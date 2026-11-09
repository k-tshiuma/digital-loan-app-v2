// Routes used by both borrowers and staff; each branches on isStaff(req). Document download, application read and save, PDF.
const path = require('path');
const fs = require('fs');
const { dbGet, dbRun, newId, safeJson } = require('../../services/dbHelpers');
const { UPLOAD_DIR } = require('../../core/config');
const { isStaff, canAccessUser } = require('../../core/auth');
const { parseApp, getAppById, writeApp, nextRequestNumber, applyRiskScore } = require('../../core/applications');
const { broadcastAppEvent } = require('../../core/sse');
const { notifyStatusChange } = require('../../core/notifications');
const { streamApplicationPdf } = require('../../services/pdfService');

function register(app) {
  app.get('/api/uploads/:filename', async (req, res) => {
    const filename = path.basename(req.params.filename); // blocks path traversal
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found' });

    // Secure document authorization check
    const fileMeta = await dbGet('SELECT * FROM uploaded_files WHERE filename = ?', [filename]);
    if (fileMeta && !canAccessUser(req, fileMeta.userId)) {
      return res.status(403).json({ success: false, error: 'Forbidden: You do not have permission to view this document.' });
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  });

  app.get('/api/applications/:id', async (req, res) => {
    const a = await getAppById(req.params.id);
    if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
    if (!canAccessUser(req, a.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
    if (!isStaff(req)) { delete a.riskScore; delete a.riskLevel; delete a.riskFlags; }
    res.json({ success: true, application: a });
  });

  // Create-or-update. Borrowers may only edit their own drafts; once submitted, status and underwriting
  // fields are server-controlled. Staff may update any application (used for status changes / sync).
  app.put('/api/applications/:id', async (req, res) => {
    const { id } = req.params;
    const incoming = req.body || {};
    const now = new Date().toISOString();
    const prev = await getAppById(id);

    if (prev && !canAccessUser(req, prev.userId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    // Lock legacy PUT for 3-step approval workflow applications (flowVersion = 2)
    if (prev && prev.flowVersion === 2) {
      return res.status(409).json({
        success: false,
        code: 'FLOW_V2_LOCKED',
        error: 'This application uses the 3-step approval workflow and must be updated via /api/flow endpoints.',
      });
    }

    const next = { ...incoming, id, updatedAt: now, createdAt: (prev && prev.createdAt) || incoming.createdAt || now };
    // Risk data and eligibility scores are computed server-side only to prevent tampering.
    delete next.riskScore; delete next.riskLevel; delete next.riskFlags;
    delete next.eligibilityScore; delete next.eligibilityBreakdown;

    if (isStaff(req)) {
      next.userId = (prev && prev.userId) || incoming.userId;
      if (!next.userId) return res.status(400).json({ success: false, error: 'userId is required' });
    } else {
      next.userId = req.auth.sub;

      if (prev && prev.isSubmitted) {
        // Immutable after submission (borrower side)
        ['requestNumber', 'submittedAt', 'borrowerDetails', 'residencyDetails', 'employmentDetails',
          'loanRequest', 'guarantor', 'guarantors', 'consents', 'digitalSignature', 'language'].forEach((f) => { next[f] = prev[f]; });
        next.isSubmitted = true;

        // Only allowed borrower status transition: re-submitting after uploading a requested document.
        const resubmitting = prev.status === 'Additional Document Required' && incoming.status === 'Under Review';
        if (resubmitting) {
          // Fixed reason texts below are stored in English and translated for display by the frontend
          // (DEFAULT_STATUS_REASONS in frontend/src/i18n/options.ts; a test keeps the two in sync).
          const latest = (incoming.statusHistory || [])[0];
          const entry = {
            id: (latest && latest.id) || newId('sh'),
            applicationId: id,
            fromStatus: prev.status,
            toStatus: 'Under Review',
            changedByType: 'borrower',
            changedByName: (prev.borrowerDetails && prev.borrowerDetails.fullName) || 'Borrower',
            reason: (latest && latest.toStatus === 'Under Review' && latest.reason) || 'Borrower uploaded the requested document.',
            createdAt: now,
          };
          next.statusHistory = [entry, ...(prev.statusHistory || [])];
          next.missingDocumentNotes = null;
        } else {
          next.status = prev.status;
          next.statusHistory = prev.statusHistory;
          next.missingDocumentNotes = prev.missingDocumentNotes;
        }
      } else if (incoming.isSubmitted) {
        // First submission
        next.status = 'Received';
        next.submittedAt = now;
        const history = Array.isArray(incoming.statusHistory) ? incoming.statusHistory.filter((h) => h.changedByType === 'borrower') : [];
        next.statusHistory = history.length > 0 ? history : [{
          id: newId('sh'), applicationId: id, fromStatus: null, toStatus: 'Received', changedByType: 'borrower',
          changedByName: (incoming.borrowerDetails && incoming.borrowerDetails.fullName) || 'Borrower',
          reason: 'Application submitted with signed consents and uploaded documentation.', createdAt: now,
        }];
      } else {
        next.status = 'Received';
        next.isSubmitted = false;
        next.statusHistory = [];
      }
    }

    // Server owns request-number uniqueness for submitted applications.
    if (next.isSubmitted) {
      const clash = next.requestNumber
        ? await dbGet('SELECT id FROM applications WHERE requestNumber = ? AND id != ?', [next.requestNumber, id])
        : null;
      if (!next.requestNumber || clash) next.requestNumber = await nextRequestNumber();
      if (!next.submittedAt) next.submittedAt = now;
    }

    // Phase 8: advisory pre-screening on every save of a submitted application
    if (next.isSubmitted) await applyRiskScore(next);

    await writeApp(next);

    // Update user profile in users table so personal details and documents are permanently associated with this account
    if (next.userId && next.userId !== 'demo_user') {
      try {
        const userToUpdate = await dbGet('SELECT * FROM users WHERE id = ?', [next.userId]);
        if (userToUpdate) {
          const existingProf = safeJson(userToUpdate.profileData, {});
          const profilePayload = {
            borrowerDetails: next.borrowerDetails || existingProf.borrowerDetails,
            residencyDetails: next.residencyDetails || existingProf.residencyDetails,
            employmentDetails: next.employmentDetails || existingProf.employmentDetails,
            bankAccount: next.bankAccount || existingProf.bankAccount,
            bankAccountConfirmed: next.bankAccountConfirmed ?? existingProf.bankAccountConfirmed,
            guarantors: next.guarantors || existingProf.guarantors,
            guarantor: next.guarantor || existingProf.guarantor,
            documents: next.documents || existingProf.documents,
          };
          const updatedName = (next.borrowerDetails && next.borrowerDetails.fullName) || userToUpdate.fullName;
          await dbRun(
            'UPDATE users SET fullName = ?, profileData = ?, updatedAt = ? WHERE id = ?',
            [updatedName, JSON.stringify(profilePayload), now, next.userId]
          );
        }
      } catch (e) {
        console.warn('[USER PROFILE UPDATE]', e.message);
      }
    }

    const saved = await getAppById(id);

    // Phase 4 + 5: status-change hook (also fires on first submission)
    const newlySubmitted = saved.isSubmitted && !(prev && prev.isSubmitted);
    const statusChanged = saved.isSubmitted && prev && prev.isSubmitted && prev.status !== saved.status;
    if (newlySubmitted || statusChanged) {
      notifyStatusChange(saved, newlySubmitted ? null : prev.status).catch((err) => console.error('[NOTIFY]', err.message));
    } else if (saved.isSubmitted) {
      broadcastAppEvent(id, 'updated', { applicationId: id, status: saved.status, updatedAt: saved.updatedAt });
    }

    if (!isStaff(req)) { delete saved.riskScore; delete saved.riskLevel; delete saved.riskFlags; }
    res.json({ success: true, application: saved });
  });

  // Phase 7: PDF export (supports GET and POST with optional application fallback payload)
  app.all('/api/applications/:id/pdf', async (req, res) => {
    let a = await getAppById(req.params.id);

    // If not found in DB, check if client provided the application object in request body
    if (!a && req.body && (req.body.id || req.body.borrowerDetails)) {
      const candidate = req.body.application || req.body;
      a = parseApp(candidate);
      if (a && (a.id || a.requestNumber)) {
        if (!a.id) a.id = req.params.id;
        try {
          await writeApp(a);
        } catch (e) {
          console.warn('Could not auto-persist application from PDF request:', e.message);
        }
      }
    }

    if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
    if (!canAccessUser(req, a.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });

    try {
      // ?lang=he|en picks the PDF language (staff send their UI language); default: the application's language.
      // Staff copies mask the bank account number; the borrower's own copy shows it in full.
      streamApplicationPdf(a, res, { includeRisk: isStaff(req), maskBankAccount: isStaff(req), lang: req.query.lang });
    } catch (err) {
      console.error('Error generating PDF:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to generate PDF summary' });
      }
    }
  });
}

module.exports = { register };
