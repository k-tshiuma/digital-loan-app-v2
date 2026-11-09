// Localization tests (hebrew-localization-plan.md). Run: node test_i18n.js
const http = require('http');
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const app = require('./lib/splitApis');

const TEST_PORT = 5005;

function makeRequest(method, urlPath, body, headers = {}, port = TEST_PORT) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING LOCALIZATION (EN/HE) TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${e.message}`);
      failed++;
    }
  }

  const phone = `+97250${Math.floor(1000000 + Math.random() * 9000000)}`;
  let token;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  console.log('--- T1.5 PUT /api/users/me/language ---');
  await test('borrower logs in with OTP', async () => {
    await makeRequest('POST', '/api/users/request-otp', { phoneNumber: phone });
    const res = await makeRequest('POST', '/api/users/verify-otp', { phoneNumber: phone, code: '123456', preferredLanguage: 'en' });
    assert.strictEqual(res.status, 200);
    token = res.data.token;
    assert.ok(token, 'expected a token');
  });

  await test('setting Hebrew returns 200 and the updated user', async () => {
    const res = await makeRequest('PUT', '/api/users/me/language', { language: 'he' }, auth());
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.user.preferredLanguage, 'he');
  });

  await test('GET /api/users/me now reports Hebrew', async () => {
    const res = await makeRequest('GET', '/api/users/me', null, auth());
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.user.preferredLanguage, 'he');
  });

  await test('switching back to English works', async () => {
    const res = await makeRequest('PUT', '/api/users/me/language', { language: 'en' }, auth());
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.user.preferredLanguage, 'en');
  });

  for (const bad of ['xx', 'th', 'zh', 'tl', '', null]) {
    await test(`rejects language ${JSON.stringify(bad)} with 400`, async () => {
      const res = await makeRequest('PUT', '/api/users/me/language', { language: bad }, auth());
      assert.strictEqual(res.status, 400);
    });
  }

  await test('missing body returns 400', async () => {
    const res = await makeRequest('PUT', '/api/users/me/language', null, auth());
    assert.strictEqual(res.status, 400);
  });

  await test('staff token is refused by the borrower API (401)', async () => {
    const staff = await makeRequest('POST', '/api/auth/staff-token', { role: 'credit_reviewer' });
    assert.strictEqual(staff.status, 200, 'staff-token endpoint should work in demo mode');
    // Sent to the borrower API on purpose (the router would send a staff token to the admin API).
    const res = await makeRequest('PUT', '/api/users/me/language', { language: 'he' }, { Authorization: `Bearer ${staff.data.token}`, 'X-Test-Target': 'borrower' });
    assert.strictEqual(res.status, 401);
  });

  await test('without a token in production-style mode (DEMO_MODE=false) returns 401', async () => {
    // DEMO_MODE is read when the API loads, so check it in a separate process.
    const script = `
      const http = require('http');
      const app = require(${JSON.stringify(path.join(__dirname, '../../borrower-app/backend/server.js'))});
      const s = app.listen(5006, () => {
        const req = http.request({ hostname: '127.0.0.1', port: 5006, path: '/api/users/me/language', method: 'PUT',
          headers: { 'Content-Type': 'application/json' } }, (res) => { console.log('STATUS=' + res.statusCode); s.close(); process.exit(0); });
        req.write(JSON.stringify({ language: 'he' })); req.end();
      });`;
    const out = spawnSync(process.execPath, ['-e', script], {
      cwd: __dirname,
      env: { ...process.env, DEMO_MODE: 'false' },
      encoding: 'utf8',
      timeout: 20000,
    });
    const match = /STATUS=(\d+)/.exec(out.stdout || '');
    assert.ok(match, `child process gave no status. stderr: ${out.stderr}`);
    assert.strictEqual(Number(match[1]), 401);
  });

  // -------------------------------------------------------------------------
  console.log('\n--- Phase 6: backend messages in the user\'s language ---');
  const { STATUS_MESSAGES, STATUS_NAMES, MESSAGES, msg, resolveMessageLanguage } = require('@quickloan/backend-core/services/messages');
  const { smsSegments } = require('@quickloan/backend-core/services/smsService');
  const { wrapEmailHtml } = require('@quickloan/backend-core/services/emailService');
  const HEBREW = /[֐-׿]/;

  await test('T6.4 every status and message key in English also exists in Hebrew', async () => {
    for (const table of [STATUS_MESSAGES, STATUS_NAMES, MESSAGES]) {
      const en = Object.keys(table.en).sort();
      assert.deepStrictEqual(Object.keys(table.he).sort(), en);
      for (const k of en) {
        // The title is the brand plus a Hebrew status name filled in at send time.
        if (k !== 'notif.statusTitle') assert.ok(HEBREW.test(table.he[k]), `he "${k}" has no Hebrew letters`);
        const params = (s) => (s.match(/\{\w+\}/g) || []).sort();
        assert.deepStrictEqual(params(table.he[k]), params(table.en[k]), `placeholders differ for "${k}"`);
      }
    }
  });

  await test('Hebrew status bodies fit in one UCS-2 SMS segment (70 characters)', async () => {
    for (const [status, text] of Object.entries(STATUS_MESSAGES.he)) {
      const info = smsSegments(text);
      assert.strictEqual(info.encoding, 'UCS-2');
      assert.strictEqual(info.segments, 1, `"${status}" is ${info.length} characters`);
    }
  });

  await test('language resolution: he and en kept, on-hold and unknown fall back to English', async () => {
    assert.strictEqual(resolveMessageLanguage('he', 'en'), 'he');
    assert.strictEqual(resolveMessageLanguage(null, 'he'), 'he');
    assert.strictEqual(resolveMessageLanguage('th', 'he'), 'en');
    assert.strictEqual(resolveMessageLanguage('xx'), 'en');
    assert.strictEqual(resolveMessageLanguage(), 'en');
    assert.strictEqual(msg('th', 'sms.otp', { code: '111111' }), 'Your QuickLoan verification code is 111111. It expires in 5 minutes.');
    assert.ok(msg('he', 'sms.otp', { code: '111111' }).includes('111111'));
  });

  await test('SMS segment counting: GSM-7 and UCS-2', async () => {
    assert.deepStrictEqual(smsSegments('a'.repeat(160)), { encoding: 'GSM-7', length: 160, segments: 1 });
    assert.strictEqual(smsSegments('a'.repeat(161)).segments, 2);
    assert.strictEqual(smsSegments('€'.repeat(80)).length, 160); // extension characters count twice
    assert.deepStrictEqual(smsSegments('ש'.repeat(70)), { encoding: 'UCS-2', length: 70, segments: 1 });
    assert.strictEqual(smsSegments('ש'.repeat(71)).segments, 2);
  });

  await test('Hebrew emails are right-to-left, English emails left-to-right', async () => {
    const he = wrapEmailHtml('<p>שלום</p>', 'he');
    assert.ok(/<html lang="he" dir="rtl">/.test(he) && /<body dir="rtl"/.test(he));
    assert.ok(/<html lang="en" dir="ltr">/.test(wrapEmailHtml('<p>Hi</p>')));
  });

  /** Capture console.log output while fn runs (the SMS/email mocks log there). */
  // The borrower API runs in its own process: read what it logged while fn ran.
  async function captureLogs(fn) {
    const mark = server.logMark('borrower');
    await fn();
    return server.logsSince(mark, 'borrower');
  }

  await test('OTP SMS is sent in the language on screen', async () => {
    const p = `+97252${Math.floor(1000000 + Math.random() * 9000000)}`;
    const heLogs = await captureLogs(() => makeRequest('POST', '/api/users/request-otp', { phoneNumber: p, language: 'he' }));
    const heSms = heLogs.find((l) => l.startsWith('[SMS MOCK]'));
    assert.ok(heSms && HEBREW.test(heSms) && heSms.includes('UCS-2'), heSms);
    const enLogs = await captureLogs(() => makeRequest('POST', '/api/users/request-otp', { phoneNumber: p, language: 'en' }));
    const enSms = enLogs.find((l) => l.startsWith('[SMS MOCK]'));
    assert.ok(enSms && enSms.includes('Your QuickLoan verification code') && enSms.includes('GSM-7'), enSms);
  });

  const staff = await makeRequest('POST', '/api/auth/staff-token', { role: 'credit_reviewer' });
  const staffAuth = { Authorization: `Bearer ${staff.data && staff.data.token}` };

  /**
   * Register a borrower with the given language, submit an application filled in `appLanguage`,
   * approve it as staff, and return the newest status notification.
   */
  async function approveFor(userLanguage, appLanguage) {
    const p = `+97253${Math.floor(1000000 + Math.random() * 9000000)}`;
    await makeRequest('POST', '/api/users/request-otp', { phoneNumber: p });
    const login = await makeRequest('POST', '/api/users/verify-otp', { phoneNumber: p, code: '123456', preferredLanguage: userLanguage });
    assert.strictEqual(login.status, 200, JSON.stringify(login.data));
    const userAuth = { Authorization: `Bearer ${login.data.token}` };
    const userId = login.data.user.id;

    const draft = (await makeRequest('GET', `/api/applications/active/${userId}`, null, userAuth)).data.application;
    const submitted = await makeRequest(
      'PUT', `/api/applications/${draft.id}`,
      { ...draft, language: appLanguage, isSubmitted: true, status: 'Received' }, userAuth
    );
    assert.strictEqual(submitted.status, 200, JSON.stringify(submitted.data));

    const approved = await makeRequest(
      'PUT', `/api/applications/${draft.id}`, { ...submitted.data.application, status: 'Approved' }, staffAuth
    );
    assert.strictEqual(approved.status, 200, JSON.stringify(approved.data));

    // Notifications are sent after the response, so poll briefly.
    for (let i = 0; i < 40; i++) {
      const list = await makeRequest('GET', `/api/notifications/${userId}`, null, userAuth);
      const notif = (list.data.notifications || []).find((n) => n.notificationType === 'STATUS_Approved');
      const submission = (list.data.notifications || []).find((n) => n.notificationType === 'SUBMISSION_CONFIRMATION');
      if (notif && submission) return { notif, submission };
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('status notification was not created');
  }

  await test('T6.1 a Hebrew user gets Hebrew notifications, even for an application filled in English', async () => {
    const { notif, submission } = await approveFor('he', 'en');
    assert.strictEqual(notif.language, 'he');
    assert.ok(HEBREW.test(notif.message), notif.message);
    assert.ok(notif.message.includes(STATUS_MESSAGES.he.Approved));
    assert.ok(notif.title.includes(STATUS_NAMES.he.Approved), notif.title);
    assert.strictEqual(submission.language, 'he');
    assert.ok(HEBREW.test(submission.message) && HEBREW.test(submission.title), submission.message);
  });

  await test('T6.2 an English user gets English notifications', async () => {
    const { notif, submission } = await approveFor('en', 'en');
    assert.strictEqual(notif.language, 'en');
    assert.ok(notif.message.includes(STATUS_MESSAGES.en.Approved), notif.message);
    assert.strictEqual(notif.title, 'QuickLoan: Approved');
    assert.ok(submission.message.includes('Your request number is'), submission.message);
  });

  await test('T6.3 a user with an on-hold language (th) falls back to English', async () => {
    const { notif } = await approveFor('th', 'th');
    assert.strictEqual(notif.language, 'en');
    assert.ok(notif.message.includes(STATUS_MESSAGES.en.Approved), notif.message);
  });

  // -------------------------------------------------------------------------
  console.log('\n--- Phase 6b: Hebrew PDF summary ---');
  const { visualOrder, wrapLines, splitRuns, forFontkit, ltr } = require('@quickloan/backend-core/services/pdfRtl');
  const { FIELDS, VALUES } = require('@quickloan/backend-core/services/pdfLabels');
  const { formatMoney, formatDate } = require('@quickloan/backend-core/services/pdfService');

  /** GET a binary response. */
  function getRaw(urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: TEST_PORT, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  }

  /** A borrower with a submitted application in `appLanguage`. Returns ids and auth headers. */
  async function submittedApplication(appLanguage) {
    const p = `+97254${Math.floor(1000000 + Math.random() * 9000000)}`;
    await makeRequest('POST', '/api/users/request-otp', { phoneNumber: p });
    const login = await makeRequest('POST', '/api/users/verify-otp', { phoneNumber: p, code: '123456', preferredLanguage: appLanguage });
    const userAuth = { Authorization: `Bearer ${login.data.token}` };
    const draft = (await makeRequest('GET', `/api/applications/active/${login.data.user.id}`, null, userAuth)).data.application;
    const saved = await makeRequest('PUT', `/api/applications/${draft.id}`, {
      ...draft,
      language: appLanguage,
      isSubmitted: true,
      status: 'Received',
      borrowerDetails: { fullName: 'Somchai Prasert', mobilePhoneNumber: p, countryOfOrigin: 'Thailand' },
      loanRequest: { requestedAmountNis: 12500, repaymentPeriodMonths: 12 },
    }, userAuth);
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.data));
    return { id: draft.id, userAuth };
  }

  const isPdf = (res) => res.status === 200 && res.headers['content-type'] === 'application/pdf' && res.body.slice(0, 4).toString() === '%PDF';
  const pdfLang = (res) => (/\/Lang \(([a-z]{2}-[A-Z]{2})\)/.exec(res.body.toString('latin1')) || [])[1];
  const hasHeebo = (res) => res.body.includes('Heebo');

  const heApp = await submittedApplication('he');
  const enApp = await submittedApplication('en');

  await test('T6b.1 ?lang=he returns a PDF with Heebo embedded and Lang he-IL', async () => {
    const res = await getRaw(`/api/applications/${enApp.id}/pdf?lang=he`, enApp.userAuth);
    assert.ok(isPdf(res), `status ${res.status}, type ${res.headers['content-type']}`);
    assert.ok(hasHeebo(res), 'Heebo font not embedded');
    assert.strictEqual(pdfLang(res), 'he-IL');
    assert.strictEqual(res.headers['content-language'], 'he');
    assert.ok(/filename="[A-Za-z0-9_-]+\.pdf"/.test(res.headers['content-disposition']), res.headers['content-disposition']);
  });

  await test('T6b.2 ?lang=en uses Helvetica only (no Heebo) for an all-Latin application', async () => {
    const res = await getRaw(`/api/applications/${heApp.id}/pdf?lang=en`, heApp.userAuth);
    assert.ok(isPdf(res));
    assert.ok(!hasHeebo(res), 'Heebo should not be embedded');
    assert.strictEqual(pdfLang(res), 'en-US');
  });

  await test('T6b.3 without ?lang the application language decides', async () => {
    const he = await getRaw(`/api/applications/${heApp.id}/pdf`, heApp.userAuth);
    const en = await getRaw(`/api/applications/${enApp.id}/pdf`, enApp.userAuth);
    assert.strictEqual(pdfLang(he), 'he-IL');
    assert.ok(hasHeebo(he));
    assert.strictEqual(pdfLang(en), 'en-US');
  });

  await test('T6b.4 ?lang=xx and on-hold languages fall back to the English PDF', async () => {
    for (const bad of ['xx', 'th']) {
      const res = await getRaw(`/api/applications/${heApp.id}/pdf?lang=${bad}`, heApp.userAuth);
      assert.ok(isPdf(res), `${bad}: status ${res.status}`);
      assert.strictEqual(pdfLang(res), 'en-US', bad);
    }
  });

  await test('T6b.5 bidi: a Latin request number stays one left-to-right run at the visual left', async () => {
    assert.strictEqual(visualOrder('בקשה מספר QL-1234', 'rtl'), 'QL-1234 רפסמ השקב');
    assert.strictEqual(visualOrder('סכום: 12,500 ₪', 'rtl'), '₪ 12,500 :םוכס');
    assert.strictEqual(visualOrder('הערה (חשוב)', 'rtl'), '(בושח) הרעה', 'brackets are mirrored');
    assert.strictEqual(visualOrder(`טל׳: ${ltr('+972501234567')}`, 'rtl'), '+972501234567 :׳לט', 'isolated phone keeps its + in front');
    assert.deepStrictEqual(splitRuns('QL-1234 רפסמ'), ['QL-1234 ', 'רפסמ']);
    assert.strictEqual(forFontkit('םש'), 'שם');
    assert.strictEqual(forFontkit('QL-1234 '), 'QL-1234 ');
  });

  await test('T6b.5 wrapping: every line fits the width and no word is lost', async () => {
    const measure = (s) => s.length * 5; // 5pt per character
    const text = 'נא להעלות תלוש שכר עדכני ואישור העסקה חתום על ידי המעסיק כולל מספר טלפון ליצירת קשר';
    const lines = wrapLines(text, 100, measure);
    assert.ok(lines.length > 1);
    lines.forEach((l) => assert.ok(measure(l) <= 100, `line too wide: ${l}`));
    assert.strictEqual(lines.join(' '), text);
    assert.deepStrictEqual(wrapLines('a'.repeat(50), 100, measure), ['a'.repeat(20), 'a'.repeat(20), 'a'.repeat(10)]);
  });

  await test('T6b.6 every PDF label in English also exists in Hebrew', async () => {
    for (const table of [FIELDS, VALUES]) {
      assert.deepStrictEqual(Object.keys(table.he).sort(), Object.keys(table.en).sort());
      const params = (s) => (s.match(/\{\w+\}/g) || []).sort();
      for (const k of Object.keys(table.en)) {
        assert.deepStrictEqual(params(table.he[k]), params(table.en[k]), `placeholders differ for "${k}"`);
      }
    }
  });

  await test('PDF formatting: amounts and dates per language', async () => {
    assert.strictEqual(formatMoney(12500, 'he'), '12,500 ₪');
    assert.strictEqual(formatMoney(12500, 'en'), 'NIS 12,500');
    assert.strictEqual(formatMoney(1121.5, 'he'), '1,121.50 ₪');
    assert.strictEqual(formatDate('2026-10-21', 'he'), '21.10.2026');
    assert.strictEqual(formatDate('2026-10-21', 'en'), '21/10/2026');
  });

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');
  return failed;
}

const server = app.listen(TEST_PORT, async () => {
  let failed = 1;
  try {
    failed = await runTests();
  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
});
