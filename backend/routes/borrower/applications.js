// Classic wizard for borrowers: active draft (with returning-user prefill), history, live status events (SSE).
const { dbGet, dbAll, newId, safeJson } = require('../../services/dbHelpers');
const { isStaff, canAccessUser } = require('../../core/auth');
const { parseApp, getAppById, writeApp, nextRequestNumber } = require('../../core/applications');
const { sseClients, lastSent } = require('../../core/sse');

function evaluateReusableDocuments(documents, residencyDetails, sourceAppId) {
  const reusableDocs = [];
  const docValidityReport = [];

  if (Array.isArray(documents)) {
    for (const d of documents) {
      if (!d || !d.documentTypeCode) continue;

      let isValid = true;
      let reason = 'Reused from previous verified records on file';

      // Visa validity check: must have >= 6 months remaining
      if (d.documentTypeCode === 'WORK_VISA' || d.documentTypeCode === 'WORKERS_CARD') {
        const expiry = residencyDetails?.visaExpiryDate;
        if (expiry) {
          const expDate = new Date(expiry);
          const sixMonthsFromNow = new Date();
          sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
          if (expDate < sixMonthsFromNow) {
            isValid = false;
            reason = 'Visa expires in under 6 months or is expired. Please upload renewed visa permit.';
          }
        }
      }

      // Pay slip check: must be recent (past 90 days)
      if (d.documentTypeCode === 'PAY_SLIP') {
        const uploadedDate = new Date(d.uploadedAt || 0);
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        if (uploadedDate < ninetyDaysAgo) {
          isValid = false;
          reason = 'Pay slip is older than 3 months. Israeli lending rules require recent proof of income.';
        }
      }

      docValidityReport.push({
        documentTypeCode: d.documentTypeCode,
        originalFilename: d.originalFilename,
        isValid,
        reason,
      });

      if (isValid) {
        reusableDocs.push({
          ...d,
          isReused: true,
          reusedFromAppId: sourceAppId || d.reusedFromAppId,
          validityStatus: 'valid',
          validityReason: reason,
        });
      }
    }
  }

  return { reusableDocs, docValidityReport };
}

