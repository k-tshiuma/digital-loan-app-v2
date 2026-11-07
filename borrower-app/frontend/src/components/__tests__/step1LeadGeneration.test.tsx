import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step1LeadGeneration } from '../Step1LeadGeneration';
import { STEP1_ORIGIN_COUNTRIES } from '@quickloan/ui-core/config/appConfig';
import { FlowApplicationView, Step1FormData, UploadedDocRef } from '@quickloan/ui-core/types';
import { ApiError } from '../../services/api';

const EXPECTED_COUNTRIES = [
  'China',
  'Thailand',
  'India',
  'Nepal',
  'Philippines',
  'Nigeria',
  'Ghana',
  'Congo',
  'Malawi',
  'South Africa',
  'Zambia',
  'Kenya',
  'Tanzania',
  'Uganda',
];

const samuel: FlowApplicationView['account'] = {
  fullName: 'Samuel Okello',
  phoneNumber: '0521234567',
  email: 'samuel@example.com',
  authProvider: 'password',
};

const dummyDoc = (name: string): UploadedDocRef => ({
  filename: `stored_${name}`,
  fileUrl: `/api/uploads/stored_${name}`,
  originalName: name,
  mimeType: 'application/pdf',
  size: 1024,
});

function fillDateBoxes(baseId: string, day: string, month: string, year: string) {
  fireEvent.change(document.getElementById(baseId)!, { target: { value: day } });
  fireEvent.change(document.getElementById(`${baseId}-month`)!, { target: { value: month } });
  fireEvent.change(document.getElementById(`${baseId}-year`)!, { target: { value: year } });
}

