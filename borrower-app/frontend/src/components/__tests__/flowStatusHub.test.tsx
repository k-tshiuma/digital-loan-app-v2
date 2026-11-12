import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowStatusHub } from '../FlowStatusHub';
import { FlowApplicationView, LoanBreakdown } from '@quickloan/ui-core/types';

const breakdown: LoanBreakdown = {
  requestedAmountNis: 5000,
  repaymentPeriodMonths: 6,
  interestRatePercent: 8.5,
  totalInterestNis: 112,
  totalServiceFeeNis: 350,
  monthlyLoanRepaymentNis: 852,
  monthlyServiceFeeNis: 58,
  totalLoanRepaymentNis: 5112,
  monthlyPaymentTotalNis: 910,
  overallTotalNis: 5462,
};

function makeApp(overrides: Partial<FlowApplicationView> = {}): FlowApplicationView {
  return {
    id: 'app_1',
    requestNumber: 'REQ-2026-100001',
    flowStatus: 'PENDING_STEP1_APPROVAL',
    group: 'pending',
    unlockedStep: 1,
    stepStates: { 1: 'pending', 2: 'locked', 3: 'locked' },
    nextAction: null,
    isCompleted: false,
    completedAt: null,
    status: 'Received',
    rejection: null,
    staffMessage: null,
    needsRegistrationConsent: false,
    steps: {
      1: { state: 'pending', submittedAt: null, data: null },
      2: { state: 'locked', submittedAt: null, data: null },
      3: { state: 'locked', submittedAt: null, data: null },
    },
    loanBreakdown: null,
    language: 'en',
    leadSource: 'manual',
    account: { email: 'a@example.com', phoneNumber: '050-1234567', fullName: 'Somchai Worker', authProvider: null },
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  } as FlowApplicationView;
}

const card = (title: RegExp) => screen.getByRole('button', { name: title });

