/**
 * The classic wizard switched off on the borrower API (ENABLE_CLASSIC_FLOW unset, the default).
 *
 * The classic 9-step wizard skips the Back Office approvals of the 3-step flow, so the borrower API refuses
 * to start or change a classic draft (403 CLASSIC_FLOW_DISABLED). What stays open:
 * - submitted classic applications: read, history, PDF, and re-submitting after a requested document
 * - the 3-step flow, and the legacy PUT's 409 for 3-step applications
 * - the access check comes first: someone else's records still get a plain 403
 *
 * Runs two borrower APIs on one database: 5081 with the classic wizard on (to make classic records the way
 * an old applicant did) and 5082 with it off; plus the admin API on 5083 to ask for a document.
 *
 * Usage: npm run seed:staff (once), then node tests/integration/test_classic_flow_disabled.js
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ON_PORT = 5081;
const OFF_PORT = 5082;
const ADMIN_PORT = 5083;
const ROOT = path.resolve(__dirname, '../..');
const SERVER_ENTRY = {
  borrower: path.join(ROOT, 'borrower-app/backend/server.js'),
  admin: path.join(ROOT, 'admin-app/backend/server.js'),
};
const REVIEWER = ['reviewer@quickloan.co.il', process.env.REVIEWER_INITIAL_PASSWORD || 'Reviewer123456!'];

let passed = 0;
let failed = 0;
const check = (msg, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ PASS: ${msg}`); } else { failed++; console.log(`  ✗ FAIL: ${msg}${detail ? ` (${detail})` : ''}`); }
};

function request(port, method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let payload = null;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers, timeout: 20000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed = buf.toString();
        try { parsed = JSON.parse(parsed); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: buf });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function startApi(app, port, env) {
  // ENABLE_CLASSIC_FLOW is cleared first so a value in the caller's shell can't leak into the "off" API.
  const baseEnv = { ...process.env };
  delete baseEnv.ENABLE_CLASSIC_FLOW;
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(SERVER_ENTRY[app])}).listen(${port})`], {
    cwd: __dirname,
    env: { ...baseEnv, NODE_ENV: '', DEMO_MODE: 'true', FLOW_REGISTER_RATE_LIMIT: '1000', STAFF_LOGIN_RATE_LIMIT: '1000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const s = { output: '', exited: false };
  child.stdout.on('data', (c) => { s.output += c; });
  child.stderr.on('data', (c) => { s.output += c; });
  s.done = new Promise((resolve) => child.on('exit', () => { s.exited = true; resolve(); }));
  s.stop = () => (s.exited ? Promise.resolve() : (child.kill(), s.done));
  s.waitUp = async () => {
    for (let i = 0; i < 300 && !s.exited; i++) {
      try { if ((await request(port, 'GET', '/api/health')).status === 200) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${app} API on ${port} did not start:\n${s.output.slice(-2000)}`);
  };
  return s;
}

const isClosed = (r) => r.status === 403 && r.body && r.body.code === 'CLASSIC_FLOW_DISABLED';
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`;

async function registerBorrower() {
  const phoneNumber = '054' + Math.floor(1000000 + Math.random() * 9000000);
  await request(ON_PORT, 'POST', '/api/users/request-otp', { body: { phoneNumber } });
  const r = await request(ON_PORT, 'POST', '/api/flow/register', { body: {
    fullName: 'Classic Closed Test', email: `classic-closed-${Date.now()}@quickloan.test`, password: 'ClassicClosed123!',
    phoneNumber, code: '123456', language: 'en', registration: { disclaimerAccepted: true, locationGranted: true },
  } });
  if (r.status !== 200) throw new Error(`could not register the test borrower: ${show(r)}`);
  return { token: r.body.token, userId: r.body.user.id };
}

async function main() {
  const on = startApi('borrower', ON_PORT, { ENABLE_CLASSIC_FLOW: 'true' });
  const off = startApi('borrower', OFF_PORT, { DB_INIT: 'false' });
  const admin = startApi('admin', ADMIN_PORT, { DB_INIT: 'false' });
  try {
    await Promise.all([on.waitUp(), off.waitUp(), admin.waitUp()]);
    const me = await registerBorrower();
    const other = await registerBorrower();
    const auth = { token: me.token };

    console.log('--- Starting or changing a classic draft is refused');
    check('GET /api/applications/active/:own -> 403 CLASSIC_FLOW_DISABLED',
      isClosed(await request(OFF_PORT, 'GET', `/api/applications/active/${me.userId}`, auth)));
    const foreign = await request(OFF_PORT, 'GET', `/api/applications/active/${other.userId}`, auth);
    check('someone else\'s draft is still a plain 403 Forbidden (access is checked first)',
      foreign.status === 403 && !foreign.body.code, show(foreign));
    const newId = `classic_closed_${Date.now()}`;
    check('PUT of a new classic application -> 403 CLASSIC_FLOW_DISABLED',
      isClosed(await request(OFF_PORT, 'PUT', `/api/applications/${newId}`, { ...auth, body: { isSubmitted: true, language: 'en' } })));
    check('...and nothing was stored', (await request(OFF_PORT, 'GET', `/api/applications/${newId}`, auth)).status === 404);

    // An older classic draft, made while the wizard was on.
    const draft = (await request(ON_PORT, 'GET', `/api/applications/active/${me.userId}`, auth)).body.application;
    check('(setup) the classic wizard on: the draft route works', !!(draft && draft.id));
    const draftBody = { ...draft, borrowerDetails: { ...draft.borrowerDetails, fullName: 'Classic Closed Test' } };
    check('saving an existing unsubmitted draft -> 403 CLASSIC_FLOW_DISABLED',
      isClosed(await request(OFF_PORT, 'PUT', `/api/applications/${draft.id}`, { ...auth, body: draftBody })));
    check('submitting an existing draft -> 403 CLASSIC_FLOW_DISABLED',
      isClosed(await request(OFF_PORT, 'PUT', `/api/applications/${draft.id}`, { ...auth, body: { ...draftBody, isSubmitted: true } })));

    console.log('--- Submitted classic applications stay open');
    const submitted = await request(ON_PORT, 'PUT', `/api/applications/${draft.id}`, { ...auth, body: { ...draftBody, isSubmitted: true } });
    check('(setup) the classic wizard on: the draft is submitted', submitted.status === 200 && submitted.body.application.isSubmitted, show(submitted));
    check('reading it -> 200', (await request(OFF_PORT, 'GET', `/api/applications/${draft.id}`, auth)).status === 200);
    const history = await request(OFF_PORT, 'GET', `/api/applications/history/${me.userId}`, auth);
    check('history lists it', history.status === 200 && history.body.applications.some((a) => a.id === draft.id), show(history));
    const pdf = await request(OFF_PORT, 'GET', `/api/applications/${draft.id}/pdf?lang=en`, auth);
    check('its PDF is generated', pdf.status === 200 && pdf.raw.slice(0, 5).toString() === '%PDF-', `${pdf.status}`);

    const staff = await request(ADMIN_PORT, 'POST', '/api/auth/staff-login', { body: { email: REVIEWER[0], password: REVIEWER[1] } });
    if (staff.status !== 200) throw new Error(`staff login failed (run npm run seed:staff): ${show(staff)}`);
    const staffAuth = { token: staff.body.token };
    const staffView = (await request(ADMIN_PORT, 'GET', `/api/applications/${draft.id}`, staffAuth)).body.application;
    const askDoc = await request(ADMIN_PORT, 'PUT', `/api/applications/${draft.id}`, { ...staffAuth, body: { ...staffView, status: 'Additional Document Required' } });
    check('staff can still change a classic application\'s status (admin API)', askDoc.status === 200, show(askDoc));
    const current = (await request(OFF_PORT, 'GET', `/api/applications/${draft.id}`, auth)).body.application;
    const resubmit = await request(OFF_PORT, 'PUT', `/api/applications/${draft.id}`, { ...auth, body: { ...current, status: 'Under Review' } });
    check('the borrower can still re-submit after a requested document',
      resubmit.status === 200 && resubmit.body.application.status === 'Under Review', show(resubmit));

    console.log('--- The 3-step flow is unaffected');
    const flow = await request(OFF_PORT, 'GET', '/api/flow/application', auth);
    check('GET /api/flow/application -> 200', flow.status === 200 && flow.body.application, show(flow));
    const flowId = flow.body.application && flow.body.application.id;
    const locked = await request(OFF_PORT, 'PUT', `/api/applications/${flowId}`, { ...auth, body: {} });
    check('the legacy PUT still answers 409 FLOW_V2_LOCKED for a 3-step application',
      locked.status === 409 && locked.body.code === 'FLOW_V2_LOCKED', show(locked));
  } finally {
    await Promise.all([on.stop(), off.stop(), admin.stop()]);
  }
}

main()
  .catch((err) => { failed++; console.log(`  ✗ FAIL: ${err.stack || err.message}`); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
