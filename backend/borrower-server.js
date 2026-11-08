// Borrower backend (default port 5000): sign-in, uploads, the classic wizard and the 3-step applicant
// steps, notifications, live status events, the borrower's own PDF. Staff tokens are refused.
// Runs next to admin-server.js on the same database and uploads folder (DB_PATH, UPLOAD_DIR).
// This process owns the schema: start it with DB_INIT unset or true, and the admin backend with DB_INIT=false.
const dotenv = require('dotenv');
dotenv.config();

const { DEMO_MODE } = require('./core/config');
const { authenticate, optionalAuth, rejectStaffTokens } = require('./core/auth');
const { createBaseApp, finishApp } = require('./core/appBase');
const { startStatusPoller } = require('./core/ssePoller');
const { prefixConsole } = require('./core/logPrefix');

const borrowerAuth = require('./routes/borrower/auth');
const borrowerUploads = require('./routes/borrower/uploads');
const borrowerApplications = require('./routes/borrower/applications');
const borrowerNotifications = require('./routes/borrower/notifications');
const sharedAccounts = require('./routes/shared/accounts');
const sharedApplications = require('./routes/shared/applications');

const PORT = process.env.BORROWER_PORT || process.env.PORT || 5000;
const { app, flowRoutes } = createBaseApp({ authMiddleware: optionalAuth, service: 'borrower' });
app.use(rejectStaffTokens);

// Public routes, before `authenticate`.
borrowerAuth.register(app);
flowRoutes.registerApplicantPublic(app);

app.use('/api', authenticate);

flowRoutes.registerApplicant(app);
sharedAccounts.register(app);
borrowerUploads.register(app);
// Before sharedApplications: /api/applications/active/:userId and /history/:userId must be matched
// before /api/applications/:id/pdf, which would otherwise catch e.g. /api/applications/active/pdf.
borrowerApplications.register(app);
borrowerNotifications.register(app);
sharedApplications.register(app);

finishApp(app);

if (require.main === module) {
  prefixConsole('borrower');
  // Staff decisions happen in the admin process; this picks them up for open status streams.
  startStatusPoller({ intervalMs: parseInt(process.env.SSE_POLL_MS || '5000', 10) });
  app.listen(PORT, () => {
    console.log(`API on port ${PORT}${DEMO_MODE ? ' (demo mode)' : ''}`);
  });
}

module.exports = app;
