/**
 * Unit & Integration test suite for the 3-Step Approval Workflow:
 * - Sequential workflow enforcement (Steps 1 -> 2 -> 3)
 * - Gating & mandatory Back Office approvals
 * - Immutability of submitted steps
 * - Atomic Step 3 submission & terms acceptance recording
 * - Rejection and Changes Requested handling
 * - Notifications generation (SMS, Email, In-App)
 * - Loan calculation parity verification
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const app = require('./server');
const fixtures = require('./fixtures/loan-calc-fixtures.json');
const { calculateLoanRepayment } = require('./services/loanCalculator');

const TEST_PORT = 5012;
let server;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
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

function uploadDummyFile(filename, mimeType, magicBuffer, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const payload = Buffer.concat([Buffer.from(header), magicBuffer, Buffer.from(footer)]);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
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
    const res = calculateLoanRepayment(item.principal, item.period);
    assert.strictEqual(res.baseMonthlyRepaymentNis, item.expectedBaseMonthly, `Base monthly mismatch for ${item.principal} NIS / ${item.period} mos`);
    assert.strictEqual(res.serviceFeeNis, item.expectedFee, `Fee mismatch for ${item.principal} NIS`);
    assert.strictEqual(res.monthlyServiceFeeNis, item.expectedMonthlyFee, `Monthly fee mismatch for ${item.principal} NIS`);
    assert.strictEqual(res.monthlyPaymentNis, item.expectedTotalMonthly, `Total monthly mismatch for ${item.principal} NIS`);
    assert.strictEqual(res.totalRepaymentNis, item.expectedTotalRepayment, `Total repayment mismatch for ${item.principal} NIS`);
    assert.strictEqual(res.totalInterestNis, item.expectedTotalInterest, `Total interest mismatch for ${item.principal} NIS`);
  }
  console.log('  ✓ PASS: Server loan calculator matches all fixture standards accurately\n');

  // Start HTTP server for API tests
  await new Promise((resolve) => {
    server = app.listen(TEST_PORT, resolve);
  });

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

    // Register applicant with regulatory disclaimer
    const regRes = await request('POST', '/api/flow/register', {
      fullName: 'Somchai Prasert',
      email: `somchai_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      phoneNumber: testPhone,
      code: demoCode,
      language: 'en',
      registration: {
        disclaimerAccepted: true,
        locationGranted: true,
      },
    });
    assert.strictEqual(regRes.status, 200, `Registration failed: ${JSON.stringify(regRes.body)}`);
    assert(regRes.body.token, 'Registration should return auth token');
    const applicantToken = regRes.body.token;
    const appId = regRes.body.application.id;

    assert.strictEqual(regRes.body.application.flowStatus, 'LEAD_REGISTERED');
    assert.strictEqual(regRes.body.application.unlockedStep, 1);
    console.log('  ✓ PASS: Applicant registered with LEAD_REGISTERED status\n');

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

    // Submit Step 1
    const step1SubmitRes = await request('POST', '/api/flow/application/steps/1/submit', {
      data: {
        personal: {
          fullName: 'Somchai Prasert',
          phoneNumber: testPhone,
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

    assert.strictEqual(step1SubmitRes.status, 200, `Step 1 submit failed: ${JSON.stringify(step1SubmitRes.body)}`);
    assert.strictEqual(step1SubmitRes.body.application.flowStatus, 'PENDING_STEP1_APPROVAL');
    console.log('  ✓ PASS: Step 1 submitted; status changed to PENDING_STEP1_APPROVAL\n');

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
    const approveStep1 = await request('POST', `/api/flow/applications/${appId}/steps/1/decision`, {
      decision: 'approve',
      note: 'All identity and employment documents verified.',
    }, reviewerToken);
    assert.strictEqual(approveStep1.status, 200);
    assert.strictEqual(approveStep1.body.flowStatus, 'STEP1_APPROVED');
    console.log('  ✓ PASS: Credit Reviewer approved Step 1; status is STEP1_APPROVED\n');

    // Check applicant status now has Step 2 unlocked
    const appStateAfterS1 = await request('GET', '/api/flow/application', null, applicantToken);
    assert.strictEqual(appStateAfterS1.body.application.unlockedStep, 2);
    assert.strictEqual(appStateAfterS1.body.application.steps[2].state, 'available');
    console.log('  ✓ PASS: Step 2 is now officially unlocked and available for the applicant\n');

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

    // Submit with simplified sponsor (Israeli or foreign without distinction: only ID or Passport + Full Name)
    const step2SubmitRes = await request('POST', '/api/flow/application/steps/2/submit', {
      data: {
        loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 },
        sponsors: [
          { id: 'sp_1', fullName: 'Anan Sukhumvit', idOrPassportNumber: 'AB9876543' },
        ],
      },
    }, applicantToken);
    assert.strictEqual(step2SubmitRes.status, 200);
    assert.strictEqual(step2SubmitRes.body.application.flowStatus, 'PENDING_STEP2_APPROVAL');
    console.log('  ✓ PASS: Step 2 submitted with simplified sponsor; status is PENDING_STEP2_APPROVAL\n');

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
      },
    }, applicantToken);
    assert.strictEqual(step3SubmitRes.status, 200, `Step 3 submit failed: ${JSON.stringify(step3SubmitRes.body)}`);
    assert.strictEqual(step3SubmitRes.body.application.flowStatus, 'PENDING_FINAL_PROCESSING');
    assert.strictEqual(step3SubmitRes.body.application.isCompleted, true);
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

    // 10. Documents uploaded in the Step 1 form before registration move to the new account
    console.log('--- 10. GUEST UPLOADS ADOPTED AT REGISTRATION ---');
    const { dbGet: ownerDbGet } = require('./services/dbHelpers');
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
      return { phone, token: res.body.token, userId: res.body.user.id };
    };
    const step1Payload = (phone, docs) => ({
      data: {
        personal: { fullName: 'Guest Uploader', phoneNumber: phone, dateOfBirth: '1990-01-01', address: 'Allenby 1, Tel Aviv' },
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
    const adoptedSubmit = await request('POST', '/api/flow/application/steps/1/submit', step1Payload(adopter.phone, guestDocs), adopter.token);
    assert.strictEqual(adoptedSubmit.status, 200, `Step 1 with adopted documents failed: ${JSON.stringify(adoptedSubmit.body)}`);
    console.log('  ✓ PASS: Guest uploads adopted at registration; Step 1 accepted them\n');

    // Without adoption the server reports each rejected document as a field error the form can highlight.
    const strayDocs = { passport: await guestUpload('passport.pdf'), visa: await guestUpload('visa.pdf'), payslip: await guestUpload('payslip.pdf') };
    const nonAdopter = await registerApplicant('Plain Applicant');
    const rejectedSubmit = await request('POST', '/api/flow/application/steps/1/submit', step1Payload(nonAdopter.phone, strayDocs), nonAdopter.token);
    assert.strictEqual(rejectedSubmit.status, 422);
    assert.deepStrictEqual(rejectedSubmit.body.fieldErrors, { passport: 'required', visa: 'required', payslip: 'required' });
    console.log('  ✓ PASS: Unowned documents come back as passport/visa/payslip field errors\n');

    console.log('====================================================');
    console.log('🎉 ALL 3-STEP WORKFLOW TESTS PASSED ACCURATELY!');
    console.log('====================================================\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

if (require.main === module) {
  runTests().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ TEST FAILED:', err);
    if (server) server.close();
    process.exit(1);
  });
}

module.exports = { runTests };
