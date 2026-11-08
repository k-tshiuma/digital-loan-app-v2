// Admin backend (default port 5100): staff sign-in, application lists and details, decisions, messages,
// audit, analytics, credit rules, the staff PDF and read-only document access. Only valid staff tokens
// are accepted, and there is no demo identity, even in demo mode.
// Runs next to borrower-server.js on the same database and uploads folder (DB_PATH, UPLOAD_DIR). Start it
// with DB_INIT=false: the borrower backend owns the schema.
const dotenv = require('dotenv');
dotenv.config();
// Both backends read backend/.env locally, so the admin backend has its own port variable and never owns
// the schema unless DB_INIT=true is set for it explicitly.
if (process.env.DB_INIT === undefined) process.env.DB_INIT = 'false';

const { DEMO_MODE } = require('./core/config');
const { staffOnlyAuth, authenticateStaff } = require('./core/auth');
const { createBaseApp, finishApp } = require('./core/appBase');
const { prefixConsole } = require('./core/logPrefix');

const adminStaffAuth = require('./routes/admin/staffAuth');
const adminApplications = require('./routes/admin/applications');
const adminNotifications = require('./routes/admin/notifications');
const adminAnalytics = require('./routes/admin/analytics');
const adminConfig = require('./routes/admin/config');
const sharedAccounts = require('./routes/shared/accounts');
const sharedApplications = require('./routes/shared/applications');

const PORT = process.env.ADMIN_PORT || 5100;
const { app, flowRoutes } = createBaseApp({ authMiddleware: staffOnlyAuth, service: 'admin' });

// Public routes, before `authenticateStaff`. The demo role-picker answers 404 outside demo mode.
adminStaffAuth.register(app);
flowRoutes.registerStaffPublic(app);

app.use('/api', authenticateStaff);

flowRoutes.registerStaff(app);
sharedAccounts.register(app);
sharedApplications.register(app);
adminApplications.register(app, { flowRoutes });
adminNotifications.register(app);
adminAnalytics.register(app);
adminConfig.register(app);

finishApp(app);

if (require.main === module) {
  prefixConsole('admin');
  app.listen(PORT, () => {
    console.log(`API on port ${PORT}${DEMO_MODE ? ' (demo mode)' : ''}`);
  });
}

module.exports = app;
