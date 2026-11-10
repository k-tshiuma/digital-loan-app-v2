/**
 * Split backends side by side (docs/app-separation-plan.md, Phase 6): borrower-server.js and
 * admin-server.js as two processes on the same database and uploads folder.
 *
 * - A document a borrower uploads through the borrower backend opens for staff through the admin backend.
 * - Borrower and staff writes at the same time: no server errors and no SQLITE_BUSY.
 * - Stopping either backend leaves the other one working.
 *
 * Usage: node scripts/seed_staff.js (once), then node test_split_backends.js
 */
const http = require('http');
const { spawn } = require('child_process');

const BORROWER_PORT = 5031;
const ADMIN_PORT = 5032;
const USER = { fullName: 'Split Backends Test', email: 'split-backends@quickloan.test', phoneNumber: '0520009902', password: 'SplitBackends123!' };
const ROUNDS = 25;
const SERVER_ENTRY = {
  'borrower-server': require('path').resolve(__dirname, '../../borrower-app/backend/server.js'),
  'admin-server': require('path').resolve(__dirname, '../../admin-app/backend/server.js'),
};

let passed = 0;
let failed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ PASS: ${msg}`); };
const fail = (msg) => { failed++; console.log(`  ✗ FAIL: ${msg}`); };

function request(port, method, path, { body, token, raw = false, formData } = {}) {
  return new Promise((resolve, reject) => {
    let payload = null;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (formData) {
      payload = formData.payload;
      headers['Content-Type'] = `multipart/form-data; boundary=${formData.boundary}`;
      headers['Content-Length'] = payload.length;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed = buf;
        if (!raw) { try { parsed = JSON.parse(buf.toString()); } catch { parsed = buf.toString(); } }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function startBackend(entry, port, env) {
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(SERVER_ENTRY[entry])}).listen(${port})`], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: '', DEMO_MODE: 'true', FLOW_REGISTER_RATE_LIMIT: '1000', STAFF_LOGIN_RATE_LIMIT: '1000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, output: '', exited: false };
  const keep = (c) => { state.output += c.toString(); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', () => { state.exited = true; });
  state.waitUp = async () => {
    for (let i = 0; i < 300 && !state.exited; i++) {
      try { if ((await request(port, 'GET', '/api/health')).status === 200) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${entry} on ${port} did not start:\n${state.output.slice(-2000)}`);
  };
  state.stop = () => new Promise((resolve) => {
    if (state.exited) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
  return state;
}

async function borrowerToken() {
  let r = await request(BORROWER_PORT, 'POST', '/api/users/login', { body: { identifier: USER.email, password: USER.password } });
  if (r.status === 404) {
    await request(BORROWER_PORT, 'POST', '/api/users/request-otp', { body: { phoneNumber: USER.phoneNumber } });
    r = await request(BORROWER_PORT, 'POST', '/api/flow/register', { body: { ...USER, code: '123456', language: 'en', registration: { disclaimerAccepted: true, locationGranted: true } } });
  }
  if (r.status !== 200) throw new Error(`could not sign in the test borrower: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token, userId: r.body.user.id };
}

async function staffToken() {
  const r = await request(ADMIN_PORT, 'POST', '/api/auth/staff-login', { body: { email: 'reviewer@quickloan.co.il', password: process.env.REVIEWER_INITIAL_PASSWORD || 'Reviewer123456!' } });
  if (r.status !== 200) throw new Error(`staff login failed (${r.status}). Run "node scripts/seed_staff.js" first.`);
  return r.body.token;
}

async function checkSharedUploads(borrower, staff) {
  console.log('\n--- A borrower upload opens for staff on the admin backend');
  const content = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(`split backends ${Date.now()}\n`)]);
  const boundary = `----split${Date.now()}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="split.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = await request(BORROWER_PORT, 'POST', '/api/upload', { token: borrower.token, formData: { boundary, payload } });
  if (up.status !== 200) return fail(`upload on the borrower backend returned ${up.status}`);
  ok('borrower uploads a document on the borrower backend');
  const got = await request(ADMIN_PORT, 'GET', `/api/uploads/${up.body.file.filename}`, { token: staff, raw: true });
  got.status === 200 && Buffer.compare(got.body, content) === 0
    ? ok('staff open the same file on the admin backend, byte for byte')
    : fail(`admin backend returned ${got.status} (${got.body.length} bytes, expected ${content.length})`);
}

async function checkConcurrentWrites(borrower, staff, backends) {
  console.log(`\n--- Borrower and staff writes at the same time (${ROUNDS} rounds)`);
  const draft = { personal: { fullName: USER.fullName } };
  const results = [];
  for (let i = 0; i < ROUNDS; i++) {
    results.push(...(await Promise.all([
      request(BORROWER_PORT, 'PUT', '/api/flow/application/steps/1/draft', { token: borrower.token, body: { data: draft } }),
      request(BORROWER_PORT, 'POST', `/api/notifications/${borrower.userId}/read-all`, { token: borrower.token, body: {} }),
      request(BORROWER_PORT, 'GET', `/api/notifications/${borrower.userId}`, { token: borrower.token }),
      request(ADMIN_PORT, 'POST', '/api/notifications', { token: staff, body: { userId: borrower.userId, title: 'Split test', message: `round ${i}`, channel: 'push' } }),
      request(ADMIN_PORT, 'GET', '/api/flow/applications', { token: staff }),
      request(ADMIN_PORT, 'GET', '/api/applications', { token: staff }),
    ])));
  }
  const errors = results.filter((r) => r.status >= 500);
  errors.length === 0 ? ok(`${results.length} requests across both backends, no server errors`) : fail(`${errors.length} server errors, e.g. ${JSON.stringify(errors[0].body)}`);
  const busy = backends.filter((b) => /SQLITE_BUSY|database is locked/.test(b.output));
  busy.length === 0 ? ok('no SQLITE_BUSY in either backend\'s output') : fail('SQLITE_BUSY seen in backend output');
}

async function checkIndependence(borrower, staff, borrowerBackend, adminBackend) {
  console.log('\n--- Each backend keeps working when the other one stops');
  await adminBackend.stop();
  const b = await request(BORROWER_PORT, 'GET', '/api/flow/application', { token: borrower.token });
  b.status === 200 ? ok('admin backend stopped: borrower backend still serves the applicant') : fail(`borrower backend returned ${b.status} with the admin backend stopped`);

  const admin2 = startBackend('admin-server', ADMIN_PORT, { DB_INIT: 'false' });
  await admin2.waitUp();
  await borrowerBackend.stop();
  const a = await request(ADMIN_PORT, 'GET', '/api/flow/applications', { token: staff });
  a.status === 200 ? ok('borrower backend stopped: admin backend still serves staff') : fail(`admin backend returned ${a.status} with the borrower backend stopped`);
  await admin2.stop();
}

(async () => {
  console.log('================================================================');
  console.log('SPLIT BACKENDS (borrower + admin processes, one database)');
  console.log('================================================================');
  const borrowerBackend = startBackend('borrower-server', BORROWER_PORT, {});
  const adminBackend = startBackend('admin-server', ADMIN_PORT, { DB_INIT: 'false' });
  try {
    await Promise.all([borrowerBackend.waitUp(), adminBackend.waitUp()]);
    const borrower = await borrowerToken();
    const staff = await staffToken();
    await checkSharedUploads(borrower, staff);
    await checkConcurrentWrites(borrower, staff, [borrowerBackend, adminBackend]);
    await checkIndependence(borrower, staff, borrowerBackend, adminBackend);
  } catch (err) {
    fail(err.message);
  } finally {
    await borrowerBackend.stop();
    await adminBackend.stop();
  }
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');
  process.exit(failed > 0 ? 1 : 0);
})();
