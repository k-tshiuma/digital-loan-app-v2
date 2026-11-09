// Both portals in one process, as the single backend was before the split. Test harness only: the older
// integration tests run against it. The real backends are borrower-app/backend and admin-app/backend.
require('@quickloan/backend-core/loadEnv').loadEnv(); // the repo-root .env, before any setting is read

const { DEMO_MODE } = require('@quickloan/backend-core/core/config');
const { authenticate, optionalAuth } = require('@quickloan/backend-core/core/auth');
const { createBaseApp, finishApp } = require('@quickloan/backend-core/core/appBase');

// Routes, grouped by who uses them (docs/app-separation-plan.md).
const borrowerAuth = require('../../borrower-app/backend/routes/auth');
const borrowerUploads = require('../../borrower-app/backend/routes/uploads');
const borrowerApplications = require('../../borrower-app/backend/routes/applications');
const borrowerNotifications = require('../../borrower-app/backend/routes/notifications');
const adminStaffAuth = require('../../admin-app/backend/routes/staffAuth');
const adminApplications = require('../../admin-app/backend/routes/applications');
const adminNotifications = require('../../admin-app/backend/routes/notifications');
const adminAnalytics = require('../../admin-app/backend/routes/analytics');
const adminConfig = require('../../admin-app/backend/routes/config');
const sharedAccounts = require('@quickloan/backend-core/routes/shared/accounts');
const sharedApplications = require('@quickloan/backend-core/routes/shared/applications');

const PORT = process.env.PORT || 5000;
const { app, flowRoutes } = createBaseApp({ authMiddleware: optionalAuth });

// ===========================================================================
// PUBLIC ROUTES (no token required). They must be registered before `authenticate` below.
// ===========================================================================
borrowerAuth.register(app);
adminStaffAuth.register(app);
flowRoutes.registerApplicantPublic(app);
flowRoutes.registerStaffPublic(app);

// ===========================================================================
// PROTECTED ROUTES — everything below requires a valid JWT
// ===========================================================================
app.use('/api', authenticate);

flowRoutes.registerApplicant(app);
flowRoutes.registerStaff(app);

sharedAccounts.register(app);

borrowerUploads.register(app);
// Before sharedApplications: /api/applications/active/:userId and /history/:userId must be matched
// before /api/applications/:id/pdf, which would otherwise catch e.g. /api/applications/active/pdf.
borrowerApplications.register(app);
borrowerNotifications.register(app);

sharedApplications.register(app);

adminApplications.register(app, { flowRoutes });
adminNotifications.register(app);
adminAnalytics.register(app);
adminConfig.register(app);

finishApp(app);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}${DEMO_MODE ? ' (demo mode: fixed OTP + staff role tokens enabled)' : ''}`);
  });
}

module.exports = app;
