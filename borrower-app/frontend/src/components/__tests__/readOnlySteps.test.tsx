import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Step1LeadGeneration } from '../Step1LeadGeneration';
import { Step2ApplicationCompletion } from '../Step2ApplicationCompletion';
import { Step3FinalSubmission } from '../Step3FinalSubmission';
import { apiService } from '../../services/api';
import { Step1FormData, Step3FormData } from '@quickloan/ui-core/types';

const doc = (name: string) => ({ filename: name, fileUrl: '/uploads/' + name, originalName: name, mimeType: 'application/pdf', size: 10 });

const step1: Step1FormData = {
  personal: {
    fullName: 'Somchai Prasert', phoneNumber: '+972501234567', dateOfBirth: '1988-05-14', address: 'Herzl St 45, Tel Aviv',
    passportNumber: 'TH7744112', countryOfOrigin: 'Thailand', visaStartDate: '2025-06-01', visaExpiryDate: '2028-05-31',
    monthlySalaryNis: 8200, salaryCurrency: 'ILS',
  },
  documents: { passport: doc('passport.pdf'), visa: doc('visa.pdf'), payslip: doc('payslip.pdf') },
  employment: { employerName: 'Yossi Cohen', companyName: 'Cohen Citrus Groves Ltd' },
  loan: { requestedAmountNis: 5000 },
};
const account = { fullName: 'Somchai Prasert', phoneNumber: '+972501234567', email: 's@example.com', authProvider: 'password' };
const step3: Step3FormData = {
  bank: { bankName: 'Bank Leumi', bankCode: '10', branchNumber: '612', accountNumber: '12345678', accountHolderName: 'Somchai Prasert' },
  bankDocument: doc('bank.pdf'),
  terms: { generalVersion: '1.0', serviceFeeVersion: '1.0', generalAccepted: true, serviceFeeAccepted: true },
};

describe('Approved application steps are read-only', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Step 1: shows the saved data, but nothing can be edited, uploaded or submitted', () => {
    const onSubmit = vi.fn();
    const upload = vi.spyOn(apiService, 'uploadFile');
    const { container } = render(<Step1LeadGeneration language="en" account={account as any} initialData={step1} isReadOnly onSubmit={onSubmit} />);

    expect(screen.getByDisplayValue('TH7744112')).toBeDisabled();
    expect(screen.getByDisplayValue('Herzl St 45, Tel Aviv')).toBeDisabled();
    expect(screen.getByText('passport.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct my legal name' })).toBeNull();
    container.querySelectorAll('input[type="file"]').forEach((f) => expect(f).toBeDisabled());
    const submit = screen.getByRole('button', { name: /Submit Loan Application/ });
    expect(submit).toBeDisabled();

    fireEvent.submit(container.querySelector('form')!);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'x.pdf')] } });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('Step 2: sponsors cannot be added or removed and the step cannot be submitted', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <Step2ApplicationCompletion
        language="en"
        isReadOnly
        initialData={{ loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 }, sponsors: [{ id: 's1', fullName: 'Anan Sukhumvit', idOrPassportNumber: 'AB9876543' }] }}
        onSubmit={onSubmit}
      />
    );
    expect(screen.getByText(/Anan Sukhumvit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
    expect(container.querySelector('input[type="range"]')).toBeDisabled();
    container.querySelectorAll('form button').forEach((b) => expect(b).toBeDisabled());
    expect(screen.getByRole('button', { name: /Submit Loan Application/ })).toBeDisabled();
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Step 3: bank details, document and terms are locked and cannot be submitted', () => {
    const onSubmit = vi.fn();
    const upload = vi.spyOn(apiService, 'uploadFile');
    const { container } = render(<Step3FinalSubmission language="en" breakdown={null} termsVersions={{}} initialData={step3} isReadOnly onSubmit={onSubmit} />);
    expect(screen.getByDisplayValue('12345678')).toBeDisabled();
    expect(container.querySelector('input[type="file"]')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Submit Final Loan Application/ })).toBeDisabled();
    fireEvent.submit(container.querySelector('form')!);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'x.pdf')] } });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});