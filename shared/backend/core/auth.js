// Tokens, auth middleware, access checks and the OTP store.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { safeJson } = require('../services/dbHelpers');
const { DEMO_MODE, JWT_SECRETS, JWT_EXPIRES_IN } = require('./config');

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

// Each token kind has its own secret and audience: a borrower token can't be verified as a staff token or
// the reverse, even if the two secrets were ever the same.
const AUDIENCES = { borrower: 'quickloan-borrower', staff: 'quickloan-admin' };
const ALGORITHM = 'HS256';

function secretFor(kind) {
  const secret = JWT_SECRETS[kind];
  if (!secret) throw new Error(`No signing secret for ${kind} tokens in this process`);
  return secret;
}

function signToken(kind, payload, expiresIn) {
  return jwt.sign({ ...payload, type: kind }, secretFor(kind), { expiresIn, audience: AUDIENCES[kind], algorithm: ALGORITHM });
}

function signUserToken(user) {
  return signToken('borrower', { sub: user.id, phone: normalizePhone(user.phoneNumber) }, JWT_EXPIRES_IN);
}

/** Demo role-picker token (admin API, DEMO_MODE only). */
function signStaffToken(role) {
  return signToken('staff', { sub: `staff_${role}`, role }, '12h');
}

/** Session for a real staff account (staff login). */
function signStaffSession(staff) {
  return signToken('staff', { sub: staff.id, role: staff.role, name: staff.fullName || staff.email }, '12h');
}

/** What the token says it is, without checking it. Only used to pick the key, or to refuse it. */
const claimedKind = (token) => {
  const decoded = jwt.decode(token);
  return decoded && decoded.type === 'staff' ? 'staff' : 'borrower';
};

/**
 * Verifies a token with the secret and audience of the kind it claims to be. Throws when the signature,
 * audience or expiry is wrong, or when this process has no secret for that kind (e.g. a staff token on
 * a borrower API that only knows the borrower secret).
 */
function verifyToken(token) {
  const kind = claimedKind(token);
  const payload = jwt.verify(token, secretFor(kind), { audience: AUDIENCES[kind], algorithms: [ALGORITHM] });
  if (payload.type !== kind) throw new Error('Token type mismatch');
  return payload;
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
    req.auth = verifyToken(token);
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
      req.auth = verifyToken(token);
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

// ---------------------------------------------------------------------------
// Per-backend guards (borrower and admin backends, docs/app-separation-plan.md). The combined server.js
// uses neither.
// ---------------------------------------------------------------------------

/**
 * Borrower backend: a staff token is refused everywhere, so staff branches never run here. That includes
 * staff tokens this process can't verify (it may not know the admin secret).
 */
function rejectStaffTokens(req, res, next) {
  const token = readToken(req);
  if (isStaff(req) || (token && claimedKind(token) === 'staff')) return res.status(401).json({ success: false, error: 'This service accepts borrower sessions only.' });
  return next();
}

/**
 * Admin backend, instead of optionalAuth: sets req.auth only for a valid staff token. Any other token
 * (borrower, expired, forged) is refused, and there is no demo identity, even in demo mode.
 */
function staffOnlyAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    if (payload && payload.type === 'staff') {
      req.auth = payload;
      return next();
    }
  } catch {
    /* fall through */
  }
  return res.status(401).json({ success: false, error: 'Invalid or expired staff session. Please sign in again.' });
}

/** Admin backend, instead of authenticate: every protected route needs a valid staff token. */
function authenticateStaff(req, res, next) {
  if (!isStaff(req)) return res.status(401).json({ success: false, error: 'Authentication required' });
  return next();
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
  AUDIENCES,
  signUserToken,
  signStaffToken,
  signStaffSession,
  verifyToken,
  readToken,
  authenticate,
  optionalAuth,
  isStaff,
  requireStaff,
  rejectStaffTokens,
  staffOnlyAuth,
  authenticateStaff,
  canAccessUser,
  otpStore,
  OTP_TTL_MS,
  MAX_CODE_ATTEMPTS,
  checkOtp,
};
