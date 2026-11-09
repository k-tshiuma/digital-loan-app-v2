const fs = require('fs');
const path = require('path');
const http = require('http');

// Import express app
const app = require('./combinedServer');

const PORT = 5002; // Use distinct test port
let server;

function makeRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      if (typeof body === 'string') req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function uploadFileRequest(filename, buffer, mimeType, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const postDataStart = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const postDataEnd = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([postDataStart, buffer, postDataEnd]);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: '/api/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': payload.length,
          Authorization: token ? `Bearer ${token}` : undefined,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
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
    req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING COMPREHENSIVE LENDING APPLICATION TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  server = app.listen(PORT, async () => {
    try {
      // ----------------------------------------------------
      // TEST 1: New User Registration & First Application
      // ----------------------------------------------------
      console.log('\n--- 1. NEW USER REGISTRATION & FIRST APPLICATION ---');
      const testRunId = Date.now().toString().slice(-6);
      const newUserPhone = '+97250' + testRunId + '1';
      const otpSendRes = await makeRequest('POST', '/api/users/request-otp', { phoneNumber: newUserPhone });
      assert(otpSendRes.status === 200 && otpSendRes.data.success, 'OTP sent for new user');

      const otpVerifyRes = await makeRequest('POST', '/api/users/verify-otp', {
        phoneNumber: newUserPhone,
        code: '123456',
      });
      assert(otpVerifyRes.status === 200 && otpVerifyRes.data.token, 'OTP verified and JWT token issued');
      const user1Token = otpVerifyRes.data.token;
      const user1 = otpVerifyRes.data.user;

      const activeApp1Res = await makeRequest('GET', `/api/applications/active/${user1.id}`, null, {
        Authorization: `Bearer ${user1Token}`,
      });
      assert(activeApp1Res.status === 200 && activeApp1Res.data.application, 'Created new active application draft for user 1');
      assert(!activeApp1Res.data.isReturningUser, 'User 1 is marked as new user (not returning user)');
      const app1 = activeApp1Res.data.application;

      // ----------------------------------------------------
      // TEST 2: Valid File Uploads & Magic Byte Verification
      // ----------------------------------------------------
      console.log('\n--- 2. FILE UPLOADS: VALID FILES & MAGIC BYTES ---');

      // Valid PDF (starts with %PDF)
      const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
      const pdfUpload = await uploadFileRequest('bank_statement.pdf', validPdfBuffer, 'application/pdf', user1Token);
      assert(pdfUpload.status === 200 && pdfUpload.data.file?.filename, 'Valid PDF file with %PDF magic bytes accepted');
      const user1PdfFilename = pdfUpload.data.file.filename;

      // Valid JPEG (starts with FF D8 FF)
      const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
      const jpgUpload = await uploadFileRequest('passport.jpg', validJpgBuffer, 'image/jpeg', user1Token);
      assert(jpgUpload.status === 200 && jpgUpload.data.file?.filename, 'Valid JPEG file with FF D8 FF magic bytes accepted');

      // Valid PNG (starts with 89 50 4E 47)
      const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const pngUpload = await uploadFileRequest('bank_cheque.png', validPngBuffer, 'image/png', user1Token);
      assert(pngUpload.status === 200 && pngUpload.data.file?.filename, 'Valid PNG file with 89 50 4E 47 magic bytes accepted');

      // ----------------------------------------------------
      // TEST 3: Malicious, Disguised, and Invalid Files
      // ----------------------------------------------------
      console.log('\n--- 3. FILE SECURITY: REJECT DISGUISED & MALICIOUS FILES ---');

      // Disguised script: named evil.pdf but contains PHP code
      const fakePdfBuffer = Buffer.from('<?php echo "evil payload"; ?>');
      const fakePdfUpload = await uploadFileRequest('evil.pdf', fakePdfBuffer, 'application/pdf', user1Token);
      assert(fakePdfUpload.status === 400, 'Disguised file (PHP disguised as PDF) rejected by magic bytes inspection');

      // Disguised image: named test.jpg but contains HTML/JS
      const fakeJpgBuffer = Buffer.from('<script>alert("xss")</script>');
      const fakeJpgUpload = await uploadFileRequest('test.jpg', fakeJpgBuffer, 'image/jpeg', user1Token);
      assert(fakeJpgUpload.status === 400, 'Disguised image (HTML/JS disguised as JPG) rejected by magic bytes inspection');

      // Invalid extension: .exe
      const exeBuffer = Buffer.from('MZ\x90\x00');
      const exeUpload = await uploadFileRequest('app.exe', exeBuffer, 'application/octet-stream', user1Token);
      assert(exeUpload.status === 400, 'Executable file (.exe) rejected by extension and MIME check');

      // Oversized file (> 10MB)
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024, 0); // 10MB + 1KB
      Buffer.from('%PDF-1.4\n').copy(largeBuffer);
      const largeUpload = await uploadFileRequest('huge.pdf', largeBuffer, 'application/pdf', user1Token);
      assert(largeUpload.status === 400, 'Oversized file (>10MB) rejected by server');

      // ----------------------------------------------------
      // TEST 4: Document Ownership & Access Control
      // ----------------------------------------------------
      console.log('\n--- 4. ACCESS CONTROL: DOCUMENT AUTHORIZATION ---');

      // Authenticate User 2
      const user2Phone = '+97250' + testRunId + '2';
      await makeRequest('POST', '/api/users/request-otp', { phoneNumber: user2Phone });
      const user2Auth = await makeRequest('POST', '/api/users/verify-otp', {
        phoneNumber: user2Phone,
        code: '123456',
      });
      const user2Token = user2Auth.data.token;
      const user2 = user2Auth.data.user;

      // User 1 accessing own document
      const user1AccessRes = await makeRequest('GET', `/api/uploads/${user1PdfFilename}`, null, {
        Authorization: `Bearer ${user1Token}`,
      });
      assert(user1AccessRes.status === 200, 'User 1 successfully downloads their own document');

      // User 2 attempting to access User 1's document (unauthorized attempt)
      const user2AccessRes = await makeRequest('GET', `/api/uploads/${user1PdfFilename}`, null, {
        Authorization: `Bearer ${user2Token}`,
      });
      assert(user2AccessRes.status === 403, "User 2 accessing User 1's document is rejected with 403 Forbidden");

      // Staff role accessing User 1's document for credit review
      const staffTokenRes = await makeRequest('POST', '/api/auth/staff-token', { role: 'credit_reviewer' });
      const staffToken = staffTokenRes.data?.token;
      const staffAccessRes = await makeRequest('GET', `/api/uploads/${user1PdfFilename}`, null, {
        Authorization: `Bearer ${staffToken}`,
      });
      assert(staffAccessRes.status === 200, 'Credit reviewer staff role authorized to view applicant document');

      // ----------------------------------------------------
      // TEST 5: Complete & Submit First Loan Application
      // ----------------------------------------------------
      console.log('\n--- 5. SUBMITTING APPLICATION WITH BANK ACCOUNT & GUARANTOR ---');

      app1.borrowerDetails = {
        fullName: 'Somchai Prasert',
        passportNumber: 'AA1234567',
        countryOfOrigin: 'Thailand',
        dateOfBirth: '1990-05-15',
        gender: 'Male',
        mobilePhoneNumber: newUserPhone,
        addressCity: 'Tel Aviv',
        addressFull: 'Herzl St 15, Tel Aviv',
      };
      app1.residencyDetails = {
        visaType: 'b1_agri', // the code, as the app stores it (not the display label)
        visaExpiryDate: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0], // 1 year validity
        dateOfEntry: '2022-01-10',
        yearsOfResidency: 3,
      };
      app1.employmentDetails = {
        employerName: 'Arava Farms Ltd',
        jobTenureMonths: 24,
        monthlySalaryNis: 7500,
        salaryPaymentMethod: 'Bank transfer',
      };
      app1.bankAccount = {
        bankName: 'Bank Hapoalim',
        bankCode: '12',
        branchNumber: '543',
        accountNumber: '9876543',
        accountHolderName: 'Somchai Prasert',
      };
      app1.loanRequest = {
        requestedAmountNis: 5000,
        repaymentPeriodMonths: 6,
        loanPurpose: 'Cash Flow',
        repaymentSource: 'Bank transfer',
        estimatedMonthlyPaymentNis: 880,
        totalRepaymentNis: 5280,
      };
      app1.guarantor = {
        hasGuarantor: false,
      };
      app1.documents = [
        {
          id: 'doc_passport_1',
          documentTypeCode: 'PASSPORT',
          originalFilename: 'passport.jpg',
          fileUrl: `/api/uploads/${jpgUpload.data.file.filename}`,
          mimeType: 'image/jpeg',
          fileSizeBytes: 120000,
          qualityStatus: 'passed',
          uploadedAt: new Date().toISOString(),
        },
        {
          id: 'doc_payslip_1',
          documentTypeCode: 'PAY_SLIP',
          originalFilename: 'payslip.pdf',
          fileUrl: `/api/uploads/${user1PdfFilename}`,
          mimeType: 'application/pdf',
          fileSizeBytes: 200000,
          qualityStatus: 'passed',
          uploadedAt: new Date().toISOString(), // recent payslip
        },
        {
          id: 'doc_bank_1',
          documentTypeCode: 'BANK_ACCOUNT_DOCUMENT',
          originalFilename: 'bank_cheque.png',
          fileUrl: `/api/uploads/${pngUpload.data.file.filename}`,
          mimeType: 'image/png',
          fileSizeBytes: 150000,
          qualityStatus: 'passed',
          uploadedAt: new Date().toISOString(),
        },
      ];
      app1.isSubmitted = true;
      app1.status = 'Received';
      app1.requestNumber = 'REQ-2026-100001';

      const saveApp1Res = await makeRequest('PUT', `/api/applications/${app1.id}`, app1, {
        Authorization: `Bearer ${user1Token}`,
      });
      assert(saveApp1Res.status === 200, 'First application successfully saved and submitted to database');

      // ----------------------------------------------------
      // TEST 6: Returning User Flow & Profile Prefill
      // ----------------------------------------------------
      console.log('\n--- 6. RETURNING USER DETECTION & PROFILE PREFILL ---');

      const returningUserAppRes = await makeRequest('GET', `/api/applications/active/${user1.id}`, null, {
        Authorization: `Bearer ${user1Token}`,
      });
      assert(returningUserAppRes.status === 200, 'Active application endpoint returned new draft for returning user');
      const returningDraft = returningUserAppRes.data.application;

      assert(returningDraft.isReturningUser === true, 'Application correctly flagged as isReturningUser: true');
      assert(returningDraft.id !== app1.id, 'New draft has distinct unique application ID (does not overwrite history)');
      assert(returningDraft.requestNumber !== app1.requestNumber, 'New draft has distinct new request number');
      assert(returningDraft.borrowerDetails?.fullName === 'Somchai Prasert', 'Borrower profile prefilled from previous record');
      assert(returningDraft.employmentDetails?.employerName === 'Arava Farms Ltd', 'Employer name prefilled from previous record');
      assert(returningDraft.employmentDetails?.monthlySalaryNis === 7500, 'Monthly salary prefilled from previous record');
      assert(returningDraft.bankAccount?.bankName === 'Bank Hapoalim', 'Bank details prefilled from previous record');
      assert(returningDraft.bankAccount?.accountNumber === '9876543', 'Bank account number prefilled correctly');

      // Check reused documents
      const reusedDocs = returningDraft.documents || [];
      const reusedPassport = reusedDocs.find((d) => d.documentTypeCode === 'PASSPORT');
      assert(reusedPassport && reusedPassport.isReused, 'Valid passport automatically reused with isReused: true');
      const reusedBank = reusedDocs.find((d) => d.documentTypeCode === 'BANK_ACCOUNT_DOCUMENT');
      assert(reusedBank && reusedBank.isReused, 'Valid bank account document automatically reused');

      // ----------------------------------------------------
      // TEST 7: Expired / Outdated Document Handling
      // ----------------------------------------------------
      console.log('\n--- 7. EXPIRED / OUTDATED DOCUMENT DETECTION ---');

      // Submit an application for user 2 with an expired visa and outdated payslip (120 days old)
      const oldApp = {
        ...app1,
        id: 'app_old_test',
        userId: user2.id,
        requestNumber: 'REQ-2025-000001',
        isSubmitted: true,
        submittedAt: new Date(Date.now() - 120 * 86400000).toISOString(),
        residencyDetails: {
          ...app1.residencyDetails,
          visaExpiryDate: '2024-01-01', // Expired in the past!
        },
        documents: [
          {
            id: 'doc_old_slip',
            documentTypeCode: 'PAY_SLIP',
            originalFilename: 'old_slip.pdf',
            fileUrl: `/api/uploads/${user1PdfFilename}`,
            mimeType: 'application/pdf',
            fileSizeBytes: 100000,
            qualityStatus: 'passed',
            uploadedAt: new Date(Date.now() - 120 * 86400000).toISOString(), // 120 days old (>90 days limit)
          },
        ],
      };
      await makeRequest('PUT', `/api/applications/${oldApp.id}`, oldApp, {
        Authorization: `Bearer ${user2Token}`,
      });

      const user2DraftRes = await makeRequest('GET', `/api/applications/active/${user2.id}`, null, {
        Authorization: `Bearer ${user2Token}`,
      });
      const user2DraftDocs = user2DraftRes.data.application?.documents || [];
      const user2ReusedPayslip = user2DraftDocs.find((d) => d.documentTypeCode === 'PAY_SLIP');
      assert(!user2ReusedPayslip, 'Outdated payslip (>90 days old) was NOT reused, requiring applicant to upload fresh payslip');

      // ----------------------------------------------------
      // TEST 8: Returning User Detail Changes (Employer & Salary)
      // ----------------------------------------------------
      console.log('\n--- 8. RETURNING USER DETAILS UPDATE (EMPLOYER & SALARY) ---');

      returningDraft.employmentDetails.employerName = 'Galilee Agro Industries';
      returningDraft.employmentDetails.monthlySalaryNis = 8200;
      returningDraft.loanRequest = {
        requestedAmountNis: 7000,
        repaymentPeriodMonths: 8,
        loanPurpose: 'Equipment',
        repaymentSource: 'Bank transfer',
        estimatedMonthlyPaymentNis: 990,
        totalRepaymentNis: 7920,
      };
      returningDraft.guarantor = {
        hasGuarantor: true,
        fullName: 'David Cohen',
        passportOrIdNumber: '023456789',
        mobilePhoneNumber: '+972528889900',
        relationship: 'Co-worker',
      };
      returningDraft.isSubmitted = true;
      returningDraft.status = 'Received';

      const saveSecondAppRes = await makeRequest('PUT', `/api/applications/${returningDraft.id}`, returningDraft, {
        Authorization: `Bearer ${user1Token}`,
      });
      assert(saveSecondAppRes.status === 200, 'Second loan application successfully saved');

      // Verify both applications exist in history independently
      const user1HistoryRes = await makeRequest('GET', `/api/applications/history/${user1.id}`, null, {
        Authorization: `Bearer ${user1Token}`,
      });
      const user1Apps = user1HistoryRes.data.applications || [];
      assert(user1HistoryRes.status === 200 && user1Apps.length === 2, 'User now has 2 distinct applications in history');
      const firstAppInDb = user1Apps.find((a) => a.id === app1.id);
      const secondAppInDb = user1Apps.find((a) => a.id === returningDraft.id);
      assert(firstAppInDb && firstAppInDb.employmentDetails.employerName === 'Arava Farms Ltd', 'First historical application employer preserved (Arava Farms Ltd)');
      assert(secondAppInDb && secondAppInDb.employmentDetails.employerName === 'Galilee Agro Industries', 'Second application has updated employer (Galilee Agro Industries)');

      // ----------------------------------------------------
      // TEST 9: PDF Summary Generation with Bank Account
      // ----------------------------------------------------
      console.log('\n--- 9. PDF SUMMARY GENERATION ---');
      try {
        const { streamApplicationPdf } = require('@quickloan/backend-core/services/pdfService');
        const stream = require('stream');
        const pass = new stream.PassThrough();
        const chunks = [];
        pass.on('data', (c) => chunks.push(c));
        const pdfPromise = new Promise((resolve, reject) => {
          pass.on('end', () => resolve(Buffer.concat(chunks)));
          pass.on('error', reject);
        });
        streamApplicationPdf(returningDraft, pass);
        const pdfBuffer = await pdfPromise;
        assert(pdfBuffer && pdfBuffer.length > 500, `PDF summary generated successfully (${pdfBuffer.length} bytes) with bank account and guarantor`);
      } catch (pdfErr) {
        assert(false, `PDF summary generation threw error: ${pdfErr.message}`);
      }

      console.log('\n====================================================');
      console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
      console.log('====================================================\n');
    } catch (err) {
      console.error('Unhandled test runner error:', err);
    } finally {
      server.close();
      process.exit(failed === 0 ? 0 : 1);
    }
  });
}

runTests();
