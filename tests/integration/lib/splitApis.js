/**
 * Runs the real borrower and admin APIs for the older HTTP tests, which were written against one
 * combined server on one port. listen(port) starts both APIs as separate processes, as in production, plus
 * a small router on `port` that sends each request where its caller would send it:
 *
 * - a staff token (Authorization header or ?token=) or a /api/auth/staff-* path -> the admin API
 * - anything else -> the borrower API
 * - header X-Test-Target: admin | borrower overrides the choice (to test what the other API answers)
 *
 * Usage, the same shape as an Express app:
 *   const app = require('./lib/splitApis');
 *   const server = app.listen(PORT, async () => { ...tests...; server.close(); });
 * The APIs listen on PORT + 1000 (borrower) and PORT + 2000 (admin).
 * SPLIT_APIS_DEBUG=1 prints how many requests each API got. Options as a third argument:
 *   { env } extra environment for both APIs (e.g. { DEMO_MODE: 'false' }).
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ENTRY = {
  borrower: path.resolve(__dirname, '../../../borrower-app/backend/server.js'),
  admin: path.resolve(__dirname, '../../../admin-app/backend/server.js'),
};

function tokenType(req) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const q = new URL(req.url, 'http://x').searchParams.get('token');
    if (q) token = q;
  }
  if (!token) return null;
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).type || null;
  } catch {
    return null;
  }
}

function targetOf(req) {
  const forced = req.headers['x-test-target'];
  if (forced === 'admin' || forced === 'borrower') return forced;
  if (req.url.startsWith('/api/auth/staff')) return 'admin';
  return tokenType(req) === 'staff' ? 'admin' : 'borrower';
}

function startApi(name, port, env) {
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(ENTRY[name])}).listen(${port})`], {
    env: {
      ...process.env,
      NODE_ENV: '',
      FLOW_REGISTER_RATE_LIMIT: '1000',
      STAFF_LOGIN_RATE_LIMIT: '1000',
      // Staff changes reach open status streams within half a second instead of five.
      SSE_POLL_MS: '500',
      ...(name === 'admin' ? { DB_INIT: 'false' } : {}),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Everything the API logs, kept for tests that check log output (e.g. mock SMS texts); see logsSince().
  const state = { child, output: '', exited: false };
  const keep = (c) => { state.output += c; };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', () => { state.exited = true; });
  return state;
}

function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function listen(port, onReady, { env = {} } = {}) {
  const ports = { borrower: port + 1000, admin: port + 2000 };
  const apis = { borrower: startApi('borrower', ports.borrower, env), admin: startApi('admin', ports.admin, env) };
  const stopApis = () => Object.values(apis).forEach((a) => { if (!a.exited) a.child.kill(); });
  process.on('exit', stopApis);

  const counts = { borrower: 0, admin: 0 };
  const router = http.createServer((req, res) => {
    const target = targetOf(req);
    counts[target]++;
    const headers = { ...req.headers };
    delete headers['x-test-target'];
    const upstream = http.request({ hostname: '127.0.0.1', port: ports[target], path: req.url, method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `${target} API unreachable: ${err.message}` }));
    });
    req.pipe(upstream);
  });

  (async () => {
    // The borrower API owns the schema, so it starts first.
    for (const name of ['borrower', 'admin']) {
      let up = false;
      for (let i = 0; i < 300 && !up && !apis[name].exited; i++) {
        up = await healthy(ports[name]);
        if (!up) await new Promise((r) => setTimeout(r, 100));
      }
      if (!up) {
        console.error(`The ${name} API did not start on port ${ports[name]}:\n${apis[name].output.slice(-4000)}`);
        stopApis();
        process.exit(1);
      }
    }
    router.listen(port, '127.0.0.1', onReady);
  })();

  return {
    /** Current length of an API's log, to pass to logsSince() later. */
    logMark(name = 'borrower') { return apis[name].output.length; },
    /** Log lines an API wrote after `mark`. Waits briefly, since the log arrives through a pipe. */
    async logsSince(mark, name = 'borrower') {
      await new Promise((r) => setTimeout(r, 300));
      return apis[name].output.slice(mark).split(/\r?\n/).filter(Boolean);
    },
    close(cb) {
      // SPLIT_APIS_DEBUG=1 prints how many requests went to each API.
      if (process.env.SPLIT_APIS_DEBUG) console.log(`[splitApis] requests: borrower ${counts.borrower}, admin ${counts.admin}`);
      stopApis();
      router.close(cb);
    },
    ports,
  };
}

module.exports = { listen, targetOf };
