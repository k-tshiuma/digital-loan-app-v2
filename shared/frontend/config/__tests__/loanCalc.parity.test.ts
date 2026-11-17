// The frontend loan calculator must give exactly the same figures as the server's
// (shared/backend/services/loanCalculator.js); both are checked against one fixture.
import { describe, expect, it } from 'vitest';
import fixtures from '../../../backend/fixtures/loan-calc-fixtures.json';
import { SERVICE_FEE_NIS, calculateLoanRepayment, getServiceFeeForAmount } from '../appConfig';

describe('loan calculator parity with the server', () => {
  it.each(fixtures as Array<(typeof fixtures)[number] & { serviceFeeNis?: number }>)('$principal NIS over $period months (fee $serviceFeeNis)', (item) => {
    // Cases without serviceFeeNis use the default fee; the others a fee configured in the Back Office.
    const r = calculateLoanRepayment(item.principal, item.period, undefined, item.serviceFeeNis);
    expect(r.baseMonthlyRepaymentNis).toBe(item.expectedBaseMonthly);
    expect(r.serviceFeeNis).toBe(item.expectedFee);
    expect(r.monthlyServiceFeeNis).toBe(item.expectedMonthlyFee);
    expect(r.monthlyPaymentNis).toBe(item.expectedTotalMonthly);
    expect(r.totalRepaymentNis).toBe(item.expectedTotalRepayment);
    expect(r.totalInterestNis).toBe(item.expectedTotalInterest);
  });

  it('charges the same flat service fee for every loan amount', () => {
    expect(SERVICE_FEE_NIS).toBe(3000);
    for (const amount of [500, 2000, 5000, 10000]) expect(getServiceFeeForAmount(amount)).toBe(3000);
    expect(getServiceFeeForAmount(0)).toBe(0);
  });

  it('charges the configured fee when one is passed in', () => {
    expect(getServiceFeeForAmount(5000, 1200)).toBe(1200);
    expect(getServiceFeeForAmount(0, 1200)).toBe(0);
    expect(calculateLoanRepayment(5000, 6, undefined, 1200).monthlyServiceFeeNis).toBe(200);
  });
});
