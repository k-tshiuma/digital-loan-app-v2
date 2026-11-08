const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('./database'); // opens the database and creates the schema
const { sendSms } = require('./services/smsService');
const { sendEmail } = require('./services/emailService');
const { resolveMessageLanguage } = require('./services/messages');
const createFlowRoutes = require('./routes/flow');
const { IS_PRODUCTION, DEMO_MODE, JWT_SECRET, BCRYPT_ROUNDS } = require('./core/config');
const {
  normalizePhone, sanitizeUser, signUserToken, authenticate, optionalAuth, isStaff, requireStaff, checkOtp,
} = require('./core/auth');
const { parseApp, nextRequestNumber } = require('./core/applications');
const { broadcastAppEvent } = require('./core/sse');
const { notifyStatusChange } = require('./core/notifications');

// Routes, grouped by who uses them (docs/app-separation-plan.md). After the split each backend mounts
// its own group plus the shared one.
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

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(optionalAuth);

const flowRoutes = createFlowRoutes({
  DEMO_MODE,
  BCRYPT_ROUNDS,
  JWT_SECRET,
  normalizePhone,
  sanitizeUser,
  signUserToken,
  isStaff,
  requireStaff,
  checkOtp,
  nextRequestNumber,
  parseApp,
  broadcastAppEvent,
  sendSms,
  sendEmail,
  notifyStatusChange,
  resolveMessageLanguage,
});

// ===========================================================================
// PUBLIC ROUTES (no token required). They must be registered before `authenticate` below.
// ===========================================================================
app.get('/api/health', (_req, res) => res.json({ success: true, demoMode: DEMO_MODE }));

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

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : (err.field || err.message);
    return res.status(400).json({ success: false, error: msg });
  }
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ success: false, error: IS_PRODUCTION ? 'Internal server error' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}${DEMO_MODE ? ' (demo mode: fixed OTP + staff role tokens enabled)' : ''}`);
  });
}

module.exports = app;
