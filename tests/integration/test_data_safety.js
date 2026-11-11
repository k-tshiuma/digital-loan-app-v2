/**
 * Data safety with two processes on one database (docs/app-separation-plan.md, Phase 9).
 *
 * - Request numbers: two processes asking at the same moment never get the same number; the unique index
 *   exists; a client can't give an application another one's number.
 * - Flow saves write only what they changed: a staff message (admin API) and a draft save (borrower API)
 *   at the same moment both survive.
 * - Registration consent sent several times at once is recorded once.
 * - A PDF request with an application in the body (offline fallback) never stores it: no records for
 *   other users, no fields that bypass the normal save rules.
 *
 * Usage: npm run seed:staff (once), then node tests/integration/test_data_safety.js
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const BORROWER_PORT = 5051;
const ADMIN_PORT = 5052;
const ROOT = path.resolve(__dirname, '../..');
const SERVER_ENTRY = {
  borrower: path.join(ROOT, 'borrower-app/backend/server.js'),
  admin: path.join(ROOT, 'admin-app/backend/server.js'),
};

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

function spawnNode(code, env) {
  const child = spawn(process.execPath, ['-e', code], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: '', DEMO_MODE: 'true', FLOW_REGISTER_RATE_LIMIT: '1000', STAFF_LOGIN_RATE_LIMIT: '1000', ENABLE_CLASSIC_FLOW: 'true', ...env }, // the request-number check uses a classic draft
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { output: '', stdout: '', exited: false };
  child.stdout.on('data', (c) => { state.output += c; state.stdout += c; });
  child.stderr.on('data', (c) => { state.output += c; });
  state.done = new Promise((resolve) => child.on('exit', (code) => { state.exited = true; resolve(code); }));
  state.stop = () => (state.exited ? Promise.resolve() : (child.kill(), state.done));
  return state;
}

function startApi(app, port, env = {}) {
  const s = spawnNode(`require(${JSON.stringify(SERVER_ENTRY[app])}).listen(${port})`, env);
  s.waitUp = async () => {
    for (let i = 0; i < 300 && !s.exited; i++) {
      try { if ((await request(port, 'GET', '/api/health')).status === 200) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${app} API did not start:\n${s.output.slice(-2000)}`);
  };
  return s;
}

const randomPhone = (prefix) => prefix + Math.floor(1000000 + Math.random() * 9000000);

async function main() {
  const borrower = startApi('borrower', BORROWER_PORT);
  const admin = startApi('admin', ADMIN_PORT, { DB_INIT: 'false' });
  try {
    await Promise.all([borrower.waitUp(), admin.waitUp()]);

    // --- Request numbers -----------------------------------------------------------------------------
    console.log('--- Request numbers');
    const allocate = (n) => spawnNode(
      `const { nextRequestNumber } = require(${JSON.stringify(path.join(ROOT, 'shared/backend/core/applications.js'))});
       Promise.all(Array.from({ length: ${n} }, () => nextRequestNumber()))
         .then((r) => { console.log('NUMBERS=' + JSON.stringify(r)); process.exit(0); })
         .catch((e) => { console.error(e); process.exit(1); });`,
      { DB_INIT: 'false' }
    );
    const workers = [allocate(40), allocate(40), allocate(40)];
    const codes = await Promise.all(workers.map((w) => w.done));
    const numbers = workers.flatMap((w) => JSON.parse((/NUMBERS=(.*)/.exec(w.stdout) || [])[1] || '[]'));
    check('three processes allocate 120 numbers at once without errors', codes.every((c) => c === 0) && numbers.length === 120, workers.map((w) => w.output.slice(-300)).join(' | '));
    check('all 120 numbers are different', new Set(numbers).size === 120, `${new Set(numbers).size} unique`);
    check('numbers have the REQ-<year>-<6 digits> format', numbers.every((n) => /^REQ-\d{4}-\d{6,}$/.test(n)));

    const indexCheck = spawnNode(
      `const db = require(${JSON.stringify(path.join(ROOT, 'shared/backend/database.js'))});
       db.get("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_applications_request_number'", (e, r) => { console.log('INDEX=' + JSON.stringify(r || null)); process.exit(0); });`,
      { DB_INIT: 'false' }
    );
    await indexCheck.done;
    check('the unique index on request numbers exists', /UNIQUE INDEX/i.test(indexCheck.stdout), indexCheck.output.slice(-300));

    // A classic draft (demo user) keeps its own number even if the client sends another application's.
    const active = await request(BORROWER_PORT, 'GET', '/api/applications/active/demo_user');
    const draft = active.body.application;
    check('classic draft has a server-assigned number', active.status === 200 && /^REQ-/.test(draft && draft.requestNumber || ''), `HTTP ${active.status}`);
    if (draft) {
      const stolen = numbers[0];
      const put = await request(BORROWER_PORT, 'PUT', `/api/applications/${draft.id}`, { body: { ...draft, requestNumber: stolen } });
      check('a client cannot change an application\'s request number', put.status === 200 && put.body.application.requestNumber === draft.requestNumber,
        `HTTP ${put.status}, got ${put.body && put.body.application && put.body.application.requestNumber}`);
    }

    // --- Concurrent saves ------------------------------------------------------------------------------
    console.log('--- Staff message and applicant draft at the same moment');
    const login = await request(ADMIN_PORT, 'POST', '/api/auth/staff-login', { body: { email: 'admin@quickloan.co.il', password: 'Admin123456!' } });
    check('staff log in', login.status === 200, `HTTP ${login.status}; run npm run seed:staff first`);
    const staffToken = login.body.token;

    const phone = randomPhone('054');
    await request(BORROWER_PORT, 'POST', '/api/users/request-otp', { body: { phoneNumber: phone } });
    const reg = await request(BORROWER_PORT, 'POST', '/api/flow/register', { body: {
      fullName: 'Data Safety', email: `data_safety_${Date.now()}@example.com`, password: 'StrongPassword123!', phoneNumber: phone,
      code: '123456', language: 'en', registration: { disclaimerAccepted: true, locationGranted: true },
    } });
    check('applicant registered', reg.status === 200, JSON.stringify(reg.body).slice(0, 200));
    const applicantToken = reg.body.token;
    const appId = reg.body.application && reg.body.application.id;

    const ROUNDS = 25;
    let lost = 0;
    for (let i = 1; i <= ROUNDS; i++) {
      const [d, m] = await Promise.all([
        request(BORROWER_PORT, 'PUT', '/api/flow/application/steps/1/draft', { token: applicantToken, body: { data: { personal: { address: `Street ${i}` } } } }),
        request(ADMIN_PORT, 'POST', `/api/flow/applications/${appId}/message`, { token: staffToken, body: { message: `Message ${i}` } }),
      ]);
      if (d.status !== 200 || m.status !== 200) { lost++; console.log(`    round ${i}: draft HTTP ${d.status}, message HTTP ${m.status}`); continue; }
      const view = (await request(BORROWER_PORT, 'GET', '/api/flow/application', { token: applicantToken })).body.application;
      const address = view.steps[1].data && view.steps[1].data.personal && view.steps[1].data.personal.address;
      const message = view.staffMessage && view.staffMessage.text;
      if (address !== `Street ${i}` || message !== `Message ${i}`) { lost++; console.log(`    round ${i}: address=${address}, message=${message}`); }
    }
    check(`${ROUNDS} rounds: the draft and the staff message both survive every time`, lost === 0, `${lost} round(s) lost a write`);

    // --- Consent recorded once ----------------------------------------------------------------------------
    console.log('--- Registration consent sent several times at once');
    const phone2 = randomPhone('055');
    await request(BORROWER_PORT, 'POST', '/api/users/request-otp', { body: { phoneNumber: phone2 } });
    const verified = await request(BORROWER_PORT, 'POST', '/api/users/verify-otp', { body: { phoneNumber: phone2, code: '123456' } });
    const t2 = verified.body.token;
    const before = await request(BORROWER_PORT, 'GET', '/api/flow/application', { token: t2 });
    check('account signed in elsewhere needs the consent', before.status === 200 && before.body.application.needsRegistrationConsent === true, `HTTP ${before.status}`);
    const consents = await Promise.all(Array.from({ length: 6 }, () =>
      request(BORROWER_PORT, 'POST', '/api/flow/application/registration-consent', { token: t2, body: { disclaimerAccepted: true, locationGranted: true } })));
    check('all six requests succeed', consents.every((r) => r.status === 200), consents.map((r) => r.status).join(','));
    const app2 = before.body.application.id;
    const auditRes = await request(ADMIN_PORT, 'GET', `/api/flow/applications/${app2}/audit`, { token: staffToken });
    const entries = (auditRes.body.audit || auditRes.body.entries || []).filter((e) => e.action === 'REGISTRATION_CONSENT');
    check('the consent is recorded once in the audit log', auditRes.status === 200 && entries.length === 1, `HTTP ${auditRes.status}, ${entries.length} entries`);
    const after = await request(BORROWER_PORT, 'GET', '/api/flow/application', { token: t2 });
    check('the application now has the consent', after.body.application.needsRegistrationConsent === false);

    // --- PDF fallback ---------------------------------------------------------------------------------------
    console.log('--- PDF with an application in the body (offline fallback)');
    const isPdf = (r) => r.status === 200 && String(r.headers['content-type']).includes('application/pdf');
    const forged = (id) => ({ id, userId: 'someone_else', status: 'Approved', isSubmitted: true, riskScore: 99,
      borrowerDetails: { fullName: 'PDF Probe' }, language: 'en' });
    const probeId = `pdf_probe_${Date.now()}`;
    const borrowerPdf = await request(BORROWER_PORT, 'POST', `/api/applications/${probeId}/pdf`, { token: applicantToken, body: forged(probeId) });
    check('an unsaved application sent by a borrower still gets a PDF', isPdf(borrowerPdf), `HTTP ${borrowerPdf.status}`);
    const afterBorrower = await request(ADMIN_PORT, 'GET', `/api/applications/${probeId}`, { token: staffToken });
    check('... and is not stored (no record for another user, no forged status)', afterBorrower.status === 404, `HTTP ${afterBorrower.status}`);

    const staffProbeId = `pdf_probe_staff_${Date.now()}`;
    const staffPdf = await request(ADMIN_PORT, 'POST', `/api/applications/${staffProbeId}/pdf`, { token: staffToken, body: forged(staffProbeId) });
    const afterStaff = await request(ADMIN_PORT, 'GET', `/api/applications/${staffProbeId}`, { token: staffToken });
    check('the admin API renders it too, and stores nothing', isPdf(staffPdf) && afterStaff.status === 404, `HTTP ${staffPdf.status} / ${afterStaff.status}`);

    if (draft) {
      const before = (await request(ADMIN_PORT, 'GET', `/api/applications/${draft.id}`, { token: staffToken })).body.application;
      const other = await request(BORROWER_PORT, 'POST', `/api/applications/${draft.id}/pdf`, { token: applicantToken, body: { ...forged(draft.id), userId: draft.userId } });
      check('another user\'s stored application is refused (403)', other.status === 403, `HTTP ${other.status}`);
      const unchanged = (await request(ADMIN_PORT, 'GET', `/api/applications/${draft.id}`, { token: staffToken })).body.application;
      check('... and stays unchanged', unchanged.status === before.status && unchanged.updatedAt === before.updatedAt);
    }
  } finally {
    await Promise.all([borrower.stop(), admin.stop()]);
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
