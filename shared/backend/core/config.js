// App-wide settings read from the environment. The caller loads .env (dotenv) before requiring this.
const path = require('path');
const fs = require('fs');

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

// Uploaded documents. Both backends must point at the same folder. Default: data/uploads at the repo root.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '..', '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { IS_PRODUCTION, DEMO_MODE, JWT_SECRET, JWT_EXPIRES_IN, BCRYPT_ROUNDS, STAFF_ROLES, UPLOAD_DIR };
