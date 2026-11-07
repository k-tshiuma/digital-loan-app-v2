/**
 * Turns the staff detail response of GET /flow/applications/:id
 * ({ application, view, user, reviews, acceptances, audit, ... }) into the flat shape
 * FlowApplicationInspector reads (flowStatus, group, account, steps[n], loanBreakdown, ...).
 */

/** Backend step state (workflow.stepStates) -> inspector step status. */
function stepStatus(state: string | undefined, step: number): string | undefined {
  if (!state) return undefined;
  if (state === 'pending') return 'SUBMITTED';
  // Step 3 is never "approved" on its own; once sent it counts as submitted.
  if (step === 3 && state === 'approved') return 'SUBMITTED';
  return state.toUpperCase();
}

export function normalizeFlowDetail(raw: any): any {
  // Already flat (or an unexpected shape): leave it alone.
  if (!raw || !raw.application) return raw;

  const app = raw.application;
  const stepStates = raw.view?.stepStates || {};
  const lb = app.loanBreakdown;
  const loan = app.step2Data?.loan || app.loanRequest || {};

  return {
    ...app,
    group: raw.view?.group,
    reviewableStep: raw.view?.reviewableStep ?? null,
    permissions: raw.permissions,
    bankRevealed: raw.bankRevealed,
    account: raw.user || null,
    requestedAmountNis: loan.requestedAmountNis ?? app.step1Data?.loan?.requestedAmountNis,
    repaymentPeriodMonths: loan.repaymentPeriodMonths,
    steps: {
      1: { status: stepStatus(stepStates[1], 1), data: app.step1Data || {} },
      2: { status: stepStatus(stepStates[2], 2), data: app.step2Data || {} },
      3: { status: stepStatus(stepStates[3], 3), data: app.step3Data || {} },
    },
    loanBreakdown: lb
      ? {
          ...lb,
          totalRepaymentNis: lb.totalRepaymentNis ?? lb.overallTotalNis,
          monthlyRepaymentWithInterestNis: lb.monthlyRepaymentWithInterestNis ?? lb.monthlyLoanRepaymentNis,
        }
      : null,
    staffMessage: app.staffMessage
      ? {
          ...app.staffMessage,
          senderRole: app.staffMessage.senderRole ?? app.staffMessage.byRole,
          sentAt: app.staffMessage.sentAt ?? app.staffMessage.at,
        }
      : null,
    termsAcceptances: (raw.acceptances || []).map((a: any) => ({ ...a, hash: a.hash ?? a.textSha256 })),
    reviews: (raw.reviews || []).map((r: any) => ({
      ...r,
      stepNumber: r.stepNumber ?? r.step,
      decision: String(r.decision || '').toUpperCase(),
      notes: r.notes ?? r.note,
      reviewedByName: r.reviewedByName ?? r.reviewerName,
      createdAt: r.createdAt ?? r.decidedAt,
    })),
    audit: raw.audit || [],
    submissions: raw.submissions || [],
    deliveries: raw.deliveries || [],
  };
}
