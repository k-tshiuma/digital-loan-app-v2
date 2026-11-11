// One classic application for its borrower: read, save, PDF; and the borrower's own uploaded documents.
// The staff side of these routes is in admin-app/backend/routes/applicationDetail.js.
const { newId } = require('@quickloan/backend-core/services/dbHelpers');
const { canAccessUser } = require('@quickloan/backend-core/core/auth');
const { getAppById } = require('@quickloan/backend-core/core/applications');
const {
  withoutRisk, refuseFlowApplication, refuseClassicDraft, draftFromRequest, saveClassicApplication, applicationForPdf, uploadedFile, sendUploadedFile,
} = require('@quickloan/backend-core/core/classicApplications');
const { streamApplicationPdf } = require('@quickloan/backend-core/services/pdfService');

function register(app) {
  app.get('/api/uploads/:filename', async (req, res) => {
    const file = await uploadedFile(req.params.filename);
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    if (file.meta && !canAccessUser(req, file.meta.userId)) {
      return res.status(403).json({ success: false, error: 'Forbidden: You do not have permission to view this document.' });
    }
    sendUploadedFile(res, file.filePath);
  });

  app.get('/api/applications/:id', async (req, res) => {
    const a = await getAppById(req.params.id);
    if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
    if (!canAccessUser(req, a.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
    res.json({ success: true, application: withoutRisk(a) });
  });

  // Create-or-update the borrower's own application. Drafts are editable; once submitted, status and
  // underwriting fields are server-controlled.
  app.put('/api/applications/:id', async (req, res) => {
    const { id } = req.params;
    const incoming = req.body || {};
    const now = new Date().toISOString();
    const prev = await getAppById(id);

    if (prev && !canAccessUser(req, prev.userId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (refuseFlowApplication(prev, res)) return;
    if (refuseClassicDraft(res, prev)) return;

    const next = await draftFromRequest(id, incoming, prev, now);
    next.userId = req.auth.sub;

    if (prev && prev.isSubmitted) {
      // Immutable after submission
      ['requestNumber', 'submittedAt', 'borrowerDetails', 'residencyDetails', 'employmentDetails',
        'loanRequest', 'guarantor', 'guarantors', 'consents', 'digitalSignature', 'language'].forEach((f) => { next[f] = prev[f]; });
      next.isSubmitted = true;

      // Only allowed status transition: re-submitting after uploading a requested document.
      const resubmitting = prev.status === 'Additional Document Required' && incoming.status === 'Under Review';
      if (resubmitting) {
        // Fixed reason texts below are stored in English and translated for display by the frontend
        // (DEFAULT_STATUS_REASONS in shared/frontend/i18n/options.ts; a contract test keeps the two in sync).
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

    const saved = await saveClassicApplication(next, prev, now);
    res.json({ success: true, application: withoutRisk(saved) });
  });

  // Phase 7: PDF export (GET, or POST with the application as an offline fallback). The borrower's own copy:
  // no risk data, full bank account. A stored application needs access; an unsaved draft sent in the body is
  // only rendered (it is the caller's own data, and nothing is stored).
  app.all('/api/applications/:id/pdf', async (req, res) => {
    const found = await applicationForPdf(req);
    if (!found) return res.status(404).json({ success: false, error: 'Application not found' });
    if (found.stored && !canAccessUser(req, found.app.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
    try {
      // ?lang=he|en picks the PDF language (the language on screen); default: the application's language.
      streamApplicationPdf(found.app, res, { includeRisk: false, maskBankAccount: false, lang: req.query.lang });
    } catch (err) {
      console.error('Error generating PDF:', err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to generate PDF summary' });
    }
  });
}

module.exports = { register };
