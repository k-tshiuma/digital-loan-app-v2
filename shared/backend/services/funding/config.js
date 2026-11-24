/**
 * Funding partner settings (admin API only; the borrower API never talks to the partner).
 *
 *   FUNDING_PARTNER_URL            base URL of the partner's API, https only
 *   FUNDING_PARTNER_CODE / _NAME   stored with each hand-off and shown in the Back Office
 *   FUNDING_PARTNER_CLIENT_ID / _CLIENT_SECRET   OAuth2 client credentials
 *   FUNDING_PARTNER_CERT / _KEY    QuickLoan's client certificate and key (mutual TLS)
 *   FUNDING_PARTNER_CA             the CA that signed the partner's server certificate
 *                                  (relative certificate paths are from the repo root)
 *   FUNDING_PARTNER_TIMEOUT_MS     per request (default 20000)
 *   FUNDING_MAX_ATTEMPTS           tries per push for temporary errors (default 3)
 *   FUNDING_RETRY_BASE_MS          first wait between tries, doubled each time (default 1000)
 *   FUNDING_POLL_MS                how often open hand-offs are checked with the partner (default 30000, 0 = off)
 *
 * In demo mode, with no FUNDING_PARTNER_URL, the defaults point at the local partner-bank sandbox
 * (sandbox/partner-bank, `npm run partner:sandbox`). Outside demo mode nothing is assumed: without the
 * settings the push answers 503 FUNDING_PARTNER_NOT_CONFIGURED.
 */
const fs = require('fs');
const path = require('path');
const { DEMO_MODE } = require('../../core/config');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SANDBOX_CERTS = path.join(REPO_ROOT, 'sandbox/partner-bank/certs');
// Relative certificate paths (as in .env.example) are from the repo root, wherever the API was started.
const fromRoot = (file) => (file ? path.resolve(REPO_ROOT, file) : '');

function readPartnerConfig(env = process.env) {
  const sandboxDefaults = DEMO_MODE && !env.FUNDING_PARTNER_URL;
  const pick = (name, sandboxValue) => env[name] || (sandboxDefaults ? sandboxValue : '');
  const cfg = {
    url: pick('FUNDING_PARTNER_URL', 'https://localhost:5300').replace(/\/+$/, ''),
    code: env.FUNDING_PARTNER_CODE || (sandboxDefaults ? 'sandbox_bank' : 'partner'),
    name: env.FUNDING_PARTNER_NAME || (sandboxDefaults ? 'Partner Bank (sandbox)' : 'Funding partner'),
    clientId: pick('FUNDING_PARTNER_CLIENT_ID', 'quickloan-sandbox'),
    clientSecret: pick('FUNDING_PARTNER_CLIENT_SECRET', 'sandbox-secret-change-me'),
    certFile: fromRoot(pick('FUNDING_PARTNER_CERT', path.join(SANDBOX_CERTS, 'client.crt'))),
    keyFile: fromRoot(pick('FUNDING_PARTNER_KEY', path.join(SANDBOX_CERTS, 'client.key'))),
    caFile: fromRoot(pick('FUNDING_PARTNER_CA', path.join(SANDBOX_CERTS, 'bank-ca.crt'))),
    timeoutMs: parseInt(env.FUNDING_PARTNER_TIMEOUT_MS || '20000', 10),
    maxAttempts: Math.max(1, parseInt(env.FUNDING_MAX_ATTEMPTS || '3', 10)),
    retryBaseMs: parseInt(env.FUNDING_RETRY_BASE_MS || '1000', 10),
    pollMs: parseInt(env.FUNDING_POLL_MS || '30000', 10),
    sandbox: sandboxDefaults,
  };
  cfg.problem = configProblem(cfg);
  cfg.configured = !cfg.problem;
  return cfg;
}

function configProblem(cfg) {
  if (!cfg.url) return 'FUNDING_PARTNER_URL is not set.';
  if (!/^https:\/\//i.test(cfg.url)) return 'FUNDING_PARTNER_URL must start with https://.';
  if (!cfg.clientId || !cfg.clientSecret) return 'FUNDING_PARTNER_CLIENT_ID and FUNDING_PARTNER_CLIENT_SECRET are required.';
  for (const [name, file] of [['FUNDING_PARTNER_CERT', cfg.certFile], ['FUNDING_PARTNER_KEY', cfg.keyFile], ['FUNDING_PARTNER_CA', cfg.caFile]]) {
    if (!file) return `${name} is required.`;
    if (!fs.existsSync(file)) {
      return cfg.sandbox
        ? 'The sandbox certificates are missing. Start the sandbox once with `npm run partner:sandbox`.'
        : `${name} points at a file that does not exist.`;
    }
  }
  return null;
}

/** What the Back Office may see about the partner: never the credentials. */
const publicPartnerInfo = (cfg) => ({ code: cfg.code, name: cfg.name, configured: cfg.configured, sandbox: cfg.sandbox, problem: cfg.problem });

module.exports = { readPartnerConfig, publicPartnerInfo };
