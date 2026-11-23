import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowApplicationInspector } from '../FlowApplicationInspector';
import { BackOffice } from '../BackOffice';
import { normalizeFlowDetail } from '../../services/flowDetail';
import { UserRole } from '@quickloan/ui-core/types';

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
    onMarkLoanRepaid: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(<FlowApplicationInspector detail={makeDetail(flowStatus, extra)} language="en" currentRole={role} {...handlers} />);
  return { user: userEvent.setup(), unmount: view.unmount, ...handlers };

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

  it('shows the recorded registration consent and a legal-name correction', () => {
    setup('PENDING_STEP1_APPROVAL', 'credit_reviewer', {
      application: {
        step1Data: {
          personal: {
            fullName: 'Somchai Prasert', phoneNumber: '050-1234567', email: 'somchai@example.com',
            nameCorrection: { previousName: 'Somchai Prasrt', correctedName: 'Somchai Prasert', confirmedAt: '2026-11-01T00:00:00Z' },
          },
          registration: { disclaimerAcceptedAt: '2026-11-01T00:00:00Z', locationGranted: true },
        },
      },
    });

    expect(screen.getByText('Legal name corrected by the applicant (account name was: Somchai Prasrt)')).toBeInTheDocument();
    expect(screen.getByText('Granted ✓')).toBeInTheDocument();
    expect(screen.getByText('Accepted ✓')).toBeInTheDocument();
  });

  it('does not claim a consent that was not recorded', () => {
    setup('PENDING_STEP1_APPROVAL');
    expect(screen.queryByText('Granted ✓')).toBeNull();
    expect(screen.getAllByText('Not given')).toHaveLength(2);
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

  it('keeps Approve loan visible but disabled once the loan is approved, and clicking it does nothing', async () => {
    for (const role of ['credit_reviewer', 'system_admin'] as UserRole[]) {
      const { user, unmount, onFinalDecision, onApproveStep } = setup('LOAN_APPROVED', role);

      expect(screen.getByRole('status')).toHaveTextContent('A final decision has been made.');
      const approve = screen.getByRole('button', { name: 'Approve loan' });
      expect(approve).toBeDisabled();
      expect(approve).toHaveAttribute('title', 'This loan is already approved.');
      expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();

      await user.click(approve);
      expect(onFinalDecision).not.toHaveBeenCalled();
      expect(onApproveStep).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('marks an approved loan as repaid after a confirmation, for the roles allowed to', async () => {
    for (const role of ['credit_reviewer', 'system_admin', 'funding_entity'] as UserRole[]) {
      const { user, unmount, onMarkLoanRepaid } = setup('LOAN_APPROVED', role);
      await user.click(screen.getByRole('button', { name: 'Loan repaid' }));
      expect(onMarkLoanRepaid).not.toHaveBeenCalled();
      expect(screen.getByText(/Mark this loan as fully repaid\?/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Yes, the loan is repaid' }));
      expect(onMarkLoanRepaid).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('cancelling the confirmation does not mark the loan as repaid', async () => {
    const { user, onMarkLoanRepaid } = setup('LOAN_APPROVED');
    await user.click(screen.getByRole('button', { name: 'Loan repaid' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Yes, the loan is repaid' })).toBeNull();
    expect(onMarkLoanRepaid).not.toHaveBeenCalled();
  });

  it('does not offer Loan repaid to customer service, before approval or after a rejection', () => {
    const cases: [string, UserRole][] = [['LOAN_APPROVED', 'customer_service'], ['PENDING_FINAL_PROCESSING', 'credit_reviewer'], ['LOAN_REJECTED', 'system_admin']];
    for (const [status, role] of cases) {
      const { unmount } = setup(status, role);
      expect(screen.queryByRole('button', { name: 'Loan repaid' })).toBeNull();
      unmount();
    }
  });

  it('shows when and by whom a repaid loan was marked, with no button to mark it again', () => {
    setup('LOAN_APPROVED', 'credit_reviewer', { application: { loanRepaidAt: '2026-11-20T09:00:00.000Z', loanRepaidBy: 'Credit Reviewer' } });
    expect(screen.queryByRole('button', { name: 'Loan repaid' })).toBeNull();
    expect(screen.getByText(/Repaid on .* · Credit Reviewer/)).toBeInTheDocument();
  });

  it('shows the error when marking the loan as repaid fails', async () => {
    const { user, onMarkLoanRepaid } = setup('LOAN_APPROVED');
    onMarkLoanRepaid.mockRejectedValueOnce(new Error('This loan is already marked as repaid.'));
    await user.click(screen.getByRole('button', { name: 'Loan repaid' }));
    await user.click(screen.getByRole('button', { name: 'Yes, the loan is repaid' }));
    expect(await screen.findByText('This loan is already marked as repaid.')).toBeInTheDocument();
  });

  it('shows no decision buttons once the loan is rejected', () => {
    setup('LOAN_REJECTED');

    expect(screen.getByRole('status')).toHaveTextContent('A final decision has been made.');
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();
  });

  it('shows the Step 1 visa type with its code, and a dash for older records without one', () => {
    const { unmount } = setup('PENDING_STEP1_APPROVAL', 'credit_reviewer', {
      application: {
        step1Data: {
          personal: { fullName: 'Somchai Worker', phoneNumber: '050-1234567', visaType: 'foreign_expert' },
          employment: { employerName: 'Moshe Cohen', companyName: 'Green Farms' },
          loan: { requestedAmountNis: 5000 },
        },
      },
    });
    expect(screen.getAllByText('⁦B/1⁩ – Foreign Expert').length).toBeGreaterThan(0);
    unmount();

    setup('PENDING_STEP1_APPROVAL');
    expect(screen.queryByText(/Foreign Expert|Work Visa/)).toBeNull();
    expect(screen.getAllByText('Visa type:')[0].parentElement).toHaveTextContent('Visa type: —');
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
    // An older record without the guarantor's ID or passport copy says so
    expect(screen.getByText('ID / passport copy')).toBeInTheDocument();
    expect(screen.getByText('Not uploaded')).toBeInTheDocument();
  });

  it("shows each guarantor's ID or passport copy as a link on the Step 2 tab", async () => {
    const { user } = setup('PENDING_STEP2_APPROVAL', 'credit_reviewer', {
      application: {
        step2Data: {
          sponsors: [{ fullName: 'Avi Levi', idOrPassportNumber: '123456789', document: { filename: 'g1.pdf', fileUrl: '/api/uploads/g1.pdf', originalName: 'avi-id.pdf', mimeType: 'application/pdf', size: 10 } }],
          loan: { repaymentPeriodMonths: 6 },
        },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Step 2: Guarantors & term' }));
    const link = screen.getByRole('link', { name: /Open/ });
    expect(link.getAttribute('href')).toContain('/api/uploads/g1.pdf');
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

  it('shows a drawn signature as an image, a typed one as the name, and a notice when there is none', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const bank = { bankName: 'Bank Leumi', accountNumber: '****5678' };
    const drawn = setup('PENDING_FINAL_PROCESSING', 'credit_reviewer', {
      application: { step3Data: { bank, signature: { signatureMethod: 'drawn_touch', signatureValue: '', signatureDataUri: png, signedAt: '2026-11-17T10:00:00.000Z' } } },
    });
    await drawn.user.click(screen.getByRole('button', { name: 'Step 3: Bank & terms' }));
    expect(screen.getByText('Drawn by hand')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Applicant’s drawn signature' })).toHaveAttribute('src', png);
    drawn.unmount();

    const typed = setup('PENDING_FINAL_PROCESSING', 'credit_reviewer', {
      application: { step3Data: { bank, signature: { signatureMethod: 'typed_name', signatureValue: 'Somchai Q. Worker', signedAt: '2026-11-17T10:00:00.000Z' } } },
    });
    await typed.user.click(screen.getByRole('button', { name: 'Step 3: Bank & terms' }));
    expect(screen.getByText('Typed name')).toBeInTheDocument();
    expect(screen.getByText('Somchai Q. Worker')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Applicant’s drawn signature' })).not.toBeInTheDocument();
    typed.unmount();

    const none = setup('PENDING_FINAL_PROCESSING', 'credit_reviewer');
    await none.user.click(screen.getByRole('button', { name: 'Step 3: Bank & terms' }));
    expect(screen.getByText(/No signature on file/)).toBeInTheDocument();
  });

  it('allows hiding and re-showing a revealed bank account', async () => {
    const { user } = setup('PENDING_FINAL_PROCESSING', 'system_admin', {
      application: {
        step3Data: { bank: { bankName: 'Bank Leumi', accountNumber: '12345678' } },
      },
      bankRevealed: true,
    });

    await user.click(screen.getByRole('button', { name: 'Step 3: Bank & terms' }));
    expect(screen.getByText('12345678')).toBeInTheDocument();
    const hideBtn = screen.getByRole('button', { name: 'Hide' });
    expect(hideBtn).toBeInTheDocument();

    // Clicking Hide toggles back to masked display
    await user.click(hideBtn);
    expect(screen.getByText('****5678')).toBeInTheDocument();
    const showAgainBtn = screen.getByRole('button', { name: 'Show' });
    expect(showAgainBtn).toBeInTheDocument();

    // Clicking Show restores full account display
    await user.click(showAgainBtn);
    expect(screen.getByText('12345678')).toBeInTheDocument();
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

  it('displays passport number, country of origin, visa validity period, and monthly salary in English and Hebrew', () => {
    const detail = makeDetail('PENDING_STEP1_APPROVAL', {
      application: {
        step1Data: {
          personal: {
            fullName: 'Grace Mensah',
            phoneNumber: '054-7788990',
            dateOfBirth: '1992-08-15',
            address: 'Dizengoff 100, Tel Aviv',
            passportNumber: 'GH9988112',
            countryOfOrigin: 'Ghana',
            visaStartDate: '2025-03-01',
            visaExpiryDate: '2028-02-29',
            monthlySalaryNis: 7850,
            salaryCurrency: 'ILS',
          },
          employment: { employerName: 'Moshe Cohen', companyName: 'Green Farms' },
          loan: { requestedAmountNis: 6000 },
        },
      },
    });

    const handlers = {
      onClose: vi.fn(),
      onApproveStep: vi.fn().mockResolvedValue(undefined),
      onRequestStepChanges: vi.fn().mockResolvedValue(undefined),
      onRejectStep: vi.fn().mockResolvedValue(undefined),
      onFinalDecision: vi.fn().mockResolvedValue(undefined),
      onSendMessage: vi.fn().mockResolvedValue(undefined),
    };

    const { rerender } = render(
      <FlowApplicationInspector detail={detail} language="en" currentRole="credit_reviewer" {...handlers} />
    );

    expect(screen.getByText('GH9988112')).toBeInTheDocument();
    expect(screen.getByText('Ghana')).toBeInTheDocument();
    expect(screen.getByText(/01\/03\/2025/)).toBeInTheDocument();
    expect(screen.getByText(/29\/02\/2028/)).toBeInTheDocument();
    expect(screen.getByText(/7,850/)).toBeInTheDocument();

    rerender(
      <FlowApplicationInspector detail={detail} language="he" currentRole="credit_reviewer" {...handlers} />
    );

    expect(screen.getByText('GH9988112')).toBeInTheDocument();
    expect(screen.getByText('גאנה')).toBeInTheDocument();
  });

  it('displays Push to Partner at the bottom of the popup for approved loans across Agent, Credit Reviewer, and System Admin roles and does nothing on click', async () => {
    const roles: UserRole[] = ['customer_service', 'credit_reviewer', 'system_admin'];
    for (const role of roles) {
      const { user, unmount, onClose, onApproveStep, onRejectStep, onFinalDecision } = setup('LOAN_APPROVED', role);
      const pushBtn = screen.getByRole('button', { name: 'Push to Partner' });
      expect(pushBtn).toBeInTheDocument();
      expect(pushBtn).toBeEnabled();

      await user.click(pushBtn);
      expect(onClose).not.toHaveBeenCalled();
      expect(onApproveStep).not.toHaveBeenCalled();
      expect(onRejectStep).not.toHaveBeenCalled();
      expect(onFinalDecision).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('hides Push to Partner in the popup when the loan is not approved', () => {
    const unapprovedStatuses = [
      'LEAD_REGISTERED',
      'PENDING_STEP1_APPROVAL',
      'STEP1_CHANGES_REQUESTED',
      'STEP1_APPROVED',
      'PENDING_STEP2_APPROVAL',
      'STEP2_CHANGES_REQUESTED',
      'STEP2_APPROVED',
      'PENDING_FINAL_PROCESSING',
      'LOAN_REJECTED',
    ];
    for (const status of unapprovedStatuses) {
      const { unmount } = render(
        <FlowApplicationInspector
          detail={makeDetail(status)}
          language="en"
          currentRole="credit_reviewer"
          onClose={vi.fn()}
          onApproveStep={vi.fn()}
          onRequestStepChanges={vi.fn()}
          onRejectStep={vi.fn()}
          onFinalDecision={vi.fn()}
          onSendMessage={vi.fn()}
        />
      );
      expect(screen.queryByRole('button', { name: 'Push to Partner' })).toBeNull();
      unmount();
    }
  });

  it('displays Push to Partner under Loan Approved in the admin panel only for approved loans and opens the popup with Push to Partner when clicking Inspect or Loan Approved', async () => {
    const approvedApp = {
      id: 'app_approved_1',
      requestNumber: 'REQ-2026-100343',
      flowVersion: 2,
      flowStatus: 'LOAN_APPROVED',
      group: 'approved_final',
      status: 'Approved',
      applicantName: 'Chinedu Okafor',
      language: 'en',
      phoneNumber: '+972553592974',
      email: 'chinedu.okafor87@gmail.com',
      requestedAmountNis: 6000,
      repaymentPeriodMonths: 6,
      documents: [],
      consents: [],
      statusHistory: [],
      createdAt: '2026-11-11T15:00:00.000Z',
      updatedAt: '2026-11-11T15:10:00.000Z',
    };
    const pendingApp = {
      id: 'app_pending_1',
      requestNumber: 'REQ-2026-100342',
      flowVersion: 2,
      flowStatus: 'PENDING_STEP1_APPROVAL',
      group: 'pending',
      status: 'Received',
      applicantName: 'Somchai Worker',
      language: 'en',
      phoneNumber: '+972501234567',
      requestedAmountNis: 5000,
      repaymentPeriodMonths: 6,
      documents: [],
      consents: [],
      statusHistory: [],
      createdAt: '2026-11-11T14:00:00.000Z',
      updatedAt: '2026-11-11T14:00:00.000Z',
    };

    const fetchSpy = vi.fn(async (url: string) => {
      const path = String(url).replace(/^.*\/api/, '');
      const ok = (body: object) => new Response(JSON.stringify({ success: true, ...body }), { status: 200 });
      if (path === '/auth/staff-token') return ok({ token: 'staff.jwt.token' });
      if (path === '/applications') return ok({ applications: [approvedApp, pendingApp] });
      if (path === '/flow/applications/app_approved_1') {
        return ok({
          application: approvedApp,
          view: { group: 'approved_final', stepStates: { 1: 'approved', 2: 'approved', 3: 'approved' } },
          user: { email: 'chinedu.okafor87@gmail.com', fullName: 'Chinedu Okafor', phoneNumber: '+972553592974' },
          acceptances: [],
          reviews: [],
        });
      }
      if (path.startsWith('/config/credit-rules')) return ok({ rules: {} });
      return ok({});
    });
    vi.stubGlobal('fetch', fetchSpy);

    const user = userEvent.setup();
    const { rerender } = render(
      <BackOffice language="en" currentRole="customer_service" onRoleChange={() => {}} onCloseBackOffice={() => {}} />
    );

    await waitFor(() => expect(screen.getByText('REQ-2026-100343')).toBeInTheDocument());

    // Only 1 "Push to Partner" button in the table (for the approved row, not the pending row)
    expect(screen.getAllByRole('button', { name: 'Push to Partner' })).toHaveLength(1);

    // Clicking the table's "Push to Partner" button does nothing (does not open the modal)
    await user.click(screen.getByRole('button', { name: 'Push to Partner' }));
    expect(screen.queryByRole('status')).toBeNull();

    // Clicking "Loan Approved" in the row opens the popup with "Push to Partner" at the bottom
    const statusBadges = screen.getAllByText('Loan Approved');
    const rowBadge = statusBadges.find((el) => el.closest('tr'));
    expect(screen.getByRole('button', { name: 'Push to Partner' }).closest('td')).toBe(rowBadge!.closest('td'));
    await user.click(rowBadge!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Push to Partner' })).toHaveLength(2));

    // Also accessible for credit_reviewer and system_admin
    rerender(<BackOffice language="en" currentRole="credit_reviewer" onRoleChange={() => {}} onCloseBackOffice={() => {}} />);
    expect(screen.getAllByRole('button', { name: 'Push to Partner' })).toHaveLength(2);

    rerender(<BackOffice language="en" currentRole="system_admin" onRoleChange={() => {}} onCloseBackOffice={() => {}} />);
    expect(screen.getAllByRole('button', { name: 'Push to Partner' })).toHaveLength(2);

    vi.unstubAllGlobals();
  });

  it('keeps Hebrew employee info assertions', () => {
    const detail = makeDetail('PENDING_STEP1_APPROVAL', {
      application: {
        step1Data: {
          personal: {
            fullName: 'Grace Mensah',
            phoneNumber: '054-7788990',
            dateOfBirth: '1992-08-15',
            address: 'Dizengoff 100, Tel Aviv',
            passportNumber: 'GH9988112',
            countryOfOrigin: 'Ghana',
            visaStartDate: '2025-03-01',
            visaExpiryDate: '2028-02-29',
            monthlySalaryNis: 7850,
            salaryCurrency: 'ILS',
          },
          employment: { employerName: 'Moshe Cohen', companyName: 'Green Farms' },
          loan: { requestedAmountNis: 6000 },
        },
      },
    });
    render(
      <FlowApplicationInspector
        detail={detail}
        language="he"
        currentRole="credit_reviewer"
        onClose={vi.fn()}
        onApproveStep={vi.fn()}
        onRequestStepChanges={vi.fn()}
        onRejectStep={vi.fn()}
        onFinalDecision={vi.fn()}
        onSendMessage={vi.fn()}
      />
    );
    expect(screen.getByText('גאנה')).toBeInTheDocument();
    expect(screen.getByText(/01\.03\.2025/)).toBeInTheDocument();
    expect(screen.getByText(/29\.02\.2028/)).toBeInTheDocument();
    expect(screen.getByText(/7,850/)).toBeInTheDocument();
  });
});
