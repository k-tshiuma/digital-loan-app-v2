/**
 * Per-app token secrets and CORS (docs/app-separation-plan.md, Phase 9). Both APIs run as separate
 * processes with demo mode off, each knowing only its own signing secret, as in production.
 *
 * - A token is only accepted by the API it was made for: secret, audience and type must all match.
 * - Old tokens (no audience, the former shared secret) and forged ones are refused.
 * - In production an API won't start without its secret, or with the same secret for both apps.
 * - Browsers may call each API only from its own site (dev defaults, CORS_ORIGIN, none in production).
 *
 * Usage: npm run seed:staff (once), then node tests/integration/test_tokens_and_cors.js
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');

const SERVER_ENTRY = {
  borrower: path.resolve(__dirname, '../../borrower-app/backend/server.js'),
  admin: path.resolve(__dirname, '../../admin-app/backend/server.js'),
};
const BORROWER_SECRET = 'test-borrower-secret-0123456789';
const ADMIN_SECRET = 'test-admin-secret-9876543210';
const AUD = { borrower: 'quickloan-borrower', staff: 'quickloan-admin' };
// Blank values hide any secrets from the local .env (dotenv never overwrites a variable that is set).
const NO_SECRETS = { JWT_SECRET: '', BORROWER_JWT_SECRET: '', ADMIN_JWT_SECRET: '' };

let passed = 0;
let failed = 0;
const check = (msg, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ PASS: ${msg}`); } else { failed++; console.log(`  ✗ FAIL: ${msg}${detail ? ` (${detail})` : ''}`); }
};

function request(port, method, urlPath, { body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    let payload = null;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers: h, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let parsed = Buffer.concat(chunks).toString();
        try { parsed = JSON.parse(parsed); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Starts an API; with `port` it listens, without it only loads the module (for start-up checks). */
