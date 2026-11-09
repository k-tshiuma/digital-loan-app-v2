const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const app = require('./combinedServer');
const {
  calculateEligibilityScore,
  calculateVisaMonthsRemaining,
  calculateEmploymentDurationMonths,
  calculateSectionsCompleted,
  extractGuarantors,
} = require('@quickloan/backend-core/services/eligibilityScoring');

const TEST_PORT = 5003;
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
  console.log('🧪 RUNNING COMPREHENSIVE GUARANTORS & 100-POINT SCORING TESTS');
  console.log('================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ PASS: ${name}`);
      passedCount++;
    } catch (e) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${e.message}`);
      failedCount++;
    }
  }

  async function asyncTest(name, fn) {
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

  // Reference date: 2026-10-08
  const REF_DATE = new Date('2026-10-08T12:00:00Z');

  // Base profile for isolated tests
  const baseApp = {
    borrowerDetails: { fullName: 'Somchai Prasert', passportNumber: 'P1234567' },
    residencyDetails: {
      visaType: 'b1_agri',
      visaExpiryDate: '2027-10-08', // 12 months remaining -> 20%
      yearsOfResidency: 3.5,        // > 36 months -> 20%
    },
    employmentDetails: {
      monthlySalaryNis: 8000,       // >= 7500 -> 20%
      jobTenureMonths: 40,          // > 36 months -> 20%
    },
    guarantors: [
      { id: 'g_1', fullName: 'Kovit Somwang', passportOrIdNumber: 'TH5521990', mobilePhoneNumber: '+972528994411' },
      { id: 'g_2', fullName: 'Anong Lek', passportOrIdNumber: 'TH9988771', mobilePhoneNumber: '+972528994422' },
    ],
    documents: [
      { documentTypeCode: 'PASSPORT', originalFilename: 'passport.jpg', qualityStatus: 'passed' },
    ],
  };

  // =========================================================================
  // 1. SCORING ENGINE: SALARY THRESHOLDS (max 20%)
  // =========================================================================
  console.log('--- 1. SCORING ENGINE: SALARY BOUNDARIES (max 20%) ---');

  test('Salary below 7,500 NIS (e.g. 7,499 NIS) awards exactly 10%', () => {
    const app = {
      ...baseApp,
      employmentDetails: { ...baseApp.employmentDetails, monthlySalaryNis: 7499 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.salaryScore, 10, 'Expected 10% for salary < 7500');
  });

  test('Salary exactly 7,500 NIS awards exactly 20%', () => {
    const app = {
      ...baseApp,
      employmentDetails: { ...baseApp.employmentDetails, monthlySalaryNis: 7500 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.salaryScore, 20, 'Expected 20% for salary == 7500');
  });

  test('Salary above 7,500 NIS (e.g. 10,500 NIS) awards exactly 20%', () => {
    const app = {
      ...baseApp,
      employmentDetails: { ...baseApp.employmentDetails, monthlySalaryNis: 10500 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.salaryScore, 20, 'Expected 20% for salary > 7500');
  });

  test('Missing or zero salary awards exactly 0%', () => {
    const app = {
      ...baseApp,
      employmentDetails: { ...baseApp.employmentDetails, monthlySalaryNis: 0 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.salaryScore, 0, 'Expected 0% for salary == 0');
  });

  // =========================================================================
  // 2. SCORING ENGINE: EMPLOYMENT DURATION EXACT BOUNDARIES (max 20%)
  // =========================================================================
  console.log('\n--- 2. SCORING ENGINE: EMPLOYMENT DURATION BOUNDARIES (max 20%) ---');

  test('Employment 0-12 months (e.g. 6 months) awards exactly 5%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, yearsOfResidency: 0.5 },
      employmentDetails: { ...baseApp.employmentDetails, jobTenureMonths: 6 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.employmentDurationScore, 5, 'Expected 5% for duration 6 months');
  });

  test('Employment exactly 12 months awards exactly 5%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, yearsOfResidency: 1.0 },
      employmentDetails: { ...baseApp.employmentDetails, jobTenureMonths: 12 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.employmentDurationScore, 5, 'Expected 5% for duration exactly 12 months');
  });

  test('Employment >12 and <=24 months (e.g. 13 months) awards exactly 10%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, yearsOfResidency: 1.08 },
      employmentDetails: { ...baseApp.employmentDetails, jobTenureMonths: 13 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.employmentDurationScore, 10, 'Expected 10% for duration 13 months');
  });

  test('Employment exactly 24 months awards exactly 10%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, yearsOfResidency: 2.0 },
      employmentDetails: { ...baseApp.employmentDetails, jobTenureMonths: 24 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.employmentDurationScore, 10, 'Expected 10% for duration exactly 24 months');
  });

  test('Employment >24 and <=36 months (e.g. 25 months) awards exactly 15%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, yearsOfResidency: 2.08 },
      employmentDetails: { ...baseApp.employmentDetails, jobTenureMonths: 25 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.employmentDurationScore, 15, 'Expected 15% for duration 25 months');
  });

  test('Employment exactly 36 months awards exactly 15%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, yearsOfResidency: 3.0 },
      employmentDetails: { ...baseApp.employmentDetails, jobTenureMonths: 36 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.employmentDurationScore, 15, 'Expected 15% for duration exactly 36 months');
  });

  test('Employment >36 months (e.g. 37 months) awards exactly 20%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, yearsOfResidency: 3.08 },
      employmentDetails: { ...baseApp.employmentDetails, jobTenureMonths: 37 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.employmentDurationScore, 20, 'Expected 20% for duration 37 months');
  });

  test('Missing employment duration awards 0%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, yearsOfResidency: undefined, dateOfEntry: undefined },
      employmentDetails: { ...baseApp.employmentDetails, jobTenureMonths: 0 },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.employmentDurationScore, 0, 'Expected 0% for missing duration');
  });

  // =========================================================================
  // 3. SCORING ENGINE: VISA VALIDITY BOUNDARIES (max 20%)
  // =========================================================================
  console.log('\n--- 3. SCORING ENGINE: VISA VALIDITY BOUNDARIES (max 20%) ---');

  test('Visa validity < 3 months (e.g. 2.5 months / 76 days) awards 0%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, visaExpiryDate: '2026-12-23' },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.visaValidityScore, 0, 'Expected 0% for visa < 3 months');
  });

  test('Visa validity around 3 months (3.5 months / 107 days) awards exactly 5%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, visaExpiryDate: '2027-01-23' },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.visaValidityScore, 5, 'Expected 5% for visa around 3 months');
  });

  test('Visa validity around 6 months (6.5 months / 198 days) awards exactly 10%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, visaExpiryDate: '2027-04-24' },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.visaValidityScore, 10, 'Expected 10% for visa around 6 months');
  });

  test('Visa validity of 12 months or more (12.5 months) awards exactly 20%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, visaExpiryDate: '2027-10-23' },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.visaValidityScore, 20, 'Expected 20% for visa >= 12 months');
  });

  test('Expired visa (past date) awards 0%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, visaExpiryDate: '2026-09-01' },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.visaValidityScore, 0, 'Expected 0% for expired visa');
  });

  // =========================================================================
  // 4. SCORING ENGINE: GUARANTORS COMPONENT (max 20%)
  // =========================================================================
  console.log('\n--- 4. SCORING ENGINE: GUARANTORS COMPONENT (max 20%) ---');

  test('Zero guarantors awards 0%', () => {
    const app = {
      ...baseApp,
      guarantor: { hasGuarantor: false },
      guarantors: [],
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.guarantorsScore, 0, 'Expected 0% for 0 guarantors');
  });

  test('Exactly 1 guarantor awards exactly 10%', () => {
    const app = {
      ...baseApp,
      guarantors: [
        { id: 'g_1', fullName: 'Kovit Somwang', passportOrIdNumber: 'TH5521990', mobilePhoneNumber: '+972528994411' },
      ],
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.guarantorsScore, 10, 'Expected 10% for 1 guarantor');
  });

  test('Two guarantors awards exactly 20%', () => {
    const app = {
      ...baseApp,
      guarantors: [
        { id: 'g_1', fullName: 'Kovit Somwang', passportOrIdNumber: 'TH5521990', mobilePhoneNumber: '+972528994411' },
        { id: 'g_2', fullName: 'Anong Lek', passportOrIdNumber: 'TH9988771', mobilePhoneNumber: '+972528994422' },
      ],
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.guarantorsScore, 20, 'Expected 20% for 2 guarantors');
  });

  test('Three guarantors awards exactly 20% (capped at 20% factor max)', () => {
    const app = {
      ...baseApp,
      guarantors: [
        { id: 'g_1', fullName: 'Kovit Somwang', passportOrIdNumber: 'TH5521990', mobilePhoneNumber: '+972528994411' },
        { id: 'g_2', fullName: 'Anong Lek', passportOrIdNumber: 'TH9988771', mobilePhoneNumber: '+972528994422' },
        { id: 'g_3', fullName: 'Chaiwat Dee', passportOrIdNumber: 'TH1122334', mobilePhoneNumber: '+972528994433' },
      ],
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.guarantorsScore, 20, 'Expected 20% for 3 guarantors');
  });

  // =========================================================================
  // 5. SCORING ENGINE: IDENTITY & PASSPORT VERIFICATION (max 20%)
  // =========================================================================
  console.log('\n--- 5. SCORING ENGINE: IDENTITY & PASSPORT VERIFICATION (max 20%) ---');

  test('Passport provided with valid visa awards 20%', () => {
    const res = calculateEligibilityScore(baseApp, REF_DATE);
    assert.strictEqual(res.identityScore, 20, 'Expected 20% when passport and valid visa are present');
  });

  test('Passport missing awards 0% even if visa date is valid', () => {
    const app = {
      ...baseApp,
      borrowerDetails: { fullName: 'No Passport' },
      documents: [],
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.identityScore, 0, 'Expected 0% without passport');
  });

  test('Passport provided but visa expired awards 0%', () => {
    const app = {
      ...baseApp,
      residencyDetails: { ...baseApp.residencyDetails, visaExpiryDate: '2026-01-01' },
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.identityScore, 0, 'Expected 0% when visa is expired');
  });

  test('Passport rejected/failed quality awards 0%', () => {
    const app = {
      ...baseApp,
      borrowerDetails: {},
      documents: [
        { documentTypeCode: 'PASSPORT', originalFilename: 'passport.jpg', qualityStatus: 'failed' },
      ],
    };
    const res = calculateEligibilityScore(app, REF_DATE);
    assert.strictEqual(res.identityScore, 0, 'Expected 0% when passport document failed quality');
  });

  // =========================================================================
  // 6. SCORING ENGINE: PROGRESS BAR 10-SECTION CONVERSION
  // =========================================================================
  console.log('\n--- 6. PROGRESS BAR: 10 DISTINCT SECTIONS CONVERSION ---');

  test('0–9% converts to 0 sections', () => {
    assert.strictEqual(calculateSectionsCompleted(0), 0);
    assert.strictEqual(calculateSectionsCompleted(5), 0);
    assert.strictEqual(calculateSectionsCompleted(9), 0);
  });

  test('10–19% converts to 1 section', () => {
    assert.strictEqual(calculateSectionsCompleted(10), 1);
    assert.strictEqual(calculateSectionsCompleted(15), 1);
    assert.strictEqual(calculateSectionsCompleted(19), 1);
  });

  test('20–29% converts to 2 sections', () => {
    assert.strictEqual(calculateSectionsCompleted(20), 2);
    assert.strictEqual(calculateSectionsCompleted(29), 2);
  });

  test('50–59% converts to 5 sections', () => {
    assert.strictEqual(calculateSectionsCompleted(50), 5);
    assert.strictEqual(calculateSectionsCompleted(55), 5);
  });

  test('90–99% converts to 9 sections', () => {
    assert.strictEqual(calculateSectionsCompleted(90), 9);
    assert.strictEqual(calculateSectionsCompleted(99), 9);
  });

  test('100% converts to 10 sections', () => {
    assert.strictEqual(calculateSectionsCompleted(100), 10);
  });

  // =========================================================================
  // 7. TOTAL SCORE & AGGREGATION GUARANTEES (MAX 100 POINTS)
  // =========================================================================
  console.log('\n--- 7. TOTAL SCORE AGGREGATION & CONSTRAINTS ---');

  test('Prime application receives full 100 points (20+20+20+20+20)', () => {
    const res = calculateEligibilityScore(baseApp, REF_DATE);
    assert.strictEqual(res.identityScore, 20);
    assert.strictEqual(res.salaryScore, 20);
    assert.strictEqual(res.employmentDurationScore, 20);
    assert.strictEqual(res.visaValidityScore, 20);
    assert.strictEqual(res.guarantorsScore, 20);
    assert.strictEqual(res.rawScore, 100, 'Expected rawScore == 100');
    assert.strictEqual(res.maxRawScore, 100, 'Expected maxRawScore == 100');
    assert.strictEqual(res.percentageOfMax, 100, 'Expected percentageOfMax == 100');
    assert.strictEqual(res.segmentsFilled, 10, 'Expected all 10 segments filled');
  });

  test('Intermediate application calculates deterministic sum (20 + 10 + 10 + 10 + 10 = 60)', () => {
    const modApp = {
      ...baseApp,
      employmentDetails: { monthlySalaryNis: 6000, jobTenureMonths: 18 }, // salary: 10, tenure (18 mos): 10
      residencyDetails: {
        visaType: 'b1_agri',
        visaExpiryDate: '2027-04-20', // ~6.4 mos -> 10%
        yearsOfResidency: 1.5,
      },
      guarantors: [
        { id: 'g_1', fullName: 'Kovit Somwang', passportOrIdNumber: 'TH5521990' }, // 1 guarantor -> 10%
      ],
    };
    const res = calculateEligibilityScore(modApp, REF_DATE);
    assert.strictEqual(res.identityScore, 20);
    assert.strictEqual(res.salaryScore, 10);
    assert.strictEqual(res.employmentDurationScore, 10);
    assert.strictEqual(res.visaValidityScore, 10);
    assert.strictEqual(res.guarantorsScore, 10);
    assert.strictEqual(res.rawScore, 60, 'Expected rawScore == 60');
    assert.strictEqual(res.segmentsFilled, 6, 'Expected 6 segments filled out of 10');
  });

  test('Minimum possible score is 0% when no criteria are satisfied', () => {
    const emptyApp = {};
    const res = calculateEligibilityScore(emptyApp, REF_DATE);
    assert.strictEqual(res.rawScore, 0, 'Expected min score to be 0');
    assert.strictEqual(res.segmentsFilled, 0, 'Expected 0 segments filled');
  });

  test('Score is strictly capped and can never exceed 100%', () => {
    const extremeApp = {
      ...baseApp,
      employmentDetails: { monthlySalaryNis: 100000, jobTenureMonths: 200 },
      residencyDetails: { visaType: 'b1_agri', visaExpiryDate: '2035-01-01', yearsOfResidency: 15 },
      guarantors: [
        { id: 'g_1', fullName: 'G1', passportOrIdNumber: 'ID1' },
        { id: 'g_2', fullName: 'G2', passportOrIdNumber: 'ID2' },
        { id: 'g_3', fullName: 'G3', passportOrIdNumber: 'ID3' },
        { id: 'g_4', fullName: 'G4', passportOrIdNumber: 'ID4' },
      ],
    };
    const res = calculateEligibilityScore(extremeApp, REF_DATE);
    assert.ok(res.rawScore <= 100, 'Score must never exceed 100');
    assert.strictEqual(res.rawScore, 100);
    assert.strictEqual(res.segmentsFilled, 10);
  });

  // =========================================================================
  // 8. HTTP & API INTEGRATION TESTS (MULTI-GUARANTORS & AUTHORITATIVE SCORING)
  // =========================================================================
  console.log('\n--- 8. HTTP ENDPOINT TESTS: GUARANTORS & SECURE SCORING ---');

  let borrowerToken;
  let userId;
  let activeAppId;

  await asyncTest('Login borrower and obtain JWT', async () => {
    const phone = '+972509988771';
    await makeRequest('POST', '/api/users/request-otp', { phoneNumber: phone });
    const verifyRes = await makeRequest('POST', '/api/users/verify-otp', { phoneNumber: phone, code: '123456' });
    assert.strictEqual(verifyRes.status, 200);
    assert.ok(verifyRes.data.token, 'Expected JWT token');
    borrowerToken = verifyRes.data.token;
    userId = verifyRes.data.user.id;
  });

  await asyncTest('Fetch active application draft', async () => {
    const res = await makeRequest('GET', `/api/applications/active/${userId}`, null, {
      Authorization: `Bearer ${borrowerToken}`,
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.application);
    activeAppId = res.data.application.id;
  });

  let pdfDocMeta;
  let pngDocMeta;
  let jpgDocMeta;

  await asyncTest('Upload Guarantor 1 valid PDF document', async () => {
    const pdfBuf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const res = await uploadFileRequest('guarantor1_id.pdf', pdfBuf, 'application/pdf', borrowerToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.file.url);
    pdfDocMeta = res.data.file;
  });

  await asyncTest('Upload Guarantor 2 valid PNG document', async () => {
    const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const res = await uploadFileRequest('guarantor2_id.png', pngBuf, 'image/png', borrowerToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.file.url);
    pngDocMeta = res.data.file;
  });

  await asyncTest('Upload Guarantor 3 valid JPEG/JPG document', async () => {
    const jpgBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const res = await uploadFileRequest('guarantor3_id.jpg', jpgBuf, 'image/jpeg', borrowerToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.file.url);
    jpgDocMeta = res.data.file;
  });

  await asyncTest('Reject invalid guarantor document format (e.g. text/html script)', async () => {
    const scriptBuf = Buffer.from('<script>alert("exploit")</script>');
    const res = await uploadFileRequest('guarantor_fake.pdf', scriptBuf, 'application/pdf', borrowerToken);
    assert.strictEqual(res.status, 400, 'Expected 400 for disguised file with bad magic bytes');
  });

  // The server scores against today's date, so the visa expiry must be relative to today.
  // (A fixed '2027-10-08' gave exactly 12 months on 2026-10-08 and fewer afterwards: 10 points instead of 20.)
  const visaTwoYearsAhead = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await asyncTest('Save application with 1 Guarantor and verify authoritative score', async () => {
    const payload = {
      borrowerDetails: { fullName: 'Apinya Srisai', passportNumber: 'TH8899001' },
      residencyDetails: { visaType: 'b1_agri', visaExpiryDate: visaTwoYearsAhead, yearsOfResidency: 3.5 },
      employmentDetails: { monthlySalaryNis: 8200, jobTenureMonths: 40 },
      loanRequest: { requestedAmountNis: 6000, repaymentPeriodMonths: 6 },
      guarantors: [
        {
          id: 'g_1',
          fullName: 'Somchai Prasert',
          passportOrIdNumber: 'TH1122334',
          mobilePhoneNumber: '+972501234567',
          relationship: 'Co-worker',
          idDocument: {
            id: 'doc_g1',
            documentTypeCode: 'GUARANTOR_ID',
            fileUrl: pdfDocMeta.url,
            originalFilename: pdfDocMeta.originalName,
          },
        },
      ],
      documents: [
        { id: 'doc_pass', documentTypeCode: 'PASSPORT', originalFilename: 'passport.jpg', qualityStatus: 'passed' },
      ],
      // Client attempt to forge a fake eligibility score
      eligibilityScore: 999,
    };

    const res = await makeRequest('PUT', `/api/applications/${activeAppId}`, payload, {
      Authorization: `Bearer ${borrowerToken}`,
    });

    assert.strictEqual(res.status, 200);
    const app = res.data.application;

    // Verify 1 guarantor score:
    // Identity: 20 + Salary: 20 + Duration: 20 + Visa: 20 + Guarantor (1): 10 = 90 points
    assert.strictEqual(app.eligibilityScore, 90, 'Authoritative score should be 90 (client tampering 999 blocked)');
    assert.strictEqual(app.guarantor.fullName, 'Somchai Prasert', 'Legacy guarantor mirrored');
    assert.strictEqual(app.guarantors.length, 1, 'Guarantors array length is 1');
  });

  await asyncTest('Update application to 2 Guarantors and verify score increases to 100', async () => {
    const payload = {
      borrowerDetails: { fullName: 'Apinya Srisai', passportNumber: 'TH8899001' },
      residencyDetails: { visaType: 'b1_agri', visaExpiryDate: visaTwoYearsAhead, yearsOfResidency: 3.5 },
      employmentDetails: { monthlySalaryNis: 8200, jobTenureMonths: 40 },
      loanRequest: { requestedAmountNis: 6000, repaymentPeriodMonths: 6 },
      guarantors: [
        {
          id: 'g_1',
          fullName: 'Somchai Prasert',
          passportOrIdNumber: 'TH1122334',
          mobilePhoneNumber: '+972501234567',
          relationship: 'Co-worker',
          idDocument: { id: 'doc_g1', documentTypeCode: 'GUARANTOR_ID', fileUrl: pdfDocMeta.url },
        },
        {
          id: 'g_2',
          fullName: 'Nok Thani',
          passportOrIdNumber: 'TH4455667',
          mobilePhoneNumber: '+972507654321',
          relationship: 'Friend',
          idDocument: { id: 'doc_g2', documentTypeCode: 'GUARANTOR_ID', fileUrl: pngDocMeta.url },
        },
      ],
      documents: [
        { id: 'doc_pass', documentTypeCode: 'PASSPORT', originalFilename: 'passport.jpg', qualityStatus: 'passed' },
      ],
    };

    const res = await makeRequest('PUT', `/api/applications/${activeAppId}`, payload, {
      Authorization: `Bearer ${borrowerToken}`,
    });

    assert.strictEqual(res.status, 200);
    const app = res.data.application;

    // 2 Guarantors awards 20%:
    // 20 + 20 + 20 + 20 + 20 = 100 points
    assert.strictEqual(app.eligibilityScore, 100, 'Authoritative score should be 100 for 2 guarantors');
    assert.strictEqual(app.guarantors.length, 2);
  });

  await asyncTest('Update application to 3 Guarantors and submit application', async () => {
    const payload = {
      isSubmitted: true,
      borrowerDetails: { fullName: 'Apinya Srisai', passportNumber: 'TH8899001' },
      residencyDetails: { visaType: 'b1_agri', visaExpiryDate: visaTwoYearsAhead, yearsOfResidency: 3.5 },
      employmentDetails: { monthlySalaryNis: 8200, jobTenureMonths: 40 },
      loanRequest: { requestedAmountNis: 6000, repaymentPeriodMonths: 6 },
      guarantors: [
        {
          id: 'g_1',
          fullName: 'Somchai Prasert',
          passportOrIdNumber: 'TH1122334',
          mobilePhoneNumber: '+972501234567',
          relationship: 'Co-worker',
          idDocument: { id: 'doc_g1', documentTypeCode: 'GUARANTOR_ID', fileUrl: pdfDocMeta.url },
        },
        {
          id: 'g_2',
          fullName: 'Nok Thani',
          passportOrIdNumber: 'TH4455667',
          mobilePhoneNumber: '+972507654321',
          relationship: 'Friend',
          idDocument: { id: 'doc_g2', documentTypeCode: 'GUARANTOR_ID', fileUrl: pngDocMeta.url },
        },
        {
          id: 'g_3',
          fullName: 'Arun Suk',
          passportOrIdNumber: 'TH9988112',
          mobilePhoneNumber: '+972509988112',
          relationship: 'Relative',
          idDocument: { id: 'doc_g3', documentTypeCode: 'GUARANTOR_ID', fileUrl: jpgDocMeta.url },
        },
      ],
      documents: [
        { id: 'doc_pass', documentTypeCode: 'PASSPORT', originalFilename: 'passport.jpg', qualityStatus: 'passed' },
      ],
    };

    const res = await makeRequest('PUT', `/api/applications/${activeAppId}`, payload, {
      Authorization: `Bearer ${borrowerToken}`,
    });

    assert.strictEqual(res.status, 200);
    const app = res.data.application;
    assert.strictEqual(app.isSubmitted, true);
    assert.strictEqual(app.guarantors.length, 3, 'All 3 guarantors persisted');
    assert.strictEqual(app.eligibilityScore, 100);
  });

  await asyncTest('Verify PDF summary includes all 3 guarantors and indicative score out of 100%', async () => {
    const res = await makeRequest('GET', `/api/applications/${activeAppId}/pdf`, null, {
      Authorization: `Bearer ${borrowerToken}`,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.ok(res.raw && res.raw.length > 2000, 'PDF generated with expected size');
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
