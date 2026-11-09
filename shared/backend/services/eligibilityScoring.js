/**
 * Authoritative Loan Eligibility Scoring Engine
 *
 * Implements a deterministic scoring engine based on 5 objective factors,
 * with a maximum possible score of 100 percentage points (20% max per factor):
 * 1. Identity / document verification (max 20%)
 * 2. Salary (max 20%)
 * 3. Employment duration (max 20%)
 * 4. Visa validity (max 20%)
 * 5. Number of guarantors (max 20%)
 *
 * The score is the direct sum of the points awarded for these five factors (0 to 100%).
 */

/**
 * Calculates remaining visa validity in months.
 * Uses average days per month (30.4375) for precise date boundaries.
 */
function calculateVisaMonthsRemaining(visaExpiryDate, referenceDate = new Date()) {
  if (!visaExpiryDate) return 0;
  const expiry = new Date(visaExpiryDate);
  const now = new Date(referenceDate);
  if (isNaN(expiry.getTime())) return 0;

  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays <= 0) return 0;

  return Math.round((diffDays / 30.4375) * 10) / 10;
}

/**
 * Calculates calendar months between two dates.
 */
function calculateMonthsBetween(startDateStr, referenceDate = new Date()) {
  if (!startDateStr) return null;
  const start = new Date(startDateStr);
  const now = new Date(referenceDate);
  if (isNaN(start.getTime())) return null;

  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) {
    months--;
  }
  return Math.max(0, months);
}

/**
 * Calculates total employment duration in months.
 * Evaluates:
 * 1. Existing employment start date (startDate or employmentStartDate in employmentDetails)
 * 2. Existing dateOfEntry in residencyDetails
 * 3. Existing jobTenureMonths in employmentDetails
 */
function calculateEmploymentDurationMonths(application, referenceDate = new Date()) {
  const { residencyDetails, employmentDetails } = application || {};

  // 1. Existing employment start date if present
  const explicitStartDate = employmentDetails?.startDate || employmentDetails?.employmentStartDate;
  if (explicitStartDate) {
    const months = calculateMonthsBetween(explicitStartDate, referenceDate);
    if (months !== null) return months;
  }

  // 2. Existing date of entry into Israel
  if (residencyDetails?.dateOfEntry) {
    const months = calculateMonthsBetween(residencyDetails.dateOfEntry, referenceDate);
    if (months !== null && months > 0) return months;
  }

  // 3. From yearsOfResidency if numeric
  if (typeof residencyDetails?.yearsOfResidency === 'number' && residencyDetails.yearsOfResidency > 0) {
    return Math.round(residencyDetails.yearsOfResidency * 12);
  }

  // 4. Existing job tenure in months
  if (typeof employmentDetails?.jobTenureMonths === 'number' && employmentDetails.jobTenureMonths > 0) {
    return Math.round(employmentDetails.jobTenureMonths);
  }

  return 0;
}

/**
 * Normalizes list of guarantors.
 * Supports both modern `application.guarantors` array and legacy `application.guarantor` single object.
 */
function extractGuarantors(application) {
  if (!application) return [];

  if (Array.isArray(application.guarantors) && application.guarantors.length > 0) {
    return application.guarantors.filter((g) => {
      if (!g) return false;
      const hasName = typeof g.fullName === 'string' && g.fullName.trim().length > 0;
      const hasId = typeof g.passportOrIdNumber === 'string' && g.passportOrIdNumber.trim().length > 0;
      return hasName && hasId;
    });
  }

  if (application.guarantor && application.guarantor.hasGuarantor) {
    const g = application.guarantor;
    const hasName = typeof g.fullName === 'string' && g.fullName.trim().length > 0;
    const hasId = typeof g.passportOrIdNumber === 'string' && g.passportOrIdNumber.trim().length > 0;
    if (hasName && hasId) {
      return [{
        id: 'g_1',
        fullName: g.fullName,
        passportOrIdNumber: g.passportOrIdNumber,
        mobilePhoneNumber: g.mobilePhoneNumber || '',
        relationship: g.relationship || 'Co-worker',
        idDocument: g.passportPhoto,
      }];
    }
  }

  return [];
}

