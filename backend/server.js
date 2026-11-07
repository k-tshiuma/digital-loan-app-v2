const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('./database');
const { runCreditScreening, DEFAULT_CREDIT_RULES, normalizeRules } = require('./creditEngine');
const { calculateEligibilityScore } = require('./services/eligibilityScoring');
const { sendSms } = require('./services/smsService');
const { sendEmail } = require('./services/emailService');
const { resolveMessageLanguage, msg, statusName, statusMessage } = require('./services/messages');
const { streamApplicationPdf } = require('./services/pdfService');
const createFlowRoutes = require('./routes/flow');
const { groupOf } = require('./services/workflow');
const { ensureSeeded: ensureTermsSeeded } = require('./services/terms');

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Demo conveniences (fixed OTP 123456, role-picker staff tokens, mock Google login, codes echoed
// back in API responses). Enabled by default for local development, always off in production.
const DEMO_MODE = !IS_PRODUCTION && process.env.DEMO_MODE !== 'false';

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (IS_PRODUCTION) {
    throw new Error('JWT_SECRET must be set in production');
  }
  JWT_SECRET = 'quickloan_dev_stable_secret_key_survives_restarts_2026';
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;

const STAFF_ROLES = ['customer_service', 'credit_reviewer', 'system_admin', 'funding_entity'];
const OPEN_STATUSES = ['Received', 'Under Review', 'Additional Document Required', 'Approved', 'Forwarded to Funding Entity'];
const DECIDED_STATUSES = ['Approved', 'Rejected', 'Forwarded to Funding Entity'];

const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ---------------------------------------------------------------------------
// Small promise helpers around sqlite3
// ---------------------------------------------------------------------------
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); }));

const newId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const normalizePhone = (p) => String(p || '').replace(/[\s()-]/g, '');
const safeJson = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);
const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const generateCode = () => String(crypto.randomInt(100000, 1000000));

// ---------------------------------------------------------------------------
// Auth helpers (Phase 1)
// ---------------------------------------------------------------------------
function sanitizeUser(row) {
  if (!row) return null;
  const { password, ...rest } = row;
  return {
    ...rest,
    roles: safeJson(row.roles, ['borrower']),
    isActive: row.isActive === 1 || row.isActive === true,
    hasPassword: !!password,
  };
}

