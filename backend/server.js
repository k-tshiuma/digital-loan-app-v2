// Both portals in one process: the original single backend, kept for rollback and for the existing tests.
// The split backends are borrower-server.js (port 5000) and admin-server.js (port 5100).
const dotenv = require('dotenv');
dotenv.config();

const { DEMO_MODE } = require('./core/config');
const { authenticate, optionalAuth } = require('./core/auth');
const { createBaseApp, finishApp } = require('./core/appBase');

// Routes, grouped by who uses them (docs/app-separation-plan.md).
const borrowerAuth = require('./routes/borrower/auth');
const borrowerUploads = require('./routes/borrower/uploads');
const borrowerApplications = require('./routes/borrower/applications');
const borrowerNotifications = require('./routes/borrower/notifications');
const adminStaffAuth = require('./routes/admin/staffAuth');
const adminApplications = require('./routes/admin/applications');
const adminNotifications = require('./routes/admin/notifications');
const adminAnalytics = require('./routes/admin/analytics');
const adminConfig = require('./routes/admin/config');
const sharedAccounts = require('./routes/shared/accounts');
const sharedApplications = require('./routes/shared/applications');

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
