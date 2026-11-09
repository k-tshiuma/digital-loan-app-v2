/**
 * Login sessions in HttpOnly cookies (core/sessionCookie.js, Phase 9). Both APIs as separate processes on
 * the same database, as in production.
 *
 * - Every sign-in sets the API's own cookie: HttpOnly, SameSite=Strict, Path=/api, lifetime = the token's,
 *   Secure in production (COOKIE_SECURE overrides).
 * - The cookie signs requests in, including the live-status stream; each API ignores the other's cookie.
 * - CSRF: a cookie-signed state change without X-QuickLoan-Request: 1 gets 403; with it, or with a Bearer
 *   header instead of the cookie, it goes through.
 * - Logout and a rejected cookie both delete the cookie. CORS allows credentials for the dev site only.
 *
 * Usage: npm run seed:staff (once), then node tests/integration/test_session_cookies.js
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ENTRY = {
  borrower: path.resolve(__dirname, '../../borrower-app/backend/server.js'),
  admin: path.resolve(__dirname, '../../admin-app/backend/server.js'),
};
const B = 5071; // borrower, demo mode (OTP codes in the response)
const A = 5072; // admin
const P = 5073; // borrower, production mode
const PNOSEC = 5074; // borrower, production mode with COOKIE_SECURE=false
const SECRETS = { JWT_SECRET: '', BORROWER_JWT_SECRET: 'cookie-test-borrower-secret-0123456789', ADMIN_JWT_SECRET: 'cookie-test-admin-secret-9876543210' };
const CSRF = { 'X-QuickLoan-Request': '1' };

let passed = 0;
let failed = 0;
const check = (msg, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ PASS: ${msg}`); } else { failed++; console.log(`  ✗ FAIL: ${msg}${detail ? ` (${detail})` : ''}`); }
};

function request(port, method, urlPath, { body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    let payload = null;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers: h, timeout: 15000 }, (res) => {
      if (raw) { resolve({ status: res.statusCode, headers: res.headers, res }); return; }
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

function start(app, env, port) {
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(ENTRY[app])}).listen(${port})`], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: '', STAFF_LOGIN_RATE_LIMIT: '1000', FLOW_REGISTER_RATE_LIMIT: '1000', ...SECRETS, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { output: '', exited: false };
  child.stdout.on('data', (c) => { state.output += c; });
  child.stderr.on('data', (c) => { state.output += c; });
  state.done = new Promise((resolve) => child.on('exit', () => { state.exited = true; resolve(); }));
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

/** The Set-Cookie line for `name`, parsed: { value, attrs: { httponly: true, 'max-age': '604800', ... } }. */
function cookieFrom(res, name) {
  const lines = [].concat(res.headers['set-cookie'] || []);
  const line = lines.find((l) => l.startsWith(`${name}=`));
  if (!line) return null;
  const [pair, ...rest] = line.split(';').map((s) => s.trim());
  const attrs = {};
  for (const a of rest) {
    const [k, v] = a.split('=');
    attrs[k.toLowerCase()] = v === undefined ? true : v;
  }
  return { value: pair.slice(name.length + 1), attrs, line };
}

async function registerBorrower(port) {
  const phoneNumber = '052' + Math.floor(1000000 + Math.random() * 9000000);
  const otp = await request(port, 'POST', '/api/users/request-otp', { body: { phoneNumber } });
  const password = 'CookieTest123456!';
  const reg = await request(port, 'POST', '/api/flow/register', { body: {
    fullName: 'Cookie Test', email: `cookie_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`, password,
    phoneNumber, code: otp.body.demoCode || '123456', language: 'en', registration: { disclaimerAccepted: true, locationGranted: true },
  } });
  return { reg, phoneNumber, password };
}

