// The parts every backend app shares: middleware, the 3-step flow route factory, health, 404 and errors.
// Used by server.js (both portals in one process), borrower-server.js and admin-server.js.
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
 * Creates the app with the common middleware, then `authMiddleware` (optionalAuth, or the admin backend's
 * staffOnlyAuth), then GET /api/health. Returns the app and this app's flow routes.
 */
function createBaseApp({ authMiddleware, service }) {
  const app = express();
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
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : (err.field || err.message);
      return res.status(400).json({ success: false, error: msg });
    }
    console.error('[SERVER ERROR]', err);
    res.status(500).json({ success: false, error: IS_PRODUCTION ? 'Internal server error' : err.message });
  });
  return app;
}

module.exports = { createBaseApp, finishApp };
