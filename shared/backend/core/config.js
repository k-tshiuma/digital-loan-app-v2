// App-wide settings read from the environment. The caller loads .env (dotenv) before requiring this.
const path = require('path');
const fs = require('fs');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Demo conveniences (fixed OTP 123456, role-picker staff tokens, mock Google login, codes echoed
// back in API responses). Enabled by default for local development, always off in production.
const DEMO_MODE = !IS_PRODUCTION && process.env.DEMO_MODE !== 'false';

// Token signing secrets, one per kind: borrower tokens (borrower API) and staff tokens (admin API), so a key
// from one app can never sign a session for the other. JWT_SECRET is the fallback for both (local
// development). Outside production a missing secret gets a fixed development value.
const DEV_JWT_SECRET = 'quickloan_dev_stable_secret_key_survives_restarts_2026';
function jwtSecret(name) {
  const value = process.env[name] || process.env.JWT_SECRET;
  if (value) return value;
  return IS_PRODUCTION ? null : `${DEV_JWT_SECRET}:${name}`;
}
const JWT_SECRETS = { borrower: jwtSecret('BORROWER_JWT_SECRET'), staff: jwtSecret('ADMIN_JWT_SECRET') };
const JWT_SECRET_NAMES = { borrower: 'BORROWER_JWT_SECRET', staff: 'ADMIN_JWT_SECRET' };

/**
 * Production start-up check. `kinds` are the token kinds this process signs or accepts. Each needs its
 * secret, and the two secrets must differ when both are known here.
 */
function assertJwtSecrets(kinds) {
  if (!IS_PRODUCTION) return;
  for (const kind of kinds) {
    if (!JWT_SECRETS[kind]) throw new Error(`${JWT_SECRET_NAMES[kind]} must be set in production`);
  }
  if (JWT_SECRETS.borrower && JWT_SECRETS.borrower === JWT_SECRETS.staff) {
    throw new Error('BORROWER_JWT_SECRET and ADMIN_JWT_SECRET must be different in production');
  }
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;

const STAFF_ROLES = ['customer_service', 'credit_reviewer', 'system_admin', 'funding_entity'];

// Uploaded documents. Both backends must point at the same folder. Default: data/uploads at the repo root.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '..', '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { IS_PRODUCTION, DEMO_MODE, JWT_SECRETS, assertJwtSecrets, JWT_EXPIRES_IN, BCRYPT_ROUNDS, STAFF_ROLES, UPLOAD_DIR };
