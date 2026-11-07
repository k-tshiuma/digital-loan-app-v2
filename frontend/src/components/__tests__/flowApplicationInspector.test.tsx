import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowApplicationInspector } from '../FlowApplicationInspector';
import { normalizeFlowDetail } from '../../services/flowDetail';
import { UserRole } from '../../types';

function makeDetail(flowStatus: string, extra: Record<string, any> = {}) {
  return normalizeFlowDetail({
    application: {
      id: 'app_1',
      requestNumber: 'REQ-2026-100001',
      flowStatus,
      step1Data: {
        personal: { fullName: 'Somchai Worker', phoneNumber: '050-1234567', address: 'Herzl 10, Tel Aviv' },
        employment: { employerName: 'Moshe Cohen', companyName: 'Green Farms' },
        loan: { requestedAmountNis: 5000 },
      },
      step2Data: { sponsors: [{ fullName: 'Avi Levi', idOrPassportNumber: '123456789' }], loan: { repaymentPeriodMonths: 6 } },
      step3Data: { bank: { bankName: 'Bank Leumi', bankCode: '10', branchNumber: '612', accountNumber: '****5678', accountHolderName: 'Somchai Worker' } },
      loanBreakdown: { requestedAmountNis: 5000, repaymentPeriodMonths: 6, totalInterestNis: 112, totalServiceFeeNis: 350, overallTotalNis: 5462, monthlyLoanRepaymentNis: 852, monthlyServiceFeeNis: 58 },
      ...extra.application,
    },
    view: { group: 'pending', stepStates: { 1: 'pending' } },
    user: { email: 'somchai@example.com', fullName: 'Somchai Worker', phoneNumber: '050-1234567' },
    acceptances: extra.acceptances || [],
    reviews: extra.reviews || [],
  });
}

function setup(flowStatus: string, role: UserRole = 'credit_reviewer', extra: Record<string, any> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onApproveStep: vi.fn().mockResolvedValue(undefined),
    onRequestStepChanges: vi.fn().mockResolvedValue(undefined),
    onRejectStep: vi.fn().mockResolvedValue(undefined),
    onFinalDecision: vi.fn().mockResolvedValue(undefined),
    onSendMessage: vi.fn().mockResolvedValue(undefined),
    onRevealBank: vi.fn().mockResolvedValue(undefined),
  };
  render(<FlowApplicationInspector detail={makeDetail(flowStatus, extra)} language="en" currentRole={role} {...handlers} />);
  return { user: userEvent.setup(), ...handlers };
}