function signUserToken(user) {
  return jwt.sign(
    { sub: user.id, type: 'borrower', phone: normalizePhone(user.phoneNumber) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function signStaffToken(role) {
  return jwt.sign({ sub: `staff_${role}`, type: 'staff', role }, JWT_SECRET, { expiresIn: '12h' });
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  // EventSource and <img>/<a> requests cannot send headers, so GETs may pass ?token=
  if (req.method === 'GET' && typeof req.query.token === 'string') return req.query.token;
  return null;
}

function authenticate(req, res, next) {
  const token = readToken(req);
  if (!token) {
    if (DEMO_MODE) {
      req.auth = { sub: 'demo_user', type: 'borrower', role: 'borrower' };
      return next();
    }
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    if (DEMO_MODE) {
      const decoded = jwt.decode(token);
      if (decoded && decoded.sub) {
        req.auth = decoded;
        return next();
      }
      req.auth = { sub: 'demo_user', type: 'borrower', role: 'borrower' };
      return next();
    }
    return res.status(401).json({ success: false, error: 'Invalid or expired session. Please sign in again.' });
  }
}

/** Like authenticate, but never rejects — sets req.auth only when a valid token is present. */
function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try {
      req.auth = jwt.verify(token, JWT_SECRET);
    } catch {
      if (DEMO_MODE) {
        const decoded = jwt.decode(token);
        if (decoded && decoded.sub) req.auth = decoded;
      }
    }
  } else if (DEMO_MODE) {
    req.auth = { sub: 'demo_user', type: 'borrower', role: 'borrower' };
  }
  next();
}

app.use(optionalAuth);

const isStaff = (req) => req.auth && req.auth.type === 'staff';

function requireStaff(...roles) {
  return (req, res, next) => {
    if (!isStaff(req)) return res.status(403).json({ success: false, error: 'Back-office access required' });
    if (roles.length > 0 && !roles.includes(req.auth.role)) {
      return res.status(403).json({ success: false, error: `This action requires one of: ${roles.join(', ')}` });
    }
    return next();
  };
}

const canAccessUser = (req, userId) => isStaff(req) || (req.auth && req.auth.sub === userId) || (DEMO_MODE && (!req.headers.authorization || req.auth?.sub === 'demo_user') && userId === 'demo_user');

// In-memory OTP store: phone -> { codeHash, expiresAt, attempts }
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

function checkOtp(phoneNumber, code) {
  const phone = normalizePhone(phoneNumber);
  const cleanCode = String(code || '').trim();
  const record = otpStore.get(phone);
  let valid = false;

  if (record) {
    if (record.expiresAt < Date.now()) {
      otpStore.delete(phone);
      return { ok: false, status: 400, error: 'OTP code has expired. Please request a new code.' };
    }
    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      otpStore.delete(phone);
      return { ok: false, status: 429, error: 'Too many attempts. Please request a new code.' };
    }
    valid = record.codeHash === hashCode(cleanCode) || record.code === cleanCode;
    if (!valid) record.attempts += 1;
  }

  if (!valid && DEMO_MODE) {
    if (cleanCode === '123456' || (cleanCode.length === 6 && /^\d{6}$/.test(cleanCode))) {
      valid = true;
    }
  }

  if (!valid) {
    return { ok: false, status: 400, error: 'Incorrect verification code. Please try again.' };
  }
  otpStore.delete(phone);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Application helpers
// ---------------------------------------------------------------------------
const APP_JSON_FIELDS = [
  'borrowerDetails',
  'residencyDetails',
  'employmentDetails',
  'loanRequest',
  'guarantor',
  'digitalSignature',
  'bankAccount',
  'eligibilityBreakdown',
  'step1Data',
  'step2Data',
  'step3Data',
  'loanBreakdown',
  'staffMessage',
];
const APP_JSON_ARRAY_FIELDS = ['documents', 'consents', 'statusHistory', 'riskFlags', 'guarantors'];

function parseApp(row) {
  if (!row) return null;
  const out = { ...row };
  APP_JSON_FIELDS.forEach((f) => { out[f] = safeJson(row[f], undefined); });
  APP_JSON_ARRAY_FIELDS.forEach((f) => { out[f] = safeJson(row[f], []); });
  out.isSubmitted = row.isSubmitted === 1;
  out.bankAccountConfirmed = row.bankAccountConfirmed === 1;
  if (out.riskScore === null) delete out.riskScore;
  if (out.riskLevel === null) delete out.riskLevel;
  if (out.missingDocumentNotes === null) delete out.missingDocumentNotes;
  if (out.eligibilityScore === null || out.eligibilityScore === undefined) {
    const el = calculateEligibilityScore(out);
    out.eligibilityScore = el.rawScore;
    out.eligibilityBreakdown = el;
  }

  // Two-way synchronization between multi-guarantors array and legacy single guarantor
  if (Array.isArray(out.guarantors) && out.guarantors.length > 0) {
    const g0 = out.guarantors[0];
    if (!out.guarantor || !out.guarantor.hasGuarantor) {
      out.guarantor = {
        hasGuarantor: true,
        fullName: g0.fullName,
        passportOrIdNumber: g0.passportOrIdNumber,
        mobilePhoneNumber: g0.mobilePhoneNumber,
        relationship: g0.relationship,
        otherRelationshipDetails: g0.otherRelationshipDetails,
        passportPhoto: g0.idDocument,
      };
    }
  } else if (out.guarantor && out.guarantor.hasGuarantor) {
    out.guarantors = [{
      id: 'g_1',
      fullName: out.guarantor.fullName,
      passportOrIdNumber: out.guarantor.passportOrIdNumber,
      mobilePhoneNumber: out.guarantor.mobilePhoneNumber,
      relationship: out.guarantor.relationship,
      otherRelationshipDetails: out.guarantor.otherRelationshipDetails,
      idDocument: out.guarantor.passportPhoto,
    }];
  }

  return out;
}

/** Phase 2: once a document has a server file URL, drop any base64 copy so it is not stored in SQLite. */
function stripInlineFiles(documents) {
  return (documents || []).map((d) => {
    if (d && d.fileUrl && d.dataUrl) {
      const { dataUrl, ...rest } = d;
      return rest;
    }
    return d;
  });
}

async function getAppById(id) {
  if (!id) return null;
  return parseApp(await dbGet('SELECT * FROM applications WHERE id = ? OR requestNumber = ?', [id, id]));
}

async function writeApp(a) {
  // Sync guarantors <-> guarantor before saving
  if (Array.isArray(a.guarantors) && a.guarantors.length > 0) {
    const g0 = a.guarantors[0];
    a.guarantor = {
      hasGuarantor: true,
      fullName: g0.fullName,
      passportOrIdNumber: g0.passportOrIdNumber,
      mobilePhoneNumber: g0.mobilePhoneNumber,
      relationship: g0.relationship,
      otherRelationshipDetails: g0.otherRelationshipDetails,
      passportPhoto: g0.idDocument,
    };
  } else if (a.guarantor && a.guarantor.hasGuarantor && (!a.guarantors || a.guarantors.length === 0)) {
    a.guarantors = [{
      id: 'g_1',
      fullName: a.guarantor.fullName,
      passportOrIdNumber: a.guarantor.passportOrIdNumber,
      mobilePhoneNumber: a.guarantor.mobilePhoneNumber,
      relationship: a.guarantor.relationship,
      otherRelationshipDetails: a.guarantor.otherRelationshipDetails,
      idDocument: a.guarantor.passportPhoto,
    }];
  }

  // Authoritative server-side calculation for indicative eligibility score
  const el = calculateEligibilityScore(a);
  a.eligibilityScore = el.rawScore;
  a.eligibilityBreakdown = el;

  const cols = [
    'id', 'userId', 'requestNumber', 'isSubmitted', 'submittedAt', 'status', 'language', 'currentStep',
    'borrowerDetails', 'residencyDetails', 'employmentDetails', 'loanRequest', 'guarantor', 'documents',
    'consents', 'digitalSignature', 'statusHistory', 'riskScore', 'riskLevel', 'riskFlags',
    'missingDocumentNotes', 'bankAccountConfirmed', 'bankAccount', 'guarantors', 'eligibilityScore', 'eligibilityBreakdown',
    'createdAt', 'updatedAt',
  ];
  const values = [
    a.id, a.userId, a.requestNumber || null, a.isSubmitted ? 1 : 0, a.submittedAt || null, a.status, a.language || 'en', a.currentStep || 3,
    JSON.stringify(a.borrowerDetails ?? null), JSON.stringify(a.residencyDetails ?? null), JSON.stringify(a.employmentDetails ?? null),
    JSON.stringify(a.loanRequest ?? null), JSON.stringify(a.guarantor ?? null), JSON.stringify(stripInlineFiles(a.documents)),
    JSON.stringify(a.consents || []), JSON.stringify(a.digitalSignature ?? null), JSON.stringify(a.statusHistory || []),
    a.riskScore ?? null, a.riskLevel ?? null, JSON.stringify(a.riskFlags || []),
    a.missingDocumentNotes ?? null, a.bankAccountConfirmed ? 1 : 0, JSON.stringify(a.bankAccount ?? null),
    JSON.stringify(a.guarantors || []), a.eligibilityScore, JSON.stringify(a.eligibilityBreakdown ?? null),
    a.createdAt, a.updatedAt,
  ];
  const updates = cols.filter((c) => c !== 'id' && c !== 'createdAt').map((c) => `${c} = excluded.${c}`).join(', ');
  await dbRun(
    `INSERT INTO applications (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${updates}`,
    values
  );
}

async function nextRequestNumber() {
  const year = new Date().getFullYear();
  const rows = await dbAll('SELECT requestNumber FROM applications WHERE requestNumber LIKE ?', [`REQ-${year}-%`]);
  const max = rows.reduce((m, r) => Math.max(m, parseInt(String(r.requestNumber).split('-')[2], 10) || 0), 100);
  return `REQ-${year}-${String(max + 1).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Credit rules config (Phase 8)
// ---------------------------------------------------------------------------
async function getCreditRules() {
  const row = await dbGet('SELECT value FROM app_config WHERE key = ?', ['creditRules']);
  return normalizeRules(safeJson(row && row.value, {}));
}

async function applyRiskScore(a, rules) {
  const result = runCreditScreening(a, rules || (await getCreditRules()));
  a.riskScore = result.score;
  a.riskLevel = result.riskLevel;
  a.riskFlags = result.flags;
  return a;
}

// ---------------------------------------------------------------------------
// Real-time updates via Server-Sent Events (Phase 4)
// ---------------------------------------------------------------------------
const sseClients = new Map(); // applicationId -> Set<res>

function broadcastAppEvent(applicationId, event, payload) {
  const clients = sseClients.get(applicationId);
  if (!clients || clients.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((res) => res.write(frame));
}

// ---------------------------------------------------------------------------
// Notifications (Phase 5)
// ---------------------------------------------------------------------------
function parseNotification(row) {
  return { ...row, read: row.read === 1, applicationId: row.applicationId || undefined };
}

async function createNotification({ userId, applicationId, notificationType, title, message, language, phoneNumber, channel = 'sms' }) {
  const id = newId('notif');
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO notifications (id, userId, applicationId, channel, notificationType, title, message, deliveryStatus, read, language, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [id, userId, applicationId || null, channel, notificationType, title, message, language || 'en', now]
  );

  let deliveryStatus = 'sent';
  if (channel === 'sms' && phoneNumber) {
    const result = await sendSms(phoneNumber, `${title}: ${message}`);
    deliveryStatus = result.success ? 'delivered' : 'failed';
  }
  await dbRun('UPDATE notifications SET deliveryStatus = ? WHERE id = ?', [deliveryStatus, id]);
  return parseNotification(await dbGet('SELECT * FROM notifications WHERE id = ?', [id]));
}

// Status texts live in services/messages.js (English and Hebrew).
async function notifyStatusChange(a, previousStatus) {
  const user = await dbGet('SELECT phoneNumber, preferredLanguage FROM users WHERE id = ?', [a.userId]);
  const phoneNumber = (a.borrowerDetails && a.borrowerDetails.mobilePhoneNumber) || (user && user.phoneNumber);
  // The user's current choice wins over the language the application was filled in.
  const lang = resolveMessageLanguage(user && user.preferredLanguage, a.language);
  const isSubmission = !previousStatus;
  let message = statusMessage(lang, a.status);
  // Notes typed by staff are sent as typed.
  if (a.status === 'Additional Document Required' && a.missingDocumentNotes) message = a.missingDocumentNotes;
  if (isSubmission) message = msg(lang, 'notif.submitted', { requestNumber: a.requestNumber });

  const notification = await createNotification({
    userId: a.userId,
    applicationId: a.id,
    notificationType: isSubmission ? 'SUBMISSION_CONFIRMATION' : `STATUS_${a.status}`,
    title: isSubmission ? msg(lang, 'notif.submittedTitle') : msg(lang, 'notif.statusTitle', { status: statusName(lang, a.status) }),
    message: `[${a.requestNumber}] ${message}`,
    language: lang,
    phoneNumber,
  });

  broadcastAppEvent(a.id, 'status', {
    applicationId: a.id,
    previousStatus: previousStatus || null,
    status: a.status,
    updatedAt: a.updatedAt,
    notification,
  });
}

// ===========================================================================
// PUBLIC ROUTES (no token required)
// ===========================================================================

app.get('/api/health', (_req, res) => res.json({ success: true, demoMode: DEMO_MODE }));

// Does an account exist for this phone, and does it use a password?
app.post('/api/users/lookup', async (req, res) => {
  const phone = normalizePhone(req.body.phoneNumber);
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });
  const user = await dbGet('SELECT password FROM users WHERE phoneNumber = ?', [phone]);
  res.json({ success: true, exists: !!user, hasPassword: !!(user && user.password) });
});

app.post('/api/users/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'Phone/email and password are required.' });
  }
  const isEmail = String(identifier).includes('@');
  const user = isEmail
    ? await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [String(identifier).trim()])
    : await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [normalizePhone(identifier)]);

  if (!user) {
    return res.status(404).json({ success: false, error: 'No account found with this phone number or email.' });
  }
  if (!user.password) {
    return res.status(400).json({ success: false, error: 'This account has no password. Sign in with an SMS code instead.' });
  }

  let valid = false;
  if (isBcryptHash(user.password)) {
    valid = await bcrypt.compare(password, user.password);
  } else if (user.password === password) {
    // Legacy plaintext password: accept once and upgrade to a bcrypt hash.
    valid = true;
    await dbRun('UPDATE users SET password = ?, updatedAt = ? WHERE id = ?', [await bcrypt.hash(password, BCRYPT_ROUNDS), new Date().toISOString(), user.id]);
  }
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Incorrect password. Please try again.' });
  }

  res.json({ success: true, user: sanitizeUser(user), token: signUserToken(user) });
});

app.post('/api/users/request-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phoneNumber);
  if (!phone || phone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ success: false, error: 'Please enter a valid mobile phone number.' });
  }
  // Demo helper: numbers ending in 4567 get 123456, other test numbers get a generated code
  const code = DEMO_MODE && phone.endsWith('4567') ? '123456' : generateCode();
  otpStore.set(phone, { code, codeHash: hashCode(code), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  // The code is sent in the language on screen; for a known number without one, the account's language.
  const existing = req.body.language ? null : await dbGet('SELECT preferredLanguage FROM users WHERE phoneNumber = ?', [phone]);
  const lang = resolveMessageLanguage(req.body.language, existing && existing.preferredLanguage);
  await sendSms(phone, msg(lang, 'sms.otp', { code }));
  res.json({ success: true, expiresInSeconds: OTP_TTL_MS / 1000, ...(DEMO_MODE ? { demoCode: code } : {}) });
});

app.post('/api/users/verify-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phoneNumber);
  const code = String(req.body.code || '').trim();
  const preferredLanguage = req.body.preferredLanguage || 'en';
  
  const otpResult = checkOtp(phone, code);
  if (!otpResult.ok) {
    return res.status(otpResult.status).json({ success: false, error: otpResult.error });
  }

  const now = new Date().toISOString();
  let user = await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [phone]);
  if (!user) {
    const id = newId('user');
    await dbRun(
      `INSERT INTO users (id, phoneNumber, authProvider, phoneVerifiedAt, preferredLanguage, roles, isActive, createdAt, updatedAt)
       VALUES (?, ?, 'phone', ?, ?, ?, 1, ?, ?)`,
      [id, phone, now, preferredLanguage, JSON.stringify(['borrower']), now, now]
    );
    user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
  } else {
    await dbRun('UPDATE users SET phoneVerifiedAt = ?, updatedAt = ? WHERE id = ?', [now, now, user.id]);
  }

  res.json({ success: true, user: sanitizeUser(user), token: signUserToken(user) });
});

// Registration completes a phone-verified account: requires the token issued by /verify-otp.
app.post('/api/users/register', authenticate, async (req, res) => {
  const { fullName, email, password, preferredLanguage } = req.body;
  const phone = normalizePhone(req.body.phoneNumber);

  if (req.auth.type !== 'borrower' || req.auth.phone !== phone) {
    return res.status(403).json({ success: false, error: 'Please verify this phone number before registering.' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
  }

  const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.auth.sub]);
  if (!user) return res.status(404).json({ success: false, error: 'Account not found' });
  if (user.password) {
    return res.status(400).json({ success: false, error: 'An account with this phone number already exists. Please sign in.' });
  }
  if (email) {
    const other = await dbGet('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?', [email.trim(), user.id]);
    if (other) return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please sign in.' });
  }

  const now = new Date().toISOString();
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await dbRun(
    `UPDATE users SET fullName = ?, email = ?, password = ?, authProvider = 'password', preferredLanguage = ?, updatedAt = ? WHERE id = ?`,
    [fullName || null, email ? email.trim() : null, hash, preferredLanguage || user.preferredLanguage || 'en', now, user.id]
  );
  const updated = await dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
  res.json({ success: true, user: sanitizeUser(updated), token: signUserToken(updated) });
});

// Mock "Continue with Google" — demo only (there is no real OAuth handshake).
app.post('/api/users/google-demo', async (req, res) => {
  if (!DEMO_MODE) return res.status(404).json({ success: false, error: 'Not available' });
  const { email, name, preferredLanguage } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

  const now = new Date().toISOString();
  let user = await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
  if (user && user.authProvider !== 'google') {
    return res.status(400).json({ success: false, error: 'This email is registered with a password. Please sign in with your phone number.' });
  }
  if (!user) {
    const id = newId('user_google');
    await dbRun(
      `INSERT INTO users (id, phoneNumber, email, fullName, authProvider, phoneVerifiedAt, preferredLanguage, roles, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'google', ?, ?, ?, 1, ?, ?)`,
      [id, `google:${email.toLowerCase()}`, email, name || null, now, preferredLanguage || 'en', JSON.stringify(['borrower']), now, now]
    );
    user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
  }
  res.json({ success: true, user: sanitizeUser(user), token: signUserToken(user) });
});

// Forgot password: send a 6-digit reset code via SMS (and email if available).
app.post('/api/users/forgot-password', async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  if (!identifier) return res.status(400).json({ success: false, error: 'Phone number or email is required' });

  const isEmail = identifier.includes('@');
  const user = isEmail
    ? await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [identifier])
    : await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [normalizePhone(identifier)]);

  // Always respond the same way so the endpoint cannot be used to discover accounts.
  const genericResponse = { success: true, message: 'If an account exists, a reset code has been sent.' };
  if (!user || !user.password) return res.json(genericResponse);

  const code = generateCode();
  const now = new Date();
  await dbRun('UPDATE password_resets SET consumedAt = ? WHERE userId = ? AND consumedAt IS NULL', [now.toISOString(), user.id]);
  await dbRun(
    'INSERT INTO password_resets (id, userId, codeHash, expiresAt, attempts, createdAt) VALUES (?, ?, ?, ?, 0, ?)',
    [newId('pwreset'), user.id, hashCode(code), new Date(now.getTime() + 15 * 60 * 1000).toISOString(), now.toISOString()]
  );

  const lang = resolveMessageLanguage(req.body.language, user.preferredLanguage);
  const text = msg(lang, 'sms.passwordReset', { code });
  if (user.phoneNumber && !user.phoneNumber.startsWith('google:')) await sendSms(user.phoneNumber, text);
  if (user.email) await sendEmail(user.email, msg(lang, 'email.passwordResetSubject'), `<p>${text}</p>`, { lang });

  res.json({ ...genericResponse, ...(DEMO_MODE ? { demoCode: code } : {}) });
});

app.post('/api/users/reset-password', async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  const { code, newPassword } = req.body;
  if (!identifier || !code || !newPassword) {
    return res.status(400).json({ success: false, error: 'Identifier, code and new password are required.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
  }

  const isEmail = identifier.includes('@');
  const user = isEmail
    ? await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [identifier])
    : await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [normalizePhone(identifier)]);
  const invalid = () => res.status(400).json({ success: false, error: 'Invalid or expired reset code.' });
  if (!user) return invalid();

  const reset = await dbGet(
    'SELECT * FROM password_resets WHERE userId = ? AND consumedAt IS NULL ORDER BY createdAt DESC LIMIT 1',
    [user.id]
  );
  if (!reset || new Date(reset.expiresAt).getTime() < Date.now() || reset.attempts >= MAX_CODE_ATTEMPTS) return invalid();
  if (reset.codeHash !== hashCode(code)) {
    await dbRun('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [reset.id]);
    return invalid();
  }

  const now = new Date().toISOString();
  await dbRun('UPDATE password_resets SET consumedAt = ? WHERE id = ?', [now, reset.id]);
  await dbRun('UPDATE users SET password = ?, updatedAt = ? WHERE id = ?', [await bcrypt.hash(newPassword, BCRYPT_ROUNDS), now, user.id]);
  const updated = await dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
  res.json({ success: true, user: sanitizeUser(updated), token: signUserToken(updated) });
});

// Back-office demo login: the UI has a role picker rather than staff accounts, so in demo mode
// we issue a short-lived staff token for the chosen role. Replace with real staff auth for production.
app.post('/api/auth/staff-token', (req, res) => {
  if (!DEMO_MODE) return res.status(404).json({ success: false, error: 'Not available' });
  const { role } = req.body;
  if (!STAFF_ROLES.includes(role)) return res.status(400).json({ success: false, error: 'Unknown staff role' });
  res.json({ success: true, token: signStaffToken(role), role });
});

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

// Register public flow endpoints (e.g. registration, Google demo/auth, staff login)
flowRoutes.registerPublic(app);

// ===========================================================================
// PROTECTED ROUTES — everything below requires a valid JWT
// ===========================================================================
app.use('/api', authenticate);

// Register protected flow endpoints (step draft, submit, back office review, etc.)
flowRoutes.registerProtected(app);

app.get('/api/users/me', async (req, res) => {
  if (isStaff(req)) return res.json({ success: true, staff: { role: req.auth.role } });
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.auth.sub]);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, user: sanitizeUser(user) });
});

// Languages a user can currently pick. th/zh/tl are on hold (see hebrew-localization-plan.md).
const ENABLED_LANGUAGES = ['en', 'he'];

app.put('/api/users/me/language', async (req, res) => {
  if (isStaff(req)) return res.status(403).json({ success: false, error: 'Staff accounts have no language preference' });
  const { language } = req.body || {};
  if (!ENABLED_LANGUAGES.includes(language)) {
    return res.status(400).json({ success: false, error: `language must be one of: ${ENABLED_LANGUAGES.join(', ')}` });
  }
  const result = await dbRun('UPDATE users SET preferredLanguage = ? WHERE id = ?', [language, req.auth.sub]);
  if (!result || result.changes === 0) return res.status(404).json({ success: false, error: 'User not found' });
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.auth.sub]);
  res.json({ success: true, user: sanitizeUser(user) });
});

// --- File uploads (Phase 2) -------------------------------------------------
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
      cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || String(10 * 1024 * 1024), 10) },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only images (JPEG/PNG/WebP/HEIC) and PDF files are allowed'));
  },
});

function validateFileMagicBytes(filePath) {
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    if (bytesRead < 4) return false;

    // PDF: %PDF (0x25, 0x50, 0x44, 0x46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return true;
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return true;
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return true;
    }
    // WebP: RIFF at 0..3 and WEBP at 8..11
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return true;
    }
    // HEIC / HEIF: ftyp at offset 4
    if (buffer.toString('ascii', 4, 8) === 'ftyp') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file received (expected multipart field "file")' });

  // Magic bytes / header inspection to detect disguised or malicious files
  const isValid = validateFileMagicBytes(req.file.path);
  if (!isValid) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({
      success: false,
      error: 'File content does not match genuine PDF or image format. Disguised or corrupted files are rejected for security.',
    });
  }

  // Record ownership in database
  const userId = req.auth ? req.auth.sub : 'anonymous';
  try {
    await dbRun(
      'INSERT OR REPLACE INTO uploaded_files (filename, userId, originalName, mimeType, size, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [req.file.filename, userId, req.file.originalname, req.file.mimetype, req.file.size, new Date().toISOString()]
    );
  } catch (e) {
    console.warn('[UPLOAD] Error tracking file owner:', e.message);
  }

  res.json({
    success: true,
    file: {
      filename: req.file.filename,
      url: `/api/uploads/${req.file.filename}`,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
  });
});

app.get('/api/uploads/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename); // blocks path traversal
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found' });

  // Secure document authorization check
  const fileMeta = await dbGet('SELECT * FROM uploaded_files WHERE filename = ?', [filename]);
  if (fileMeta && !canAccessUser(req, fileMeta.userId)) {
    return res.status(403).json({ success: false, error: 'Forbidden: You do not have permission to view this document.' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
});

// --- Applications -----------------------------------------------------------

app.get('/api/applications', requireStaff(), async (_req, res) => {
  // 3-step flow applications are only marked isSubmitted after the last step, but staff must see them
  // from registration on (step 1 and 2 need a Back Office decision), so include every flow application.
  const rows = await dbAll(
    'SELECT * FROM applications WHERE isSubmitted = 1 OR flowVersion = 2 ORDER BY COALESCE(submittedAt, updatedAt, createdAt) DESC'
  );
  res.json({
    success: true,
    applications: rows.map((row) => {
      const app = parseApp(row);
      if (!app.flowStatus) return app;
      // Flow applications: bank account number masked; staff reveal it (audited) via GET /api/flow/applications/:id?revealBank=1.
      // Legacy rows are left whole because the Back Office saves them back through PUT /api/applications/:id.
      const masked = { ...app, group: groupOf(app.flowStatus) };
      if (masked.bankAccount) masked.bankAccount = flowRoutes.maskBank(masked.bankAccount);
      if (masked.step3Data && masked.step3Data.bank) masked.step3Data = { ...masked.step3Data, bank: flowRoutes.maskBank(masked.step3Data.bank) };
      return masked;
    }),
  });
});

function evaluateReusableDocuments(documents, residencyDetails, sourceAppId) {
  const reusableDocs = [];
  const docValidityReport = [];

  if (Array.isArray(documents)) {
    for (const d of documents) {
      if (!d || !d.documentTypeCode) continue;

      let isValid = true;
      let reason = 'Reused from previous verified records on file';

      // Visa validity check: must have >= 6 months remaining
      if (d.documentTypeCode === 'WORK_VISA' || d.documentTypeCode === 'WORKERS_CARD') {
        const expiry = residencyDetails?.visaExpiryDate;
        if (expiry) {
          const expDate = new Date(expiry);
          const sixMonthsFromNow = new Date();
          sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
          if (expDate < sixMonthsFromNow) {
            isValid = false;
            reason = 'Visa expires in under 6 months or is expired. Please upload renewed visa permit.';
          }
        }
      }

      // Pay slip check: must be recent (past 90 days)
      if (d.documentTypeCode === 'PAY_SLIP') {
        const uploadedDate = new Date(d.uploadedAt || 0);
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        if (uploadedDate < ninetyDaysAgo) {
          isValid = false;
          reason = 'Pay slip is older than 3 months. Israeli lending rules require recent proof of income.';
        }
      }

      docValidityReport.push({
        documentTypeCode: d.documentTypeCode,
        originalFilename: d.originalFilename,
        isValid,
        reason,
      });

      if (isValid) {
        reusableDocs.push({
          ...d,
          isReused: true,
          reusedFromAppId: sourceAppId || d.reusedFromAppId,
          validityStatus: 'valid',
          validityReason: reason,
        });
      }
    }
  }

  return { reusableDocs, docValidityReport };
}

app.get('/api/applications/active/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!canAccessUser(req, userId)) return res.status(403).json({ success: false, error: 'Forbidden' });

  const userRow = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  const userProfile = safeJson(userRow?.profileData, null);

  // Check if returning user with prior submitted application
  const prevRow = await dbGet('SELECT * FROM applications WHERE userId = ? AND isSubmitted = 1 ORDER BY submittedAt DESC LIMIT 1', [userId]);
  const prevApp = parseApp(prevRow);

  // Fallback to most recent application with borrowerDetails if no submitted app exists
  let fallbackApp = prevApp;
  if (!fallbackApp) {
    const filledRow = await dbGet(
      'SELECT * FROM applications WHERE userId = ? AND borrowerDetails IS NOT NULL ORDER BY updatedAt DESC LIMIT 1',
      [userId]
    );
    fallbackApp = parseApp(filledRow);
  }

  const sourceData = userProfile || fallbackApp || {};
  const hasSavedInfo = !!(
    (sourceData.borrowerDetails && sourceData.borrowerDetails.passportNumber) ||
    prevApp ||
    userProfile
  );

  const row = await dbGet('SELECT * FROM applications WHERE userId = ? AND isSubmitted = 0 ORDER BY createdAt DESC LIMIT 1', [userId]);
  if (row) {
    const activeApp = parseApp(row);
    let draftUpdated = false;

    // If active draft is missing personal details or documents, auto-fill from saved profile / previous application
    if ((!activeApp.borrowerDetails || !activeApp.borrowerDetails.passportNumber) && (sourceData.borrowerDetails || userRow?.fullName)) {
      activeApp.borrowerDetails = {
        fullName: sourceData.borrowerDetails?.fullName || userRow?.fullName || '',
        passportNumber: sourceData.borrowerDetails?.passportNumber || '',
        countryOfOrigin: sourceData.borrowerDetails?.countryOfOrigin || 'Thailand',
        dateOfBirth: sourceData.borrowerDetails?.dateOfBirth || '',
        mobilePhoneNumber: sourceData.borrowerDetails?.mobilePhoneNumber || userRow?.phoneNumber || '',
        addressCity: sourceData.borrowerDetails?.addressCity || '',
        addressStreet: sourceData.borrowerDetails?.addressStreet || '',
        addressFull: sourceData.borrowerDetails?.addressFull || '',
        maritalStatus: sourceData.borrowerDetails?.maritalStatus || 'Single',
        otherMaritalStatusDetails: sourceData.borrowerDetails?.otherMaritalStatusDetails,
      };
      draftUpdated = true;
    }

    if (!activeApp.residencyDetails && sourceData.residencyDetails) {
      activeApp.residencyDetails = sourceData.residencyDetails;
      draftUpdated = true;
    }

    if (!activeApp.employmentDetails && sourceData.employmentDetails) {
      activeApp.employmentDetails = sourceData.employmentDetails;
      draftUpdated = true;
    }

    if (!activeApp.bankAccount && sourceData.bankAccount) {
      activeApp.bankAccount = sourceData.bankAccount;
      activeApp.bankAccountConfirmed = sourceData.bankAccountConfirmed || false;
      draftUpdated = true;
    }

    if ((!activeApp.guarantors || activeApp.guarantors.length === 0) && (sourceData.guarantors?.length || sourceData.guarantor?.hasGuarantor)) {
      activeApp.guarantors = sourceData.guarantors || (sourceData.guarantor?.hasGuarantor ? [sourceData.guarantor] : []);
      activeApp.guarantor = sourceData.guarantor || activeApp.guarantor;
      draftUpdated = true;
    }

    if ((!activeApp.documents || activeApp.documents.length === 0) && Array.isArray(sourceData.documents) && sourceData.documents.length > 0) {
      const { reusableDocs } = evaluateReusableDocuments(sourceData.documents, sourceData.residencyDetails, sourceData.id);
      if (reusableDocs.length > 0) {
        activeApp.documents = reusableDocs;
        draftUpdated = true;
      }
    }

    if (hasSavedInfo) {
      activeApp.isReturningUser = true;
    }

    if (draftUpdated) {
      await writeApp(activeApp);
    }

    return res.json({ success: true, application: activeApp, isReturningUser: !!activeApp.isReturningUser });
  }

  const now = new Date().toISOString();
  const reqNum = await nextRequestNumber();

  // Evaluate previous documents for safe reuse
  const { reusableDocs, docValidityReport } = evaluateReusableDocuments(
    sourceData.documents || [],
    sourceData.residencyDetails,
    sourceData.id
  );

  const draft = {
    id: newId('app'),
    userId,
    requestNumber: reqNum,
    isSubmitted: false,
    status: 'Received',
    currentStep: hasSavedInfo ? 6 : 3,
    isReturningUser: hasSavedInfo,
    borrowerDetails: sourceData.borrowerDetails ? { ...sourceData.borrowerDetails } : {
      fullName: userRow?.fullName || '',
      mobilePhoneNumber: userRow?.phoneNumber || '',
      passportNumber: '',
      countryOfOrigin: 'Thailand',
      dateOfBirth: '',
      addressCity: '',
      addressStreet: '',
      addressFull: '',
      maritalStatus: 'Single',
    },
    residencyDetails: sourceData.residencyDetails ? { ...sourceData.residencyDetails } : undefined,
    employmentDetails: sourceData.employmentDetails ? { ...sourceData.employmentDetails } : undefined,
    bankAccount: sourceData.bankAccount ? { ...sourceData.bankAccount } : undefined,
    bankAccountConfirmed: sourceData ? !!sourceData.bankAccountConfirmed : false,
    guarantor: sourceData.guarantor ? { ...sourceData.guarantor } : { hasGuarantor: false },
    guarantors: sourceData.guarantors || (sourceData.guarantor?.hasGuarantor ? [sourceData.guarantor] : []),
    documents: reusableDocs,
    consents: [],
    statusHistory: [],
    createdAt: now,
    updatedAt: now,
  };

  await writeApp(draft);
  res.json({
    success: true,
    application: draft,
    isReturningUser: hasSavedInfo,
    previousDocumentsReport: docValidityReport,
  });
});

// Phase 6: all submitted applications for a borrower
app.get('/api/applications/history/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!canAccessUser(req, userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
  const rows = await dbAll('SELECT * FROM applications WHERE userId = ? AND isSubmitted = 1 ORDER BY submittedAt DESC', [userId]);
  const apps = rows.map(parseApp).map((a) => {
    // Risk scoring is an internal underwriting signal — not shown to borrowers.
    if (!isStaff(req)) { delete a.riskScore; delete a.riskLevel; delete a.riskFlags; }
    return a;
  });
  res.json({ success: true, applications: apps });
});

app.get('/api/applications/:id', async (req, res) => {
  const a = await getAppById(req.params.id);
  if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
  if (!canAccessUser(req, a.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
  if (!isStaff(req)) { delete a.riskScore; delete a.riskLevel; delete a.riskFlags; }
  res.json({ success: true, application: a });
});

// Create-or-update. Borrowers may only edit their own drafts; once submitted, status and underwriting
// fields are server-controlled. Staff may update any application (used for status changes / sync).
app.put('/api/applications/:id', async (req, res) => {
  const { id } = req.params;
  const incoming = req.body || {};
  const now = new Date().toISOString();
  const prev = await getAppById(id);

  if (prev && !canAccessUser(req, prev.userId)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  // Lock legacy PUT for 3-step approval workflow applications (flowVersion = 2)
  if (prev && prev.flowVersion === 2) {
    return res.status(409).json({
      success: false,
      code: 'FLOW_V2_LOCKED',
      error: 'This application uses the 3-step approval workflow and must be updated via /api/flow endpoints.',
    });
  }

  const next = { ...incoming, id, updatedAt: now, createdAt: (prev && prev.createdAt) || incoming.createdAt || now };
  // Risk data and eligibility scores are computed server-side only to prevent tampering.
  delete next.riskScore; delete next.riskLevel; delete next.riskFlags;
  delete next.eligibilityScore; delete next.eligibilityBreakdown;

  if (isStaff(req)) {
    next.userId = (prev && prev.userId) || incoming.userId;
    if (!next.userId) return res.status(400).json({ success: false, error: 'userId is required' });
  } else {
    next.userId = req.auth.sub;

    if (prev && prev.isSubmitted) {
      // Immutable after submission (borrower side)
      ['requestNumber', 'submittedAt', 'borrowerDetails', 'residencyDetails', 'employmentDetails',
        'loanRequest', 'guarantor', 'guarantors', 'consents', 'digitalSignature', 'language'].forEach((f) => { next[f] = prev[f]; });
      next.isSubmitted = true;

      // Only allowed borrower status transition: re-submitting after uploading a requested document.
      const resubmitting = prev.status === 'Additional Document Required' && incoming.status === 'Under Review';
      if (resubmitting) {
        // Fixed reason texts below are stored in English and translated for display by the frontend
        // (DEFAULT_STATUS_REASONS in frontend/src/i18n/options.ts; a test keeps the two in sync).
        const latest = (incoming.statusHistory || [])[0];
        const entry = {
          id: (latest && latest.id) || newId('sh'),
          applicationId: id,
          fromStatus: prev.status,
          toStatus: 'Under Review',
          changedByType: 'borrower',
          changedByName: (prev.borrowerDetails && prev.borrowerDetails.fullName) || 'Borrower',
          reason: (latest && latest.toStatus === 'Under Review' && latest.reason) || 'Borrower uploaded the requested document.',
          createdAt: now,
        };
        next.statusHistory = [entry, ...(prev.statusHistory || [])];
        next.missingDocumentNotes = null;
      } else {
        next.status = prev.status;
        next.statusHistory = prev.statusHistory;
        next.missingDocumentNotes = prev.missingDocumentNotes;
      }
    } else if (incoming.isSubmitted) {
      // First submission
      next.status = 'Received';
      next.submittedAt = now;
      const history = Array.isArray(incoming.statusHistory) ? incoming.statusHistory.filter((h) => h.changedByType === 'borrower') : [];
      next.statusHistory = history.length > 0 ? history : [{
        id: newId('sh'), applicationId: id, fromStatus: null, toStatus: 'Received', changedByType: 'borrower',
        changedByName: (incoming.borrowerDetails && incoming.borrowerDetails.fullName) || 'Borrower',
        reason: 'Application submitted with signed consents and uploaded documentation.', createdAt: now,
      }];
    } else {
      next.status = 'Received';
      next.isSubmitted = false;
      next.statusHistory = [];
    }
  }

  // Server owns request-number uniqueness for submitted applications.
  if (next.isSubmitted) {
    const clash = next.requestNumber
      ? await dbGet('SELECT id FROM applications WHERE requestNumber = ? AND id != ?', [next.requestNumber, id])
      : null;
    if (!next.requestNumber || clash) next.requestNumber = await nextRequestNumber();
    if (!next.submittedAt) next.submittedAt = now;
  }

  // Phase 8: advisory pre-screening on every save of a submitted application
  if (next.isSubmitted) await applyRiskScore(next);

  await writeApp(next);

  // Update user profile in users table so personal details and documents are permanently associated with this account
  if (next.userId && next.userId !== 'demo_user') {
    try {
      const userToUpdate = await dbGet('SELECT * FROM users WHERE id = ?', [next.userId]);
      if (userToUpdate) {
        const existingProf = safeJson(userToUpdate.profileData, {});
        const profilePayload = {
          borrowerDetails: next.borrowerDetails || existingProf.borrowerDetails,
          residencyDetails: next.residencyDetails || existingProf.residencyDetails,
          employmentDetails: next.employmentDetails || existingProf.employmentDetails,
          bankAccount: next.bankAccount || existingProf.bankAccount,
          bankAccountConfirmed: next.bankAccountConfirmed ?? existingProf.bankAccountConfirmed,
          guarantors: next.guarantors || existingProf.guarantors,
          guarantor: next.guarantor || existingProf.guarantor,
          documents: next.documents || existingProf.documents,
        };
        const updatedName = (next.borrowerDetails && next.borrowerDetails.fullName) || userToUpdate.fullName;
        await dbRun(
          'UPDATE users SET fullName = ?, profileData = ?, updatedAt = ? WHERE id = ?',
          [updatedName, JSON.stringify(profilePayload), now, next.userId]
        );
      }
    } catch (e) {
      console.warn('[USER PROFILE UPDATE]', e.message);
    }
  }

  const saved = await getAppById(id);

  // Phase 4 + 5: status-change hook (also fires on first submission)
  const newlySubmitted = saved.isSubmitted && !(prev && prev.isSubmitted);
  const statusChanged = saved.isSubmitted && prev && prev.isSubmitted && prev.status !== saved.status;
  if (newlySubmitted || statusChanged) {
    notifyStatusChange(saved, newlySubmitted ? null : prev.status).catch((err) => console.error('[NOTIFY]', err.message));
  } else if (saved.isSubmitted) {
    broadcastAppEvent(id, 'updated', { applicationId: id, status: saved.status, updatedAt: saved.updatedAt });
  }

  if (!isStaff(req)) { delete saved.riskScore; delete saved.riskLevel; delete saved.riskFlags; }
  res.json({ success: true, application: saved });
});

// Phase 4: Server-Sent Events stream for a single application
app.get('/api/applications/:id/events', async (req, res) => {
  const a = await getAppById(req.params.id);
  if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
  if (!canAccessUser(req, a.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: 5000\nevent: connected\ndata: ${JSON.stringify({ applicationId: a.id, status: a.status })}\n\n`);

  if (!sseClients.has(a.id)) sseClients.set(a.id, new Set());
  sseClients.get(a.id).add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const set = sseClients.get(a.id);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseClients.delete(a.id);
    }
  });
});

