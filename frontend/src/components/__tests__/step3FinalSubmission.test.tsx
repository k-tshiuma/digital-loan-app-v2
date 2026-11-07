import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step3FinalSubmission } from '../Step3FinalSubmission';
import { apiService } from '../../services/api';
import { LoanBreakdown, Step3FormData, TermsVersionRecord } from '../../types';

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

const terms: Record<string, TermsVersionRecord> = {
  general: { type: 'general', version: '1.2', textEn: 'General terms in English.', textHe: 'תנאים כלליים בעברית.', sha256: 'a', effectiveFrom: '2026-01-01' },
  service_fee: { type: 'service_fee', version: '2.0', textEn: 'Service fee terms in English.', textHe: 'תנאי דמי שירות בעברית.', sha256: 'b', effectiveFrom: '2026-01-01' },
};

const filledData: Step3FormData = {
  bank: { bankName: 'Bank Leumi', bankCode: '10', branchNumber: '612', accountNumber: '12345678', accountHolderName: 'Somchai Worker' },
  bankDocument: { filename: 'bank.pdf', fileUrl: '/uploads/bank.pdf', originalName: 'bank-confirmation.pdf', mimeType: 'application/pdf', size: 1000 },
  terms: { generalVersion: '1.2', serviceFeeVersion: '2.0', generalAccepted: true, serviceFeeAccepted: true },
};

const submitBtn = () => screen.getByRole('button', { name: /Submit Final Loan Application/i });

async function fillForm(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await user.type(screen.getByPlaceholderText('e.g. 612'), ' 612 ');
  await user.type(screen.getByPlaceholderText('e.g. 12345678'), '12345678');
  const holder = screen.getAllByRole('textbox').find((el) => el.getAttribute('dir') !== 'ltr')!;
  await user.type(holder, 'Somchai Worker');
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, new File(['%PDF'], 'bank-confirmation.pdf', { type: 'application/pdf' }));
  await screen.findByText('bank-confirmation.pdf');
  await user.click(screen.getByRole('checkbox', { name: /General Terms & Conditions/i }));
  await user.click(screen.getByRole('checkbox', { name: /Service Fee Terms & Conditions/i }));
}

describe('Step3FinalSubmission', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the financial breakdown', () => {
    render(<Step3FinalSubmission language="en" breakdown={breakdown} termsVersions={terms} onSubmit={vi.fn()} />);

    expect(screen.getByText(/5,000/)).toBeInTheDocument();
    expect(screen.getByText(/5,112/)).toBeInTheDocument();
    expect(screen.getByText(/910/)).toBeInTheDocument();
  });

  it('shows a loading notice when there is no breakdown yet', () => {
    render(<Step3FinalSubmission language="en" breakdown={null} termsVersions={terms} onSubmit={vi.fn()} />);
    expect(screen.getByText('Loading financial figures...')).toBeInTheDocument();
  });

  it('uploads the bank document, then submits the trimmed bank details with the terms versions', async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(apiService, 'uploadFile').mockResolvedValue({
      filename: 'f_1.pdf', url: '/uploads/f_1.pdf', originalName: 'bank-confirmation.pdf', mimeType: 'application/pdf', size: 4,
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<Step3FinalSubmission language="en" breakdown={breakdown} termsVersions={terms} onSubmit={onSubmit} />);

    expect(submitBtn()).toBeDisabled();
    await fillForm(user, container);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(submitBtn()).toBeEnabled();

    await user.click(submitBtn());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload: Step3FormData = onSubmit.mock.calls[0][0];
    expect(payload.bank.branchNumber).toBe('612');
    expect(payload.bank.accountNumber).toBe('12345678');
    expect(payload.bank.accountHolderName).toBe('Somchai Worker');
    expect(payload.bank.bankName).toBeTruthy();
    expect(payload.bank.bankCode).toBeTruthy();
    expect(payload.bankDocument).toMatchObject({ filename: 'f_1.pdf', fileUrl: '/uploads/f_1.pdf' });
    expect(payload.terms).toEqual({ generalVersion: '1.2', serviceFeeVersion: '2.0', generalAccepted: true, serviceFeeAccepted: true });
  });

  it('keeps submit disabled until both terms are accepted', async () => {
    const user = userEvent.setup();
    render(<Step3FinalSubmission language="en" breakdown={breakdown} termsVersions={terms} initialData={{ ...filledData, terms: { ...filledData.terms, generalAccepted: false, serviceFeeAccepted: false } }} onSubmit={vi.fn()} />);

    expect(submitBtn()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /General Terms & Conditions/i }));
    expect(submitBtn()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Service Fee Terms & Conditions/i }));
    expect(submitBtn()).toBeEnabled();
  });

  it('shows the upload error when the bank document fails to upload', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiService, 'uploadFile').mockRejectedValue(new Error('File type not allowed'));
    const { container } = render(<Step3FinalSubmission language="en" breakdown={breakdown} termsVersions={terms} onSubmit={vi.fn()} />);

    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'bad.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('File type not allowed')).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });

  it('shows the server error when submission fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Step 3 is not unlocked yet'));
    render(<Step3FinalSubmission language="en" breakdown={breakdown} termsVersions={terms} initialData={filledData} onSubmit={onSubmit} />);

    await user.click(submitBtn());
    expect(await screen.findByText('Step 3 is not unlocked yet')).toBeInTheDocument();
    expect(submitBtn()).toBeEnabled();
  });

  it('prefills from initialData and locks everything when read-only', () => {
    render(<Step3FinalSubmission language="en" breakdown={breakdown} termsVersions={terms} initialData={filledData} isReadOnly onSubmit={vi.fn()} />);

    expect(screen.getByDisplayValue('612')).toBeDisabled();
    expect(screen.getByDisplayValue('12345678')).toBeDisabled();
    expect(screen.getByDisplayValue('Somchai Worker')).toBeDisabled();
    expect(screen.getByText('bank-confirmation.pdf')).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(submitBtn()).toBeDisabled();
  });

  it('opens each terms text in the applicant\'s language', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Step3FinalSubmission language="en" breakdown={breakdown} termsVersions={terms} onSubmit={vi.fn()} />);

    const [generalBtn, feeBtn] = screen.getAllByRole('button', { name: /View Terms/i });
    await user.click(generalBtn);
    expect(screen.getByText('General terms in English.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(screen.queryByText('General terms in English.')).toBeNull();

    await user.click(feeBtn);
    expect(screen.getByText('Service fee terms in English.')).toBeInTheDocument();
    unmount();

    render(<Step3FinalSubmission language="he" breakdown={breakdown} termsVersions={terms} onSubmit={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: /תנאי/ })[0]);
    expect(screen.getByText('תנאים כלליים בעברית.')).toBeInTheDocument();
  });

  it('calls onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<Step3FinalSubmission language="en" breakdown={breakdown} termsVersions={terms} onSubmit={vi.fn()} onBack={onBack} />);

    await user.click(screen.getByRole('button', { name: /^Back$/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