describe('FlowApplicationInspector', () => {
  it('shows the applicant header and Step 1 details', () => {
    setup('PENDING_STEP1_APPROVAL');

    expect(screen.getByText('REQ-2026-100001')).toBeInTheDocument();
    expect(screen.getByText('Pending Step 1 Approval')).toBeInTheDocument();
    expect(screen.getByText('somchai@example.com', { selector: 'bdi.font-mono' })).toBeInTheDocument();
    expect(screen.getByText('Moshe Cohen')).toBeInTheDocument();
    expect(screen.getByText('Green Farms')).toBeInTheDocument();
  });

  it('lets a credit reviewer approve the pending step, with the note', async () => {
    const { user, onApproveStep } = setup('PENDING_STEP1_APPROVAL');

    expect(screen.getByRole('status')).toHaveTextContent('Step 1 is waiting for your decision.');
    await user.click(screen.getByRole('button', { name: 'Approve Step 1' }));
    expect(onApproveStep).toHaveBeenCalledWith(1, undefined);
  });

  it('requires corrections before requesting changes', async () => {
    const { user, onRequestStepChanges } = setup('PENDING_STEP2_APPROVAL');

    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    const send = screen.getByRole('button', { name: 'Send changes request' });
    expect(send).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Describe what the applicant needs to change/), '  Add a second guarantor  ');
    await user.click(send);
    expect(onRequestStepChanges).toHaveBeenCalledWith(2, '', 'Add a second guarantor');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send changes request' })).toBeNull());
  });

  it('requires a reason before rejecting a step', async () => {
    const { user, onRejectStep } = setup('PENDING_STEP1_APPROVAL');

    await user.click(screen.getByRole('button', { name: 'Reject Step 1' }));
    const confirm = screen.getByRole('button', { name: 'Confirm rejection' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Why is this being rejected?'), 'Forged payslip');
    await user.click(confirm);
    expect(onRejectStep).toHaveBeenCalledWith(1, 'Forged payslip');
  });

  it('offers the final decisions once the final application is submitted', async () => {
    const { user, onFinalDecision } = setup('PENDING_FINAL_PROCESSING', 'system_admin');

    expect(screen.getByRole('status')).toHaveTextContent('The final application is waiting for your decision.');
    await user.click(screen.getByRole('button', { name: 'Approve loan' }));
    expect(onFinalDecision).toHaveBeenLastCalledWith('APPROVE', undefined);

    await user.click(screen.getByRole('button', { name: 'Request more documents' }));
    expect(onFinalDecision).toHaveBeenLastCalledWith('ADDITIONAL_DOCS', undefined);

    await user.click(screen.getByRole('button', { name: 'Reject loan' }));
    await user.type(screen.getByPlaceholderText('Why is this being rejected?'), 'Income too low');
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(onFinalDecision).toHaveBeenLastCalledWith('REJECT', 'Income too low');
  });

  it('locks decisions for roles that may not decide', () => {
    setup('PENDING_STEP1_APPROVAL', 'customer_service');

    expect(screen.getByRole('status')).toHaveTextContent(/Only a credit reviewer or system admin can decide/);
    expect(screen.getByRole('button', { name: 'Approve Step 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject Step 1' })).toBeDisabled();
  });

  it('locks decisions while waiting for the applicant', () => {
    setup('STEP1_APPROVED');

    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the applicant to submit Step 2.');
    expect(screen.getByRole('button', { name: 'Approve Step 2' })).toBeDisabled();
  });

  it('shows no decision buttons once the loan is decided', () => {
    setup('LOAN_APPROVED');

    expect(screen.getByRole('status')).toHaveTextContent('A final decision has been made.');
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();
  });

  it('shows the localized error when a decision fails', async () => {
    const { user, onApproveStep } = setup('PENDING_STEP1_APPROVAL');
    onApproveStep.mockRejectedValueOnce(new Error('Step 1 was already decided'));

    await user.click(screen.getByRole('button', { name: 'Approve Step 1' }));
    expect(await screen.findByText('Step 1 was already decided')).toBeInTheDocument();
  });

  it('shows guarantors and term on the Step 2 tab', async () => {
    const { user } = setup('PENDING_STEP2_APPROVAL');

    await user.click(screen.getByRole('button', { name: 'Step 2: Guarantors & term' }));
    expect(screen.getByText('Avi Levi')).toBeInTheDocument();
    expect(screen.getByText('123456789')).toBeInTheDocument();
  });

  it('shows the masked account on the Step 3 tab and reveals it on request', async () => {
    const { user, onRevealBank } = setup('PENDING_FINAL_PROCESSING', 'system_admin', {
      acceptances: [{ termsType: 'general', version: '1.0', acceptedAt: '2026-11-03T08:00:00.000Z', textSha256: 'f'.repeat(64) }],
    });

    await user.click(screen.getByRole('button', { name: 'Step 3: Bank & terms' }));
    expect(screen.getByText('****5678')).toBeInTheDocument();
    expect(screen.getByText('1.0')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(onRevealBank).toHaveBeenCalled();
  });

  it('shows the financial breakdown tab', async () => {
    const { user } = setup('PENDING_FINAL_PROCESSING');

    await user.click(screen.getByRole('button', { name: 'Financial breakdown' }));
    expect(screen.getByText(/5,462/)).toBeInTheDocument();
    expect(screen.getByText(/852/)).toBeInTheDocument();
  });

  it('sends a trimmed message to the applicant', async () => {
    const { user, onSendMessage } = setup('PENDING_STEP1_APPROVAL');

    await user.click(screen.getByRole('button', { name: 'Decisions & messages' }));
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Message for the applicant...'), '  Please call us  ');
    await user.click(send);
    expect(onSendMessage).toHaveBeenCalledWith('Please call us');
  });

  it('lists past reviews on the decisions tab', async () => {
    const { user } = setup('STEP1_APPROVED', 'credit_reviewer', {
      reviews: [{ step: 1, decision: 'approve', note: 'Documents look fine', reviewerName: 'Dana Reviewer', decidedAt: '2026-11-02T09:00:00.000Z' }],
    });

    await user.click(screen.getByRole('button', { name: 'Decisions & messages' }));
    expect(screen.getByText('Documents look fine')).toBeInTheDocument();
    expect(screen.getByText(/Dana Reviewer/)).toBeInTheDocument();
  });

  it('closes', async () => {
    const { user, onClose } = setup('LOAN_APPROVED');

    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