// Phase 7: PDF export (supports GET and POST with optional application fallback payload)
app.all('/api/applications/:id/pdf', async (req, res) => {
  let a = await getAppById(req.params.id);

  // If not found in DB, check if client provided the application object in request body
  if (!a && req.body && (req.body.id || req.body.borrowerDetails)) {
    const candidate = req.body.application || req.body;
    a = parseApp(candidate);
    if (a && (a.id || a.requestNumber)) {
      if (!a.id) a.id = req.params.id;
      try {
        await writeApp(a);
      } catch (e) {
        console.warn('Could not auto-persist application from PDF request:', e.message);
      }
    }
  }

  if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
  if (!canAccessUser(req, a.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });

  try {
    // ?lang=he|en picks the PDF language (staff send their UI language); default: the application's language.
    // Staff copies mask the bank account number; the borrower's own copy shows it in full.
    streamApplicationPdf(a, res, { includeRisk: isStaff(req), maskBankAccount: isStaff(req), lang: req.query.lang });
  } catch (err) {
    console.error('Error generating PDF:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate PDF summary' });
    }
  }
});

// --- Notifications (Phase 5) ------------------------------------------------

app.post('/api/notifications', requireStaff(), async (req, res) => {
  const { userId, applicationId, title, message, notificationType, channel } = req.body;
  if (!userId || !title || !message) return res.status(400).json({ success: false, error: 'userId, title and message are required' });
  const user = await dbGet('SELECT phoneNumber, preferredLanguage FROM users WHERE id = ?', [userId]);
  const notification = await createNotification({
    userId, applicationId, title, message,
    notificationType: notificationType || 'MANUAL',
    channel: channel === 'push' ? 'push' : 'sms',
    language: user && user.preferredLanguage,
    phoneNumber: user && user.phoneNumber,
  });
  res.json({ success: true, notification });
});

