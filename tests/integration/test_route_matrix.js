/**
 * Route access matrix: the safety net for the borrower/admin separation (docs/app-separation-plan.md, Phase 1).
 *
 * Calls every API route as each identity (no token, a bad token, a borrower, and each staff role)
 * and compares the HTTP status codes with the snapshot in fixtures/route-matrix.json. It runs two
 * servers: one in demo mode (port 5013) and one with DEMO_MODE=false (port 5014), because access
 * rules differ between them. It does the same for the split backends (Phase 6): borrower-server.js and
 * admin-server.js, each in demo mode (5015/5016) and with DEMO_MODE=false (5017/5018), the admin ones
 * with DB_INIT=false as in production.
 *
 * Requests are built so nothing real is changed: bodies fail validation, mutating routes use IDs
 * that don't exist, and routes that would write only touch the test borrower's own records.
 *
 * Also checks:
 * - SSE: a staff status change reaches the borrower's open event stream, in one process and across the
 *   two backends (the borrower backend's status poller)
 * - Split boundaries: each backend answers 404 for the other one's routes, even with the right token
 * - PDF: borrower and staff copies are generated in English and Hebrew
 *
 * Usage:
 *   node scripts/seed_staff.js           (once; staff accounts must exist)
 *   node test_route_matrix.js            compare with the snapshot
 *   node test_route_matrix.js --update   rewrite the snapshot (only when an access change is intended)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SNAPSHOT_PATH = path.join(__dirname, 'fixtures', 'route-matrix.json');
const UPDATE = process.argv.includes('--update');
const DEMO_PORT = 5013;
const STRICT_PORT = 5014;
// Split backends: [snapshot key, port, entry file, demo mode].
const SPLIT = [
  ['borrowerDemo', 5015, 'borrower-server', true],
  ['adminDemo', 5016, 'admin-server', true],
  ['borrowerStrict', 5017, 'borrower-server', false],
  ['adminStrict', 5018, 'admin-server', false],
];

const MATRIX_USER = {
  fullName: 'Route Matrix Test',
  email: 'route-matrix@quickloan.test',
  phoneNumber: '0520009901',
  password: 'RouteMatrix123!',
};
const STAFF_ACCOUNTS = {
  customer_service: ['service@quickloan.co.il', process.env.SERVICE_INITIAL_PASSWORD || 'Service123456!'],
  credit_reviewer: ['reviewer@quickloan.co.il', process.env.REVIEWER_INITIAL_PASSWORD || 'Reviewer123456!'],
  system_admin: ['admin@quickloan.co.il', process.env.ADMIN_INITIAL_PASSWORD || 'Admin123456!'],
  funding_entity: ['funding@quickloan.co.il', process.env.FUNDING_INITIAL_PASSWORD || 'Funding123456!'],
};
const MISSING = 'route-matrix-missing';

let passed = 0;
let failed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ PASS: ${msg}`); };
const fail = (msg) => { failed++; console.log(`  ✗ FAIL: ${msg}`); };

// --- HTTP helpers -----------------------------------------------------------

function request(port, method, urlPath, { body, token, raw = false, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      // Event streams never end: record the status and hang up.
      if (String(res.headers['content-type'] || '').startsWith('text/event-stream')) {
        res.destroy();
        return resolve({ status: res.statusCode, headers: res.headers, body: null });
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed = buf;
        if (!raw) { try { parsed = JSON.parse(buf.toString()); } catch { parsed = buf.toString(); } }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Opens an event stream and collects events until `until(event)` is true or the timeout passes. */
function openEventStream(port, urlPath, token) {
  const events = [];
  let req;
  const ready = new Promise((resolve, reject) => {
    req = http.get({ hostname: '127.0.0.1', port, path: `${urlPath}?token=${encodeURIComponent(token)}` }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`stream returned ${res.statusCode}`));
      let buf = '';
      res.on('data', (c) => {
        buf += c.toString();
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(frame);
          const data = /^data: (.*)$/m.exec(frame);
          if (ev) events.push({ event: ev[1], data: data ? JSON.parse(data[1]) : null });
        }
      });
      resolve();
    });
    req.on('error', reject);
  });
  const waitFor = (pred, ms) => new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const hit = events.find(pred);
      if (hit || Date.now() - start > ms) return resolve(hit || null);
      setTimeout(tick, 50);
    };
    tick();
  });
  return { ready, events, waitFor, close: () => req.destroy() };
}

// --- Servers ----------------------------------------------------------------

