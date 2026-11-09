// Admin backend (default port 5100): staff sign-in, application lists and details, decisions, messages,
// audit, analytics, credit rules, the staff PDF and read-only document access. Only valid staff tokens
// are accepted, and there is no demo identity, even in demo mode.
// Runs next to borrower-app/backend on the same database and uploads folder (DB_PATH, UPLOAD_DIR). Start it
// with DB_INIT=false: the borrower backend owns the schema.
require('@quickloan/backend-core/loadEnv').loadEnv(__dirname); // backend .env files, before any setting is read
// Both backends read the repo-root .env locally, so the admin backend has its own port variable and never owns
// the schema unless DB_INIT=true is set for it explicitly.
if (process.env.DB_INIT === undefined) process.env.DB_INIT = 'false';

const { DEMO_MODE } = require('@quickloan/backend-core/core/config');
const { staffOnlyAuth, authenticateStaff } = require('@quickloan/backend-core/core/auth');
const { createBaseApp, finishApp } = require('@quickloan/backend-core/core/appBase');
const { prefixConsole } = require('@quickloan/backend-core/core/logPrefix');

const adminStaffAuth = require('./routes/staffAuth');
const adminApplications = require('./routes/applications');
const adminNotifications = require('./routes/notifications');
const adminAnalytics = require('./routes/analytics');
const adminConfig = require('./routes/config');
const adminAccount = require('./routes/account');
const adminApplicationDetail = require('./routes/applicationDetail');

const PORT = process.env.ADMIN_PORT || 5100;
// ADMIN_ALLOWED_IPS: optional office/VPN networks; other addresses get 403 (core/ipAllowlist.js).
const { app, flowRoutes } = createBaseApp({
  authMiddleware: staffOnlyAuth,
  service: 'admin',
  allowedNetworks: process.env.ADMIN_ALLOWED_IPS,
});

// Public routes, before `authenticateStaff`. The demo role-picker answers 404 outside demo mode.
adminStaffAuth.register(app);
flowRoutes.registerStaffPublic(app);

app.use('/api', authenticateStaff);

flowRoutes.registerStaff(app);
adminAccount.register(app);
adminApplicationDetail.register(app);
adminApplications.register(app, { flowRoutes });
adminNotifications.register(app);
adminAnalytics.register(app);
adminConfig.register(app);

finishApp(app);

if (require.main === module) {
  prefixConsole('admin');
  // LISTEN_HOST=127.0.0.1 in production, so the API is reachable only through the proxy. Unset: all interfaces.
  const host = process.env.LISTEN_HOST || undefined;
  app.listen(PORT, host, () => {
    console.log(`API on ${host ? `${host}:` : 'port '}${PORT}${DEMO_MODE ? ' (demo mode)' : ''}`);
  });
}

module.exports = app;
