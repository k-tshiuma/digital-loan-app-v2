// Login sessions in HttpOnly cookies (Phase 9): the browser apps never see or store the token.
//
// - Each API sets and reads only its own cookie: ql_borrower (borrower API) or ql_staff (admin API). Locally
//   both APIs run on localhost, where cookies are shared across ports, so the names keep them apart.
// - HttpOnly (no script access), SameSite=Strict (never sent from another site), Path=/api, Secure in
//   production (COOKIE_SECURE=true|false overrides). Lifetime = the token's.
// - CSRF: a request that is signed in by the cookie and changes something must send the header
//   X-QuickLoan-Request: 1. Another site can't add a custom header without passing CORS, which only allows
//   the app's own site. Requests with an Authorization header (API clients, tests) don't use the cookie.
const jwt = require('jsonwebtoken');
const { IS_PRODUCTION } = require('./config');

const COOKIE_NAMES = { borrower: 'ql_borrower', staff: 'ql_staff' };
const CSRF_HEADER = 'x-quickloan-request';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The token kind this process keeps in its cookie; set once by createBaseApp ('borrower' or 'staff').
let cookieKind = null;
function setCookieKind(kind) {
  cookieKind = kind;
}

const secureCookies = () =>
  process.env.COOKIE_SECURE === 'true' || (IS_PRODUCTION && process.env.COOKIE_SECURE !== 'false');

function cookieAttributes(maxAgeSeconds) {
  return [
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    ...(secureCookies() ? ['Secure'] : []),
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join('; ');
}

/** Adds a Set-Cookie line, replacing an earlier one for the same cookie in this response. */
function appendSetCookie(res, value) {
  const name = value.slice(0, value.indexOf('=') + 1);
  const prev = res.getHeader('Set-Cookie');
  const list = (prev ? (Array.isArray(prev) ? prev : [prev]) : []).filter((line) => !String(line).startsWith(name));
  res.setHeader('Set-Cookie', [...list, value]);
}

/** Puts a freshly signed token in this kind's cookie. Returns the token, so call sites can still send it. */
function setSessionCookie(res, kind, token) {
  const exp = (jwt.decode(token) || {}).exp;
  const maxAge = typeof exp === 'number' ? exp - Math.floor(Date.now() / 1000) : 12 * 3600;
  appendSetCookie(res, `${COOKIE_NAMES[kind]}=${token}; ${cookieAttributes(maxAge)}`);
  return token;
}

function clearSessionCookie(res, kind) {
  appendSetCookie(res, `${COOKIE_NAMES[kind]}=; ${cookieAttributes(0)}`);
}

/** A cookie's value from the Cookie header, or null. */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      const value = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return value || null;
      }
    }
  }
  return null;
}

/** This API's session cookie on the request, if any. */
const sessionCookieToken = (req) => (cookieKind ? readCookie(req, COOKIE_NAMES[cookieKind]) : null);

/** On a 401 for a bad session: if the token came from the cookie, delete the cookie too. */
function dropBadCookie(req, res) {
  if (!req.headers.authorization && sessionCookieToken(req)) clearSessionCookie(res, cookieKind);
}

/**
 * Refuses state-changing requests that would be signed in by the cookie alone without the app's custom
 * header (403 CSRF_CHECK_FAILED). Runs before the auth middleware.
 */
function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.headers.authorization) return next(); // the cookie is not used
  if (!sessionCookieToken(req)) return next();
  if (req.headers[CSRF_HEADER] === '1') return next();
  return res.status(403).json({ success: false, code: 'CSRF_CHECK_FAILED', error: 'Missing X-QuickLoan-Request header.' });
}

module.exports = {
  COOKIE_NAMES,
  setCookieKind,
  setSessionCookie,
  clearSessionCookie,
  readCookie,
  sessionCookieToken,
  csrfGuard,
  dropBadCookie,
};
