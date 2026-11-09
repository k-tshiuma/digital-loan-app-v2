// Application rows: parsing, saving, request numbers and the credit pre-screen.
const { dbGet, dbAll, dbRun, safeJson } = require('../services/dbHelpers');
const { runCreditScreening, normalizeRules } = require('../creditEngine');
const { calculateEligibilityScore } = require('../services/eligibilityScoring');

const APP_JSON_FIELDS = [
  'borrowerDetails',
  'residencyDetails',
  'employmentDetails',
  'loanRequest',
  'guarantor',
  'digitalSignature',
  'bankAccount',
  'eligibilityBreakdown',
  'step1Data',
  'step2Data',
  'step3Data',
  'loanBreakdown',
  'staffMessage',
];
const APP_JSON_ARRAY_FIELDS = ['documents', 'consents', 'statusHistory', 'riskFlags', 'guarantors'];

function parseApp(row) {
  if (!row) return null;
  const out = { ...row };
  APP_JSON_FIELDS.forEach((f) => { out[f] = safeJson(row[f], undefined); });
  APP_JSON_ARRAY_FIELDS.forEach((f) => { out[f] = safeJson(row[f], []); });
  out.isSubmitted = row.isSubmitted === 1;
  out.bankAccountConfirmed = row.bankAccountConfirmed === 1;
  if (out.riskScore === null) delete out.riskScore;
  if (out.riskLevel === null) delete out.riskLevel;
  if (out.missingDocumentNotes === null) delete out.missingDocumentNotes;

  // Keep flowVersion = 2 legacy mirror fields strictly aligned with step1Data (never retaining default country overrides)
  if (out.flowVersion === 2) {
    const s1 = out.step1Data || {};
    const p = s1.personal || {};
    const e = s1.employment || {};
    const prevB = out.borrowerDetails || {};
    out.borrowerDetails = {
      ...prevB,
      fullName: p.fullName || prevB.fullName || '',
      mobilePhoneNumber: p.phoneNumber || prevB.mobilePhoneNumber || '',
      dateOfBirth: p.dateOfBirth || prevB.dateOfBirth || '',
      addressFull: p.address || prevB.addressFull || '',
      passportNumber: p.passportNumber || prevB.passportNumber || '',
      countryOfOrigin: p.countryOfOrigin || '',
    };
    const prevR = out.residencyDetails || {};
    if (p.visaStartDate || p.visaExpiryDate || prevR.visaStartDate || prevR.visaExpiryDate || prevR.visaType) {
      out.residencyDetails = {
        ...prevR,
        visaStartDate: p.visaStartDate || prevR.visaStartDate || '',
        visaExpiryDate: p.visaExpiryDate || prevR.visaExpiryDate || '',
      };
    }
    const prevE = out.employmentDetails || {};
    const salaryNis = Number(p.monthlySalaryNis) > 0
      ? Number(p.monthlySalaryNis)
      : Number(e.monthlySalaryNis) > 0
        ? Number(e.monthlySalaryNis)
        : Number(prevE.monthlySalaryNis) > 0
          ? Number(prevE.monthlySalaryNis)
          : undefined;
    if (s1.employment || salaryNis !== undefined) {
      out.employmentDetails = {
        ...prevE,
        ...(s1.employment ? {
          employerName: e.employerName,
          companyName: e.companyName,
          manpowerAgent: e.manpowerAgent || undefined,
        } : {}),
        ...(salaryNis !== undefined ? { monthlySalaryNis: salaryNis, salaryCurrency: p.salaryCurrency || 'ILS' } : {}),
      };
    }
  }

  if (out.eligibilityScore === null || out.eligibilityScore === undefined) {
    const el = calculateEligibilityScore(out);
    out.eligibilityScore = el.rawScore;
    out.eligibilityBreakdown = el;
  }

  // Two-way synchronization between multi-guarantors array and legacy single guarantor
  if (Array.isArray(out.guarantors) && out.guarantors.length > 0) {
    const g0 = out.guarantors[0];
    if (!out.guarantor || !out.guarantor.hasGuarantor) {
      out.guarantor = {
        hasGuarantor: true,
        fullName: g0.fullName,
        passportOrIdNumber: g0.passportOrIdNumber,
        mobilePhoneNumber: g0.mobilePhoneNumber,
        relationship: g0.relationship,
        otherRelationshipDetails: g0.otherRelationshipDetails,
        passportPhoto: g0.idDocument,
      };
    }
  } else if (out.guarantor && out.guarantor.hasGuarantor) {
    out.guarantors = [{
      id: 'g_1',
      fullName: out.guarantor.fullName,
      passportOrIdNumber: out.guarantor.passportOrIdNumber,
      mobilePhoneNumber: out.guarantor.mobilePhoneNumber,
      relationship: out.guarantor.relationship,
      otherRelationshipDetails: out.guarantor.otherRelationshipDetails,
      idDocument: out.guarantor.passportPhoto,
    }];
  }

  return out;
}

/** Phase 2: once a document has a server file URL, drop any base64 copy so it is not stored in SQLite. */
function stripInlineFiles(documents) {
  return (documents || []).map((d) => {
    if (d && d.fileUrl && d.dataUrl) {
      const { dataUrl, ...rest } = d;
      return rest;
    }
    return d;
  });
}

