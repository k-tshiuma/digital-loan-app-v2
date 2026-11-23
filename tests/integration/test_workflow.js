/**
 * Unit & Integration test suite for the 3-Step Approval Workflow:
 * - Sequential workflow enforcement (Steps 1 -> 2 -> 3)
 * - Gating & mandatory Back Office approvals
 * - Immutability of submitted steps
 * - Atomic Step 3 submission & terms acceptance recording
 * - Rejection and Changes Requested handling
 * - Notifications generation (SMS, Email, In-App)
 * - Loan calculation parity verification
 *
 * Runs against the two real APIs as separate processes on the same database: the borrower API (port 5022)
 * and the admin API (port 5023, DB_INIT=false). Staff requests go to the admin API, everything else to the
 * borrower API.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const fixtures = require('@quickloan/backend-core/fixtures/loan-calc-fixtures.json');
const { calculateLoanRepayment } = require('@quickloan/backend-core/services/loanCalculator');

const BORROWER_PORT = 5022;
const ADMIN_PORT = 5023;
const children = [];
const SERVER_ENTRY = {
  'borrower-server': require('path').resolve(__dirname, '../../borrower-app/backend/server.js'),
  'admin-server': require('path').resolve(__dirname, '../../admin-app/backend/server.js'),
};

const tokenType = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).type;
  } catch {
    return null;
  }
};
/** Which API a request goes to: staff sign-in and staff tokens -> admin, the rest -> borrower. */
function portFor(path, token, to) {
  if (to === 'admin') return ADMIN_PORT;
  if (to === 'borrower') return BORROWER_PORT;
  if (/^\/api\/auth\/staff-/.test(path) || (token && tokenType(token) === 'staff')) return ADMIN_PORT;
  return BORROWER_PORT;
}