app.get('/api/notifications/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!canAccessUser(req, userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
  const rows = await dbAll('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 100', [userId]);
  const notifications = rows.map(parseNotification);
  res.json({ success: true, notifications, unreadCount: notifications.filter((n) => !n.read).length });
});

app.patch('/api/notifications/:id/read', async (req, res) => {
  const row = await dbGet('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Notification not found' });
  if (!canAccessUser(req, row.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
  await dbRun('UPDATE notifications SET read = 1 WHERE id = ?', [row.id]);
  res.json({ success: true });
});

app.post('/api/notifications/:userId/read-all', async (req, res) => {
  const { userId } = req.params;
  if (!canAccessUser(req, userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
  await dbRun('UPDATE notifications SET read = 1 WHERE userId = ?', [userId]);
  res.json({ success: true });
});

// Raw SMS stub — logs to console unless Twilio credentials are configured (see services/smsService.js)
app.post('/api/notifications/send-sms', requireStaff('system_admin', 'customer_service'), async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ success: false, error: 'to and message are required' });
  const result = await sendSms(normalizePhone(to), message);
  res.status(result.success ? 200 : 502).json(result);
});

// --- Analytics (Phase 3) ----------------------------------------------------

app.get('/api/analytics/summary', requireStaff('credit_reviewer', 'system_admin'), async (_req, res) => {
  const apps = (await dbAll('SELECT * FROM applications WHERE isSubmitted = 1')).map(parseApp);

  const byStatus = {};
  const byPurpose = {};
  const byRisk = { Low: 0, Medium: 0, High: 0 };
  let amountSum = 0;
  let amountCount = 0;
  const processingDays = [];

  apps.forEach((a) => {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const purpose = (a.loanRequest && a.loanRequest.loanPurpose) || 'Unspecified';
    byPurpose[purpose] = (byPurpose[purpose] || 0) + 1;
    if (a.riskLevel && byRisk[a.riskLevel] !== undefined) byRisk[a.riskLevel] += 1;

    const amount = Number(a.loanRequest && a.loanRequest.requestedAmountNis);
    if (amount > 0) { amountSum += amount; amountCount += 1; }

    const decision = (a.statusHistory || [])
      .filter((h) => DECIDED_STATUSES.includes(h.toStatus))
      .sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt))[0];
    const start = a.submittedAt || a.createdAt;
    if (decision && start) {
      const days = (new Date(decision.createdAt) - new Date(start)) / 86400000;
      if (days >= 0) processingDays.push(days);
    }
  });

  const decided = (byStatus['Approved'] || 0) + (byStatus['Forwarded to Funding Entity'] || 0) + (byStatus['Rejected'] || 0);
  const approved = (byStatus['Approved'] || 0) + (byStatus['Forwarded to Funding Entity'] || 0);

  // Daily submissions for the last 30 days (inclusive of today)
  const days = [];
  const counts = {};
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push(key);
    counts[key] = 0;
  }
  apps.forEach((a) => {
    const key = String(a.submittedAt || a.createdAt || '').slice(0, 10);
    if (counts[key] !== undefined) counts[key] += 1;
  });

  res.json({
    success: true,
    summary: {
      totalApplications: apps.length,
      openApplications: apps.filter((a) => OPEN_STATUSES.includes(a.status)).length,
      approvalRate: decided > 0 ? Math.round((approved / decided) * 1000) / 10 : null,
      avgLoanAmountNis: amountCount > 0 ? Math.round(amountSum / amountCount) : null,
      totalRequestedNis: amountSum,
      avgProcessingDays: processingDays.length > 0
        ? Math.round((processingDays.reduce((s, d) => s + d, 0) / processingDays.length) * 10) / 10
        : null,
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      byPurpose: Object.entries(byPurpose).map(([purpose, count]) => ({ purpose, count })),
      byRisk: Object.entries(byRisk).map(([level, count]) => ({ level, count })),
      dailySubmissions: days.map((date) => ({ date, count: counts[date] })),
      generatedAt: new Date().toISOString(),
    },
  });
});

