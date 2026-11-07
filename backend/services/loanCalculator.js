/**
 * Server-side loan calculation. This is a straight port of `calculateLoanRepayment` and
 * `getServiceFeeForAmount` in frontend/src/config/appConfig.ts and MUST stay identical to it.
 * A shared fixture (backend/fixtures/loan-calc-fixtures.json) is checked by both
 * `test_loan_calc_parity.js` (this file) and `frontend/src/config/__tests__/loanCalc.parity.test.ts`.
 */

const LOAN_CONFIG = {
  minLoanAmountNis: 500,
  maxLoanAmountNis: 10000,
  amountIncrementNis: 500,
  allowedRepaymentPeriodsMonths: [3, 6, 9],
  defaultInterestRatePercent: 8.5,
};

const SERVICE_FEE_TIERS = [
  { minAmount: 500, maxAmount: 2000, feeNis: 120 },
  { minAmount: 2001, maxAmount: 4000, feeNis: 220 },
  { minAmount: 4001, maxAmount: 7000, feeNis: 350 },
  { minAmount: 7001, maxAmount: 10000, feeNis: 480 },
];

function getServiceFeeForAmount(amount, tiers = SERVICE_FEE_TIERS) {
  if (amount <= 0) return 0;
  const match = tiers.find((t) => amount >= t.minAmount && amount <= t.maxAmount);
  if (match) return match.feeNis;
  if (amount < ((tiers[0] && tiers[0].minAmount) || 500)) return (tiers[0] && tiers[0].feeNis) || 120;
  return (tiers[tiers.length - 1] && tiers[tiers.length - 1].feeNis) || 480;
}

function calculateLoanRepayment(principalAmount, periodMonths, config = LOAN_CONFIG) {
  if (principalAmount <= 0 || periodMonths <= 0) {
    return {
      baseMonthlyRepaymentNis: 0,
      serviceFeeNis: 0,
      monthlyServiceFeeNis: 0,
      monthlyPaymentNis: 0,
      totalRepaymentNis: 0,
      totalInterestNis: 0,
      managementFeeNis: 0,
      interestRatePercent: config.defaultInterestRatePercent,
    };
  }

  const monthlyRate = config.defaultInterestRatePercent / 100 / 12;
  const factor = Math.pow(1 + monthlyRate, periodMonths);
  const baseMonthlyRepaymentNis = Math.round((principalAmount * (monthlyRate * factor)) / (factor - 1));

  const serviceFeeNis = getServiceFeeForAmount(principalAmount);
  const monthlyServiceFeeNis = Math.round(serviceFeeNis / periodMonths);
  const monthlyPaymentNis = baseMonthlyRepaymentNis + monthlyServiceFeeNis;
  const totalRepaymentNis = monthlyPaymentNis * periodMonths;
  const totalInterestNis = totalRepaymentNis - principalAmount - serviceFeeNis;

  return {
    baseMonthlyRepaymentNis,
    serviceFeeNis,
    monthlyServiceFeeNis,
    monthlyPaymentNis,
    totalRepaymentNis,
    totalInterestNis,
    managementFeeNis: serviceFeeNis,
    interestRatePercent: config.defaultInterestRatePercent,
  };
}

/** Is this a loan amount the product allows (500..10,000 in steps of 500)? */
function isValidLoanAmount(amount) {
  return (
    Number.isInteger(amount) &&
    amount >= LOAN_CONFIG.minLoanAmountNis &&
    amount <= LOAN_CONFIG.maxLoanAmountNis &&
    amount % LOAN_CONFIG.amountIncrementNis === 0
  );
}

function isValidRepaymentPeriod(months) {
  return LOAN_CONFIG.allowedRepaymentPeriodsMonths.includes(months);
}

/**
 * Full breakdown for display and for the stored snapshot. The loan figures (principal + interest)
 * are kept apart from the service fee so the applicant can see the difference:
 *  - loanOnly*   = what repays the loan itself (base monthly payment x months)
 *  - service fee = tiered one-time fee, split evenly across the months
 *  - overall*    = both together (the existing monthlyPaymentNis / totalRepaymentNis)
 */
function buildLoanBreakdown(principalAmount, periodMonths) {
  const r = calculateLoanRepayment(principalAmount, periodMonths);
  return {
    requestedAmountNis: principalAmount,
    repaymentPeriodMonths: periodMonths,
    interestRatePercent: r.interestRatePercent,
    totalInterestNis: r.totalInterestNis,
    totalServiceFeeNis: r.serviceFeeNis,
    monthlyLoanRepaymentNis: r.baseMonthlyRepaymentNis,
    monthlyServiceFeeNis: r.monthlyServiceFeeNis,
    totalLoanRepaymentNis: r.baseMonthlyRepaymentNis * periodMonths,
    monthlyPaymentTotalNis: r.monthlyPaymentNis,
    overallTotalNis: r.totalRepaymentNis,
    calculatedAt: new Date().toISOString(),
  };
}

module.exports = {
  LOAN_CONFIG,
  SERVICE_FEE_TIERS,
  getServiceFeeForAmount,
  calculateLoanRepayment,
  isValidLoanAmount,
  isValidRepaymentPeriod,
  buildLoanBreakdown,
};