async function getAppById(id) {
  if (!id) return null;
  return parseApp(await dbGet('SELECT * FROM applications WHERE id = ? OR requestNumber = ?', [id, id]));
}

async function writeApp(a) {
  // Sync guarantors <-> guarantor before saving
  if (Array.isArray(a.guarantors) && a.guarantors.length > 0) {
    const g0 = a.guarantors[0];
    a.guarantor = {
      hasGuarantor: true,
      fullName: g0.fullName,
      passportOrIdNumber: g0.passportOrIdNumber,
      mobilePhoneNumber: g0.mobilePhoneNumber,
      relationship: g0.relationship,
      otherRelationshipDetails: g0.otherRelationshipDetails,
      passportPhoto: g0.idDocument,
    };
  } else if (a.guarantor && a.guarantor.hasGuarantor && (!a.guarantors || a.guarantors.length === 0)) {
    a.guarantors = [{
      id: 'g_1',
      fullName: a.guarantor.fullName,
      passportOrIdNumber: a.guarantor.passportOrIdNumber,
      mobilePhoneNumber: a.guarantor.mobilePhoneNumber,
      relationship: a.guarantor.relationship,
      otherRelationshipDetails: a.guarantor.otherRelationshipDetails,
      idDocument: a.guarantor.passportPhoto,
    }];
  }

  // Authoritative server-side calculation for indicative eligibility score
  const el = calculateEligibilityScore(a);
  a.eligibilityScore = el.rawScore;
  a.eligibilityBreakdown = el;

  const cols = [
    'id', 'userId', 'requestNumber', 'isSubmitted', 'submittedAt', 'status', 'language', 'currentStep',
    'borrowerDetails', 'residencyDetails', 'employmentDetails', 'loanRequest', 'guarantor', 'documents',
    'consents', 'digitalSignature', 'statusHistory', 'riskScore', 'riskLevel', 'riskFlags',
    'missingDocumentNotes', 'bankAccountConfirmed', 'bankAccount', 'guarantors', 'eligibilityScore', 'eligibilityBreakdown',
    'createdAt', 'updatedAt',
  ];
  const values = [
    a.id, a.userId, a.requestNumber || null, a.isSubmitted ? 1 : 0, a.submittedAt || null, a.status, a.language || 'en', a.currentStep || 3,
    JSON.stringify(a.borrowerDetails ?? null), JSON.stringify(a.residencyDetails ?? null), JSON.stringify(a.employmentDetails ?? null),
    JSON.stringify(a.loanRequest ?? null), JSON.stringify(a.guarantor ?? null), JSON.stringify(stripInlineFiles(a.documents)),
    JSON.stringify(a.consents || []), JSON.stringify(a.digitalSignature ?? null), JSON.stringify(a.statusHistory || []),
    a.riskScore ?? null, a.riskLevel ?? null, JSON.stringify(a.riskFlags || []),
    a.missingDocumentNotes ?? null, a.bankAccountConfirmed ? 1 : 0, JSON.stringify(a.bankAccount ?? null),
    JSON.stringify(a.guarantors || []), a.eligibilityScore, JSON.stringify(a.eligibilityBreakdown ?? null),
    a.createdAt, a.updatedAt,
  ];
  const updates = cols.filter((c) => c !== 'id' && c !== 'createdAt').map((c) => `${c} = excluded.${c}`).join(', ');
  await dbRun(
    `INSERT INTO applications (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${updates}`,
    values
  );
}

/**
 * The next REQ-<year>-<number>. Taken from the year's counter in one statement, which SQLite runs atomically
 * even across the borrower and admin processes, so no number is handed out twice. The counter never goes
 * below the highest number already used that year (applications from before the counter existed).
 */
async function nextRequestNumber() {
  const year = new Date().getFullYear();
  const rows = await dbAll('SELECT requestNumber FROM applications WHERE requestNumber LIKE ?', [`REQ-${year}-%`]);
  const used = rows.reduce((m, r) => Math.max(m, parseInt(String(r.requestNumber).split('-')[2], 10) || 0), 100);
  const row = await dbGet(
    `INSERT INTO request_counters (year, lastNumber) VALUES (?, ?)
     ON CONFLICT(year) DO UPDATE SET lastNumber = max(lastNumber + 1, excluded.lastNumber)
     RETURNING lastNumber`,
    [year, used + 1]
  );
  return `REQ-${year}-${String(row.lastNumber).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Credit rules config (Phase 8)
// ---------------------------------------------------------------------------
async function getCreditRules() {
  const row = await dbGet('SELECT value FROM app_config WHERE key = ?', ['creditRules']);
  return normalizeRules(safeJson(row && row.value, {}));
}

async function applyRiskScore(a, rules) {
  const result = runCreditScreening(a, rules || (await getCreditRules()));
  a.riskScore = result.score;
  a.riskLevel = result.riskLevel;
  a.riskFlags = result.flags;
  return a;
}

module.exports = {
  APP_JSON_FIELDS,
  APP_JSON_ARRAY_FIELDS,
  parseApp,
  stripInlineFiles,
  getAppById,
  writeApp,
  nextRequestNumber,
  getCreditRules,
  applyRiskScore,
};