function register(app) {
  app.get('/api/applications/active/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!canAccessUser(req, userId)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const userRow = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    const userProfile = safeJson(userRow?.profileData, null);

    // Check if returning user with prior submitted application
    const prevRow = await dbGet('SELECT * FROM applications WHERE userId = ? AND isSubmitted = 1 ORDER BY submittedAt DESC LIMIT 1', [userId]);
    const prevApp = parseApp(prevRow);

    // Fallback to most recent application with borrowerDetails if no submitted app exists
    let fallbackApp = prevApp;
    if (!fallbackApp) {
      const filledRow = await dbGet(
        'SELECT * FROM applications WHERE userId = ? AND borrowerDetails IS NOT NULL AND (flowVersion IS NULL OR flowVersion != 2 OR step1SubmittedAt IS NOT NULL) ORDER BY updatedAt DESC LIMIT 1',
        [userId]
      );
      fallbackApp = parseApp(filledRow);
    }

    const sourceData = userProfile || fallbackApp || {};
    const hasSavedInfo = !!(
      (sourceData.borrowerDetails && sourceData.borrowerDetails.passportNumber) ||
      prevApp ||
      userProfile
    );

    const row = await dbGet(
      'SELECT * FROM applications WHERE userId = ? AND isSubmitted = 0 AND (flowVersion IS NULL OR flowVersion != 2) ORDER BY createdAt DESC LIMIT 1',
      [userId]
    );
    if (row) {
      const activeApp = parseApp(row);
      let draftUpdated = false;

      // If active draft is missing personal details or documents, auto-fill from saved profile / previous application
      if ((!activeApp.borrowerDetails || !activeApp.borrowerDetails.passportNumber) && (sourceData.borrowerDetails || userRow?.fullName)) {
        activeApp.borrowerDetails = {
          fullName: sourceData.borrowerDetails?.fullName || userRow?.fullName || '',
          passportNumber: sourceData.borrowerDetails?.passportNumber || '',
          countryOfOrigin: sourceData.borrowerDetails?.countryOfOrigin || '',
          dateOfBirth: sourceData.borrowerDetails?.dateOfBirth || '',
          mobilePhoneNumber: sourceData.borrowerDetails?.mobilePhoneNumber || userRow?.phoneNumber || '',
          addressCity: sourceData.borrowerDetails?.addressCity || '',
          addressStreet: sourceData.borrowerDetails?.addressStreet || '',
          addressFull: sourceData.borrowerDetails?.addressFull || '',
          maritalStatus: sourceData.borrowerDetails?.maritalStatus || 'Single',
          otherMaritalStatusDetails: sourceData.borrowerDetails?.otherMaritalStatusDetails,
        };
        draftUpdated = true;
      }

      if (!activeApp.residencyDetails && sourceData.residencyDetails) {
        activeApp.residencyDetails = sourceData.residencyDetails;
        draftUpdated = true;
      }

      if (!activeApp.employmentDetails && sourceData.employmentDetails) {
        activeApp.employmentDetails = sourceData.employmentDetails;
        draftUpdated = true;
      }

      if (!activeApp.bankAccount && sourceData.bankAccount) {
        activeApp.bankAccount = sourceData.bankAccount;
        activeApp.bankAccountConfirmed = sourceData.bankAccountConfirmed || false;
        draftUpdated = true;
      }

      if ((!activeApp.guarantors || activeApp.guarantors.length === 0) && (sourceData.guarantors?.length || sourceData.guarantor?.hasGuarantor)) {
        activeApp.guarantors = sourceData.guarantors || (sourceData.guarantor?.hasGuarantor ? [sourceData.guarantor] : []);
        activeApp.guarantor = sourceData.guarantor || activeApp.guarantor;
        draftUpdated = true;
      }

      if ((!activeApp.documents || activeApp.documents.length === 0) && Array.isArray(sourceData.documents) && sourceData.documents.length > 0) {
        const { reusableDocs } = evaluateReusableDocuments(sourceData.documents, sourceData.residencyDetails, sourceData.id);
        if (reusableDocs.length > 0) {
          activeApp.documents = reusableDocs;
          draftUpdated = true;
        }
      }

      if (hasSavedInfo) {
        activeApp.isReturningUser = true;
      }

      if (draftUpdated) {
        await writeApp(activeApp);
      }

      return res.json({ success: true, application: activeApp, isReturningUser: !!activeApp.isReturningUser });
    }

    const now = new Date().toISOString();
    const reqNum = await nextRequestNumber();

    // Evaluate previous documents for safe reuse
    const { reusableDocs, docValidityReport } = evaluateReusableDocuments(
      sourceData.documents || [],
      sourceData.residencyDetails,
      sourceData.id
    );

    const draft = {
      id: newId('app'),
      userId,
      requestNumber: reqNum,
      isSubmitted: false,
      status: 'Received',
      currentStep: hasSavedInfo ? 6 : 3,
      isReturningUser: hasSavedInfo,
      borrowerDetails: sourceData.borrowerDetails ? { ...sourceData.borrowerDetails } : {
        fullName: userRow?.fullName || '',
        mobilePhoneNumber: userRow?.phoneNumber || '',
        passportNumber: '',
        countryOfOrigin: '',
        dateOfBirth: '',
        addressCity: '',
        addressStreet: '',
        addressFull: '',
        maritalStatus: 'Single',
      },
      residencyDetails: sourceData.residencyDetails ? { ...sourceData.residencyDetails } : undefined,
      employmentDetails: sourceData.employmentDetails ? { ...sourceData.employmentDetails } : undefined,
      bankAccount: sourceData.bankAccount ? { ...sourceData.bankAccount } : undefined,
      bankAccountConfirmed: sourceData ? !!sourceData.bankAccountConfirmed : false,
      guarantor: sourceData.guarantor ? { ...sourceData.guarantor } : { hasGuarantor: false },
      guarantors: sourceData.guarantors || (sourceData.guarantor?.hasGuarantor ? [sourceData.guarantor] : []),
      documents: reusableDocs,
      consents: [],
      statusHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    await writeApp(draft);
    res.json({
      success: true,
      application: draft,
      isReturningUser: hasSavedInfo,
      previousDocumentsReport: docValidityReport,
    });
  });

  // Phase 6: all submitted applications for a borrower
  app.get('/api/applications/history/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!canAccessUser(req, userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
    const rows = await dbAll('SELECT * FROM applications WHERE userId = ? AND isSubmitted = 1 ORDER BY submittedAt DESC', [userId]);
    const apps = rows.map(parseApp).map((a) => {
      // Risk scoring is an internal underwriting signal — not shown to borrowers.
      if (!isStaff(req)) { delete a.riskScore; delete a.riskLevel; delete a.riskFlags; }
      return a;
    });
    res.json({ success: true, applications: apps });
  });

  // Phase 4: Server-Sent Events stream for a single application
  app.get('/api/applications/:id/events', async (req, res) => {
    const a = await getAppById(req.params.id);
    if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
    if (!canAccessUser(req, a.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: 5000\nevent: connected\ndata: ${JSON.stringify({ applicationId: a.id, status: a.status })}\n\n`);

    if (!sseClients.has(a.id)) sseClients.set(a.id, new Set());
    sseClients.get(a.id).add(res);
    // Baseline for the status poller (core/ssePoller.js): changes after this moment are reported.
    if (!lastSent.has(a.id)) lastSent.set(a.id, { status: a.status, flowStatus: a.flowStatus, updatedAt: a.updatedAt });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      const set = sseClients.get(a.id);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          sseClients.delete(a.id);
          lastSent.delete(a.id);
        }
      }
    });
  });
}

module.exports = { register };