describe('FlowStatusHub', () => {
  it('shows the status, reference and applicant summary while Step 1 is pending', () => {
    render(<FlowStatusHub application={makeApp()} language="en" onNavigateToStep={vi.fn()} />);

    expect(screen.getByText('Pending Step 1 Approval')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Application Pending' })).toBeInTheDocument();
    expect(screen.getByText(/REQ-2026-100001/)).toBeInTheDocument();
    expect(screen.getByText(/Somchai Worker/)).toBeInTheDocument();
    expect(screen.getByText('050-1234567')).toBeInTheDocument();
    // No next action yet, so no continue button.
    expect(screen.queryByRole('button', { name: /Continue to Step/ })).toBeNull();
  });

  it('only lets the applicant open steps that are unlocked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<FlowStatusHub application={makeApp()} language="en" onNavigateToStep={onNavigate} />);

    expect(card(/Step 1: Registration & Loan Application/)).toBeEnabled();
    expect(card(/Step 2: Sponsors & Loan Duration/)).toBeDisabled();
    expect(card(/Step 3: Bank Details & Final Submission/)).toBeDisabled();

    await user.click(card(/Step 2: Sponsors & Loan Duration/));
    await user.click(card(/Step 3: Bank Details & Final Submission/));
    expect(onNavigate).not.toHaveBeenCalled();

    await user.click(card(/Step 1: Registration & Loan Application/));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('step cards work from the keyboard and skip locked steps', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const app = makeApp({
      flowStatus: 'STEP1_APPROVED',
      unlockedStep: 2,
      stepStates: { 1: 'approved', 2: 'available', 3: 'locked' },
    });
    render(<FlowStatusHub application={app} language="en" onNavigateToStep={onNavigate} />);

    await user.tab();
    expect(card(/Step 1: Registration & Loan Application/)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenLastCalledWith(1);

    await user.tab();
    expect(card(/Step 2: Sponsors & Loan Duration/)).toHaveFocus();
    await user.keyboard(' ');
    expect(onNavigate).toHaveBeenLastCalledWith(2);

    // Step 3 is locked, so Tab moves past it.
    await user.tab();
    expect(card(/Step 3: Bank Details & Final Submission/)).not.toHaveFocus();
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('offers the next step once it is unlocked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const app = makeApp({
      flowStatus: 'STEP1_APPROVED',
      unlockedStep: 2,
      stepStates: { 1: 'approved', 2: 'available', 3: 'locked' },
      nextAction: { step: 2 },
    });
    render(<FlowStatusHub application={app} language="en" onNavigateToStep={onNavigate} />);

    await user.click(screen.getByRole('button', { name: /Continue to Step 2/ }));
    expect(onNavigate).toHaveBeenCalledWith(2);

    onNavigate.mockClear();
    await user.click(card(/Step 2: Sponsors & Loan Duration/));
    expect(onNavigate).toHaveBeenCalledWith(2);

    onNavigate.mockClear();
    await user.click(card(/Step 3: Bank Details & Final Submission/));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('shows the staff message when changes are requested', () => {
    const app = makeApp({
      flowStatus: 'STEP1_CHANGES_REQUESTED',
      stepStates: { 1: 'changes_requested', 2: 'locked', 3: 'locked' },
      staffMessage: { text: 'Please upload a clearer passport photo.', at: '2026-11-02T09:00:00.000Z', byRole: 'credit_reviewer', step: 1 },
    });
    render(<FlowStatusHub application={app} language="en" onNavigateToStep={vi.fn()} />);

    expect(screen.getByText('Staff Communication')).toBeInTheDocument();
    expect(screen.getByText(/Please upload a clearer passport photo\./)).toBeInTheDocument();
  });

  it('shows the rejection reason and hides the continue button when the loan is rejected', () => {
    const app = makeApp({
      flowStatus: 'LOAN_REJECTED',
      nextAction: { step: 2 },
      rejection: { atStep: '1', reason: 'Visa expires before the repayment period ends.' },
    });
    render(<FlowStatusHub application={app} language="en" onNavigateToStep={vi.fn()} />);

    expect(screen.getByText('Application Not Approved')).toBeInTheDocument();
    expect(screen.getByText('Visa expires before the repayment period ends.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue to Step/ })).toBeNull();
  });

  it('shows a translated default when the rejection has no reason', () => {
    const app = makeApp({ flowStatus: 'LOAN_REJECTED', rejection: { atStep: '1', reason: null } });
    const { unmount } = render(<FlowStatusHub application={app} language="en" onNavigateToStep={vi.fn()} />);
    expect(screen.getByText('Criteria not met at this stage.')).toBeInTheDocument();
    unmount();

    render(<FlowStatusHub application={app} language="he" onNavigateToStep={vi.fn()} />);
    expect(screen.getByText('הבקשה אינה עומדת בקריטריונים בשלב זה.')).toBeInTheDocument();
  });

  it('shows the approved heading and the loan amount and term', () => {
    const app = makeApp({
      flowStatus: 'LOAN_APPROVED',
      isCompleted: true,
      unlockedStep: 3,
      stepStates: { 1: 'approved', 2: 'approved', 3: 'approved' },
      loanBreakdown: breakdown,
    });
    render(<FlowStatusHub application={app} language="en" onNavigateToStep={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Application Approved!' })).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
    expect(screen.getByText(/6 months/)).toBeInTheDocument();
  });

  it('names each step state in text, not only with an icon', () => {
    const app = makeApp({
      flowStatus: 'STEP2_CHANGES_REQUESTED',
      unlockedStep: 2,
      stepStates: { 1: 'approved', 2: 'changes_requested', 3: 'locked' },
    });
    const { unmount } = render(<FlowStatusHub application={app} language="en" onNavigateToStep={vi.fn()} />);

    expect(card(/Step 1: Registration & Loan Application/)).toHaveAccessibleName(/Approved$/);
    expect(card(/Step 2: Sponsors & Loan Duration/)).toHaveAccessibleName(/Changes requested$/);
    expect(card(/Step 3: Bank Details & Final Submission/)).toHaveAccessibleName(/Locked$/);
    unmount();

    const states = { available: 'Ready to fill in', pending: 'Waiting for approval', submitted: 'Submitted', rejected: 'Not approved' } as const;
    for (const [state, label] of Object.entries(states)) {
      const { unmount: done } = render(
        <FlowStatusHub application={makeApp({ stepStates: { 1: state as any, 2: 'locked', 3: 'locked' } })} language="en" onNavigateToStep={vi.fn()} />
      );
      expect(card(/Step 1: Registration & Loan Application/)).toHaveAccessibleName(new RegExp(`${label}$`));
      done();
    }

    render(<FlowStatusHub application={app} language="he" onNavigateToStep={vi.fn()} />);
    expect(screen.getByRole('button', { name: /שלב 1/ })).toHaveAccessibleName(/אושר$/);
    expect(screen.getByRole('button', { name: /שלב 2/ })).toHaveAccessibleName(/נדרשים תיקונים$/);
  });

  it('renders in Hebrew', () => {
    render(<FlowStatusHub application={makeApp()} language="he" onNavigateToStep={vi.fn()} />);

    expect(screen.getByText('ממתין לאישור שלב 1')).toBeInTheDocument();
    expect(screen.getByText('מסלול הגשת הבקשה ב-3 שלבים')).toBeInTheDocument();
    expect(screen.getByText('שלב 1: הרשמה והגשת בקשה')).toBeInTheDocument();
  });
  describe('approved loan', () => {
    const approved = () =>
      makeApp({
        flowStatus: 'LOAN_APPROVED',
        isCompleted: true,
        unlockedStep: 3,
        stepStates: { 1: 'approved', 2: 'approved', 3: 'approved' },
        loanBreakdown: breakdown,
      });

    it('lets the applicant open all three completed steps to review them', async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      render(<FlowStatusHub application={approved()} language="en" onNavigateToStep={onNavigate} onStartNewApplication={vi.fn()} />);

      for (const [n, title] of [[1, /Step 1: Registration/], [2, /Step 2: Sponsors/], [3, /Step 3: Bank Details/]] as const) {
        expect(card(title)).toBeEnabled();
        await user.click(card(title));
        expect(onNavigate).toHaveBeenLastCalledWith(n);
      }
    });

    it('shows an active Submit Loan Application button at the bottom that starts a new application', async () => {
      const user = userEvent.setup();
      const onNew = vi.fn();
      const onNavigate = vi.fn();
      const { container } = render(<FlowStatusHub application={approved()} language="en" onNavigateToStep={onNavigate} onStartNewApplication={onNew} />);

      const btn = screen.getByRole('button', { name: 'Submit Loan Application' });
      expect(btn).toBeEnabled();
      const buttons = container.querySelectorAll('button');
      expect(buttons[buttons.length - 1]).toBe(btn);
      await user.click(btn);
      expect(onNew).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('shows the button in Hebrew', () => {
      render(<FlowStatusHub application={approved()} language="he" onNavigateToStep={vi.fn()} onStartNewApplication={vi.fn()} />);
      const hebrewSubmitText = "הגשת בקשת הלוואה";
      expect(screen.getByRole("button", { name: hebrewSubmitText })).toBeEnabled();
    });

    it('does not offer a new application before the loan is approved', () => {
      render(<FlowStatusHub application={makeApp({ flowStatus: 'PENDING_FINAL_PROCESSING', isCompleted: true })} language="en" onNavigateToStep={vi.fn()} onStartNewApplication={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Submit Loan Application' })).toBeNull();
    });
  });
});
