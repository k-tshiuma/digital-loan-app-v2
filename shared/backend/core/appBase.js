// The parts every backend app shares: middleware, the 3-step flow route factory, health, 404 and errors.
// Used by borrower-app/backend/server.js, admin-app/backend/server.js and the combined test harness.
const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('../database'); // opens the database (and creates the schema unless DB_INIT=false)
const { sendSms } = require('../services/smsService');
const { sendEmail } = require('../services/emailService');
const { resolveMessageLanguage } = require('../services/messages');
const createFlowRoutes = require('../routes/flow');
const { IS_PRODUCTION, DEMO_MODE, JWT_SECRET, BCRYPT_ROUNDS } = require('./config');
const { normalizePhone, sanitizeUser, signUserToken, isStaff, requireStaff, checkOtp } = require('./auth');
const { parseApp, nextRequestNumber } = require('./applications');
const { broadcastAppEvent } = require('./sse');
const { notifyStatusChange } = require('./notifications');

/**
 * TRUST_PROXY: set it when the API runs behind a reverse proxy (nginx), so req.ip is the visitor's address
 * instead of the proxy's. Rate limits and audit IPs depend on it. Same values as Express's 'trust proxy'
 * setting: true/false, a hop count, or addresses such as "loopback". Unset: no proxy is trusted.
 */
function trustProxySetting(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}

/**
 * Without Twilio or SMTP settings, SMS and email are only written to the log (including login codes) and
 * reported as sent, so borrowers would never receive them. Fine locally; in production it is a setup error.
 */
function warnMissingProductionSettings() {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN || !process.env.TWILIO_FROM) {
    console.warn('WARNING: TWILIO_SID/TWILIO_TOKEN/TWILIO_FROM not set: SMS (including login codes) are only logged, not sent.');
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('WARNING: SMTP_USER/SMTP_PASS not set: emails are only logged, not sent.');
  }
}

/**
 * Creates the app with the common middleware, then `authMiddleware` (optionalAuth, or the admin backend's
 * staffOnlyAuth), then GET /api/health. Returns the app and this app's flow routes.
 */
function createBaseApp({ authMiddleware, service }) {
  if (IS_PRODUCTION) warnMissingProductionSettings();
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(authMiddleware);

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

  app.get('/api/health', (_req, res) => res.json({ success: true, demoMode: DEMO_MODE, ...(service ? { service } : {}) }));
  return { app, flowRoutes };
}

/** Adds the 404 for unknown /api routes and the error handler. Call after every route is registered. */
function finishApp(app) {
  app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    // By name too: the borrower backend's upload route may load its own copy of multer, and instanceof
    // fails across copies (two npm workspaces can each get one).
    if (err instanceof multer.MulterError || (err && err.name === 'MulterError')) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : (err.field || err.message);
      return res.status(400).json({ success: false, error: msg });
    }
    console.error('[SERVER ERROR]', err);
    res.status(500).json({ success: false, error: IS_PRODUCTION ? 'Internal server error' : err.message });
  });
  return app;
}

module.exports = { createBaseApp, finishApp };