async function main() {
  const servers = [];
  try {
    const borrower = start('borrower', { DEMO_MODE: 'true' }, B);
    const admin = start('admin', { DB_INIT: 'false' }, A);
    servers.push(borrower, admin);
    await Promise.all([borrower.waitUp(), admin.waitUp()]);

    console.log('--- Borrower sign-in sets the cookie');
    const { reg, phoneNumber, password } = await registerBorrower(B);
    check('registration succeeds', reg.status === 200 || reg.status === 201, `HTTP ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
    const bc = cookieFrom(reg, 'ql_borrower');
    check('sets ql_borrower', !!bc && bc.value === reg.body.token, bc ? 'value differs from token' : 'no cookie');
    check('HttpOnly, SameSite=Strict, Path=/api', bc && bc.attrs.httponly === true && bc.attrs.samesite === 'Strict' && bc.attrs.path === '/api', bc && bc.line);
    const maxAge = bc ? Number(bc.attrs['max-age']) : 0;
    check('lifetime is the token\'s (7 days)', maxAge > 7 * 86400 - 60 && maxAge <= 7 * 86400, `Max-Age=${maxAge}`);
    check('not Secure outside production (local http)', bc && !bc.attrs.secure);
    const userId = reg.body.user && reg.body.user.id;
    const appId = reg.body.application && reg.body.application.id;
    const borrowerCookie = { Cookie: `ql_borrower=${bc && bc.value}` };

    const login = await request(B, 'POST', '/api/users/login', { body: { identifier: phoneNumber, password } });
    check('password login sets ql_borrower too', login.status === 200 && !!cookieFrom(login, 'ql_borrower'), `HTTP ${login.status}`);

    console.log('--- The cookie signs requests in');
    const me = await request(B, 'GET', '/api/users/me', { headers: borrowerCookie });
    check('GET /api/users/me with only the cookie is this user', me.status === 200 && me.body.user && me.body.user.id === userId, `HTTP ${me.status} ${me.body.user && me.body.user.id}`);
    const flowApp = await request(B, 'GET', '/api/flow/application', { headers: borrowerCookie });
    check('flow application with only the cookie', flowApp.status === 200 && JSON.stringify(flowApp.body).includes(appId), `HTTP ${flowApp.status}`);
    const sse = await request(B, 'GET', `/api/applications/${appId}/events`, { headers: borrowerCookie, raw: true });
    check('live-status stream opens with only the cookie', sse.status === 200 && /text\/event-stream/.test(sse.headers['content-type'] || ''), `HTTP ${sse.status}`);
    sse.res.destroy();

    console.log('--- CSRF');
    const noHeader = await request(B, 'PUT', '/api/users/me/language', { headers: borrowerCookie, body: { language: 'he' } });
    check('cookie + state change without the header -> 403', noHeader.status === 403 && noHeader.body.code === 'CSRF_CHECK_FAILED', `HTTP ${noHeader.status}`);
    const withHeader = await request(B, 'PUT', '/api/users/me/language', { headers: { ...borrowerCookie, ...CSRF }, body: { language: 'he' } });
    check('cookie + header -> goes through', withHeader.status === 200, `HTTP ${withHeader.status}`);
    const bearer = await request(B, 'PUT', '/api/users/me/language', { headers: { Authorization: `Bearer ${reg.body.token}` }, body: { language: 'en' } });
    check('Bearer header without the CSRF header -> goes through (cookie not used)', bearer.status === 200, `HTTP ${bearer.status}`);
    const wrongValue = await request(B, 'PUT', '/api/users/me/language', { headers: { ...borrowerCookie, 'X-QuickLoan-Request': 'yes' }, body: { language: 'he' } });
    check('header with another value -> 403', wrongValue.status === 403, `HTTP ${wrongValue.status}`);
    const loginNoHeader = await request(B, 'POST', '/api/users/login', { headers: borrowerCookie, body: { identifier: phoneNumber, password } });
    check('even public routes need the header when a cookie is sent', loginNoHeader.status === 403, `HTTP ${loginNoHeader.status}`);
    const getNoHeader = await request(B, 'GET', '/api/users/me', { headers: borrowerCookie });
    check('GETs need no header', getNoHeader.status === 200, `HTTP ${getNoHeader.status}`);

    console.log('--- Staff sign-in on the admin API');
    const staff = await request(A, 'POST', '/api/auth/staff-login', { body: { email: 'reviewer@quickloan.co.il', password: 'Reviewer123456!' } });
    check('staff log in', staff.status === 200, `HTTP ${staff.status}; run npm run seed:staff first`);
    const sc = cookieFrom(staff, 'ql_staff');
    check('sets ql_staff (HttpOnly, Strict, /api, 12 h)', sc && sc.attrs.httponly === true && sc.attrs.samesite === 'Strict' && sc.attrs.path === '/api' && Math.abs(Number(sc.attrs['max-age']) - 12 * 3600) < 60, sc && sc.line);
    const staffCookie = { Cookie: `ql_staff=${sc && sc.value}` };
    const list = await request(A, 'GET', '/api/flow/applications', { headers: staffCookie });
    check('staff list with only the cookie', list.status === 200, `HTTP ${list.status}`);
    const msgNoHeader = await request(A, 'POST', `/api/flow/applications/${appId}/message`, { headers: staffCookie, body: { text: 'Hello' } });
    check('staff state change without the header -> 403', msgNoHeader.status === 403 && msgNoHeader.body.code === 'CSRF_CHECK_FAILED', `HTTP ${msgNoHeader.status}`);
    const msgHeader = await request(A, 'POST', `/api/flow/applications/${appId}/message`, { headers: { ...staffCookie, ...CSRF }, body: { text: 'Hello from the cookie test' } });
    check('staff state change with the header passes the check', msgHeader.status !== 403 && msgHeader.status !== 401, `HTTP ${msgHeader.status}`);

    console.log('--- Each API reads only its own cookie (locally both are on localhost)');
    const both = { Cookie: `ql_staff=${sc && sc.value}; ql_borrower=${bc && bc.value}` };
    const meBoth = await request(B, 'GET', '/api/users/me', { headers: both });
    check('borrower API with both cookies: the borrower', meBoth.status === 200 && meBoth.body.user && meBoth.body.user.id === userId, `HTTP ${meBoth.status}`);
    const listBoth = await request(A, 'GET', '/api/flow/applications', { headers: both });
    check('admin API with both cookies: the staff member', listBoth.status === 200, `HTTP ${listBoth.status}`);
    const staffOnBorrower = await request(B, 'GET', '/api/users/me', { headers: { Cookie: `ql_borrower=${sc && sc.value}` } });
    check('a staff token in the borrower cookie is refused', staffOnBorrower.status === 401, `HTTP ${staffOnBorrower.status}`);
    const borrowerOnAdmin = await request(A, 'GET', '/api/flow/applications', { headers: { Cookie: `ql_staff=${bc && bc.value}` } });
    check('a borrower token in the staff cookie is refused', borrowerOnAdmin.status === 401, `HTTP ${borrowerOnAdmin.status}`);
    check('...and the bad staff cookie is deleted', (cookieFrom(borrowerOnAdmin, 'ql_staff') || { attrs: {} }).attrs['max-age'] === '0');
    const loginWithBad = await request(A, 'POST', '/api/auth/staff-login', { headers: { Cookie: 'ql_staff=expired.or.forged', ...CSRF }, body: { email: 'reviewer@quickloan.co.il', password: 'Reviewer123456!' } });
    check('staff can sign in while an old, invalid staff cookie is still sent', loginWithBad.status === 200 && !!cookieFrom(loginWithBad, 'ql_staff') && cookieFrom(loginWithBad, 'ql_staff').value !== '', `HTTP ${loginWithBad.status}`);
    const borrowerCookieOnAdmin = await request(A, 'GET', '/api/flow/applications', { headers: borrowerCookie });
    check('the admin API ignores ql_borrower (401: no session)', borrowerCookieOnAdmin.status === 401, `HTTP ${borrowerCookieOnAdmin.status}`);

    console.log('--- Logout');
    for (const [name, port, cookieName, headers] of [['borrower', B, 'ql_borrower', borrowerCookie], ['admin', A, 'ql_staff', staffCookie]]) {
      const out = await request(port, 'POST', '/api/auth/logout', { headers: { ...headers, ...CSRF } });
      const cleared = cookieFrom(out, cookieName);
      check(`${name} logout deletes ${cookieName}`, out.status === 200 && cleared && cleared.value === '' && cleared.attrs['max-age'] === '0' && cleared.attrs.httponly === true, cleared && cleared.line);
    }

    console.log('--- CORS with credentials');
    const pre = await request(B, 'OPTIONS', '/api/users/me/language', { headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,x-quickloan-request' } });
    check('dev site preflight allows credentials and the CSRF header', pre.headers['access-control-allow-credentials'] === 'true' && pre.headers['access-control-allow-origin'] === 'http://localhost:3000' && /x-quickloan-request/i.test(pre.headers['access-control-allow-headers'] || ''), JSON.stringify(pre.headers));
    const evil = await request(B, 'OPTIONS', '/api/users/me/language', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'x-quickloan-request' } });
    check('another site gets no CORS permission', !evil.headers['access-control-allow-origin']);
    await Promise.all(servers.splice(0).map((s) => s.stop()));

    console.log('--- Production mode');
    const prod = start('borrower', { NODE_ENV: 'production' }, P);
    const prodNoSecure = start('borrower', { NODE_ENV: 'production', COOKIE_SECURE: 'false', DB_INIT: 'false' }, PNOSEC);
    servers.push(prod, prodNoSecure);
    await Promise.all([prod.waitUp(), prodNoSecure.waitUp()]);
    const pLogin = await request(P, 'POST', '/api/users/login', { body: { identifier: phoneNumber, password } });
    const pc = cookieFrom(pLogin, 'ql_borrower');
    check('production cookie is Secure', pLogin.status === 200 && pc && pc.attrs.secure === true, `HTTP ${pLogin.status} ${pc && pc.line}`);
    const nsLogin = await request(PNOSEC, 'POST', '/api/users/login', { body: { identifier: phoneNumber, password } });
    const nc = cookieFrom(nsLogin, 'ql_borrower');
    check('COOKIE_SECURE=false turns Secure off', nsLogin.status === 200 && nc && !nc.attrs.secure, nc && nc.line);
    const forged = await request(P, 'GET', '/api/users/me', { headers: { Cookie: 'ql_borrower=not.a.token' } });
    check('a bad cookie gets 401 and is deleted', forged.status === 401 && (cookieFrom(forged, 'ql_borrower') || { attrs: {} }).attrs['max-age'] === '0', `HTTP ${forged.status}`);
    const pMe = await request(P, 'GET', '/api/users/me', { headers: { Cookie: `ql_borrower=${pc && pc.value}` } });
    check('the production cookie signs in', pMe.status === 200 && pMe.body.user && pMe.body.user.id === userId, `HTTP ${pMe.status}`);
  } finally {
    await Promise.all(servers.map((s) => s.stop()));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
