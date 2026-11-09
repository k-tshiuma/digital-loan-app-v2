/**
 * Admin API limited to office/VPN networks (ADMIN_ALLOWED_IPS, docs/deployment-runbook.md 2.7).
 * The admin API runs as its own process behind a pretend proxy: TRUST_PROXY=loopback, and the test sends
 * X-Forwarded-For the way nginx does, so req.ip is the "visitor" address.
 *
 * - Addresses inside the list reach the API (health, staff login); others get 403 on every path.
 * - The machine itself (no forwarded address) always passes: deploy health checks call the API directly.
 * - IPv6 networks and single addresses work; a typo in the list stops the API at start-up.
 * - Without a list nothing changes.
 *
 * Usage: npm run seed:staff (once), then node tests/integration/test_admin_network.js
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { parseAllowlist, normalizeAddress } = require('../../shared/backend/core/ipAllowlist');

const ADMIN_ENTRY = path.resolve(__dirname, '../../admin-app/backend/server.js');

let passed = 0;
let failed = 0;
const check = (msg, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ PASS: ${msg}`); } else { failed++; console.log(`  ✗ FAIL: ${msg}${detail ? ` (${detail})` : ''}`); }
};

function request(port, method, urlPath, { body, from } = {}) {
  return new Promise((resolve, reject) => {
    const headers = from ? { 'X-Forwarded-For': from } : {};
    let payload = null;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let parsed = Buffer.concat(chunks).toString();
        try { parsed = JSON.parse(parsed); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Starts the admin API; without `port` it only loads the module (start-up checks). */
function startAdmin(env, port) {
  const code = port ? `require(${JSON.stringify(ADMIN_ENTRY)}).listen(${port})` : `require(${JSON.stringify(ADMIN_ENTRY)}); process.exit(0)`;
  const child = spawn(process.execPath, ['-e', code], {
    cwd: __dirname,
    env: { ...process.env, DB_INIT: 'false', STAFF_LOGIN_RATE_LIMIT: '1000', TRUST_PROXY: 'loopback', ...env },
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
    throw new Error(`admin API on ${port} did not start:\n${state.output.slice(-2000)}`);
  };
  state.stop = () => (state.exited ? Promise.resolve() : (child.kill(), state.done));
  return state;
}

async function main() {
  console.log('--- Parsing the list');
  check('empty list means no limit', parseAllowlist('') === null && parseAllowlist(undefined) === null);
  const list = parseAllowlist('10.8.0.0/16, 198.51.100.7 2001:db8::/32');
  check('IPv4 network matches', list.check('10.8.3.4', 'ipv4') && !list.check('10.9.0.1', 'ipv4'));
  check('single IPv4 address matches only itself', list.check('198.51.100.7', 'ipv4') && !list.check('198.51.100.8', 'ipv4'));
  check('IPv6 network matches', list.check('2001:db8::1', 'ipv6') && !list.check('2001:db9::1', 'ipv6'));
  check('IPv4-mapped IPv6 is read as IPv4', normalizeAddress('::ffff:10.8.0.1') === '10.8.0.1');
  for (const bad of ['10.0.0.0/33', 'office', '10.0.0/8', '10.0.0.0/', '10.0.0.0/8/1', '::1/129']) {
    let threw = false;
    try { parseAllowlist(bad); } catch { threw = true; }
    check(`"${bad}" is refused`, threw);
  }

  const servers = [];
  try {
    console.log('--- Admin API with ADMIN_ALLOWED_IPS');
    const A = startAdmin({ ADMIN_ALLOWED_IPS: '10.8.0.0/16,2001:db8::/32' }, 5061);
    servers.push(A);
    await A.waitUp();

    const inside = await request(5061, 'GET', '/api/health', { from: '10.8.20.30' });
    check('office address reaches the API', inside.status === 200, `HTTP ${inside.status}`);
    const login = await request(5061, 'POST', '/api/auth/staff-login', {
      from: '10.8.20.30',
      body: { email: 'admin@quickloan.co.il', password: 'Admin123456!' },
    });
    check('staff log in from the office', login.status === 200 && login.body.token, `HTTP ${login.status}; run npm run seed:staff first`);
    const v6 = await request(5061, 'GET', '/api/health', { from: '2001:db8::42' });
    check('IPv6 VPN address reaches the API', v6.status === 200, `HTTP ${v6.status}`);

    for (const [name, method, p, body] of [
      ['health', 'GET', '/api/health'],
      ['staff login', 'POST', '/api/auth/staff-login', { email: 'admin@quickloan.co.il', password: 'Admin123456!' }],
      ['staff application list', 'GET', '/api/flow/applications'],
      ['unknown path', 'GET', '/api/nothing-here'],
    ]) {
      const res = await request(5061, method, p, { from: '203.0.113.9', body });
      check(`outside address refused: ${name}`, res.status === 403 && res.body.code === 'NETWORK_NOT_ALLOWED', `HTTP ${res.status}`);
    }
    const outside = await request(5061, 'POST', '/api/auth/staff-login', { from: '203.0.113.9', body: { email: 'admin@quickloan.co.il', password: 'Admin123456!' } });
    check('no token handed out to an outside address', !outside.body.token);
    // nginx sends only $remote_addr; a forged first hop in front of it doesn't help.
    const forged = await request(5061, 'GET', '/api/health', { from: '10.8.0.1, 203.0.113.9' });
    check('a forged earlier hop does not pass', forged.status === 403, `HTTP ${forged.status}`);
    const local = await request(5061, 'GET', '/api/health');
    check('the machine itself passes (deploy health check)', local.status === 200, `HTTP ${local.status}`);
    check('refusals are logged with the address', /refused a request from 203\.0\.113\.9/.test(A.output));
    await Promise.all(servers.splice(0).map((s) => s.stop()));

    console.log('--- Without a list');
    const B = startAdmin({ ADMIN_ALLOWED_IPS: '' }, 5062);
    servers.push(B);
    await B.waitUp();
    const open = await request(5062, 'GET', '/api/health', { from: '203.0.113.9' });
    check('any address reaches the API', open.status === 200, `HTTP ${open.status}`);
    await Promise.all(servers.splice(0).map((s) => s.stop()));

    console.log('--- Start-up');
    const C = startAdmin({ ADMIN_ALLOWED_IPS: '10.8.0.0/16,ofice-vpn' });
    const code = await C.done;
    check('a typo in the list stops the API', code !== 0 && /Invalid address or network/.test(C.output), `exit ${code}`);
  } finally {
    await Promise.all(servers.map((s) => s.stop()));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
