/**
 * Server-side loan calculation. This is a straight port of `calculateLoanRepayment` and
 * `getServiceFeeForAmount` in frontend/src/config/appConfig.ts and MUST stay identical to it.
 * A shared fixture (shared/backend/fixtures/loan-calc-fixtures.json) is checked by both
 * `tests/integration/test_workflow.js` (this file) and `shared/frontend/config/__tests__/loanCalc.parity.test.ts`.
 */

const LOAN_CONFIG = {
  minLoanAmountNis: 500,
  maxLoanAmountNis: 10000,
  amountIncrementNis: 500,
  allowedRepaymentPeriodsMonths: [3, 6, 9],
  defaultInterestRatePercent: 8.5,
};

/** Flat one-time service (agent) fee, whatever the loan amount; split evenly across the months. */
const SERVICE_FEE_NIS = 3000;

function getServiceFeeForAmount(amount) {
  return amount > 0 ? SERVICE_FEE_NIS : 0;
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
 *  - service fee = flat one-time fee (SERVICE_FEE_NIS), split evenly across the months
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
  SERVICE_FEE_NIS,
  getServiceFeeForAmount,
  calculateLoanRepayment,
  isValidLoanAmount,
  isValidRepaymentPeriod,
  buildLoanBreakdown,
};