/**
 * Calculates the number of visual sections completed (out of 10) for a 0–100 score:
 * 0–9%   → 0 sections
 * 10–19% → 1 section
 * 20–29% → 2 sections
 * 30–39% → 3 sections
 * 40–49% → 4 sections
 * 50–59% → 5 sections
 * 60–69% → 6 sections
 * 70–79% → 7 sections
 * 80–89% → 8 sections
 * 90–99% → 9 sections
 * 100%   → 10 sections
 */
function calculateSectionsCompleted(score) {
  if (score >= 100) return 10;
  if (score < 10) return 0;
  return Math.floor(score / 10);
}

/**
 * Calculates the authoritative loan eligibility score (0 to 100 points).
 *
 * @param {Object} application - Full application object
 * @param {Date} [referenceDate] - Optional date override for deterministic testing
 * @returns {Object} Score breakdown and total score
 */
function calculateEligibilityScore(application, referenceDate = new Date()) {
  const app = application || {};
  const { borrowerDetails, residencyDetails, employmentDetails, documents = [] } = app;

  // -------------------------------------------------------------------------
  // Component 1: Identity / Document Verification (Maximum 20%)
  // Award:
  // 20% if the required identity document/passport is provided and the applicant has a valid visa.
  // 0% if the required document or valid visa cannot be verified.
  // Do not award points solely because a file was uploaded if the application
  // has a verification status indicating that the identity document or visa is invalid.
  // -------------------------------------------------------------------------
  const passportDoc = documents.find((d) => d && d.documentTypeCode === 'PASSPORT');
  const isPassportFailed = passportDoc && (passportDoc.qualityStatus === 'failed' || passportDoc.validityStatus === 'rejected' || passportDoc.validityStatus === 'expired');
  const hasValidPassportDoc = !!passportDoc && !isPassportFailed;
  const hasPassportNumber = typeof borrowerDetails?.passportNumber === 'string' && borrowerDetails.passportNumber.trim().length > 0;
  const isPassportProvided = hasValidPassportDoc || hasPassportNumber;

  const visaMonths = calculateVisaMonthsRemaining(residencyDetails?.visaExpiryDate, referenceDate);
  const isVisaExpired = visaMonths <= 0;
  const isVisaStatusFailed = documents.some((d) => d && (d.documentTypeCode === 'WORK_VISA' || d.documentTypeCode === 'WORKERS_CARD') && (d.qualityStatus === 'failed' || d.validityStatus === 'rejected' || d.validityStatus === 'expired'));
  const hasVisaDoc = documents.some((d) => d && (d.documentTypeCode === 'WORK_VISA' || d.documentTypeCode === 'WORKERS_CARD') && d.qualityStatus !== 'failed' && d.validityStatus !== 'rejected' && d.validityStatus !== 'expired');
  const hasValidVisa = !isVisaExpired && !isVisaStatusFailed && !!(residencyDetails?.visaType || residencyDetails?.visaStartDate || hasVisaDoc);

  let identityScore = 0;
  let identityDesc = '';
  let identityKey = '';
  let identityParams = {};
  if (isPassportProvided && hasValidVisa) {
    identityScore = 20;
    identityDesc = 'Identity document verified with valid visa status (+20%).';
    identityKey = 'elig.identity.ok';
    identityParams = {};
  } else if (!isPassportProvided) {
    identityScore = 0;
    identityDesc = 'Required passport / identity document missing or invalid (0%).';
    identityKey = 'elig.identity.missingDoc';
    identityParams = {};
  } else {
    identityScore = 0;
    identityDesc = 'Valid visa cannot be verified or has expired (0%).';
    identityKey = 'elig.identity.visaInvalid';
    identityParams = {};
  }

  // -------------------------------------------------------------------------
  // Component 2: Salary (Maximum 20%)
  // Award:
  // 20% if monthly salary is 7,500 NIS or higher.
  // 10% if monthly salary is below 7,500 NIS (and > 0).
  // 0% if missing or 0.
  // -------------------------------------------------------------------------
  const salary = Number(employmentDetails?.monthlySalaryNis || 0);
  let salaryScore = 0;
  let salaryDesc = '';
  let salaryKey = '';
  let salaryParams = {};
  if (salary >= 7500) {
    salaryScore = 20;
    salaryDesc = `Monthly salary (${salary.toLocaleString()} NIS) is 7,500 NIS or higher (+20%).`;
    salaryKey = 'elig.salary.high';
    salaryParams = { salary };
  } else if (salary > 0) {
    salaryScore = 10;
    salaryDesc = `Monthly salary (${salary.toLocaleString()} NIS) is below 7,500 NIS (+10%).`;
    salaryKey = 'elig.salary.low';
    salaryParams = { salary };
  } else {
    salaryScore = 0;
    salaryDesc = 'Monthly salary information missing or invalid (0%).';
    salaryKey = 'elig.salary.missing';
    salaryParams = {};
  }

  // -------------------------------------------------------------------------
  // Component 3: Employment Duration (Maximum 20%)
  // Exact specified ranges:
  // 0–12 months: 5% (12 months exactly -> 5%)
  // >12 months and <=24 months: 10% (24 months exactly -> 10%)
  // >24 months and <=36 months: 15% (36 months exactly -> 15%)
  // >36 months: 20%
  // -------------------------------------------------------------------------
  const durationMonths = calculateEmploymentDurationMonths(app, referenceDate);
  const hasEmploymentData = (employmentDetails && (employmentDetails.employerName || employmentDetails.jobTenureMonths || employmentDetails.startDate)) ||
    (residencyDetails && residencyDetails.dateOfEntry);

  let employmentDurationScore = 0;
  let employmentDurationDesc = '';
  let employmentDurationKey = '';
  let employmentDurationParams = {};

  if (!hasEmploymentData && durationMonths === 0) {
    employmentDurationScore = 0;
    employmentDurationDesc = 'Employment duration data missing (0%).';
    employmentDurationKey = 'elig.duration.missing';
    employmentDurationParams = {};
  } else if (durationMonths > 36) {
    employmentDurationScore = 20;
    employmentDurationDesc = `Employment duration is ${durationMonths} months (>36 months) (+20%).`;
    employmentDurationKey = 'elig.duration.gt36';
    employmentDurationParams = { months: durationMonths };
  } else if (durationMonths > 24) {
    employmentDurationScore = 15;
    employmentDurationDesc = `Employment duration is ${durationMonths} months (>24 and ≤36 months) (+15%).`;
    employmentDurationKey = 'elig.duration.gt24';
    employmentDurationParams = { months: durationMonths };
  } else if (durationMonths > 12) {
    employmentDurationScore = 10;
    employmentDurationDesc = `Employment duration is ${durationMonths} months (>12 and ≤24 months) (+10%).`;
    employmentDurationKey = 'elig.duration.gt12';
    employmentDurationParams = { months: durationMonths };
  } else {
    // 0 to 12 months (including exactly 12 months)
    employmentDurationScore = 5;
    employmentDurationDesc = `Employment duration is ${durationMonths} months (0–12 months) (+5%).`;
    employmentDurationKey = 'elig.duration.upTo12';
    employmentDurationParams = { months: durationMonths };
  }

  // -------------------------------------------------------------------------
  // Component 4: Visa Validity (Maximum 20%)
  // Boundary conditions:
  // 20% for 12 months or more of remaining validity (>= 12.0)
  // 10% for approximately 6 months (>= 6.0 and < 12.0)
  // 5% for approximately 3 months (>= 3.0 and < 6.0)
  // 0% if expired or < 3.0 months
  // -------------------------------------------------------------------------
  let visaValidityScore = 0;
  let visaValidityDesc = '';
  let visaValidityKey = '';
  let visaValidityParams = {};
  if (visaMonths >= 12.0) {
    visaValidityScore = 20;
    visaValidityDesc = `Remaining visa validity is ${visaMonths.toFixed(1)} months (12+ months) (+20%).`;
    visaValidityKey = 'elig.visa.gte12';
    visaValidityParams = { months: visaMonths.toFixed(1) };
  } else if (visaMonths >= 6.0) {
    visaValidityScore = 10;
    visaValidityDesc = `Remaining visa validity is ${visaMonths.toFixed(1)} months (~6 months buffer) (+10%).`;
    visaValidityKey = 'elig.visa.gte6';
    visaValidityParams = { months: visaMonths.toFixed(1) };
  } else if (visaMonths >= 3.0) {
    visaValidityScore = 5;
    visaValidityDesc = `Remaining visa validity is ${visaMonths.toFixed(1)} months (~3 months buffer) (+5%).`;
    visaValidityKey = 'elig.visa.gte3';
    visaValidityParams = { months: visaMonths.toFixed(1) };
  } else {
    visaValidityScore = 0;
    visaValidityDesc = visaMonths > 0
      ? `Remaining visa validity is ${visaMonths.toFixed(1)} months (< 3 months minimum) (0%).`
      : 'Visa has expired or expiry date missing (0%).';
    visaValidityKey = visaMonths > 0 ? 'elig.visa.lt3' : 'elig.visa.expired';
    visaValidityParams = visaMonths > 0 ? { months: visaMonths.toFixed(1) } : {};
  }

  // -------------------------------------------------------------------------
  // Component 5: Number of Guarantors (Maximum 20%)
  // Award:
  // 10% for exactly 1 guarantor.
  // 20% for 2 or more guarantors.
  // 0% if no guarantor exists.
  // -------------------------------------------------------------------------
  const validGuarantors = extractGuarantors(app);
  const guarantorCount = validGuarantors.length;
  let guarantorsScore = 0;
  let guarantorsDesc = '';
  let guarantorsKey = '';
  let guarantorsParams = {};
  if (guarantorCount >= 2) {
    guarantorsScore = 20;
    guarantorsDesc = `${guarantorCount} guarantors provided (+20%).`;
    guarantorsKey = 'elig.guarantors.many';
    guarantorsParams = { n: guarantorCount };
  } else if (guarantorCount === 1) {
    guarantorsScore = 10;
    guarantorsDesc = '1 guarantor provided (+10%).';
    guarantorsKey = 'elig.guarantors.one';
    guarantorsParams = {};
  } else {
    guarantorsScore = 0;
    guarantorsDesc = 'No guarantor provided (0%).';
    guarantorsKey = 'elig.guarantors.none';
    guarantorsParams = {};
  }

  // -------------------------------------------------------------------------
  // Total Score: Direct sum (max 100%)
  // Guarantee score is within 0 to 100
  // -------------------------------------------------------------------------
  const rawScore = identityScore + salaryScore + employmentDurationScore + visaValidityScore + guarantorsScore;
  const clampedScore = Math.min(100, Math.max(0, rawScore));
  const maxRawScore = 100;
  const percentageOfMax = clampedScore;
  const segmentsFilled = calculateSectionsCompleted(clampedScore);

  return {
    rawScore: clampedScore,
    maxRawScore,
    percentageOfMax,
    segmentsFilled,
    identityScore,
    salaryScore,
    employmentDurationScore,
    visaValidityScore,
    guarantorsScore,
    factors: {
      identity: { awarded: identityScore, max: 20, description: identityDesc, descriptionKey: identityKey, descriptionParams: identityParams },
      salary: { awarded: salaryScore, max: 20, description: salaryDesc, descriptionKey: salaryKey, descriptionParams: salaryParams },
      employmentDuration: { awarded: employmentDurationScore, max: 20, description: employmentDurationDesc, descriptionKey: employmentDurationKey, descriptionParams: employmentDurationParams },
      visaValidity: { awarded: visaValidityScore, max: 20, description: visaValidityDesc, descriptionKey: visaValidityKey, descriptionParams: visaValidityParams },
      guarantors: { awarded: guarantorsScore, max: 20, description: guarantorsDesc, descriptionKey: guarantorsKey, descriptionParams: guarantorsParams },
    },
  };
}

module.exports = {
  calculateEligibilityScore,
  calculateVisaMonthsRemaining,
  calculateEmploymentDurationMonths,
  calculateMonthsBetween,
  extractGuarantors,
  calculateSectionsCompleted,
};
