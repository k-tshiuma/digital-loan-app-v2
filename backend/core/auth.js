// Tokens, auth middleware, access checks and the OTP store.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { safeJson } = require('../services/dbHelpers');
const { DEMO_MODE, JWT_SECRET, JWT_EXPIRES_IN } = require('./config');

const normalizePhone = (p) => String(p || '').replace(/[\s()-]/g, '');
const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);
const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const generateCode = () => String(crypto.randomInt(100000, 1000000));

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
      if (decoded && decoded.type === 'staff') {
        return res.status(401).json({ success: false, error: 'Invalid or expired staff session. Please sign in again.' });
      }
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
        if (decoded && decoded.sub && decoded.type !== 'staff') req.auth = decoded;
      }
    }
  } else if (DEMO_MODE) {
    req.auth = { sub: 'demo_user', type: 'borrower', role: 'borrower' };
  }
  next();
}

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

module.exports = {
  normalizePhone,
  isBcryptHash,
  hashCode,
  generateCode,
  sanitizeUser,
  signUserToken,
  signStaffToken,
  readToken,
  authenticate,
  optionalAuth,
  isStaff,
  requireStaff,
  canAccessUser,
  otpStore,
  OTP_TTL_MS,
  MAX_CODE_ATTEMPTS,
  checkOtp,
};
