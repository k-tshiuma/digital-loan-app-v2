// Read-only checks of a deployed QuickLoan (docs/deployment-runbook.md). Changes no data.
//   node deploy/smoke.js https://app.example.com https://admin.example.com [--allow-demo]
// Checks each site's page, SPA fallback, cache and security headers, that the build talks to /api on its own
// site, the API health (right service, demo mode off), and that a request without a token is refused.
const [borrowerUrl, adminUrl] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ALLOW_DEMO = process.argv.includes('--allow-demo');
if (!borrowerUrl || !adminUrl) {
  console.error('usage: node deploy/smoke.js <borrower site URL> <admin site URL> [--allow-demo]');
  process.exit(2);
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function get(url) {
  const res = await fetch(url, { redirect: 'manual' });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

async function site(name, base, otherBase) {
  base = base.replace(/\/$/, '');
  console.log(`\n${name}: ${base}`);

  const home = await get(`${base}/`);
  check('page loads', home.status === 200 && home.text.includes('<div id="root">'), `HTTP ${home.status}`);
  check('page is revalidated on every visit', /no-cache/.test(home.headers.get('cache-control') || ''), home.headers.get('cache-control'));
  check('nosniff header', home.headers.get('x-content-type-options') === 'nosniff');
  check('no-referrer header', home.headers.get('referrer-policy') === 'no-referrer');
  check('frame protection header', (home.headers.get('x-frame-options') || '').toUpperCase() === 'DENY');

  const deep = await get(`${base}/some/deep/link`);
  check('deep links serve the app', deep.status === 200 && deep.text.includes('<div id="root">'), `HTTP ${deep.status}`);

  const script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(home.text)?.[1];
  check('page references a built script', !!script);
  if (script) {
    const js = await get(`${base}${script}`);
    check('built script loads', js.status === 200, `HTTP ${js.status}`);
    check('built script cached for a year', /max-age=31536000/.test(js.headers.get('cache-control') || ''), js.headers.get('cache-control'));
    check('build has no localhost API address (VITE_API_URL=/api)', !/localhost:5[01]00/.test(js.text));
    const other = new URL(otherBase).origin;
    check(`build links to the other site (${other})`, js.text.includes(other));
  }

  const health = await get(`${base}/api/health`);
  let body = {};
  try { body = JSON.parse(health.text); } catch { /* checked below */ }
  check('API health', health.status === 200 && body.success === true, `HTTP ${health.status}`);
  check(`API is the ${name} API`, body.service === name, `service=${body.service}`);
  if (!ALLOW_DEMO) check('demo mode is off', body.demoMode === false, `demoMode=${body.demoMode}`);

  // Without a token: 401 (in demo mode the borrower API would answer as the demo user instead).
  const me = await get(`${base}/api/users/me`);
  if (!ALLOW_DEMO || name === 'admin') check('request without a token is refused', me.status === 401, `HTTP ${me.status}`);
}

(async () => {
  try {
    await site('borrower', borrowerUrl, adminUrl);
    await site('admin', adminUrl, borrowerUrl);
  } catch (err) {
    check('sites reachable', false, err.cause?.message || err.message);
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
