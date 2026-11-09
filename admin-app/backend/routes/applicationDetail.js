// One classic application for staff: read (with risk data), save (status changes and sync), PDF; and any
// uploaded document. Only staff reach these routes (staffOnlyAuth + authenticateStaff in server.js).
// The borrower side is in borrower-app/backend/routes/applicationDetail.js.
const { getAppById } = require('@quickloan/backend-core/core/applications');
const {
  refuseFlowApplication, draftFromRequest, saveClassicApplication, applicationForPdf, uploadedFile, sendUploadedFile,
} = require('@quickloan/backend-core/core/classicApplications');
const { streamApplicationPdf } = require('@quickloan/backend-core/services/pdfService');

function register(app) {
  // Staff may open any applicant's document.
  app.get('/api/uploads/:filename', async (req, res) => {
    const file = await uploadedFile(req.params.filename);
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    sendUploadedFile(res, file.filePath);
  });

  app.get('/api/applications/:id', async (req, res) => {
    const a = await getAppById(req.params.id);
    if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
    res.json({ success: true, application: a });
  });

  // Create-or-update any classic application (status changes, Back Office sync).
  app.put('/api/applications/:id', async (req, res) => {
    const { id } = req.params;
    const incoming = req.body || {};
    const now = new Date().toISOString();
    const prev = await getAppById(id);
    if (refuseFlowApplication(prev, res)) return;

    const next = await draftFromRequest(id, incoming, prev, now);
    next.userId = (prev && prev.userId) || incoming.userId;
    if (!next.userId) return res.status(400).json({ success: false, error: 'userId is required' });

    const saved = await saveClassicApplication(next, prev, now);
    res.json({ success: true, application: saved });
  });

  // Phase 7: PDF export. The staff copy includes the risk data and masks the bank account number. An
  // application that isn't stored (sent in the body) is only rendered, never saved.
  app.all('/api/applications/:id/pdf', async (req, res) => {
    const found = await applicationForPdf(req);
    if (!found) return res.status(404).json({ success: false, error: 'Application not found' });
    try {
      // ?lang=he|en picks the PDF language (staff send their UI language); default: the application's language.
      streamApplicationPdf(found.app, res, { includeRisk: true, maskBankAccount: true, lang: req.query.lang });
    } catch (err) {
      console.error('Error generating PDF:', err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to generate PDF summary' });
    }
  });
}

module.exports = { register };
