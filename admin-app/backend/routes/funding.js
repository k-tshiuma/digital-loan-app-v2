// "Push to partner": sending approved loans to the funding partner (shared/backend/services/funding/).
//   GET  /api/flow/applications/:id/funding                  partner, consent, hand-offs and what this role may do
//   POST /api/flow/applications/:id/funding/push             send (or send again after a failure)
//   POST /api/flow/applications/:id/funding/refresh          ask the partner for its status now
//   POST /api/flow/applications/:id/funding/consent-request  remind the applicant to accept the updated terms
const { requireStaff } = require('@quickloan/backend-core/core/auth');
const { UPLOAD_DIR } = require('@quickloan/backend-core/core/config');
const W = require('@quickloan/backend-core/services/workflow');
const { createFundingService } = require('@quickloan/backend-core/services/funding/fundingHandoff');

function register(app, { flowRoutes }) {
  const funding = createFundingService({
    getFlowAppById: flowRoutes.getFlowAppById,
    updateFlowApp: flowRoutes.updateFlowApp,
    audit: flowRoutes.audit,
    notifier: flowRoutes.notifier,
    uploadDir: UPLOAD_DIR,
  });
  const reply = (res) => (r) => res.status(r.status).json(r.body);

  app.get('/api/flow/applications/:id/funding', requireStaff(...W.VIEW_ROLES), async (req, res) => {
    const a = await flowRoutes.getFlowAppById(req.params.id);
    if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
    res.json({ success: true, ...(await funding.overview(a, req.auth.role)) });
  });

  app.post('/api/flow/applications/:id/funding/push', requireStaff(...W.FUNDING_PUSH_ROLES), async (req, res) => {
    reply(res)(await funding.push(req.params.id, req));
  });

  app.post('/api/flow/applications/:id/funding/refresh', requireStaff(...W.FUNDING_PUSH_ROLES), async (req, res) => {
    reply(res)(await funding.refreshForApplication(req.params.id, req));
  });

  app.post('/api/flow/applications/:id/funding/consent-request', requireStaff(...W.FUNDING_PUSH_ROLES), async (req, res) => {
    reply(res)(await funding.requestConsent(req.params.id, req));
  });

  return funding;
}

module.exports = { register };