/** Starts both APIs as child processes and waits until they answer. */
async function startSplitServers() {
  const { spawn } = require('child_process');
  const start = (entry, port, env) => {
    // The borrower API polls for staff changes when it runs on its own (server.js main); started here too, fast.
    const poller = entry === 'borrower-server'
      ? `require(${JSON.stringify(require('path').resolve(__dirname, '../../borrower-app/backend/ssePoller.js'))}).startStatusPoller({ intervalMs: 300 }); `
      : '';
    const child = spawn(process.execPath, ['-e', `${poller}require(${JSON.stringify(SERVER_ENTRY[entry])}).listen(${port})`], {
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: '', DEMO_MODE: 'true', ENABLE_CLASSIC_FLOW: 'true', ...env }, // one check calls the classic draft route
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    children.push(child);
  };
  start('borrower-server', BORROWER_PORT, {});
  start('admin-server', ADMIN_PORT, { DB_INIT: 'false' });
  for (const port of [BORROWER_PORT, ADMIN_PORT]) {
    for (let i = 0; ; i++) {
      const up = await new Promise((resolve) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (up) break;
      if (i > 300) throw new Error(`backend on port ${port} did not start`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

function request(method, path, body = null, token = null, { to } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: portFor(path, token, to),
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Opens the applicant's live status stream on the borrower API. next(event, ms) resolves with the event data or null. */
function openStatusStream(applicationId, token) {
  let buffer = '';
  const events = [];
  const waiters = [];
  let resolveConnected;
  const connected = new Promise((r) => { resolveConnected = r; });
  const req = http.get({ hostname: '127.0.0.1', port: BORROWER_PORT, path: `/api/applications/${applicationId}/events?token=${encodeURIComponent(token)}` }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const event = (/^event: (.*)$/m.exec(block) || [])[1];
        const data = (/^data: (.*)$/m.exec(block) || [])[1];
        if (!event) continue;
        if (event === 'connected') { resolveConnected(); continue; }
        const parsed = data ? JSON.parse(data) : null;
        events.push({ event, data: parsed });
        waiters.splice(0).forEach((w) => w());
      }
    });
  });
  req.on('error', () => resolveConnected());
  const next = (name, ms) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    const check = () => {
      const hit = events.find((e) => e.event === name);
      if (hit) { clearTimeout(timer); resolve(hit.data); } else waiters.push(check);
    };
    check();
  });
  return { connected, next, close: () => req.destroy() };
}

function uploadDummyFile(filename, mimeType, magicBuffer, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const payload = Buffer.concat([Buffer.from(header), magicBuffer, Buffer.from(footer)]);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: BORROWER_PORT,
        path: '/api/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': payload.length,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING 3-STEP APPROVAL WORKFLOW TEST SUITE');
  console.log('====================================================\n');

  // 1. Calculation Parity Verification
  console.log('--- 1. LOAN CALCULATION PARITY ---');
  for (const item of fixtures) {
    const res = calculateLoanRepayment(item.principal, item.period, undefined, item.serviceFeeNis);
    assert.strictEqual(res.baseMonthlyRepaymentNis, item.expectedBaseMonthly, `Base monthly mismatch for ${item.principal} NIS / ${item.period} mos`);
    assert.strictEqual(res.serviceFeeNis, item.expectedFee, `Fee mismatch for ${item.principal} NIS`);
    assert.strictEqual(res.monthlyServiceFeeNis, item.expectedMonthlyFee, `Monthly fee mismatch for ${item.principal} NIS`);
    assert.strictEqual(res.monthlyPaymentNis, item.expectedTotalMonthly, `Total monthly mismatch for ${item.principal} NIS`);
    assert.strictEqual(res.totalRepaymentNis, item.expectedTotalRepayment, `Total repayment mismatch for ${item.principal} NIS`);
    assert.strictEqual(res.totalInterestNis, item.expectedTotalInterest, `Total interest mismatch for ${item.principal} NIS`);
  }
  console.log('  ✓ PASS: Server loan calculator matches all fixture standards accurately\n');

  // Start both APIs for the HTTP tests
  console.log('(borrower API on 5022, admin API on 5023)\n');
  await startSplitServers();

  // The tests change the configured service fee; the real database gets its original row back at the end.
  const { dbGet: cfgGet, dbRun: cfgRun } = require('@quickloan/backend-core/services/dbHelpers');
  const originalFeeRow = await cfgGet("SELECT value, updatedAt FROM app_config WHERE key = 'serviceFeeNis'");

  try {
    // 2. Staff Authentication
    console.log('--- 2. STAFF AUTHENTICATION & LOGIN ---');
    const staffLoginRes = await request('POST', '/api/auth/staff-login', {
      email: 'admin@quickloan.co.il',
      password: 'Admin123456!',
    });
    assert.strictEqual(staffLoginRes.status, 200, 'Staff login failed');
    assert.strictEqual(staffLoginRes.body.staff.role, 'system_admin');
    const adminToken = staffLoginRes.body.token;
    console.log('  ✓ PASS: Back Office administrator successfully logged in\n');

    // Reviewer login
    const reviewerLoginRes = await request('POST', '/api/auth/staff-login', {
      email: 'reviewer@quickloan.co.il',
      password: 'Reviewer123456!',
    });
    assert.strictEqual(reviewerLoginRes.status, 200);
    const reviewerToken = reviewerLoginRes.body.token;
    console.log('  ✓ PASS: Credit Reviewer staff successfully logged in\n');

    // Customer service login
    const csLoginRes = await request('POST', '/api/auth/staff-login', {
      email: 'service@quickloan.co.il',
      password: 'Service123456!',
    });
    assert.strictEqual(csLoginRes.status, 200);
    const csToken = csLoginRes.body.token;
    console.log('  ✓ PASS: Customer Service staff successfully logged in\n');

    // 3. Applicant Registration & Step 1 Gating
    console.log('--- 3. STEP 1 REGISTRATION & SUBMISSION ---');
    const testPhone = '052' + Math.floor(1000000 + Math.random() * 9000000);
    
    // Request OTP
    const otpRes = await request('POST', '/api/users/request-otp', { phoneNumber: testPhone });
    assert.strictEqual(otpRes.status, 200);
    const demoCode = otpRes.body.demoCode || '123456';

    // Location access and the disclaimer are both mandatory before an account is created
    const regBase = { fullName: 'Somchai Prasrt', email: `somchai_${Date.now()}@example.com`, password: 'StrongPassword123!', phoneNumber: testPhone, code: demoCode, language: 'en' };
    const noLocation = await request('POST', '/api/flow/register', { ...regBase, registration: { disclaimerAccepted: true, locationGranted: false } });
    assert.strictEqual(noLocation.status, 400);
    assert.strictEqual(noLocation.body.code, 'LOCATION_REQUIRED');
    const noDisclaimer = await request('POST', '/api/flow/register', { ...regBase, registration: { disclaimerAccepted: false, locationGranted: true } });
    assert.strictEqual(noDisclaimer.status, 400);
    assert.strictEqual(noDisclaimer.body.code, 'DISCLAIMER_REQUIRED');
    console.log('  ✓ PASS: Registration refused without location access or without the disclaimer\n');

    // Register applicant with location + regulatory disclaimer (the name has a typo, corrected in Step 1 below)
    const regRes = await request('POST', '/api/flow/register', {
      fullName: 'Somchai Prasrt',
      email: regBase.email,
      password: 'StrongPassword123!',
      phoneNumber: testPhone,
      code: demoCode,
      language: 'en',
      registration: {
        disclaimerAccepted: true,
        locationGranted: true,
        location: { latitude: 32.08531, longitude: 34.78177, accuracy: 25 },
      },
    });
    assert.strictEqual(regRes.status, 200, `Registration failed: ${JSON.stringify(regRes.body)}`);
    assert(regRes.body.token, 'Registration should return auth token');
    const applicantToken = regRes.body.token;
    const appId = regRes.body.application.id;
    const accountPhone = regRes.body.user.phoneNumber;
    assert.strictEqual(regRes.body.application.needsRegistrationConsent, false);

    assert.strictEqual(regRes.body.application.flowStatus, 'LEAD_REGISTERED');
    assert.strictEqual(regRes.body.application.unlockedStep, 1);
    console.log('  ✓ PASS: Applicant registered with LEAD_REGISTERED status\n');

    // 3b. Google: a new Google account is only created through registration, then adds a verified phone
    console.log('--- 3b. GOOGLE REGISTRATION & ACCOUNT COMPLETION ---');
    const gEmail = `g_${Date.now()}@gmail.com`;
    const gNoReg = await request('POST', '/api/flow/google', { demo: { email: gEmail, name: 'Maria Santos' }, language: 'en' });
    assert.strictEqual(gNoReg.status, 400);
    assert.strictEqual(gNoReg.body.code, 'REGISTRATION_REQUIRED');
    const gNoLoc = await request('POST', '/api/flow/google', { demo: { email: gEmail, name: 'Maria Santos' }, registration: { disclaimerAccepted: true, locationGranted: false } });
    assert.strictEqual(gNoLoc.body.code, 'LOCATION_REQUIRED');
    const gReg = await request('POST', '/api/flow/google', { demo: { email: gEmail, name: 'Maria Santos' }, language: 'en', registration: { disclaimerAccepted: true, locationGranted: true } });
    assert.strictEqual(gReg.status, 200, JSON.stringify(gReg.body));
    const gToken = gReg.body.token;
    assert.strictEqual(gReg.body.application.account.phoneNumber, null);
    const gSignIn = await request('POST', '/api/flow/google', { demo: { email: gEmail, name: 'Maria Santos' } });
    assert.strictEqual(gSignIn.status, 200, 'An existing Google account signs in without registering again');
    const gStep1 = await request('POST', '/api/flow/application/steps/1/submit', { data: { personal: { fullName: 'Maria Santos' } } }, gToken);
    assert.strictEqual(gStep1.status, 422);
    assert.strictEqual(gStep1.body.fieldErrors.phoneNumber, 'account_incomplete');
    const gPhone = '053' + Math.floor(1000000 + Math.random() * 9000000);
    const gOtp = await request('POST', '/api/users/request-otp', { phoneNumber: gPhone });
    const takenPhone = await request('POST', '/api/flow/account/contact', { phoneNumber: testPhone, code: '123456' }, gToken);
    assert.strictEqual(takenPhone.status, 409, 'A phone number of another account cannot be added');
    const gContact = await request('POST', '/api/flow/account/contact', { phoneNumber: gPhone, code: gOtp.body.demoCode || '123456' }, gToken);
    assert.strictEqual(gContact.status, 200, JSON.stringify(gContact.body));
    assert(gContact.body.application.account.phoneNumber, 'Account now has a phone number');
    const gChange = await request('POST', '/api/flow/account/contact', { phoneNumber: '0541112233', code: '123456' }, gContact.body.token);
    assert.strictEqual(gChange.status, 409);
    assert.strictEqual(gChange.body.code, 'CONTACT_LOCKED');
    const gEmailChange = await request('POST', '/api/flow/account/contact', { email: 'other@example.com' }, gContact.body.token);
    assert.strictEqual(gEmailChange.body.code, 'CONTACT_LOCKED');
    const consentNoLoc = await request('POST', '/api/flow/application/registration-consent', { disclaimerAccepted: true, locationGranted: false }, gContact.body.token);
    assert.strictEqual(consentNoLoc.body.code, 'LOCATION_REQUIRED');
    console.log('  ✓ PASS: Google registration needs location + disclaimer; a missing phone is added once with an SMS code and then locked\n');

    // Try accessing Step 2 before Step 1 is submitted/approved -> MUST BE REJECTED 403
    console.log('--- 4. ENFORCE SEQUENTIAL GATING ---');
    const illegalStep2 = await request('POST', '/api/flow/application/steps/2/submit', {
      data: {
        loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 },
        sponsors: [{ id: 's1', fullName: 'Guarantor One', idOrPassportNumber: '123456789' }],
      },
    }, applicantToken);
    assert.strictEqual(illegalStep2.status, 403, 'Applicant should NOT be able to submit Step 2 before Step 1 is approved');
    assert.strictEqual(illegalStep2.body.code, 'STEP_LOCKED');
    console.log('  ✓ PASS: Access to Step 2 strictly locked before Step 1 approval\n');

    // Upload genuine documents (%PDF magic bytes)
    const pdfMagic = Buffer.from('%PDF-1.4 dummy valid content here');
    const passDoc = await uploadDummyFile('passport.pdf', 'application/pdf', pdfMagic, applicantToken);
    const visaDoc = await uploadDummyFile('visa.pdf', 'application/pdf', pdfMagic, applicantToken);
    const payslipDoc = await uploadDummyFile('payslip.pdf', 'application/pdf', pdfMagic, applicantToken);
    assert.strictEqual(passDoc.status, 200);
    assert.strictEqual(visaDoc.status, 200);
    assert.strictEqual(payslipDoc.status, 200);

    const step1Rest = {
      documents: { passport: passDoc.body.file, visa: visaDoc.body.file, payslip: payslipDoc.body.file },
      employment: { employerName: 'Yossi Cohen', companyName: 'Cohen Citrus Groves Ltd' },
      loan: { requestedAmountNis: 5000 },
    };
    // A name that differs from the account is a legal-name correction and must be confirmed
    const unconfirmedName = await request('POST', '/api/flow/application/steps/1/submit', {
      data: { personal: { fullName: 'Somchai Prasert', dateOfBirth: '1988-05-14', address: 'Herzl St 45, Tel Aviv' }, ...step1Rest },
    }, applicantToken);
    assert.strictEqual(unconfirmedName.status, 422);
    assert.strictEqual(unconfirmedName.body.fieldErrors.fullName, 'legal_name_unconfirmed');
    const badName = await request('POST', '/api/flow/application/steps/1/submit', {
      data: { personal: { fullName: '<script>', legalNameConfirmed: true, dateOfBirth: '1988-05-14', address: 'Herzl St 45, Tel Aviv' }, ...step1Rest },
    }, applicantToken);
    assert.strictEqual(badName.status, 422);
    assert.strictEqual(badName.body.fieldErrors.fullName, 'invalid');
    // A draft with an unconfirmed name change keeps the account name; the phone always comes from the account
    const draftRes = await request('PUT', '/api/flow/application/steps/1/draft', {
      data: { personal: { fullName: 'Someone Else', phoneNumber: '0500000000', dateOfBirth: '1988-05-14' } },
    }, applicantToken);
    assert.strictEqual(draftRes.status, 200);
    assert.strictEqual(draftRes.body.application.steps[1].data.personal.fullName, 'Somchai Prasrt');
    assert.strictEqual(draftRes.body.application.steps[1].data.personal.phoneNumber, accountPhone);
    console.log('  ✓ PASS: Unconfirmed or invalid legal-name changes are refused; drafts keep the account name and phone\n');


    // Validate the 4 mandatory Step 1 employee fields before submission
    const missingNewFieldsRes = await request('POST', '/api/flow/application/steps/1/submit', {
      data: {
        personal: {
          fullName: 'Somchai Prasert',
          legalNameConfirmed: true,
          phoneNumber: '0500000000',
          email: 'attacker@example.com',
          dateOfBirth: '1988-05-14',
          address: 'Herzl St 45, Tel Aviv',
        },
        documents: {
          passport: passDoc.body.file,
          visa: visaDoc.body.file,
          payslip: payslipDoc.body.file,
        },
        employment: {
          employerName: 'Yossi Cohen',
          companyName: 'Cohen Citrus Groves Ltd',
          manpowerAgent: 'AgroManpower TLV',
        },
        loan: {
          requestedAmountNis: 5000,
        },
      },
    }, applicantToken);
    assert.strictEqual(missingNewFieldsRes.status, 422, 'Missing mandatory Step 1 employee fields must return 422');
    assert.strictEqual(missingNewFieldsRes.body.fieldErrors.passportNumber, 'required');
    assert.strictEqual(missingNewFieldsRes.body.fieldErrors.countryOfOrigin, 'required');
    assert.strictEqual(missingNewFieldsRes.body.fieldErrors.visaStartDate, 'required');
    assert.strictEqual(missingNewFieldsRes.body.fieldErrors.visaExpiryDate, 'required');
    assert.strictEqual(missingNewFieldsRes.body.fieldErrors.monthlySalaryNis, 'required');

    const invalidCountryAndVisaRangeRes = await request('POST', '/api/flow/application/steps/1/submit', {
      data: {
        personal: {
          fullName: 'Somchai Prasert',
          phoneNumber: testPhone,
          dateOfBirth: '1988-05-14',
          address: 'Herzl St 45, Tel Aviv',
          passportNumber: 'TH7744112',
          countryOfOrigin: 'Atlantis',
          visaStartDate: '2027-06-01',
          visaExpiryDate: '2026-05-31',
          monthlySalaryNis: 0,
        },
        documents: {
          passport: passDoc.body.file,
          visa: visaDoc.body.file,
          payslip: payslipDoc.body.file,
        },
        employment: {
          employerName: 'Yossi Cohen',
          companyName: 'Cohen Citrus Groves Ltd',
        },
        loan: {
          requestedAmountNis: 5000,
        },
      },
    }, applicantToken);
    assert.strictEqual(invalidCountryAndVisaRangeRes.status, 422);
    assert.strictEqual(invalidCountryAndVisaRangeRes.body.fieldErrors.countryOfOrigin, 'invalid');
    assert.strictEqual(invalidCountryAndVisaRangeRes.body.fieldErrors.visaExpiryDate, 'before_start');
    assert.strictEqual(invalidCountryAndVisaRangeRes.body.fieldErrors.monthlySalaryNis, 'required');
    console.log('  ✓ PASS: Mandatory validation enforces passportNumber, countryOfOrigin, visa validity period, and monthlySalaryNis\n');

    // Visa type: only the known Step 1 ids are kept (a draft with an unknown value stores none)
    const oddVisaDraft = await request('PUT', '/api/flow/application/steps/1/draft', {
      data: { personal: { fullName: 'Somchai Prasrt', visaType: 'not_a_visa' } },
    }, applicantToken);
    assert.strictEqual(oddVisaDraft.status, 200, `Step 1 draft failed: ${JSON.stringify(oddVisaDraft.body)}`);
    assert.strictEqual(oddVisaDraft.body.application.steps[1].data.personal.visaType, '');
    console.log('  ✓ PASS: An unknown visa type is not stored\n');

    // Submit Step 1 (confirmed name correction; phone/email in the body are ignored in favour of the account)
    const step1SubmitRes = await request('POST', '/api/flow/application/steps/1/submit', {
      data: {
        personal: {
          fullName: 'Somchai Prasert',
          legalNameConfirmed: true,
          phoneNumber: '0500000000',
          email: 'attacker@example.com',
          dateOfBirth: '1988-05-14',
          address: 'Herzl St 45, Tel Aviv',
          passportNumber: 'TH7744112',
          countryOfOrigin: 'Thailand',
          visaType: 'foreign_expert',
          visaStartDate: '2025-06-01',
          visaExpiryDate: '2028-05-31',
          monthlySalaryNis: 8200,
          salaryCurrency: 'ILS',
        },
        documents: {
          passport: passDoc.body.file,
          visa: visaDoc.body.file,
          payslip: payslipDoc.body.file,
        },
        employment: {
          employerName: 'Yossi Cohen',
          companyName: 'Cohen Citrus Groves Ltd',
          manpowerAgent: 'AgroManpower TLV',
        },
        loan: {
          requestedAmountNis: 5000,
        },
      },
    }, applicantToken);

    assert.strictEqual(step1SubmitRes.status, 200, `Step 1 submit failed: ${JSON.stringify(step1SubmitRes.body)}`);
    assert.strictEqual(step1SubmitRes.body.application.flowStatus, 'PENDING_STEP1_APPROVAL');
    const submittedStep1Personal = step1SubmitRes.body.application.steps[1].data.personal;
    assert.strictEqual(submittedStep1Personal.passportNumber, 'TH7744112');
    assert.strictEqual(submittedStep1Personal.countryOfOrigin, 'Thailand');
    assert.strictEqual(submittedStep1Personal.visaStartDate, '2025-06-01');
    assert.strictEqual(submittedStep1Personal.visaExpiryDate, '2028-05-31');
    assert.strictEqual(submittedStep1Personal.monthlySalaryNis, 8200);
    assert.strictEqual(submittedStep1Personal.salaryCurrency, 'ILS');

    // Verify Back Office queue & centralized detail record synchronize all 4 fields
    const boDetailRes = await request('GET', `/api/flow/applications/${appId}`, null, reviewerToken);
    assert.strictEqual(boDetailRes.status, 200);
    assert.strictEqual(boDetailRes.body.application.step1Data.personal.passportNumber, 'TH7744112');
    assert.strictEqual(boDetailRes.body.application.step1Data.personal.countryOfOrigin, 'Thailand');
    assert.strictEqual(boDetailRes.body.application.step1Data.personal.visaStartDate, '2025-06-01');
    assert.strictEqual(boDetailRes.body.application.step1Data.personal.visaExpiryDate, '2028-05-31');
    assert.strictEqual(boDetailRes.body.application.step1Data.personal.monthlySalaryNis, 8200);
    assert.strictEqual(boDetailRes.body.application.borrowerDetails.passportNumber, 'TH7744112');
    assert.strictEqual(boDetailRes.body.application.borrowerDetails.countryOfOrigin, 'Thailand');
    assert.strictEqual(boDetailRes.body.application.residencyDetails.visaStartDate, '2025-06-01');
    assert.strictEqual(boDetailRes.body.application.residencyDetails.visaExpiryDate, '2028-05-31');
    assert.strictEqual(boDetailRes.body.application.employmentDetails.monthlySalaryNis, 8200);
    // The Step 1 visa type is stored with Step 1 (B/1 Foreign Expert, not B/1 Work Visa) and does not
    // touch the classic residencyDetails.visaType, which the eligibility score reads.
    assert.strictEqual(submittedStep1Personal.visaType, 'foreign_expert');
    assert.strictEqual(boDetailRes.body.application.step1Data.personal.visaType, 'foreign_expert');
    assert.strictEqual(boDetailRes.body.application.residencyDetails.visaType, undefined);
    console.log('  ✓ PASS: Step 1 visa type stored and returned to the applicant and the Back Office\n');

    const boQueueSearchRes = await request('GET', '/api/flow/applications?q=TH7744112', null, reviewerToken);
    assert.strictEqual(boQueueSearchRes.status, 200);
    const queueRow = boQueueSearchRes.body.applications.find((r) => r.id === appId);
    assert.ok(queueRow, 'Back Office queue search by passportNumber must return the application');
    assert.strictEqual(queueRow.passportNumber, 'TH7744112');
    assert.strictEqual(queueRow.countryOfOrigin, 'Thailand');
    assert.strictEqual(queueRow.visaStartDate, '2025-06-01');
    assert.strictEqual(queueRow.visaExpiryDate, '2028-05-31');
    assert.strictEqual(queueRow.monthlySalaryNis, 8200);

    // Identity: phone and email from the account, the confirmed name correction recorded
    const s1Personal = step1SubmitRes.body.application.steps[1].data.personal;
    assert.strictEqual(s1Personal.phoneNumber, accountPhone, 'Step 1 phone must come from the account');
    assert.strictEqual(s1Personal.email, regBase.email, 'Step 1 email must come from the account');
    assert.strictEqual(s1Personal.nameCorrection.previousName, 'Somchai Prasrt');
    const meAfterS1 = await request('GET', '/api/users/me', null, applicantToken);
    assert.strictEqual(meAfterS1.body.user.fullName, 'Somchai Prasert', 'A confirmed correction updates the account name');
    console.log('  ✓ PASS: Step 1 submitted; all 4 new employee fields saved & synchronized to Back Office\n');

    // Try modifying Step 1 while pending -> MUST BE REJECTED 409
    const illegalEditRes = await request('PUT', '/api/flow/application/steps/1/draft', {
      data: { personal: { fullName: 'Hacked Name' } },
    }, applicantToken);
    assert.strictEqual(illegalEditRes.status, 409, 'Submitted step must be immutable');
    console.log('  ✓ PASS: Submitted Step 1 is immutable for applicant while awaiting review\n');

    // Try unauthorized role approving Step 1 (customer_service cannot approve, only review/request changes)
    const illegalApproval = await request('POST', `/api/flow/applications/${appId}/steps/1/decision`, {
      decision: 'approve',
    }, csToken);
    assert.strictEqual(illegalApproval.status, 403, 'Customer service must NOT be able to approve Step 1');
    console.log('  ✓ PASS: Permission check prevents unauthorized staff from approving steps\n');

    // 5. Back Office Step 1 Approval
    console.log('--- 5. BACK OFFICE STEP 1 APPROVAL ---');
    // The applicant's 3-step screens listen to this stream (useFlowLiveUpdates): the approval, made on the
    // admin API, must reach it through the borrower API's status poller.
    const stream = openStatusStream(appId, applicantToken);
    await stream.connected;
    const approveStep1 = await request('POST', `/api/flow/applications/${appId}/steps/1/decision`, {
      decision: 'approve',
      note: 'All identity and employment documents verified.',
    }, reviewerToken);
    assert.strictEqual(approveStep1.status, 200);
    assert.strictEqual(approveStep1.body.flowStatus, 'STEP1_APPROVED');
    console.log('  ✓ PASS: Credit Reviewer approved Step 1; status is STEP1_APPROVED\n');
    const liveEvent = await stream.next('status', 8000);
    stream.close();
    assert.ok(liveEvent, 'The applicant\'s live stream must receive a "status" event for the Step 1 approval');
    assert.strictEqual(liveEvent.flowStatus, 'STEP1_APPROVED');
    console.log('  ✓ PASS: The approval reached the applicant\'s live stream (borrower API) as a "status" event\n');

    // Check applicant status now has Step 2 unlocked
    const appStateAfterS1 = await request('GET', '/api/flow/application', null, applicantToken);
    assert.strictEqual(appStateAfterS1.body.application.unlockedStep, 2);
    assert.strictEqual(appStateAfterS1.body.application.steps[2].state, 'available');
    console.log('  ✓ PASS: Step 2 is now officially unlocked and available for the applicant\n');

    // 5b. Service fee configured in the Back Office ("Credit Policy & Config")
    console.log('--- 5b. CONFIGURABLE SERVICE FEE ---');
    const feeGet = await request('GET', '/api/config/service-fee', null, reviewerToken);
    assert.strictEqual(feeGet.status, 200, 'Staff can read the service fee');
    assert.deepStrictEqual([feeGet.body.min, feeGet.body.max, feeGet.body.default], [0, 50000, 3000]);
    const feeByReviewer = await request('PUT', '/api/config/service-fee', { serviceFeeNis: 1000 }, reviewerToken);
    assert.strictEqual(feeByReviewer.status, 403, 'Only a system admin may change the service fee');
    for (const bad of [-1, 50001, 12.5, 'abc', null]) {
      const r = await request('PUT', '/api/config/service-fee', { serviceFeeNis: bad }, adminToken);
      assert.strictEqual(r.status, 400, `Service fee ${JSON.stringify(bad)} must be refused`);
      assert.strictEqual(r.body.code, 'INVALID_SERVICE_FEE');
    }
    const feeSet = await request('PUT', '/api/config/service-fee', { serviceFeeNis: 1200 }, adminToken);
    assert.strictEqual(feeSet.status, 200, `Admin sets the fee: ${JSON.stringify(feeSet.body)}`);
    assert.strictEqual(feeSet.body.serviceFeeNis, 1200);
    const feeAudit = await cfgGet("SELECT * FROM audit_log WHERE action = 'SERVICE_FEE_CHANGED' ORDER BY createdAt DESC, rowid DESC LIMIT 1");
    assert(feeAudit && JSON.parse(feeAudit.metadata).to === 1200 && feeAudit.actorRole === 'system_admin', 'The fee change is audited');
    const viewBeforeStep2 = await request('GET', '/api/flow/application', null, applicantToken);
    assert.strictEqual(viewBeforeStep2.body.application.serviceFeeNis, 1200, 'Step 2 shows the configured fee (borrower API, other process)');
    console.log('  ✓ PASS: Staff read the fee, only a system admin can set it (0-50,000, audited), and the applicant sees it before Step 2\n');

    // 6. Step 2 Submission (Sponsors & Loan Duration)
    console.log('--- 6. STEP 2 SUBMISSION & APPROVAL ---');
    // Ensure sponsor requires at least 1 sponsor
    const emptySponsors = await request('POST', '/api/flow/application/steps/2/submit', {
      data: {
        loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 },
        sponsors: [],
      },
    }, applicantToken);
    assert.strictEqual(emptySponsors.status, 422, 'Sponsors cannot be empty');

    // Each sponsor needs a copy of their ID or passport; one that isn't the applicant's own upload doesn't count
    const sponsorDoc = await uploadDummyFile('sponsor-passport.pdf', 'application/pdf', pdfMagic, applicantToken);
    const noSponsorDoc = await request('POST', '/api/flow/application/steps/2/submit', {
      data: {
        loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 },
        sponsors: [{ id: 'sp_1', fullName: 'Anan Sukhumvit', idOrPassportNumber: 'AB9876543', document: { filename: 'someone-elses-file.pdf' } }],
      },
    }, applicantToken);
    assert.strictEqual(noSponsorDoc.status, 422, 'A sponsor without an ID or passport copy is refused');
    assert.strictEqual(noSponsorDoc.body.fieldErrors['sponsors.0.document'], 'required');

    // Submit with simplified sponsor (Israeli or foreign without distinction: only ID or Passport + Full Name + document)
    const step2SubmitRes = await request('POST', '/api/flow/application/steps/2/submit', {
      data: {
        loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 },
        sponsors: [
          { id: 'sp_1', fullName: 'Anan Sukhumvit', idOrPassportNumber: 'AB9876543', document: sponsorDoc.body.file },
        ],
      },
    }, applicantToken);
    assert.strictEqual(step2SubmitRes.status, 200, `Step 2 submit failed: ${JSON.stringify(step2SubmitRes.body)}`);
    assert.strictEqual(step2SubmitRes.body.application.steps[2].data.sponsors[0].document.filename, sponsorDoc.body.file.filename, 'The sponsor document is kept');
    // Staff see it with the other documents (and the PDF lists it): document type GUARANTOR_ID
    const s2Detail = await request('GET', `/api/flow/applications/${appId}`, null, reviewerToken);
    const guarantorDocs = s2Detail.body.application.documents.filter((d) => d.documentTypeCode === 'GUARANTOR_ID');
    assert.deepStrictEqual(guarantorDocs.map((d) => d.storageKey), [sponsorDoc.body.file.filename], 'The guarantor copy is listed with the documents');
    assert.strictEqual(s2Detail.body.application.guarantors[0].document.filename, sponsorDoc.body.file.filename);
    const staffFile = await request('GET', sponsorDoc.body.file.url, null, reviewerToken);
    assert.strictEqual(staffFile.status, 200, 'Staff can open the guarantor copy');
    assert.strictEqual(step2SubmitRes.body.application.flowStatus, 'PENDING_STEP2_APPROVAL');
    const step2Breakdown = step2SubmitRes.body.application.loanBreakdown;
    assert.strictEqual(step2Breakdown.totalServiceFeeNis, 1200, 'Step 2 takes the configured fee');
    assert.strictEqual(step2Breakdown.monthlyServiceFeeNis, 200, '1,200 over 6 months');
    assert.strictEqual(step2Breakdown.overallTotalNis, 6324, 'Totals use the configured fee (fixture: 5,000 / 6 months / 1,200)');
    console.log('  ✓ PASS: Step 2 submitted with simplified sponsor; status is PENDING_STEP2_APPROVAL\n');

    // A later change of the configured fee leaves this application's fee as it was
    const feeChanged = await request('PUT', '/api/config/service-fee', { serviceFeeNis: 2500 }, adminToken);
    assert.strictEqual(feeChanged.status, 200);
    const viewAfterChange = await request('GET', '/api/flow/application', null, applicantToken);
    assert.strictEqual(viewAfterChange.body.application.serviceFeeNis, 1200, 'The application keeps the fee it took at Step 2');
    assert.strictEqual(viewAfterChange.body.application.loanBreakdown.totalServiceFeeNis, 1200);
    console.log('  ✓ PASS: Changing the configured fee afterwards does not change an application past Step 2\n');

    // Step 2 Approval by Admin
    const approveStep2 = await request('POST', `/api/flow/applications/${appId}/steps/2/decision`, {
      decision: 'approve',
      note: 'Sponsor and loan terms confirmed.',
    }, adminToken);
    assert.strictEqual(approveStep2.status, 200);
    assert.strictEqual(approveStep2.body.flowStatus, 'STEP2_APPROVED');
    console.log('  ✓ PASS: Admin approved Step 2; status is STEP2_APPROVED\n');

    // 7. Step 3 Final Submission (Bank details, Bank doc, Mandatory Terms)
    console.log('--- 7. STEP 3 FINAL SUBMISSION & MANDATORY AGREEMENTS ---');
    const bankDoc = await uploadDummyFile('bank_account_ownership.pdf', 'application/pdf', pdfMagic, applicantToken);
    assert.strictEqual(bankDoc.status, 200);

    // Fetch current terms version
    const termsRes = await request('GET', '/api/flow/terms/current', null, applicantToken);
    assert(termsRes.body.terms.general && termsRes.body.terms.service_fee);
    const genVersion = termsRes.body.terms.general.version;
    const feeVersion = termsRes.body.terms.service_fee.version;

    // Fail if terms not accepted
    const failTermsRes = await request('POST', '/api/flow/application/steps/3/submit', {
      data: {
        bank: {
          bankName: 'Bank Hapoalim',
          branchNumber: '612',
          accountNumber: '12345678',
          accountHolderName: 'Somchai Prasert',
        },
        bankDocument: bankDoc.body.file,
        terms: {
          generalVersion: genVersion,
          serviceFeeVersion: feeVersion,
          generalAccepted: false, // NOT accepted
          serviceFeeAccepted: true,
        },
      },
    }, applicantToken);
    assert.strictEqual(failTermsRes.status, 422, 'Step 3 must reject unaccepted terms');

    const step3Base = {
      bank: { bankName: 'Bank Hapoalim', branchNumber: '612', accountNumber: '12345678', accountHolderName: 'Somchai Prasert' },
      bankDocument: bankDoc.body.file,
      terms: { generalVersion: genVersion, serviceFeeVersion: feeVersion, generalAccepted: true, serviceFeeAccepted: true },
    };
    // A 1x1 PNG, as the Step 3 canvas would send it
    const signaturePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    // The signature is required on the server too, and only a well-formed one counts
    for (const [label, signature] of [
      ['no signature', undefined],
      ['an empty typed name', { signatureMethod: 'typed_name', signatureValue: '   ' }],
      ['a drawn signature without an image', { signatureMethod: 'drawn_touch', signatureValue: 'x' }],
      ['a drawn signature that is not a PNG data URI', { signatureMethod: 'drawn_touch', signatureDataUri: 'data:image/svg+xml;base64,PHN2Zy8+' }],
      ['an oversized drawn signature', { signatureMethod: 'drawn_touch', signatureDataUri: `data:image/png;base64,${'A'.repeat(500000)}` }],
    ]) {
      const r = await request('POST', '/api/flow/application/steps/3/submit', { data: { ...step3Base, signature } }, applicantToken);
      assert.strictEqual(r.status, 422, `Step 3 with ${label} must be refused: ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.strictEqual(r.body.fieldErrors && r.body.fieldErrors.signature, 'required', `Step 3 with ${label} must flag the signature`);
    }
    console.log('  ✓ PASS: Step 3 without a valid signature is refused (422, fieldErrors.signature)');

    // Submit Step 3 with all mandatory requirements fulfilled
    const step3SubmitRes = await request('POST', '/api/flow/application/steps/3/submit', {
      data: {
        bank: {
          bankName: 'Bank Hapoalim',
          branchNumber: '612',
          accountNumber: '12345678',
          accountHolderName: 'Somchai Prasert',
        },
        bankDocument: bankDoc.body.file,
        terms: {
          generalVersion: genVersion,
          serviceFeeVersion: feeVersion,
          generalAccepted: true,
          serviceFeeAccepted: true,
        },
        signature: { signatureMethod: 'drawn_touch', signatureValue: 'ignored', signatureDataUri: signaturePng, signedAt: '2000-01-01T00:00:00.000Z' },
      },
    }, applicantToken);
    assert.strictEqual(step3SubmitRes.status, 200, `Step 3 submit failed: ${JSON.stringify(step3SubmitRes.body)}`);
    assert.strictEqual(step3SubmitRes.body.application.flowStatus, 'PENDING_FINAL_PROCESSING');
    assert.strictEqual(step3SubmitRes.body.application.isCompleted, true);
    assert.strictEqual(step3SubmitRes.body.application.loanBreakdown.totalServiceFeeNis, 1200, 'Step 3 keeps the fee from Step 2');
    assert.strictEqual(termsRes.body.terms.service_fee.version, '3.0', 'Service fee terms v3.0 (no amount in the text) is current');
    assert(!/\d,\d{3}/.test(termsRes.body.terms.service_fee.textEn), 'The current service fee terms name no amount');
    console.log('  ✓ PASS: Step 3 submitted with recorded terms acceptance; status is PENDING_FINAL_PROCESSING\n');

    // Verify Back Office Centralized Record
    console.log('--- 8. BACK OFFICE CENTRALIZED APPLICATION INSPECTION ---');
    const fullAppRes = await request('GET', `/api/flow/applications/${appId}`, null, reviewerToken);
    assert.strictEqual(fullAppRes.status, 200);
    const fullApp = fullAppRes.body;

    assert.strictEqual(fullApp.application.id, appId);
    assert(fullApp.application.step1Data.personal.fullName === 'Somchai Prasert');
    assert(fullApp.application.step2Data.sponsors.length === 1);
    assert(fullApp.application.step3Data.bank.bankName === 'Bank Hapoalim');
    assert.strictEqual(fullApp.acceptances.length, 2, 'Must record 2 terms acceptances (general + service fee)');
    assert.strictEqual(fullApp.submissions.length, 3, 'Must record snapshots for steps 1, 2, and 3');
    assert(fullApp.audit.length >= 7, 'Comprehensive audit trail must be recorded');
    assert(fullApp.audit.some((r) => r.action === 'LEGAL_NAME_CORRECTED' && r.metadata.from === 'Somchai Prasrt'), 'Name correction must be audited');
    assert.strictEqual(fullApp.application.step1Data.registration.location.latitude, 32.09, 'Position is stored coarsely');
    const storedSig = fullApp.application.step3Data.signature;
    assert.strictEqual(storedSig.signatureMethod, 'drawn_touch');
    assert.strictEqual(storedSig.signatureDataUri, signaturePng, 'Staff see the drawn signature');
    assert.strictEqual(storedSig.signatureValue, '', 'A drawn signature keeps no text value');
    assert(Date.now() - Date.parse(storedSig.signedAt) < 5 * 60 * 1000, `signedAt is the server time, not the device's: ${storedSig.signedAt}`);
    const listRes = await request('GET', '/api/applications', null, reviewerToken);
    const listed = listRes.body.applications.find((x) => x.id === appId);
    assert(listed && listed.step3Data.signature && !listed.step3Data.signature.signatureDataUri, 'The list leaves out the signature image');
    assert(!(listed.digitalSignature && listed.digitalSignature.signatureValue), 'The list leaves out the mirrored signature image');
    const staffPdf = await request('GET', `/api/applications/${appId}/pdf?lang=en`, null, reviewerToken);
    assert.strictEqual(staffPdf.status, 200);
    assert(String(staffPdf.body).includes('/Subtype /Image'), 'The PDF embeds the drawn signature');
    const ownPdf = await request('GET', `/api/applications/${appId}/pdf?lang=he`, null, applicantToken);
    assert.strictEqual(ownPdf.status, 200);
    assert(String(ownPdf.body).includes('/Subtype /Image'), "The applicant's Hebrew PDF embeds the drawn signature");
    console.log('  ✓ PASS: The signature is stored with the server time, shown to staff, left out of the list and drawn in the PDF');
    console.log('  ✓ PASS: Back Office centralized view contains all steps, documents, terms acceptances, and audit entries\n');

    // 9. Final Decision (Approved)
    console.log('--- 9. EXISTING FINAL APPROVAL PROCEDURE ---');
    const finalApprove = await request('POST', `/api/flow/applications/${appId}/final-decision`, {
      status: 'Approved',
      reason: 'Application verified by credit committee and accepted.',
    }, reviewerToken);
    assert.strictEqual(finalApprove.status, 200);
    assert.strictEqual(finalApprove.body.flowStatus, 'LOAN_APPROVED');
    console.log('  ✓ PASS: Final decision mapped successfully to LOAN_APPROVED\n');

    // An approved loan can't be approved a second time; its status stays as it was
    const approveAgain = await request('POST', `/api/flow/applications/${appId}/final-decision`, {
      status: 'Approved',
      reason: 'Second approval attempt.',
    }, reviewerToken);
    assert.strictEqual(approveAgain.status, 409, `Re-approval must be refused: ${JSON.stringify(approveAgain.body)}`);
    const afterAgain = await request('GET', `/api/flow/applications/${appId}`, null, reviewerToken);
    assert.strictEqual(afterAgain.body.application.flowStatus, 'LOAN_APPROVED');
    assert.strictEqual(afterAgain.body.application.status, 'Approved');
    assert.strictEqual(afterAgain.body.application.loanBreakdown.totalServiceFeeNis, 1200, 'The approved loan keeps the fee from Step 2');
    assert.strictEqual(afterAgain.body.application.loanRequest.serviceFeeNis, 1200, 'The PDF/list figures use the same fee');
    console.log('  ✓ PASS: A second approval of an approved loan is refused (409) and changes nothing\n');

    // An ongoing (approved, not yet repaid) loan blocks a new application
    const approvedView = await request('GET', '/api/flow/application', null, applicantToken);
    assert.strictEqual(approvedView.body.application.flowStatus, 'LOAN_APPROVED');
    assert.strictEqual(approvedView.body.application.canStartNewApplication, false, 'An ongoing loan must not offer a new application');
    const newWhileActive = await request('POST', '/api/flow/application/steps/1/submit', { newApplication: true, data: {} }, applicantToken);
    assert.strictEqual(newWhileActive.status, 409, `A new application during an ongoing loan must be refused: ${JSON.stringify(newWhileActive.body)}`);
    assert.strictEqual(newWhileActive.body.code, 'LOAN_ACTIVE');
    const stillOne = await request('GET', '/api/flow/application', null, applicantToken);
    assert.strictEqual(stillOne.body.application.id, approvedView.body.application.id, 'No new application is created');
    assert.strictEqual(stillOne.body.application.flowStatus, 'LOAN_APPROVED');
    console.log('  ✓ PASS: A new application during an ongoing loan is refused (409 LOAN_ACTIVE)\n');

    // Staff mark the loan as repaid ("Loan repaid" in the Back Office); then the applicant may apply again
    const csRepaid = await request('POST', `/api/flow/applications/${appId}/loan-repaid`, {}, csToken);
    assert.strictEqual(csRepaid.status, 403, 'Customer service may not mark a loan as repaid');
    const repaid = await request('POST', `/api/flow/applications/${appId}/loan-repaid`, { note: 'Last instalment received.' }, reviewerToken);
    assert.strictEqual(repaid.status, 200, `Loan repaid failed: ${JSON.stringify(repaid.body)}`);
    assert(repaid.body.loanRepaidAt, 'The repayment date is returned');
    const repaidAgain = await request('POST', `/api/flow/applications/${appId}/loan-repaid`, {}, reviewerToken);
    assert.strictEqual(repaidAgain.status, 409);
    assert.strictEqual(repaidAgain.body.code, 'ALREADY_REPAID');
    const repaidDetail = await request('GET', `/api/flow/applications/${appId}`, null, reviewerToken);
    assert.strictEqual(repaidDetail.body.application.loanRepaidAt, repaid.body.loanRepaidAt);
    assert.strictEqual(repaidDetail.body.application.flowStatus, 'LOAN_APPROVED', 'A repaid loan stays approved');
    assert.strictEqual(repaidDetail.body.permissions.markRepaid, false, 'Nothing left to mark');
    assert(repaidDetail.body.audit.some((r) => r.action === 'LOAN_REPAID' && r.metadata && r.metadata.note === 'Last instalment received.'), 'Marking a loan as repaid is audited');
    for (let i = 0; i < 20 && !(await request('GET', `/api/flow/applications/${appId}`, null, reviewerToken)).body.deliveries.some((d) => d.event === 'LOAN_REPAID'); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const repaidDeliveries = (await request('GET', `/api/flow/applications/${appId}`, null, reviewerToken)).body.deliveries.filter((d) => d.event === 'LOAN_REPAID');
    assert(repaidDeliveries.some((d) => d.channel === 'in_app'), 'The applicant is notified that the loan is repaid');
    const repaidView = await request('GET', '/api/flow/application', null, applicantToken);
    assert.strictEqual(repaidView.body.application.canStartNewApplication, true);
    assert.strictEqual(repaidView.body.application.loanRepaidAt, repaid.body.loanRepaidAt);
    console.log('  ✓ PASS: Staff mark the loan as repaid (audited, notified, once only, not by customer service)\n');

    // The applicant starts a new application; the repaid one stays as it was
    const nextApp = await request('POST', '/api/flow/application/steps/1/submit', {
      newApplication: true,
      data: {
        personal: {
          fullName: 'Somchai Prasert', dateOfBirth: '1988-05-14', address: 'Herzl St 45, Tel Aviv', passportNumber: 'TH7744112',
          countryOfOrigin: 'Thailand', visaType: 'foreign_expert', visaStartDate: '2025-06-01', visaExpiryDate: '2028-05-31', monthlySalaryNis: 8200,
        },
        documents: { passport: passDoc.body.file, visa: visaDoc.body.file, payslip: payslipDoc.body.file },
        employment: { employerName: 'Yossi Cohen', companyName: 'Cohen Citrus Groves Ltd', manpowerAgent: 'AgroManpower TLV' },
        loan: { requestedAmountNis: 3000 },
      },
    }, applicantToken);
    assert.strictEqual(nextApp.status, 200, `New application after repayment failed: ${JSON.stringify(nextApp.body)}`);
    assert.notStrictEqual(nextApp.body.application.id, appId, 'A new application is created');
    assert.strictEqual(nextApp.body.application.flowStatus, 'PENDING_STEP1_APPROVAL');
    const oldApp = await request('GET', `/api/flow/applications/${appId}`, null, reviewerToken);
    assert.strictEqual(oldApp.body.application.flowStatus, 'LOAN_APPROVED');
    assert.strictEqual(oldApp.body.application.loanRepaidAt, repaid.body.loanRepaidAt);
    console.log('  ✓ PASS: After repayment the applicant can apply again; the repaid loan is unchanged\n');

    // 10. Documents uploaded in the Step 1 form before registration move to the new account
    console.log('--- 10. GUEST UPLOADS ADOPTED AT REGISTRATION ---');
    const { dbGet: ownerDbGet } = require('@quickloan/backend-core/services/dbHelpers');
    const ownerOf = async (f) => (await ownerDbGet('SELECT userId FROM uploaded_files WHERE filename = ?', [f])).userId;
    const registerApplicant = async (name, uploadedFiles) => {
      const phone = '053' + Math.floor(1000000 + Math.random() * 9000000);
      const otp = await request('POST', '/api/users/request-otp', { phoneNumber: phone });
      const res = await request('POST', '/api/flow/register', {
        fullName: name,
        email: `${name.split(' ')[0].toLowerCase()}_${Date.now()}@example.com`,
        password: 'StrongPassword123!',
        phoneNumber: phone,
        code: otp.body.demoCode || '123456',
        language: 'en',
        registration: { disclaimerAccepted: true, locationGranted: true },
        uploadedFiles,
      });
      assert.strictEqual(res.status, 200, `Registration failed: ${JSON.stringify(res.body)}`);
      return { phone, token: res.body.token, userId: res.body.user.id, appId: res.body.application.id };
    };
    // Same name as the account (a different one would be a legal-name correction).
    const step1Payload = (phone, docs, fullName) => ({
      data: {
        personal: {
          fullName,
          phoneNumber: phone,
          dateOfBirth: '1990-01-01',
          address: 'Allenby 1, Tel Aviv',
          passportNumber: 'NG5510982',
          countryOfOrigin: 'Nigeria',
          visaStartDate: '2025-01-01',
          visaExpiryDate: '2027-12-31',
          monthlySalaryNis: 7200,
          salaryCurrency: 'ILS',
        },
        documents: docs,
        employment: { employerName: 'Employer', companyName: 'Company Ltd' },
        loan: { requestedAmountNis: 5000 },
      },
    });
    const guestUpload = async (name) => {
      const r = await uploadDummyFile(name, 'application/pdf', pdfMagic, null);
      assert.strictEqual(r.status, 200);
      return r.body.file;
    };

    const guestDocs = { passport: await guestUpload('passport.pdf'), visa: await guestUpload('visa.pdf'), payslip: await guestUpload('payslip.pdf') };
    // A file that belongs to a real account must never be handed to someone else.
    const ownedByFirstApplicant = (await uploadDummyFile('other.pdf', 'application/pdf', pdfMagic, applicantToken)).body.file.filename;
    const adopter = await registerApplicant('Adopter Applicant', [...Object.values(guestDocs).map((d) => d.filename), ownedByFirstApplicant]);
    for (const d of Object.values(guestDocs)) assert.strictEqual(await ownerOf(d.filename), adopter.userId, 'Guest upload should move to the new account');
    assert.strictEqual(await ownerOf(ownedByFirstApplicant), regRes.body.user.id, 'Another account\'s file must not be adopted');

    // Verify clients cannot access Back Office endpoints or mint staff tokens. These are sent to the admin
    // API (where those routes live), which refuses any non-staff token outright: 401.
    const denied = 401;
    const toAdmin = { to: 'admin' };
    const clientFlowBoAttempt = await request('GET', '/api/flow/applications', null, adopter.token, toAdmin);
    assert.strictEqual(clientFlowBoAttempt.status, denied, 'Client token must be denied Back Office flow list');
    const clientClassicBoAttempt = await request('GET', '/api/applications', null, adopter.token, toAdmin);
    assert.strictEqual(clientClassicBoAttempt.status, denied, 'Client token must be denied Back Office classic list');
    const clientStaffTokenAttempt = await request('POST', '/api/auth/staff-token', { role: 'credit_reviewer' }, adopter.token, toAdmin);
    assert.strictEqual(clientStaffTokenAttempt.status, denied, 'Client token must be denied /api/auth/staff-token');

    // Verify calling classic /api/applications/active/:userId does NOT pollute flowVersion=2 lead with Thailand
    await request('GET', `/api/applications/active/${adopter.userId}`, null, adopter.token);
    const preSubmitBoRes = await request('GET', `/api/flow/applications/${adopter.appId}`, null, reviewerToken);
    assert.strictEqual(preSubmitBoRes.status, 200);
    assert.strictEqual(preSubmitBoRes.body.application.borrowerDetails.countryOfOrigin, '', 'Unsubmitted flowVersion=2 lead must never default countryOfOrigin to Thailand');

    const adoptedSubmit = await request('POST', '/api/flow/application/steps/1/submit', step1Payload(adopter.phone, guestDocs, 'Adopter Applicant'), adopter.token);
    assert.strictEqual(adoptedSubmit.status, 200, `Step 1 with adopted documents failed: ${JSON.stringify(adoptedSubmit.body)}`);
    const postSubmitBoRes = await request('GET', `/api/flow/applications/${adopter.appId}`, null, reviewerToken);
    assert.strictEqual(postSubmitBoRes.body.application.step1Data.personal.countryOfOrigin, 'Nigeria');
    assert.strictEqual(postSubmitBoRes.body.application.borrowerDetails.countryOfOrigin, 'Nigeria');
    assert.strictEqual(postSubmitBoRes.body.application.step1Data.personal.passportNumber, 'NG5510982');
    assert.strictEqual(postSubmitBoRes.body.application.step1Data.personal.visaStartDate, '2025-01-01');
    assert.strictEqual(postSubmitBoRes.body.application.step1Data.personal.visaExpiryDate, '2027-12-31');
    assert.strictEqual(postSubmitBoRes.body.application.step1Data.personal.monthlySalaryNis, 7200);
    console.log('  ✓ PASS: Guest uploads adopted at registration; non-Thailand country & all 4 fields preserved; clients blocked from Back Office\n');

    // Without adoption the server reports each rejected document as a field error the form can highlight.
    const strayDocs = { passport: await guestUpload('passport.pdf'), visa: await guestUpload('visa.pdf'), payslip: await guestUpload('payslip.pdf') };
    const nonAdopter = await registerApplicant('Plain Applicant');
    const rejectedSubmit = await request('POST', '/api/flow/application/steps/1/submit', step1Payload(nonAdopter.phone, strayDocs, 'Plain Applicant'), nonAdopter.token);
    assert.strictEqual(rejectedSubmit.status, 422);
    assert.deepStrictEqual(rejectedSubmit.body.fieldErrors, { passport: 'required', visa: 'required', payslip: 'required' });
    console.log('  ✓ PASS: Unowned documents come back as passport/visa/payslip field errors\n');

    console.log('====================================================');
    console.log('🎉 ALL 3-STEP WORKFLOW TESTS PASSED ACCURATELY!');
    console.log('====================================================\n');
  } finally {
    if (originalFeeRow) {
      await cfgRun("UPDATE app_config SET value = ?, updatedAt = ? WHERE key = 'serviceFeeNis'", [originalFeeRow.value, originalFeeRow.updatedAt]);
    } else {
      await cfgRun("DELETE FROM app_config WHERE key = 'serviceFeeNis'");
    }
    for (const child of children) child.kill();
  }
}

if (require.main === module) {
  runTests().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ TEST FAILED:', err);
    for (const child of children) child.kill();
    process.exit(1);
  });
}

module.exports = { runTests };
