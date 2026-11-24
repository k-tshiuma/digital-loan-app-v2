/**
 * "Push to partner": approved loans sent to the funding partner, against the partner-bank sandbox.
 *
 * Starts the sandbox (sandbox/partner-bank, mutual TLS + OAuth2, certificates in a temporary folder) on port
 * 5113, the borrower API on 5111 and the admin API on 5112 (same database), and drives real applications
 * from registration to final approval. Checks:
 *   - the sandbox itself: no client certificate, wrong client secret
 *   - who may push (credit reviewer / system admin; not customer service), and only approved, unrepaid loans
 *   - temporary partner errors are retried; a permanent one is not; a failed push can be pushed again, with the
 *     same idempotency key after a temporary error and a new one after a permanent error
 *   - two pushes at the same moment send once; a sent loan can't be sent again
 *   - what reaches the partner (all documents, real bank account) and what we keep (no personal data)
 *   - status "Forwarded to Funding Entity", audit entries and notifications; the partner's decision through the
 *     poller and through "Check status", reported once
 *   - an application that accepted the old terms: push refused until the applicant accepts version 2.0 (once,
 *     even when sent twice), and staff can send a reminder
 *
 * Needs the staff seed (npm run seed:staff) and openssl (see sandbox/partner-bank/certs.js).
 * Run: node tests/integration/test_funding_handoff.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const BORROWER_PORT = 5111;
const ADMIN_PORT = 5112;
const SANDBOX_PORT = 5113;
const CERT_DIR = path.join(os.tmpdir(), 'quickloan-test-partner-certs');
const children = [];

const { ensureCerts } = require('../../sandbox/partner-bank/certs');
const { createSandbox } = require('../../sandbox/partner-bank/server');
const certs = ensureCerts({ dir: CERT_DIR });

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function request(port, method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const borrower = (...a) => request(BORROWER_PORT, ...a);
const admin = (...a) => request(ADMIN_PORT, ...a);

/** A call to the sandbox, with our client certificate unless withCert is false. */
function sandbox(method, urlPath, { body = null, withCert = true, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request({
      hostname: 'localhost', port: SANDBOX_PORT, path: urlPath, method,
      ca: fs.readFileSync(certs.bankCa),
      ...(withCert ? { cert: fs.readFileSync(certs.clientCert), key: fs.readFileSync(certs.clientKey) } : {}),
      headers: { ...(payload && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; } resolve({ status: res.statusCode, body: parsed }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function upload(filename, token) {
  return new Promise((resolve, reject) => {
    const boundary = `----b${Math.random().toString(36).slice(2)}`;
    const content = Buffer.from(`%PDF-1.4 ${filename} ${Math.random()}`);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const req = http.request({
      hostname: '127.0.0.1', port: BORROWER_PORT, path: '/api/upload', method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length, Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { const b = JSON.parse(data); assert.strictEqual(res.statusCode, 200, data); resolve(b.file); });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await sleep(150);
  }
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------
async function startApis() {
  const entry = (app) => path.resolve(__dirname, `../../${app}/backend/server.js`);
  const env = {
    ...process.env, NODE_ENV: '', DEMO_MODE: 'true',
    FUNDING_PARTNER_URL: `https://localhost:${SANDBOX_PORT}`,
    FUNDING_PARTNER_CODE: 'sandbox_bank', FUNDING_PARTNER_NAME: 'Partner Bank (sandbox)',
    FUNDING_PARTNER_CLIENT_ID: 'quickloan-sandbox', FUNDING_PARTNER_CLIENT_SECRET: 'test-secret',
    FUNDING_PARTNER_CERT: certs.clientCert, FUNDING_PARTNER_KEY: certs.clientKey, FUNDING_PARTNER_CA: certs.bankCa,
    FUNDING_RETRY_BASE_MS: '50', FUNDING_POLL_MS: '300', FUNDING_MAX_ATTEMPTS: '3',
  };
  children.push(spawn(process.execPath, ['-e', `require(${JSON.stringify(entry('borrower-app'))}).listen(${BORROWER_PORT})`], { env, stdio: ['ignore', 'ignore', 'inherit'] }));
  // The admin API runs as its own main module, as in production, so its funding status poller starts too.
  children.push(spawn(process.execPath, [entry('admin-app')], { env: { ...env, DB_INIT: 'false', ADMIN_PORT: String(ADMIN_PORT) }, stdio: ['ignore', 'ignore', 'inherit'] }));
  for (const port of [BORROWER_PORT, ADMIN_PORT]) {
    await waitFor(() => request(port, 'GET', '/api/health').then((r) => r.status === 200, () => false), 30000, `API on ${port}`);
  }
}

// ---------------------------------------------------------------------------
// An application from registration to the final decision
// ---------------------------------------------------------------------------
async function approvedLoan(staff, label, { approve = true, bankCode = '12' } = {}) {
  const phone = `054${Math.floor(1000000 + Math.random() * 9000000)}`;
  const otp = await borrower('POST', '/api/users/request-otp', { phoneNumber: phone });
  const reg = await borrower('POST', '/api/flow/register', {
    fullName: `Funding ${label}`, email: `funding_${label}_${Date.now()}@example.com`, password: 'StrongPassword123!', phoneNumber: phone,
    code: otp.body.demoCode || '123456', language: 'en', registration: { disclaimerAccepted: true, locationGranted: true },
  });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.body));
  const token = reg.body.token;
  const appId = reg.body.application.id;
  const [passport, visa, payslip] = [await upload('passport.pdf', token), await upload('visa.pdf', token), await upload('payslip.pdf', token)];
  const s1 = await borrower('POST', '/api/flow/application/steps/1/submit', {
    data: {
      personal: {
        fullName: `Funding ${label}`, dateOfBirth: '1990-03-02', address: 'Herzl St 1, Tel Aviv', passportNumber: `PX${Date.now() % 10000000}`,
        countryOfOrigin: 'Thailand', visaType: 'work', visaStartDate: '2025-01-01', visaExpiryDate: '2030-12-31', monthlySalaryNis: 9000, salaryCurrency: 'ILS',
      },
      documents: { passport, visa, payslip },
      employment: { employerName: 'Dana Levi', companyName: 'Levi Farms' },
      loan: { requestedAmountNis: 5000 },
    },
  }, token);
  assert.strictEqual(s1.status, 200, JSON.stringify(s1.body));
  assert.strictEqual((await admin('POST', `/api/flow/applications/${appId}/steps/1/decision`, { decision: 'approve' }, staff.reviewer)).status, 200);
  const sponsorDoc = await upload('sponsor.pdf', token);
  const s2 = await borrower('POST', '/api/flow/application/steps/2/submit', {
    data: { loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 }, sponsors: [{ id: 'sp_1', fullName: 'Sponsor One', idOrPassportNumber: 'AB1234567', document: sponsorDoc }] },
  }, token);
  assert.strictEqual(s2.status, 200, JSON.stringify(s2.body));
  assert.strictEqual((await admin('POST', `/api/flow/applications/${appId}/steps/2/decision`, { decision: 'approve' }, staff.reviewer)).status, 200);
  const bankDocument = await upload('bank.pdf', token);
  const terms = (await borrower('GET', '/api/flow/terms/current', null, token)).body.terms;
  const s3 = await borrower('POST', '/api/flow/application/steps/3/submit', {
    data: {
      bank: { bankName: 'Bank Hapoalim', bankCode, branchNumber: '612', accountNumber: '33445566', accountHolderName: `Funding ${label}` },
      bankDocument,
      terms: { generalVersion: terms.general.version, serviceFeeVersion: terms.service_fee.version, generalAccepted: true, serviceFeeAccepted: true },
      signature: { signatureMethod: 'typed_name', signatureValue: `Funding ${label}` },
    },
  }, token);
  assert.strictEqual(s3.status, 200, JSON.stringify(s3.body));
  if (approve) {
    const fin = await admin('POST', `/api/flow/applications/${appId}/final-decision`, { status: 'Approved' }, staff.reviewer);
    assert.strictEqual(fin.status, 200, JSON.stringify(fin.body));
  }
  return { appId, token, passportNumber: s1.body.application.steps[1].data.personal.passportNumber };
}

// ---------------------------------------------------------------------------
async function run() {
  console.log('🧪 FUNDING PARTNER HAND-OFF ("Push to partner")\n');
  const { server: sandboxServer } = createSandbox({ certs, store: ':memory:', reviewMs: 10 * 60 * 1000, clientSecret: 'test-secret', log: () => {} });
  await new Promise((r) => sandboxServer.listen(SANDBOX_PORT, '127.0.0.1', r));
  await startApis();
  const { dbGet, dbAll, dbRun } = require('@quickloan/backend-core/services/dbHelpers');

  try {
    // --- the sandbox's own checks --------------------------------------------
    const noCert = await sandbox('GET', '/health', { withCert: false });
    assert.strictEqual(noCert.status, 401, 'The sandbox refuses a client without a certificate');
    assert.strictEqual(noCert.body.error.code, 'CLIENT_CERTIFICATE_REQUIRED');
    const badSecret = await sandbox('POST', '/oauth/token', {
      body: 'grant_type=client_credentials', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from('quickloan-sandbox:wrong').toString('base64')}` },
    });
    assert.strictEqual(badSecret.status, 401, 'Wrong client secret refused');
    const noToken = await sandbox('POST', '/v1/loan-applications', { body: {} });
    assert.strictEqual(noToken.status, 401, 'The loan API needs a Bearer token');
    console.log('  ✓ Sandbox: mutual TLS required, client credentials checked, Bearer token required');

    // --- staff -----------------------------------------------------------------
    const login = async (email, password) => {
      const r = await admin('POST', '/api/auth/staff-login', { email, password });
      assert.strictEqual(r.status, 200, `staff login ${email}: ${JSON.stringify(r.body)} (run npm run seed:staff)`);
      return r.body.token;
    };
    const staff = {
      reviewer: await login('reviewer@quickloan.co.il', 'Reviewer123456!'),
      admin: await login('admin@quickloan.co.il', 'Admin123456!'),
      service: await login('service@quickloan.co.il', 'Service123456!'),
    };

    // --- loan 1: a new application (accepted terms 2.0 in Step 3) ---------------
    const pending = await approvedLoan(staff, 'pending', { approve: false });
    const notApproved = await admin('POST', `/api/flow/applications/${pending.appId}/funding/push`, {}, staff.reviewer);
    assert.strictEqual(notApproved.status, 409);
    assert.strictEqual(notApproved.body.code, 'NOT_APPROVED');
    assert.strictEqual((await admin('POST', '/api/flow/applications/app_does_not_exist/funding/push', {}, staff.reviewer)).status, 404);
    console.log('  ✓ Only an approved loan can be pushed (409 NOT_APPROVED, 404 for an unknown one)');

    const loan1 = await approvedLoan(staff, 'one');
    const ov = await admin('GET', `/api/flow/applications/${loan1.appId}/funding`, null, staff.reviewer);
    assert.strictEqual(ov.status, 200, JSON.stringify(ov.body));
    assert.strictEqual(ov.body.partner.configured, true, `partner configured: ${ov.body.partner.problem}`);
    assert.strictEqual(ov.body.partner.name, 'Partner Bank (sandbox)');
    assert.strictEqual(ov.body.consent.given, true, 'Terms 2.0 accepted in Step 3 cover the transfer');
    assert.strictEqual(ov.body.consent.version, '2.0');
    assert.strictEqual(ov.body.permissions.push, true);
    assert(!JSON.stringify(ov.body).includes('test-secret'), 'The overview never shows the client secret');
    const ovService = await admin('GET', `/api/flow/applications/${loan1.appId}/funding`, null, staff.service);
    assert.strictEqual(ovService.status, 200);
    assert.strictEqual(ovService.body.permissions.push, false, 'Customer service sees the panel but may not push');
    assert.strictEqual((await admin('POST', `/api/flow/applications/${loan1.appId}/funding/push`, {}, staff.service)).status, 403);
    console.log('  ✓ Overview: partner, consent 2.0 and permissions; customer service may not push (403)');

    // Two temporary errors, then the partner accepts: three attempts, one push.
    await sandbox('POST', '/sandbox/faults', { body: { next: [{ status: 503 }, { status: 503 }] } });
    const push1 = await admin('POST', `/api/flow/applications/${loan1.appId}/funding/push`, {}, staff.reviewer);
    assert.strictEqual(push1.status, 200, JSON.stringify(push1.body));
    const h1 = push1.body.handoff;
    assert.strictEqual(h1.status, 'SENT');
    assert.strictEqual(h1.attemptCount, 3, 'Two 503 answers were retried');
    assert(/^SBX-LN-\d{6}$/.test(h1.externalReference), h1.externalReference);
    console.log(`  ✓ Temporary partner errors retried: sent after ${h1.attemptCount} attempts as ${h1.externalReference}`);

    const again = await admin('POST', `/api/flow/applications/${loan1.appId}/funding/push`, {}, staff.admin);
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.code, 'ALREADY_SENT');
    console.log('  ✓ A sent loan cannot be sent again (409 ALREADY_SENT)');

    // What the partner got: every document, the real bank account, the consent
    const atBank = (await sandbox('GET', '/sandbox/applications')).body.applications.find((x) => x.reference === h1.externalReference);
    assert(atBank, 'The sandbox has the application');
    assert.strictEqual(atBank.documents, 5, 'passport, visa, payslip, sponsor copy and bank document');
    const detail = await admin('GET', `/api/flow/applications/${loan1.appId}`, null, staff.reviewer);
    assert.strictEqual(detail.body.application.status, 'Forwarded to Funding Entity');
    assert.strictEqual(detail.body.application.flowStatus, 'LOAN_APPROVED');
    assert(detail.body.audit.some((r) => r.action === 'FUNDING_SENT' && r.metadata.reference === h1.externalReference && r.actorRole === 'credit_reviewer'));
    const row1 = await dbGet('SELECT * FROM funding_handoffs WHERE id = ?', [h1.id]);
    const stored = JSON.stringify(row1);
    for (const secret of [loan1.passportNumber, '33445566', 'Funding one', 'contentBase64']) {
      assert(!stored.includes(secret), `funding_handoffs must not store "${secret}"`);
    }
    assert(/^[0-9a-f]{64}$/.test(row1.payloadSha256));
    assert.strictEqual(JSON.parse(row1.requestSummary).documents.length, 5);
    await waitFor(async () => (await dbGet("SELECT id FROM notification_deliveries WHERE applicationId = ? AND event = 'FUNDING_SENT'", [loan1.appId])), 5000, 'FUNDING_SENT notification');
    console.log('  ✓ Status "Forwarded to Funding Entity", audited, applicant told; only a hash and a summary are kept');

    // The partner approves; the poller picks it up and reports it once
    await sandbox('POST', `/sandbox/applications/${h1.externalReference}/decision`, { body: { decision: 'APPROVED' } });
    const approved = await waitFor(async () => {
      const r = await admin('GET', `/api/flow/applications/${loan1.appId}/funding`, null, staff.reviewer);
      return r.body.handoffs[0].status === 'APPROVED' ? r.body.handoffs[0] : null;
    }, 8000, 'the poller to see the approval');
    assert(approved.completedAt && approved.responseSummary.fundingReference);
    const manual = await admin('POST', `/api/flow/applications/${loan1.appId}/funding/refresh`, {}, staff.reviewer);
    assert.strictEqual(manual.body.code, 'NOTHING_TO_CHECK', 'A decided hand-off is not checked again');
    const approvedAudits = await dbAll("SELECT id FROM audit_log WHERE applicationId = ? AND action = 'FUNDING_APPROVED'", [loan1.appId]);
    assert.strictEqual(approvedAudits.length, 1, 'The decision is audited once');
    await waitFor(async () => (await dbGet("SELECT id FROM notification_deliveries WHERE applicationId = ? AND event = 'FUNDING_APPROVED'", [loan1.appId])), 5000, 'FUNDING_APPROVED notification');
    console.log('  ✓ The partner\'s approval reached us through the poller, audited and told to the applicant once');

    const repaid = await admin('POST', `/api/flow/applications/${loan1.appId}/loan-repaid`, {}, staff.reviewer);
    assert.strictEqual(repaid.status, 200);
    assert.strictEqual((await admin('POST', `/api/flow/applications/${loan1.appId}/funding/push`, {}, staff.reviewer)).body.code, 'LOAN_REPAID');
    console.log('  ✓ A repaid loan cannot be pushed (LOAN_REPAID)');

    // --- loan 2: accepted the old terms (1.0) -------------------------------------
    const loan2 = await approvedLoan(staff, 'two');
    await dbRun("UPDATE terms_acceptances SET version = '1.0' WHERE applicationId = ? AND termsType = 'general'", [loan2.appId]);
    const ov2 = await admin('GET', `/api/flow/applications/${loan2.appId}/funding`, null, staff.reviewer);
    assert.strictEqual(ov2.body.consent.given, false);
    assert.strictEqual(ov2.body.permissions.push, false);
    assert.strictEqual(ov2.body.permissions.requestConsent, true);
    const noConsent = await admin('POST', `/api/flow/applications/${loan2.appId}/funding/push`, {}, staff.reviewer);
    assert.strictEqual(noConsent.status, 409);
    assert.strictEqual(noConsent.body.code, 'PARTNER_CONSENT_REQUIRED');
    const remind = await admin('POST', `/api/flow/applications/${loan2.appId}/funding/consent-request`, {}, staff.reviewer);
    assert.strictEqual(remind.status, 200, JSON.stringify(remind.body));
    assert(await dbGet("SELECT id FROM notification_deliveries WHERE applicationId = ? AND event = 'PARTNER_CONSENT_REQUESTED' AND channel = 'sms'", [loan2.appId]));
    console.log('  ✓ Old terms: push refused (PARTNER_CONSENT_REQUIRED), staff can remind the applicant');

    const view2 = await borrower('GET', '/api/flow/application', null, loan2.token);
    assert.strictEqual(view2.body.application.partnerConsent.required, true);
    assert.strictEqual(view2.body.application.partnerConsent.terms.version, '2.0');
    assert(/funding partner/.test(view2.body.application.partnerConsent.terms.textEn));
    assert(view2.body.application.partnerConsent.terms.textHe.length > 100);
    const wrongVersion = await borrower('POST', '/api/flow/application/partner-consent', { accepted: true, version: '1.0' }, loan2.token);
    assert.strictEqual(wrongVersion.body.code, 'TERMS_VERSION_CHANGED');
    const notTicked = await borrower('POST', '/api/flow/application/partner-consent', { accepted: false, version: '2.0' }, loan2.token);
    assert.strictEqual(notTicked.status, 422);
    const [c1, c2] = await Promise.all([1, 2].map(() => borrower('POST', '/api/flow/application/partner-consent', { accepted: true, version: '2.0', language: 'he' }, loan2.token)));
    assert.strictEqual(c1.status, 200, JSON.stringify(c1.body));
    assert.strictEqual(c2.status, 200, JSON.stringify(c2.body));
    assert.strictEqual(c1.body.application.partnerConsent, null, 'Nothing more to accept');
    const partnerRows = await dbAll("SELECT * FROM terms_acceptances WHERE applicationId = ? AND version = '2.0'", [loan2.appId]);
    assert.strictEqual(partnerRows.length, 1, 'Accepting twice at once stores one acceptance');
    assert.strictEqual(partnerRows[0].language, 'he');
    assert.strictEqual((await dbAll("SELECT id FROM audit_log WHERE applicationId = ? AND action = 'TERMS_ACCEPTED'", [loan2.appId])).length, 2, 'Step 3 + the partner consent');
    console.log('  ✓ The applicant accepts terms 2.0 in the app (once, even when sent twice)');

    // A permanent error (422) is not retried; pushing again uses a new idempotency key
    await sandbox('POST', '/sandbox/faults', { body: { next: [{ status: 422 }] } });
    const bad = await admin('POST', `/api/flow/applications/${loan2.appId}/funding/push`, {}, staff.admin);
    assert.strictEqual(bad.status, 502);
    assert.strictEqual(bad.body.code, 'PARTNER_VALIDATION');
    assert.strictEqual(bad.body.handoff.status, 'FAILED');
    assert.strictEqual(bad.body.handoff.attemptCount, 1, 'A permanent error is not retried');
    const keyBefore = (await dbGet('SELECT idempotencyKey FROM funding_handoffs WHERE id = ?', [bad.body.handoff.id])).idempotencyKey;
    const ok2 = await admin('POST', `/api/flow/applications/${loan2.appId}/funding/push`, {}, staff.admin);
    assert.strictEqual(ok2.status, 200, JSON.stringify(ok2.body));
    assert.strictEqual(ok2.body.handoff.id, bad.body.handoff.id, 'The failed hand-off is reused');
    const keyAfter = (await dbGet('SELECT idempotencyKey FROM funding_handoffs WHERE id = ?', [ok2.body.handoff.id])).idempotencyKey;
    assert.notStrictEqual(keyAfter, keyBefore, 'New idempotency key after a permanent error');
    assert((await dbAll("SELECT action FROM audit_log WHERE applicationId = ? AND action = 'FUNDING_PUSH_FAILED'", [loan2.appId])).length === 1);
    console.log('  ✓ Permanent error: one attempt, FAILED, pushed again with a new idempotency key');
    // Settle it, so no hand-off is left waiting for this test's sandbox (the real admin API would keep asking).
    await sandbox('POST', `/sandbox/applications/${ok2.body.handoff.externalReference}/decision`, { body: { decision: 'APPROVED' } });
    await admin('POST', `/api/flow/applications/${loan2.appId}/funding/refresh`, {}, staff.admin);

    // --- loan 3: temporary errors until the attempts run out, then two pushes at once --------
    // No bank code, only the bank's name (older applications, API clients): the package fills in the code.
    const loan3 = await approvedLoan(staff, 'three', { bankCode: '' });
    await sandbox('POST', '/sandbox/faults', { body: { next: [{ status: 503 }, { status: 502 }, { status: 500 }] } });
    const down = await admin('POST', `/api/flow/applications/${loan3.appId}/funding/push`, {}, staff.reviewer);
    assert.strictEqual(down.status, 502);
    assert.strictEqual(down.body.code, 'PARTNER_ERROR');
    assert.strictEqual(down.body.handoff.attemptCount, 3);
    const key3 = (await dbGet('SELECT idempotencyKey FROM funding_handoffs WHERE id = ?', [down.body.handoff.id])).idempotencyKey;
    await sandbox('POST', '/sandbox/faults', { body: { next: [{ delayMs: 600 }] } });
    const both = await Promise.all([staff.reviewer, staff.admin].map((t) => admin('POST', `/api/flow/applications/${loan3.appId}/funding/push`, {}, t)));
    const statuses = both.map((r) => r.status).sort();
    assert.deepStrictEqual(statuses, [200, 409], `two pushes at once: ${JSON.stringify(both.map((r) => r.body))}`);
    assert(['HANDOFF_IN_PROGRESS', 'ALREADY_SENT'].includes(both.find((r) => r.status === 409).body.code));
    const sent3 = both.find((r) => r.status === 200).body.handoff;
    assert.strictEqual((await dbGet('SELECT idempotencyKey FROM funding_handoffs WHERE id = ?', [sent3.id])).idempotencyKey, key3, 'Same key after a temporary error');
    const atBank3 = (await sandbox('GET', '/sandbox/applications')).body.applications.filter((x) => x.externalId === loan3.appId);
    assert.strictEqual(atBank3.length, 1, 'The partner has the loan once');
    console.log('  ✓ Temporary errors: 3 attempts then FAILED; pushed again with the same key; two pushes at once send it once');
    console.log('  ✓ A loan with only the bank name (no code) is sent with the code filled in (the partner requires it)');

    // The partner declines; staff press "Check status"
    await sandbox('POST', `/sandbox/applications/${sent3.externalReference}/decision`, { body: { decision: 'REJECTED', reason: 'Sponsor could not be verified.' } });
    const checked = await admin('POST', `/api/flow/applications/${loan3.appId}/funding/refresh`, {}, staff.reviewer);
    assert.strictEqual(checked.status, 200, JSON.stringify(checked.body));
    // The poller may have been first; either way the result is the same
    const finalRow = await waitFor(async () => {
      const r = await dbGet('SELECT * FROM funding_handoffs WHERE id = ?', [sent3.id]);
      return r.status === 'REJECTED' ? r : null;
    }, 5000, 'the rejection');
    assert.strictEqual(finalRow.decisionReason, 'Sponsor could not be verified.');
    assert.strictEqual((await dbAll("SELECT id FROM audit_log WHERE applicationId = ? AND action = 'FUNDING_REJECTED'", [loan3.appId])).length, 1);
    await waitFor(async () => (await dbGet("SELECT id FROM notification_deliveries WHERE applicationId = ? AND event = 'FUNDING_REJECTED'", [loan3.appId])), 5000, 'FUNDING_REJECTED notification');
    const again3 = await admin('POST', `/api/flow/applications/${loan3.appId}/funding/push`, {}, staff.reviewer);
    assert.strictEqual(again3.body.code, 'ALREADY_SENT', 'A declined loan is not sent to the same partner again');
    console.log('  ✓ The partner\'s rejection through "Check status": reason kept, audited and told once\n');

    console.log('✅ ALL FUNDING HAND-OFF TESTS PASSED');
  } finally {
    children.forEach((c) => c.kill());
    sandboxServer.close();
  }
}

run().then(() => process.exit(0), (err) => {
  console.error('\n❌ TEST FAILED:', err && err.stack ? err.stack : err);
  children.forEach((c) => c.kill());
  process.exit(1);
});
