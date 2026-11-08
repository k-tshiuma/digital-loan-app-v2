import { describe, it, expect } from 'vitest';
import { normalizeFlowDetail } from '../flowDetail';

describe('normalizeFlowDetail', () => {
  it('leaves an already-flat or empty value alone', () => {
    expect(normalizeFlowDetail(null)).toBeNull();
    const flat = { flowStatus: 'LEAD_REGISTERED', steps: {} };
    expect(normalizeFlowDetail(flat)).toBe(flat);
  });

  it('flattens the staff detail response', () => {
    const raw = {
      application: {
        id: 'app_1',
        flowStatus: 'PENDING_FINAL_PROCESSING',
        step1Data: { loan: { requestedAmountNis: 4000 } },
        step2Data: { loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 } },
        step3Data: { bank: { accountNumber: '****5678' } },
        loanBreakdown: { requestedAmountNis: 5000, overallTotalNis: 5462, monthlyLoanRepaymentNis: 852 },
        staffMessage: { text: 'Hi', byRole: 'credit_reviewer', at: '2026-11-02T09:00:00.000Z' },
      },
      view: { group: 'pending', reviewableStep: null, stepStates: { 1: 'approved', 2: 'approved', 3: 'pending' } },
      permissions: { canDecide: true },
      bankRevealed: false,
      user: { email: 'a@example.com', fullName: 'Somchai' },
      acceptances: [{ termsType: 'general', textSha256: 'abc' }],
      reviews: [{ step: 1, decision: 'approve', note: 'ok', reviewerName: 'Rev', decidedAt: '2026-11-01' }],
    };

    const out = normalizeFlowDetail(raw);

    expect(out.id).toBe('app_1');
    expect(out.group).toBe('pending');
    expect(out.reviewableStep).toBeNull();
    expect(out.permissions).toEqual({ canDecide: true });
    expect(out.bankRevealed).toBe(false);
    expect(out.account).toEqual({ email: 'a@example.com', fullName: 'Somchai' });
    // Step 2 loan wins over Step 1.
    expect(out.requestedAmountNis).toBe(5000);
    expect(out.repaymentPeriodMonths).toBe(6);

    expect(out.steps[1]).toEqual({ status: 'APPROVED', data: raw.application.step1Data });
    expect(out.steps[2].status).toBe('APPROVED');
    expect(out.steps[3]).toEqual({ status: 'SUBMITTED', data: raw.application.step3Data });

    expect(out.loanBreakdown.totalRepaymentNis).toBe(5462);
    expect(out.loanBreakdown.monthlyRepaymentWithInterestNis).toBe(852);
    expect(out.staffMessage).toMatchObject({ text: 'Hi', senderRole: 'credit_reviewer', sentAt: '2026-11-02T09:00:00.000Z' });
    expect(out.termsAcceptances[0].hash).toBe('abc');
    expect(out.reviews[0]).toMatchObject({ stepNumber: 1, decision: 'APPROVE', notes: 'ok', reviewedByName: 'Rev', createdAt: '2026-11-01' });
    expect(out.audit).toEqual([]);
    expect(out.submissions).toEqual([]);
    expect(out.deliveries).toEqual([]);
  });

  it('maps step states: pending counts as submitted, an approved Step 3 stays submitted, missing stays undefined', () => {
    const out = normalizeFlowDetail({
      application: { id: 'x' },
      view: { stepStates: { 1: 'pending', 2: 'changes_requested', 3: 'approved' } },
    });
    expect(out.steps[1].status).toBe('SUBMITTED');
    expect(out.steps[2].status).toBe('CHANGES_REQUESTED');
    expect(out.steps[3].status).toBe('SUBMITTED');

    const empty = normalizeFlowDetail({ application: { id: 'y', step1Data: { loan: { requestedAmountNis: 3000 } } } });
    expect(empty.steps[1]).toEqual({ status: undefined, data: { loan: { requestedAmountNis: 3000 } } });
    expect(empty.steps[2].data).toEqual({});
    expect(empty.requestedAmountNis).toBe(3000);
    expect(empty.loanBreakdown).toBeNull();
    expect(empty.staffMessage).toBeNull();
    expect(empty.account).toBeNull();
  });

  it('keeps explicit values over the fallbacks', () => {
    const out = normalizeFlowDetail({
      application: {
        loanBreakdown: { totalRepaymentNis: 1, overallTotalNis: 2, monthlyRepaymentWithInterestNis: 3, monthlyLoanRepaymentNis: 4 },
      },
    });
    expect(out.loanBreakdown.totalRepaymentNis).toBe(1);
    expect(out.loanBreakdown.monthlyRepaymentWithInterestNis).toBe(3);
  });
});