describe('Step1LeadGeneration – Additional Employee Information Fields', () => {
  it('positions the 4 new mandatory fields immediately above the Documents section and lists all 14 countries in order', () => {
    expect(Array.from(STEP1_ORIGIN_COUNTRIES)).toEqual(EXPECTED_COUNTRIES);

    render(
      <Step1LeadGeneration
        language="en"
        account={samuel}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const employeeSection = screen.getByTestId('step1-employee-info-section');
    const documentsSection = screen.getByTestId('step1-documents-section');

    // Employee info section must appear BEFORE the Documents section in DOM order, as its immediate previous sibling
    expect(
      employeeSection.compareDocumentPosition(documentsSection) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(employeeSection.nextElementSibling).toBe(documentsSection);

    // Check all 4 inputs exist inside the section above Documents
    const passportInput = screen.getByLabelText(/Passport Number/i);
    const countrySelect = screen.getByLabelText(/Country of Origin/i) as HTMLSelectElement;
    const visaStartDay = document.getElementById('step1-visa-start');
    const visaExpiryDay = document.getElementById('step1-visa-expiry');
    const salaryInput = screen.getByLabelText(/Monthly Salary/i);

    expect(employeeSection.contains(passportInput)).toBe(true);
    expect(employeeSection.contains(countrySelect)).toBe(true);
    expect(employeeSection.contains(visaStartDay)).toBe(true);
    expect(employeeSection.contains(visaExpiryDay)).toBe(true);
    expect(employeeSection.contains(salaryInput)).toBe(true);
    expect(salaryInput).toHaveAttribute('type', 'number');
    expect(employeeSection).toHaveTextContent('₪');
    expect(employeeSection).toHaveTextContent('NIS');

    // Check exact 14 country options in dropdown (excluding placeholder option at index 0)
    const countryValues = Array.from(countrySelect.options)
      .slice(1)
      .map((opt) => opt.value);
    expect(countryValues).toEqual(EXPECTED_COUNTRIES);
  });

  it('translates all 4 new fields and all 14 country options cleanly in Hebrew while preserving English values', () => {
    render(
      <Step1LeadGeneration
        language="he"
        account={samuel}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const countrySelect = screen.getByLabelText(/ארץ מוצא/) as HTMLSelectElement;
    const options = Array.from(countrySelect.options).slice(1);
    expect(options.map((o) => o.value)).toEqual(EXPECTED_COUNTRIES);
    expect(options.find((o) => o.value === 'Nigeria')?.textContent).toBe('ניגריה');
    expect(options.find((o) => o.value === 'South Africa')?.textContent).toBe('דרום אפריקה');
    expect(options.find((o) => o.value === 'Uganda')?.textContent).toBe('אוגנדה');

    const employeeSection = screen.getByTestId('step1-employee-info-section');
    expect(employeeSection).toHaveTextContent('ש״ח');
  });

  it('enforces mandatory validation on all 4 new fields and validates visa date range', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Step1LeadGeneration
        language="en"
        account={samuel}
        initialData={{
          personal: {
            fullName: 'Samuel Okello',
            phoneNumber: '0521234567',
            dateOfBirth: '1990-04-12',
            address: 'Allenby 22, Tel Aviv',
          },
          documents: {
            passport: dummyDoc('passport.pdf'),
            visa: dummyDoc('visa.pdf'),
            payslip: dummyDoc('payslip.pdf'),
          },
          employment: {
            employerName: 'David Levi',
            companyName: 'Levi Logistics Ltd',
          },
          loan: { requestedAmountNis: 5000 },
        }}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Submit Loan Application/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Passport number is required')).toBeInTheDocument();
    expect(screen.getByText('Country of origin is required')).toBeInTheDocument();
    expect(screen.getByText('Visa start date is required')).toBeInTheDocument();
    expect(screen.getByText('Visa expiry date is required')).toBeInTheDocument();
    expect(screen.getByText('Valid monthly salary is required')).toBeInTheDocument();

    // Enter reversed visa validity period (expiry before start)
    fireEvent.change(screen.getByLabelText(/Passport Number/i), { target: { value: 'UG4455667' } });
    fireEvent.change(screen.getByLabelText(/Country of Origin/i), { target: { value: 'Uganda' } });
    fillDateBoxes('step1-visa-start', '15', '06', '2027');
    fillDateBoxes('step1-visa-expiry', '01', '06', '2026');
    fireEvent.change(screen.getByLabelText(/Monthly Salary/i), { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: /Submit Loan Application/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Visa expiry date must be on or after the start date')).toBeInTheDocument();
    expect(screen.getByText('Valid monthly salary is required')).toBeInTheDocument();
  });

  it('submits all 4 new employee fields accurately in the Step 1 payload', async () => {
    let submitted: Step1FormData | null = null;
    const onSubmit = vi.fn(async (data: Step1FormData) => {
      submitted = data;
    });

    render(
      <Step1LeadGeneration
        language="en"
        account={samuel}
        initialData={{
          personal: {
            fullName: 'Samuel Okello',
            phoneNumber: '0521234567',
            dateOfBirth: '1990-04-12',
            address: 'Allenby 22, Tel Aviv',
          },
          documents: {
            passport: dummyDoc('passport.pdf'),
            visa: dummyDoc('visa.pdf'),
            payslip: dummyDoc('payslip.pdf'),
          },
          employment: {
            employerName: 'David Levi',
            companyName: 'Levi Logistics Ltd',
            manpowerAgent: 'GlobalStaff IL',
          },
          loan: { requestedAmountNis: 6500 },
        }}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText(/Passport Number/i), { target: { value: '  KE8899001  ' } });
    fireEvent.change(screen.getByLabelText(/Country of Origin/i), { target: { value: 'Kenya' } });
    fillDateBoxes('step1-visa-start', '01', '05', '2025');
    fillDateBoxes('step1-visa-expiry', '30', '04', '2028');
    fireEvent.change(screen.getByLabelText(/Monthly Salary/i), { target: { value: '8450' } });

    fireEvent.click(screen.getByRole('button', { name: /Submit Loan Application/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted).not.toBeNull();
    expect(submitted!.personal).toEqual({
      fullName: 'Samuel Okello',
      phoneNumber: '0521234567',
      email: 'samuel@example.com',
      dateOfBirth: '1990-04-12',
      address: 'Allenby 22, Tel Aviv',
      passportNumber: 'KE8899001',
      countryOfOrigin: 'Kenya',
      visaStartDate: '2025-05-01',
      visaExpiryDate: '2028-04-30',
      monthlySalaryNis: 8450,
      salaryCurrency: 'ILS',
    });
    expect(submitted!.employment.monthlySalaryNis).toBe(8450);
    expect(submitted!.employment.salaryCurrency).toBe('ILS');
  });
});

const account: FlowApplicationView['account'] = {
  fullName: 'Somchai Prasrt',
  phoneNumber: '+972501234567',
  email: 'somchai@example.com',
  authProvider: 'password',
};

const doc = (name: string) => ({ filename: name, fileUrl: `/uploads/${name}`, originalName: name, mimeType: 'application/pdf', size: 10 });
const filled: Step1FormData = {
  personal: {
    fullName: '', phoneNumber: '', dateOfBirth: '1988-05-14', address: 'Herzl St 45, Tel Aviv',
    passportNumber: 'TH7744112', countryOfOrigin: 'Thailand', visaStartDate: '2025-06-01', visaExpiryDate: '2028-05-31',
    monthlySalaryNis: 8200, salaryCurrency: 'ILS',
  },
  documents: { passport: doc('passport.pdf'), visa: doc('visa.pdf'), payslip: doc('payslip.pdf') },
  employment: { employerName: 'Yossi Cohen', companyName: 'Cohen Citrus Groves Ltd' },
  loan: { requestedAmountNis: 5000 },
};

const nameInput = () => screen.getByLabelText(/Full Name/) as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: /Submit/ });

describe('Step1LeadGeneration (identity from the account)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has no registration, location or Google sign-up inside Step 1', () => {
    render(<Step1LeadGeneration language="en" account={account} onSubmit={vi.fn()} />);
    expect(screen.queryByText('Location required')).not.toBeInTheDocument();
    expect(screen.queryByText(/Google/)).not.toBeInTheDocument();
    expect(screen.queryByText('Account Credentials')).not.toBeInTheDocument();
  });

  it('pre-fills name, phone and email from the account and protects them', () => {
    render(<Step1LeadGeneration language="en" account={account} onSubmit={vi.fn()} />);
    expect(nameInput()).toHaveValue('Somchai Prasrt');
    expect(nameInput()).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Phone Number')).toHaveValue('+972501234567');
    expect(screen.getByLabelText('Phone Number')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Email Address')).toHaveValue('somchai@example.com');
    expect(screen.getByLabelText('Email Address')).toHaveAttribute('readonly');
  });

  it('submits the account details unchanged when no correction is made', async () => {
    const u = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step1LeadGeneration language="en" account={account} initialData={filled} onSubmit={onSubmit} />);

    await u.click(submit());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const personal = onSubmit.mock.calls[0][0].personal;
    expect(personal).toMatchObject({ fullName: 'Somchai Prasrt', phoneNumber: '+972501234567', email: 'somchai@example.com' });
    expect(personal.legalNameConfirmed).toBeUndefined();
  });

  it('allows a legal-name correction only with the passport confirmation', async () => {
    const u = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step1LeadGeneration language="en" account={account} initialData={filled} onSubmit={onSubmit} />);

    await u.click(screen.getByRole('button', { name: 'Correct my legal name' }));
    expect(nameInput()).not.toHaveAttribute('readonly');
    await u.clear(nameInput());
    await u.type(nameInput(), 'Somchai Prasert');
    await u.click(submit());
    expect(screen.getByText('Please confirm that the corrected name matches your passport.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await u.click(screen.getByRole('checkbox', { name: /full legal name/ }));
    await u.click(submit());
    expect(onSubmit.mock.calls[0][0].personal).toMatchObject({ fullName: 'Somchai Prasert', legalNameConfirmed: true });
  });

  it('restores the account name when the correction is cancelled', async () => {
    const u = userEvent.setup();
    render(<Step1LeadGeneration language="en" account={account} onSubmit={vi.fn()} />);
    await u.click(screen.getByRole('button', { name: 'Correct my legal name' }));
    await u.type(nameInput(), 'xx');
    await u.click(screen.getByRole('button', { name: 'Cancel correction' }));
    expect(nameInput()).toHaveValue('Somchai Prasrt');
    expect(nameInput()).toHaveAttribute('readonly');
  });

  it('rejects names with characters that cannot be on a passport', async () => {
    const u = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Step1LeadGeneration language="en" account={account} initialData={filled} onSubmit={onSubmit} />);
    await u.click(screen.getByRole('button', { name: 'Correct my legal name' }));
    await u.clear(nameInput());
    await u.type(nameInput(), 'Somchai <b>');
    await u.click(screen.getByRole('checkbox', { name: /full legal name/ }));
    await u.click(submit());
    expect(screen.getByText('Use letters, spaces, hyphens and apostrophes only.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the server field error for an unconfirmed name', async () => {
    const u = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new ApiError('Please complete all required fields.', 422, { code: 'VALIDATION', fieldErrors: { fullName: 'legal_name_unconfirmed' } }));
    render(<Step1LeadGeneration language="en" account={account} initialData={filled} onSubmit={onSubmit} />);
    await u.click(submit());
    expect(await screen.findByText('Please confirm that the corrected name matches your passport.')).toBeInTheDocument();
  });

  it('shows a previous correction', () => {
    const corrected = { ...filled, personal: { ...filled.personal, fullName: 'Somchai Prasert', nameCorrection: { previousName: 'Somchai Prasrt', correctedName: 'Somchai Prasert', confirmedAt: '2026-11-01T00:00:00Z' } } };
    render(<Step1LeadGeneration language="en" account={{ ...account, fullName: 'Somchai Prasert' }} initialData={corrected} onSubmit={vi.fn()} />);
    expect(screen.getByText('Corrected legal name (previously: Somchai Prasrt)')).toBeInTheDocument();
  });
});
