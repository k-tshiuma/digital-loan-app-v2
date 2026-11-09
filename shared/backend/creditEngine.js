// Rule-based credit pre-screening engine (advisory only — never blocks a submission)

/**
 * Default rule thresholds. A system_admin can override any of these via
 * PUT /api/config/credit-rules; overrides are persisted in the app_config table.
 */
const DEFAULT_CREDIT_RULES = {
  salaryMultiplier: 6,          // monthly salary × N must cover the loan amount
  salaryWarnRatio: 1.5,         // coverage ratio below this (but ≥ 1) is marginal
  salaryFailPenalty: 40,
  salaryWarnPenalty: 15,
  visaBufferMonths: 3,          // visa must outlast repayment period + N months
  visaPenalty: 25,
  minTenureMonths: 6,           // below this is a warning
  hardMinTenureMonths: 3,       // below this is a failure
  tenureFailPenalty: 20,
  tenureWarnPenalty: 10,
  guarantorBonus: 10,
  lowRiskMinScore: 80,          // score ≥ this → Low
  mediumRiskMinScore: 50,       // score ≥ this → Medium, otherwise High
};

/** Merge stored overrides with defaults, coercing everything to finite numbers. */
function normalizeRules(overrides) {
  const rules = { ...DEFAULT_CREDIT_RULES };
  if (overrides && typeof overrides === 'object') {
    for (const key of Object.keys(DEFAULT_CREDIT_RULES)) {
      const n = Number(overrides[key]);
      if (overrides[key] !== undefined && overrides[key] !== null && Number.isFinite(n)) {
        rules[key] = n;
      }
    }
  }
  return rules;
}

/**
 * Run credit pre-screening rules against a loan application.
 * @param {Object} application - The full application object
 * @param {Object} config      - Optional rule overrides (see DEFAULT_CREDIT_RULES)
 * @returns {{ score: number, riskLevel: string, flags: string[] }}
 */
function runCreditScreening(application, config) {
  const rules = normalizeRules(config);
  const flags = [];
  let score = 100; // Start at 100, deduct for risk factors

  const { loanRequest, employmentDetails, residencyDetails, guarantor } = application || {};

  // Rule 1: Salary-to-loan ratio (monthly salary * N >= loan amount)
  if (loanRequest && employmentDetails && Number(loanRequest.requestedAmountNis) > 0) {
    const ratio = (Number(employmentDetails.monthlySalaryNis || 0) * rules.salaryMultiplier) / Number(loanRequest.requestedAmountNis);
    if (ratio < 1) {
      score -= rules.salaryFailPenalty;
      flags.push('SALARY_RATIO_FAIL: Salary too low for requested amount');
    } else if (ratio < rules.salaryWarnRatio) {
      score -= rules.salaryWarnPenalty;
      flags.push('SALARY_RATIO_WARN: Salary-to-loan ratio is marginal');
    }
  } else {
    score -= rules.salaryFailPenalty;
    flags.push('DATA_MISSING: Salary or loan amount not provided');
  }

  // Rule 2: Visa expiry must cover repayment period + buffer months
  if (residencyDetails && residencyDetails.visaExpiryDate && loanRequest) {
    const expiryDate = new Date(residencyDetails.visaExpiryDate);
    const requiredDate = new Date();
    requiredDate.setMonth(requiredDate.getMonth() + Number(loanRequest.repaymentPeriodMonths || 0) + rules.visaBufferMonths);
    if (Number.isNaN(expiryDate.getTime()) || expiryDate < requiredDate) {
      score -= rules.visaPenalty;
      flags.push('VISA_EXPIRY_RISK: Visa may expire before loan term ends');
    }
  }

  // Rule 3: Job tenure thresholds
  if (employmentDetails) {
    const tenure = Number(employmentDetails.jobTenureMonths || 0);
    if (tenure < rules.hardMinTenureMonths) {
      score -= rules.tenureFailPenalty;
      flags.push(`TENURE_FAIL: Job tenure under ${rules.hardMinTenureMonths} months`);
    } else if (tenure < rules.minTenureMonths) {
      score -= rules.tenureWarnPenalty;
      flags.push(`TENURE_WARN: Job tenure under ${rules.minTenureMonths} months`);
    }
  }

  // Rule 4: Guarantor bonus
  if (guarantor && guarantor.hasGuarantor) {
    score += rules.guarantorBonus;
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  let riskLevel;
  if (score >= rules.lowRiskMinScore) riskLevel = 'Low';
  else if (score >= rules.mediumRiskMinScore) riskLevel = 'Medium';
  else riskLevel = 'High';

  return { score, riskLevel, flags };
}

// Every code that runCreditScreening can put at the start of a risk flag ("CODE: text").
// The back office translates flags by code, so add new codes here and in the frontend translations.
const RISK_FLAG_CODES = ['SALARY_RATIO_FAIL', 'SALARY_RATIO_WARN', 'DATA_MISSING', 'VISA_EXPIRY_RISK', 'TENURE_FAIL', 'TENURE_WARN'];

module.exports = { runCreditScreening, DEFAULT_CREDIT_RULES, normalizeRules, RISK_FLAG_CODES };
