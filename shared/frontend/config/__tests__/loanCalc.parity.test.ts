// The frontend loan calculator must give exactly the same figures as the server's
// (shared/backend/services/loanCalculator.js); both are checked against one fixture.
import { describe, expect, it } from 'vitest';
import fixtures from '../../../backend/fixtures/loan-calc-fixtures.json';
import { SERVICE_FEE_NIS, calculateLoanRepayment, getServiceFeeForAmount } from '../appConfig';

describe('loan calculator parity with the server', () => {
  it.each(fixtures)('$principal NIS over $period months', (item) => {
    const r = calculateLoanRepayment(item.principal, item.period);
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
});
