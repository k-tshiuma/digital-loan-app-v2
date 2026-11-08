const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const app = require('./server');

const TEST_PORT = 5004;
let server;

function makeRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
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
            resolve({ status: res.statusCode, data: JSON.parse(data) });
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
  console.log('================================================================');
  console.log('🧪 RUNNING LOGGED-IN USER PREFILL & DOCUMENT REUSE TEST SUITE');
  console.log('================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passedCount++;
    } catch (e) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${e.message}`);
      failedCount++;
    }
  }

  // Generate unique test phone numbers to isolate run
  const phoneA = `+97250${Math.floor(1000000 + Math.random() * 9000000)}`;
  const phoneB = `+97250${Math.floor(1000000 + Math.random() * 9000000)}`;

  let tokenA, userA, draftIdA;
  let tokenB, userB;
  let passportDocA, bankDocA;

  // 1. New User A Registration
  console.log('--- 1. NEW USER REGISTRATION & INITIAL DRAFT ---');
  await test('User A requests OTP and logs in', async () => {
    await makeRequest('POST', '/api/users/request-otp', { phoneNumber: phoneA });
    const res = await makeRequest('POST', '/api/users/verify-otp', { phoneNumber: phoneA, code: '123456' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.token);
    tokenA = res.data.token;
    userA = res.data.user;
  });

  await test('User A active draft shows clean form without returning user flags', async () => {
    const res = await makeRequest('GET', `/api/applications/active/${userA.id}`, null, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert.strictEqual(res.status, 200);
    const app = res.data.application;
    draftIdA = app.id;
    assert.strictEqual(res.data.isReturningUser, false, 'New user should not be marked as returning');
    assert.strictEqual(app.documents.length, 0, 'New user starts with 0 documents');
    assert.ok(!app.borrowerDetails || !app.borrowerDetails.passportNumber, 'Passport number should not be prefilled yet');
  });

  // 2. Upload initial documents and save details for User A
  console.log('\n--- 2. USER A PROVIDES DETAILS & UPLOADS DOCUMENTS ---');
  await test('User A uploads Passport and Bank document', async () => {
    const passBuf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const passRes = await uploadFileRequest('passport_usera.pdf', passBuf, 'application/pdf', tokenA);
    assert.strictEqual(passRes.status, 200);
    passportDocA = passRes.data.file;

    const bankBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const bankRes = await uploadFileRequest('bank_usera.png', bankBuf, 'image/png', tokenA);
    assert.strictEqual(bankRes.status, 200);
    bankDocA = bankRes.data.file;
  });

  await test('User A saves and submits complete application', async () => {
    const payload = {
      isSubmitted: true,
      borrowerDetails: {
        fullName: 'Kovit Prasert',
        passportNumber: 'TH7766554',
        countryOfOrigin: 'Thailand',
        dateOfBirth: '1992-04-12',
        mobilePhoneNumber: phoneA,
        addressCity: 'Hadera',
        addressStreet: 'HaShalom 15',
        addressFull: 'HaShalom 15, Hadera, Israel',
        maritalStatus: 'Married',
      },
      residencyDetails: {
        visaType: 'b1_agri',
        visaExpiryDate: '2028-05-20',
        dateOfEntry: '2022-01-10',
        yearsOfResidency: 4.5,
      },
      employmentDetails: {
        employerName: 'Sharon Citrus Groves Ltd',
        jobTenureMonths: 36,
        monthlySalaryNis: 8400,
        salaryPaymentMethod: 'Bank Transfer',
      },
      bankAccount: {
        bankName: 'Bank Hapoalim',
        branchNumber: '612',
        accountNumber: '445566',
        accountHolderName: 'Kovit Prasert',
      },
      bankAccountConfirmed: true,
      guarantors: [
        {
          id: 'g_1',
          fullName: 'Anan Suk',
          passportOrIdNumber: 'TH9911223',
          mobilePhoneNumber: '+972509988112',
          relationship: 'Co-worker',
        },
      ],
      documents: [
        {
          id: 'doc_pass_1',
          documentTypeCode: 'PASSPORT',
          originalFilename: passportDocA.originalName,
          fileUrl: passportDocA.url,
          qualityStatus: 'passed',
        },
        {
          id: 'doc_bank_1',
          documentTypeCode: 'BANK_ACCOUNT_DOCUMENT',
          originalFilename: bankDocA.originalName,
          fileUrl: bankDocA.url,
          qualityStatus: 'passed',
        },
      ],
    };

    const res = await makeRequest('PUT', `/api/applications/${draftIdA}`, payload, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.application.isSubmitted, true);
  });

  // 3. User A returns for a subsequent application
  console.log('\n--- 3. USER A RETURNS: AUTOMATIC PRE-POPULATION ---');
  let newDraftA;
  await test('User A requests active application and automatically receives pre-filled draft', async () => {
    const res = await makeRequest('GET', `/api/applications/active/${userA.id}`, null, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.isReturningUser, true, 'User A recognized as returning user');

    newDraftA = res.data.application;
    assert.ok(newDraftA.id !== draftIdA, 'New draft has unique distinct application ID');
    assert.strictEqual(newDraftA.isSubmitted, false, 'New application is unsubmitted draft');

    // Verify personal information pre-filled
    assert.strictEqual(newDraftA.borrowerDetails.fullName, 'Kovit Prasert', 'Full name prefilled');
    assert.strictEqual(newDraftA.borrowerDetails.passportNumber, 'TH7766554', 'Passport number prefilled');
    assert.strictEqual(newDraftA.borrowerDetails.countryOfOrigin, 'Thailand', 'Country prefilled');
    assert.strictEqual(newDraftA.borrowerDetails.addressCity, 'Hadera', 'Address city prefilled');

    // Verify residency pre-filled
    assert.strictEqual(newDraftA.residencyDetails.visaType, 'b1_agri');
    assert.strictEqual(newDraftA.residencyDetails.visaExpiryDate, '2028-05-20');

    // Verify employment pre-filled
    assert.strictEqual(newDraftA.employmentDetails.employerName, 'Sharon Citrus Groves Ltd');
    assert.strictEqual(newDraftA.employmentDetails.monthlySalaryNis, 8400);

    // Verify bank account pre-filled
    assert.strictEqual(newDraftA.bankAccount.bankName, 'Bank Hapoalim');
    assert.strictEqual(newDraftA.bankAccount.accountNumber, '445566');

    // Verify guarantor pre-filled
    assert.strictEqual(newDraftA.guarantors.length, 1);
    assert.strictEqual(newDraftA.guarantors[0].fullName, 'Anan Suk');

    // Verify documents on file recognized
    assert.ok(newDraftA.documents.length >= 2, 'Documents on file automatically associated');
    const reusedPass = newDraftA.documents.find((d) => d.documentTypeCode === 'PASSPORT');
    const reusedBank = newDraftA.documents.find((d) => d.documentTypeCode === 'BANK_ACCOUNT_DOCUMENT');
    assert.ok(reusedPass && reusedPass.isReused, 'Passport recognized as reused');
    assert.ok(reusedBank && reusedBank.isReused, 'Bank document recognized as reused');
  });

  // 4. User Control: Edit pre-filled fields & replace document
  console.log('\n--- 4. USER CONTROL: EDIT PRE-FILLED FIELDS & REPLACE DOCUMENTS ---');
  await test('User A edits employer and replaces passport document', async () => {
    // Upload replacement passport document
    const newPassBuf = Buffer.from('%PDF-1.5\n2 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const newPassRes = await uploadFileRequest('new_renewed_passport.pdf', newPassBuf, 'application/pdf', tokenA);
    assert.strictEqual(newPassRes.status, 200);

    const updatedDocs = [
      {
        id: 'doc_new_pass',
        documentTypeCode: 'PASSPORT',
        originalFilename: newPassRes.data.file.originalName,
        fileUrl: newPassRes.data.file.url,
        isReused: false,
        qualityStatus: 'passed',
      },
      ...newDraftA.documents.filter((d) => d.documentTypeCode !== 'PASSPORT'),
    ];

    const updatePayload = {
      ...newDraftA,
      employmentDetails: {
        ...newDraftA.employmentDetails,
        employerName: 'Emek Hefer Packing House',
        monthlySalaryNis: 9200,
      },
      documents: updatedDocs,
    };

    const saveRes = await makeRequest('PUT', `/api/applications/${newDraftA.id}`, updatePayload, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert.strictEqual(saveRes.status, 200);
    const saved = saveRes.data.application;

    assert.strictEqual(saved.employmentDetails.employerName, 'Emek Hefer Packing House', 'Employer name updated');
    assert.strictEqual(saved.employmentDetails.monthlySalaryNis, 9200, 'Salary updated');
    const currentPass = saved.documents.find((d) => d.documentTypeCode === 'PASSPORT');
    assert.strictEqual(currentPass.originalFilename, 'new_renewed_passport.pdf', 'Document successfully replaced');
  });

  // 5. User Isolation: Verify User B cannot access User A's data or documents
  console.log('\n--- 5. DATA ISOLATION: USER PRIVACY & ZERO CROSS-CONTAMINATION ---');
  await test('User B registers and receives fresh clean profile', async () => {
    await makeRequest('POST', '/api/users/request-otp', { phoneNumber: phoneB });
    const res = await makeRequest('POST', '/api/users/verify-otp', { phoneNumber: phoneB, code: '123456' });
    assert.strictEqual(res.status, 200);
    tokenB = res.data.token;
    userB = res.data.user;

    const draftRes = await makeRequest('GET', `/api/applications/active/${userB.id}`, null, {
      Authorization: `Bearer ${tokenB}`,
    });
    assert.strictEqual(draftRes.status, 200);
    assert.strictEqual(draftRes.data.isReturningUser, false, 'User B has no prior profile');
    assert.strictEqual(draftRes.data.application.documents.length, 0, 'User B has zero documents');
    assert.ok(!draftRes.data.application.borrowerDetails?.passportNumber, 'No cross contamination from User A');
    assert.strictEqual(draftRes.data.application.borrowerDetails?.countryOfOrigin, '', 'New user countryOfOrigin must be empty rather than defaulting to Thailand');
  });

  await test('User B attempting to access User A document is rejected with 403 Forbidden', async () => {
    const filename = path.basename(passportDocA.url);
    const fileRes = await makeRequest('GET', `/api/uploads/${filename}`, null, {
      Authorization: `Bearer ${tokenB}`,
    });
    assert.strictEqual(fileRes.status, 403, 'Expected 403 Forbidden when accessing another user file');
  });

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passedCount + failedCount} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Start server on test port and run
server = app.listen(TEST_PORT, async () => {
  try {
    await runTests();
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    server.close();
  }
});
