// pm2 process file for the two APIs on one Linux server (docs/deployment-runbook.md).
//   pm2 startOrReload deploy/ecosystem.config.js --update-env
// Settings come from env files outside the checkout (default /etc/quickloan, override with QUICKLOAN_ENV_DIR):
//   shared.env   values both APIs need (NODE_ENV, JWT_SECRET, DB_PATH, UPLOAD_DIR, Twilio, SMTP, ...)
//   borrower.env / admin.env   per-API values (port, DB_INIT, rate limit); they win over shared.env.
// Templates: deploy/env/*.example. Values set here come first, so a stray .env file in the checkout
// can only fill gaps, never override them.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
const ENV_DIR = process.env.QUICKLOAN_ENV_DIR || '/etc/quickloan';
const LOG_DIR = process.env.QUICKLOAN_LOG_DIR || '/var/log/quickloan';

function readEnv(name) {
  const file = path.join(ENV_DIR, name);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file} (copy it from deploy/env/${name}.example)`);
  return dotenv.parse(fs.readFileSync(file));
}

const shared = readEnv('shared.env');

// One instance each, never cluster mode: the OTP store, rate limits and live-status streams are kept in
// the process's memory.
const common = {
  cwd: ROOT,
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  min_uptime: '10s',
  max_memory_restart: '400M',
  kill_timeout: 5000,
  time: true, // timestamps in the log files
  merge_logs: true, // log file names without pm2's -<id> suffix
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'quickloan-borrower',
      script: 'borrower-app/backend/server.js',
      env: { ...shared, ...readEnv('borrower.env') },
      out_file: path.join(LOG_DIR, 'borrower.log'),
      error_file: path.join(LOG_DIR, 'borrower.error.log'),
    },
    {
      ...common,
      name: 'quickloan-admin',
      script: 'admin-app/backend/server.js',
      env: { ...shared, ...readEnv('admin.env') },
      out_file: path.join(LOG_DIR, 'admin.log'),
      error_file: path.join(LOG_DIR, 'admin.error.log'),
    },
  ],
};