function start(app, env, port) {
  const code = port ? `require(${JSON.stringify(SERVER_ENTRY[app])}).listen(${port})` : `require(${JSON.stringify(SERVER_ENTRY[app])}); process.exit(0)`;
  const child = spawn(process.execPath, ['-e', code], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: '', DEMO_MODE: 'false', STAFF_LOGIN_RATE_LIMIT: '1000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { output: '', exited: false, code: null };
  const keep = (c) => { state.output += c.toString(); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  state.done = new Promise((resolve) => child.on('exit', (c) => { state.exited = true; state.code = c; resolve(c); }));
  state.waitUp = async () => {
    for (let i = 0; i < 300 && !state.exited; i++) {
      try { if ((await request(port, 'GET', '/api/health')).status === 200) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${app} on ${port} did not start:\n${state.output.slice(-2000)}`);
  };
  state.stop = () => (state.exited ? Promise.resolve() : (child.kill(), state.done));
  return state;
}

const sign = (payload, secret, opts = {}) => jwt.sign(payload, secret, { expiresIn: '1h', ...opts });

async function main() {
  const servers = [];
  try {
    // --- Tokens: each API with only its own secret ---------------------------------------------------
    console.log('--- Tokens (each API knows only its own secret)');
    const B = start('borrower', { ...NO_SECRETS, BORROWER_JWT_SECRET: BORROWER_SECRET }, 5041);
    const A = start('admin', { ...NO_SECRETS, ADMIN_JWT_SECRET: ADMIN_SECRET, DB_INIT: 'false' }, 5042);
    servers.push(B, A);
    await Promise.all([B.waitUp(), A.waitUp()]);

    const login = await request(5042, 'POST', '/api/auth/staff-login', { body: { email: 'admin@quickloan.co.il', password: 'Admin123456!' } });
    check('staff log in on the admin API', login.status === 200 && login.body.token, `HTTP ${login.status}; run npm run seed:staff first`);
    const staffToken = login.body.token;
    const staffClaims = jwt.decode(staffToken) || {};
    check('staff token carries the admin audience', staffClaims.aud === AUD.staff && staffClaims.type === 'staff');

    const borrowerToken = sign({ sub: 'token-test-user', type: 'borrower' }, BORROWER_SECRET, { audience: AUD.borrower });
    const meStatus = async (token) => (await request(5041, 'GET', '/api/users/me', { token })).status;
    const staffListStatus = async (token) => (await request(5042, 'GET', '/api/flow/applications', { token })).status;

    check('borrower token accepted by the borrower API', (await meStatus(borrowerToken)) !== 401);
    check('borrower token refused by the admin API', (await staffListStatus(borrowerToken)) === 401);
    check('staff token accepted by the admin API', (await staffListStatus(staffToken)) === 200);
    check('staff token refused by the borrower API', (await meStatus(staffToken)) === 401);
    const publicWithStaff = await request(5041, 'POST', '/api/users/lookup', { token: staffToken, body: { identifier: '0520000000' } });
    check('staff token refused even on a public borrower route', publicWithStaff.status === 401, `HTTP ${publicWithStaff.status}`);

    const cases = [
      ['staff token signed with the borrower secret', 'admin', sign({ sub: 'x', type: 'staff', role: 'system_admin' }, BORROWER_SECRET, { audience: AUD.staff })],
      ['staff token with the borrower audience', 'admin', sign({ sub: 'x', type: 'staff', role: 'system_admin' }, ADMIN_SECRET, { audience: AUD.borrower })],
      ['staff token without an audience (old format)', 'admin', sign({ sub: 'x', type: 'staff', role: 'system_admin' }, ADMIN_SECRET)],
      ['borrower token without an audience (old format)', 'borrower', sign({ sub: 'token-test-user', type: 'borrower' }, BORROWER_SECRET)],
      ['borrower token from the old shared development secret', 'borrower', sign({ sub: 'token-test-user', type: 'borrower' }, 'quickloan_dev_stable_secret_key_survives_restarts_2026')],
      ['borrower token signed with the admin secret', 'borrower', sign({ sub: 'token-test-user', type: 'borrower' }, ADMIN_SECRET, { audience: AUD.borrower })],
      ['expired borrower token', 'borrower', sign({ sub: 'token-test-user', type: 'borrower' }, BORROWER_SECRET, { audience: AUD.borrower, expiresIn: -10 })],
      ['unsigned token (alg none)', 'admin', jwt.sign({ sub: 'x', type: 'staff', role: 'system_admin', aud: AUD.staff }, null, { algorithm: 'none' })],
    ];
    for (const [name, app, token] of cases) {
      const status = app === 'admin' ? await staffListStatus(token) : await meStatus(token);
      check(`${name}: refused`, status === 401, `HTTP ${status}`);
    }

    // --- CORS ----------------------------------------------------------------------------------------
    console.log('--- CORS');
    const allowed = async (port, origin) => (await request(port, 'GET', '/api/health', { headers: { Origin: origin } })).headers['access-control-allow-origin'];
    check('borrower API allows the borrower dev site', (await allowed(5041, 'http://localhost:3000')) === 'http://localhost:3000');
    check('borrower API does not allow the admin dev site', !(await allowed(5041, 'http://localhost:3001')));
    check('admin API allows the admin dev site', (await allowed(5042, 'http://localhost:3001')) === 'http://localhost:3001');
    check('admin API does not allow the borrower dev site', !(await allowed(5042, 'http://localhost:3000')));
    check('neither API allows another site', !(await allowed(5041, 'https://evil.example')) && !(await allowed(5042, 'https://evil.example')));
    const preflight = await request(5042, 'OPTIONS', '/api/flow/applications', { headers: { Origin: 'http://localhost:3001', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    check('admin API answers the dev site\'s preflight', preflight.status === 204 && preflight.headers['access-control-allow-origin'] === 'http://localhost:3001', `HTTP ${preflight.status}`);
    await Promise.all(servers.splice(0).map((s) => s.stop()));

    const C = start('borrower', { CORS_ORIGIN: 'https://app.example.com' }, 5043);
    servers.push(C);
    await C.waitUp();
    check('CORS_ORIGIN replaces the dev defaults', (await allowed(5043, 'https://app.example.com')) === 'https://app.example.com' && !(await allowed(5043, 'http://localhost:3000')));
    await Promise.all(servers.splice(0).map((s) => s.stop()));

    const P = start('borrower', { ...NO_SECRETS, NODE_ENV: 'production', BORROWER_JWT_SECRET: BORROWER_SECRET }, 5044);
    servers.push(P);
    await P.waitUp();
    check('production: borrower API starts with only its own secret', true);
    check('production: no cross-site access by default (same-origin behind nginx)', !(await allowed(5044, 'http://localhost:3000')));
    await Promise.all(servers.splice(0).map((s) => s.stop()));

    // --- Production start-up checks -------------------------------------------------------------------
    console.log('--- Production start-up checks');
    const refuses = async (name, app, env, message) => {
      const s = start(app, { ...NO_SECRETS, NODE_ENV: 'production', DB_INIT: 'false', ...env });
      const code = await s.done;
      check(name, code !== 0 && s.output.includes(message), `exit ${code}: ${s.output.slice(-300)}`);
    };
    await refuses('borrower API refuses to start without BORROWER_JWT_SECRET', 'borrower', {}, 'BORROWER_JWT_SECRET must be set in production');
    await refuses('admin API refuses to start without ADMIN_JWT_SECRET', 'admin', { BORROWER_JWT_SECRET: BORROWER_SECRET }, 'ADMIN_JWT_SECRET must be set in production');
    await refuses('an API refuses one shared JWT_SECRET for both apps', 'admin', { JWT_SECRET: 'one-secret-for-everything' }, 'must be different in production');
  } finally {
    await Promise.all(servers.map((s) => s.stop()));
  }
}

main()
  .catch((err) => { failed++; console.error(err); })
  .finally(() => {
    console.log('\n================================================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('================================================================');
    process.exit(failed ? 1 : 0);
  });