// `code` is the start-up script for the child: by default the combined server.js.
function startServer(port, extraEnv, code = `require('./combinedServer').listen(${port})`) {
  const child = spawn(process.execPath, ['-e', code], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: '', FLOW_REGISTER_RATE_LIMIT: '1000', STAFF_LOGIN_RATE_LIMIT: '1000', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Keep the tail of the server's output so a failed start can be explained.
  let output = '';
  const keep = (c) => { output = (output + c.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exitCode = null;
  child.on('exit', (code) => { exitCode = code; });
  const waitUp = async () => {
    // Up to 30 s: a cold start on a busy machine can take well over the usual second.
    for (let i = 0; i < 300 && exitCode === null; i++) {
      try { const r = await request(port, 'GET', '/api/health', { timeoutMs: 1000 }); if (r.status === 200) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const why = exitCode !== null ? `exited with code ${exitCode}` : 'did not answer within 30 s';
    throw new Error(`server on ${port} ${why}. Last output:\n${output.split('\n').filter((l) => !/^\[(SMS|EMAIL)/.test(l)).slice(-15).join('\n')}`);
  };
  return { child, waitUp };
}

// --- Setup: test borrower, staff tokens, sample IDs -------------------------

async function setup(port) {
  let login = await request(port, 'POST', '/api/users/login', { body: { identifier: MATRIX_USER.email, password: MATRIX_USER.password } });
  if (login.status === 404) {
    await request(port, 'POST', '/api/users/request-otp', { body: { phoneNumber: MATRIX_USER.phoneNumber } });
    const reg = await request(port, 'POST', '/api/flow/register', {
      body: { ...MATRIX_USER, code: '123456', language: 'en', registration: { disclaimerAccepted: true } },
    });
    if (reg.status !== 200) throw new Error(`could not register the test borrower: ${reg.status} ${JSON.stringify(reg.body)}`);
    login = reg;
  }
  if (login.status !== 200) throw new Error(`could not log in the test borrower: ${login.status} ${JSON.stringify(login.body)}`);
  const borrowerToken = login.body.token;
  const userId = login.body.user.id;

  const staffTokens = {};
  for (const [role, [email, password]] of Object.entries(STAFF_ACCOUNTS)) {
    const r = await request(port, 'POST', '/api/auth/staff-login', { body: { email, password } });
    if (r.status !== 200) throw new Error(`staff login failed for ${email} (${r.status}). Run "node scripts/seed_staff.js" first.`);
    staffTokens[role] = r.body.token;
  }

  const own = await request(port, 'GET', '/api/flow/application', { token: borrowerToken });
  if (own.status !== 200) throw new Error(`test borrower has no flow application: ${own.status}`);
  const ownAppId = own.body.application.id;

  // Another applicant's flow application, so ownership checks can be exercised.
  // Must be flowVersion 2 so the legacy PUT in the matrix refuses it instead of overwriting it.
  const list = await request(port, 'GET', '/api/applications', { token: staffTokens.system_admin });
  const rows = (list.body && list.body.applications) || [];
  const foreign = rows
    .filter((a) => a.flowVersion === 2 && a.id !== ownAppId && a.userId && a.userId !== userId && a.userId !== 'demo_user')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  if (!foreign) throw new Error('no other applicant\'s flow application found to test ownership checks');

  return { borrowerToken, userId, staffTokens, ownAppId, foreignAppId: foreign.id, foreignUserId: foreign.userId };
}

// --- Route list -------------------------------------------------------------

function routes(ctx) {
  const { userId, ownAppId, foreignAppId, foreignUserId } = ctx;
  return [
    // Public, before `app.use('/api', authenticate)`
    ['GET', '/api/health'],
    ['POST', '/api/users/lookup', {}],
    ['POST', '/api/users/login', {}],
    ['POST', '/api/users/request-otp', {}],
    ['POST', '/api/users/verify-otp', {}],
    ['POST', '/api/users/register', {}],
    ['POST', '/api/users/google-demo', {}],
    ['POST', '/api/users/forgot-password', {}],
    ['POST', '/api/users/reset-password', {}],
    ['POST', '/api/auth/staff-token', { role: 'not_a_role' }],
    ['POST', '/api/flow/register', {}],
    ['POST', '/api/flow/google', {}],
    ['POST', '/api/auth/staff-login', {}],
    // Accounts and uploads
    ['GET', '/api/users/me'],
    ['PUT', '/api/users/me/language', { language: 'xx' }],
    ['POST', '/api/upload', {}],
    ['GET', `/api/uploads/${MISSING}.pdf`, undefined, '/api/uploads/:missing'],
    // Classic applications
    ['GET', '/api/applications'],
    ['GET', `/api/applications/active/${userId}`, undefined, '/api/applications/active/:own'],
    ['GET', `/api/applications/active/${foreignUserId}`, undefined, '/api/applications/active/:foreign'],
    ['GET', `/api/applications/history/${userId}`, undefined, '/api/applications/history/:own'],
    ['GET', `/api/applications/history/${foreignUserId}`, undefined, '/api/applications/history/:foreign'],
    ['GET', `/api/applications/${ownAppId}`, undefined, '/api/applications/:own'],
    ['GET', `/api/applications/${foreignAppId}`, undefined, '/api/applications/:foreign'],
    // Both are flowVersion 2, so the legacy PUT refuses them (409) after the access check.
    ['PUT', `/api/applications/${ownAppId}`, {}, '/api/applications/:own'],
    ['PUT', `/api/applications/${foreignAppId}`, {}, '/api/applications/:foreign'],
    ['GET', `/api/applications/${ownAppId}/events`, undefined, '/api/applications/:own/events'],
    ['GET', `/api/applications/${foreignAppId}/events`, undefined, '/api/applications/:foreign/events'],
    ['GET', `/api/applications/${ownAppId}/pdf`, undefined, '/api/applications/:own/pdf'],
    ['GET', `/api/applications/${foreignAppId}/pdf`, undefined, '/api/applications/:foreign/pdf'],
    // Notifications
    ['POST', '/api/notifications', {}],
    ['GET', `/api/notifications/${userId}`, undefined, '/api/notifications/:own'],
    ['GET', `/api/notifications/${foreignUserId}`, undefined, '/api/notifications/:foreign'],
    ['PATCH', `/api/notifications/${MISSING}/read`, {}, '/api/notifications/:missing/read'],
    ['POST', `/api/notifications/${userId}/read-all`, {}, '/api/notifications/:own/read-all'],
    ['POST', '/api/notifications/send-sms', {}],
    // Analytics and config
    ['GET', '/api/analytics/summary'],
    ['GET', '/api/config/credit-rules'],
    ['PUT', '/api/config/credit-rules', { rules: { mediumRiskMinScore: 99, lowRiskMinScore: 1 } }],
    // 3-step flow, applicant side
    ['GET', '/api/flow/terms/current'],
    ['GET', '/api/flow/application'],
    ['POST', '/api/flow/application/registration-consent', {}],
    ['POST', '/api/flow/account/contact', {}],
    ['PUT', '/api/flow/application/steps/9/draft', {}, '/api/flow/application/steps/:bad/draft'],
    ['POST', '/api/flow/application/steps/9/submit', {}, '/api/flow/application/steps/:bad/submit'],
    ['POST', '/api/flow/application/final-documents', {}],
    // 3-step flow, staff side
    ['GET', '/api/flow/applications'],
    ['GET', '/api/flow/summary'],
    ['GET', `/api/flow/applications/${ownAppId}`, undefined, '/api/flow/applications/:own'],
    ['POST', `/api/flow/applications/${MISSING}/steps/1/decision`, { decision: 'approve' }, '/api/flow/applications/:missing/steps/1/decision'],
    ['POST', `/api/flow/applications/${MISSING}/final-decision`, {}, '/api/flow/applications/:missing/final-decision'],
    ['POST', `/api/flow/applications/${MISSING}/message`, {}, '/api/flow/applications/:missing/message'],
    ['POST', `/api/flow/applications/${MISSING}/deliveries/${MISSING}/retry`, {}, '/api/flow/applications/:missing/deliveries/:missing/retry'],
    ['GET', `/api/flow/applications/${ownAppId}/audit`, undefined, '/api/flow/applications/:own/audit'],
    // Catch-all
    ['GET', '/api/route-matrix-unknown'],
  ];
}

function identities(ctx) {
  return {
    none: null,
    badToken: 'not.a.valid-token',
    borrower: ctx.borrowerToken,
    ...ctx.staffTokens,
  };
}

async function runMatrix(port, ctx) {
  const ids = identities(ctx);
  const result = {};
  for (const [method, urlPath, body, label] of routes(ctx)) {
    const key = `${method} ${label || urlPath}`;
    result[key] = {};
    for (const [name, token] of Object.entries(ids)) {
      const r = await request(port, method, urlPath, { body, token, raw: true });
      result[key][name] = r.status;
    }
  }
  return result;
}

// --- SSE and PDF checks -----------------------------------------------------

async function ensureClassicApp(port, ctx) {
  const id = `route_matrix_classic_${ctx.userId}`;
  const cur = await request(port, 'GET', `/api/applications/${id}`, { token: ctx.borrowerToken });
  if (cur.status === 200 && cur.body.application && cur.body.application.isSubmitted) return cur.body.application;
  const r = await request(port, 'PUT', `/api/applications/${id}`, {
    token: ctx.borrowerToken,
    body: { isSubmitted: true, language: 'en', borrowerDetails: { fullName: MATRIX_USER.fullName, mobilePhoneNumber: MATRIX_USER.phoneNumber } },
  });
  if (r.status !== 200) throw new Error(`could not create the classic test application: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.application;
}

async function checkSse(port, ctx, { staffPort = port, label = 'one process' } = {}) {
  console.log(`\n--- SSE: staff status change reaches the borrower stream (${label})`);
  const app = await ensureClassicApp(port, ctx);
  const stream = openEventStream(port, `/api/applications/${app.id}/events`, ctx.borrowerToken);
  try {
    await stream.ready;
    const connected = await stream.waitFor((e) => e.event === 'connected', 3000);
    connected ? ok('borrower stream connects') : fail('borrower stream sent no "connected" event');

    const staffView = await request(staffPort, 'GET', `/api/applications/${app.id}`, { token: ctx.staffTokens.credit_reviewer });
    const nextStatus = staffView.body.application.status === 'Under Review' ? 'Received' : 'Under Review';
    const put = await request(staffPort, 'PUT', `/api/applications/${app.id}`, {
      token: ctx.staffTokens.credit_reviewer,
      body: { ...staffView.body.application, status: nextStatus },
    });
    put.status === 200 ? ok(`staff changes status to "${nextStatus}"`) : fail(`staff status change returned ${put.status}`);

    const ev = await stream.waitFor((e) => e.event === 'status' && e.data && e.data.status === nextStatus, 5000);
    ev ? ok('borrower stream receives the "status" event') : fail(`no "status" event for "${nextStatus}" (got: ${stream.events.map((e) => e.event).join(', ')})`);
  } finally {
    stream.close();
  }
  return app;
}

async function checkPdf(port, ctx, app) {
  console.log('\n--- PDF: borrower and staff copies in English and Hebrew');
  const who = { borrower: ctx.borrowerToken, staff: ctx.staffTokens.credit_reviewer };
  for (const [name, token] of Object.entries(who)) {
    for (const lang of ['en', 'he']) {
      const r = await request(port, 'GET', `/api/applications/${app.id}/pdf?lang=${lang}`, { token, raw: true });
      const isPdf = r.status === 200 && String(r.headers['content-type']).includes('application/pdf')
        && Buffer.isBuffer(r.body) && r.body.slice(0, 5).toString() === '%PDF-';
      isPdf ? ok(`${name} PDF (${lang}) is generated`) : fail(`${name} PDF (${lang}): status ${r.status}, type ${r.headers['content-type']}`);
    }
  }
}

// --- Split boundaries ----------------------------------------------------------

/**
 * Each split backend answers 404 for the other one's routes, even with the token that route needs.
 * (Each backend checks the token before the route, so a request without one, or a staff token on the
 * borrower backend, gets 401 first.)
 */
function checkSplitBoundaries(actual) {
  console.log('\n--- Split backends: each answers 404 for the other one\'s routes');
  const cases = [
    // [snapshot key, route, identity, why]
    ['borrowerDemo', 'GET /api/flow/applications', 'borrower', 'staff list'],
    ['borrowerDemo', 'GET /api/analytics/summary', 'borrower', 'analytics'],
    ['borrowerDemo', 'POST /api/auth/staff-login', 'none', 'staff login'],
    ['borrowerStrict', 'POST /api/auth/staff-token', 'borrower', 'demo staff tokens'],
    ['adminDemo', 'GET /api/applications/active/:own', 'credit_reviewer', 'classic draft'],
    ['adminDemo', 'GET /api/flow/application', 'credit_reviewer', 'applicant flow'],
    ['adminDemo', 'POST /api/users/request-otp', 'credit_reviewer', 'borrower sign-in'],
    ['adminDemo', 'GET /api/applications/:own/events', 'credit_reviewer', 'live status stream'],
    ['adminStrict', 'POST /api/upload', 'credit_reviewer', 'uploads'],
  ];
  for (const [mode, route, who, why] of cases) {
    const got = actual[mode][route] && actual[mode][route][who];
    got === 404 ? ok(`${mode}: ${route} (${why}) as ${who} -> 404`) : fail(`${mode}: ${route} (${why}) as ${who} -> ${got}, expected 404`);
  }
  // The guards: staff tokens never reach borrower handlers, and admin never falls back to a demo identity.
  const guard = [
    ['borrowerDemo', 'GET /api/users/me', 'system_admin', 401, 'staff token refused by the borrower backend'],
    ['adminDemo', 'GET /api/flow/applications', 'none', 401, 'no demo identity on the admin backend in demo mode'],
    ['adminDemo', 'GET /api/flow/applications', 'borrower', 401, 'borrower token refused by the admin backend'],
    ['adminDemo', 'GET /api/flow/applications', 'badToken', 401, 'bad token refused by the admin backend'],
  ];
  for (const [mode, route, who, want, why] of guard) {
    const got = actual[mode][route] && actual[mode][route][who];
    got === want ? ok(`${why} (${got})`) : fail(`${why}: got ${got}, expected ${want}`);
  }
}

// --- Compare with snapshot --------------------------------------------------

function compare(mode, actual, expected) {
  console.log(`\n--- Route matrix (${mode})`);
  if (!expected) { fail(`no snapshot for "${mode}" — run with --update to create it`); return; }
  let diffs = 0;
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const exp = expected[key];
    const act = actual[key];
    if (!exp) { diffs++; console.log(`    new route not in snapshot: ${key}`); continue; }
    if (!act) { diffs++; console.log(`    route missing from this run: ${key}`); continue; }
    for (const who of new Set([...Object.keys(exp), ...Object.keys(act)])) {
      if (exp[who] !== act[who]) { diffs++; console.log(`    ${key} as ${who}: expected ${exp[who]}, got ${act[who]}`); }
    }
  }
  const cells = Object.values(actual).reduce((n, r) => n + Object.keys(r).length, 0);
  diffs === 0 ? ok(`${Object.keys(actual).length} routes × identities (${cells} calls) match the snapshot`) : fail(`${diffs} difference(s) from the snapshot`);
}

// --- Main -------------------------------------------------------------------

(async () => {
  console.log('================================================================');
  console.log('ROUTE ACCESS MATRIX (separation safety net)');
  console.log('================================================================');
  const demo = startServer(DEMO_PORT, { DEMO_MODE: 'true' });
  const strict = startServer(STRICT_PORT, { DEMO_MODE: 'false' });
  // The borrower backends poll fast here so the cross-process SSE check doesn't wait 5 s.
  const split = SPLIT.map(([key, port, entry, demoMode]) => [key, port, startServer(
    port,
    { DEMO_MODE: demoMode ? 'true' : 'false', ...(entry === 'admin-server' ? { DB_INIT: 'false' } : {}) },
    entry === 'borrower-server'
      ? `require('../../borrower-app/backend/ssePoller').startStatusPoller({ intervalMs: 300 }); require('../../borrower-app/backend/server').listen(${port})`
      : `require('../../admin-app/backend/server').listen(${port})`
  )]);
  let exitCode = 0;
  try {
    await Promise.all([demo.waitUp(), strict.waitUp(), ...split.map(([, , srv]) => srv.waitUp())]);
    const ctx = await setup(DEMO_PORT);

    const actual = { demo: await runMatrix(DEMO_PORT, ctx), strict: await runMatrix(STRICT_PORT, ctx) };
    for (const [key, port] of split) actual[key] = await runMatrix(port, ctx);

    if (UPDATE) {
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(actual, null, 2) + '\n');
      console.log(`\nSnapshot written to ${path.relative(__dirname, SNAPSHOT_PATH)}`);
    } else {
      const expected = fs.existsSync(SNAPSHOT_PATH) ? JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) : {};
      compare('demo mode', actual.demo, expected.demo);
      compare('DEMO_MODE=false', actual.strict, expected.strict);
      for (const [key] of split) compare(`split: ${key}`, actual[key], expected[key]);
    }
    checkSplitBoundaries(actual);

    const app = await checkSse(DEMO_PORT, ctx);
    await checkSse(5015, ctx, { staffPort: 5016, label: 'borrower backend stream, staff change on the admin backend' });
    await checkPdf(DEMO_PORT, ctx, app);
  } catch (err) {
    fail(err.message);
  } finally {
    demo.child.kill();
    strict.child.kill();
    for (const [, , srv] of split) srv.child.kill();
  }
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');
  if (failed > 0) exitCode = 1;
  process.exit(exitCode);
})();