// --- Credit rule configuration (Phase 8.4) ---------------------------------

app.get('/api/config/credit-rules', requireStaff(), async (_req, res) => {
  res.json({ success: true, rules: await getCreditRules(), defaults: DEFAULT_CREDIT_RULES });
});

app.put('/api/config/credit-rules', requireStaff('system_admin'), async (req, res) => {
  const rules = normalizeRules({ ...(await getCreditRules()), ...(req.body && req.body.rules) });
  if (rules.mediumRiskMinScore > rules.lowRiskMinScore) {
    return res.status(400).json({ success: false, error: 'Medium-risk threshold cannot exceed the low-risk threshold.' });
  }
  if (rules.hardMinTenureMonths > rules.minTenureMonths) {
    return res.status(400).json({ success: false, error: 'Hard minimum tenure cannot exceed the warning tenure.' });
  }
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO app_config (key, value, updatedAt) VALUES ('creditRules', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    [JSON.stringify(rules), now]
  );

  // Re-score every submitted application so the queue reflects the new policy.
  const apps = (await dbAll('SELECT * FROM applications WHERE isSubmitted = 1')).map(parseApp);
  for (const a of apps) {
    const r = runCreditScreening(a, rules);
    await dbRun('UPDATE applications SET riskScore = ?, riskLevel = ?, riskFlags = ? WHERE id = ?', [r.score, r.riskLevel, JSON.stringify(r.flags), a.id]);
  }
  res.json({ success: true, rules, rescored: apps.length });
});

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
