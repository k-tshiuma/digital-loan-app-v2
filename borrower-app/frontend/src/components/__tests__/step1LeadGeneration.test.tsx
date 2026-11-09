import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Step1LeadGeneration } from '../Step1LeadGeneration';
import { STEP1_ORIGIN_COUNTRIES } from '@quickloan/ui-core/config/appConfig';
import { Step1FormData, UploadedDocRef } from '@quickloan/ui-core/types';

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
        hasCompletedDisclaimer
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
        hasCompletedDisclaimer
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
        hasCompletedDisclaimer
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
        hasCompletedDisclaimer
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
