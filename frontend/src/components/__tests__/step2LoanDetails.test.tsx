import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step2ApplicationCompletion } from '../Step2ApplicationCompletion';
import { Step3FinalSubmission } from '../Step3FinalSubmission';
import { LOAN_PERIOD_OPTIONS, MAX_REPAYMENT_PERIOD_MONTHS } from '@quickloan/ui-core/config/appConfig';
import { LeadData, LoanBreakdown, TermsVersionRecord } from '@quickloan/ui-core/types';

describe('Step 2 & Step 3 Workflow Details', () => {
  const dummyLead: LeadData = {
    id: 'lead_123',
    email: 'test@example.com',
    fullName: 'Test Borrower',
    phoneNumber: '050-1234567',
    dateOfBirth: '1990-01-01',
    address: 'Herzl St 10, Tel Aviv',
    employerName: 'John Doe',
    companyName: 'Tech Corp',
    requestedLoanAmountNis: 5000,
    repaymentPeriodMonths: 6,
    serviceFeeNis: 500,
    displayedMonthlyPaymentNis: 833,
    status: 'approved' as const,
    createdAt: new Date().toISOString(),
  };

  const dummyBreakdown: LoanBreakdown = {
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
    calculatedAt: new Date().toISOString(),
  };

  const dummyTermsVersions: Record<string, TermsVersionRecord> = {
    general: { type: 'general', version: '1.0', textEn: 'General Terms text...', textHe: 'תנאים כלליים...', sha256: 'a', effectiveFrom: '2026-01-01' },
    service_fee: { type: 'service_fee', version: '1.0', textEn: 'Service Fee Terms text...', textHe: 'תנאי דמי שירות...', sha256: 'b', effectiveFrom: '2026-01-01' },
  };

  it('1. Repayment Period: only 3, 6, and 9 months are available and maximum is 9 months', () => {
    expect(LOAN_PERIOD_OPTIONS.map((o) => o.months)).toEqual([3, 6, 9]);
    expect(MAX_REPAYMENT_PERIOD_MONTHS).toBe(9);
    expect(MAX_REPAYMENT_PERIOD_MONTHS).toBeLessThanOrEqual(10);

    render(
      <Step2ApplicationCompletion
        lead={dummyLead}
        onCompleted={vi.fn()}
        language="en"
      />
    );

    // Verify exactly 3 repayment buttons exist: 3, 6, 9 months
    expect(screen.getByRole('button', { name: /3\s*months/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /6\s*months/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /9\s*months/i })).toBeInTheDocument();

    // 12 months or any other period must not exist
    expect(screen.queryByRole('button', { name: /12\s*months/i })).toBeNull();
  });

  it('2. Simplified Sponsors in Step 2: requires only Full Name and ID or Passport', async () => {
    const user = userEvent.setup();
    render(
      <Step2ApplicationCompletion
        lead={dummyLead}
        onCompleted={vi.fn()}
        language="en"
      />
    );

    const addSponsorBtn = screen.getByRole('button', { name: /Add Sponsor/i });
    expect(addSponsorBtn).toBeInTheDocument();
    await user.click(addSponsorBtn);

    // Verify fields: Full Name and ID or Passport
    expect(screen.getByPlaceholderText(/Full name as shown on legal ID\/Passport/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Israeli ID or Foreign Passport/i)).toBeInTheDocument();

    // Distinctions like "Israeli" or "Foreigner" dropdowns must not exist
    expect(screen.queryByText(/Select citizenship/i)).toBeNull();
  });

  it('3. Mandatory Agreements in Step 3: checkboxes are not preselected, Terms modal opens, submit gated', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <Step3FinalSubmission
        breakdown={dummyBreakdown}
        termsVersions={dummyTermsVersions}
        onSubmit={onSubmit}
        language="en"
      />
    );

    const termsCheckbox = screen.getByRole('checkbox', { name: /General Terms & Conditions/i }) as HTMLInputElement;
    const feeCheckbox = screen.getByRole('checkbox', { name: /Service Fee Terms & Conditions/i }) as HTMLInputElement;

    // Both checkboxes MUST not be preselected
    expect(termsCheckbox.checked).toBe(false);
    expect(feeCheckbox.checked).toBe(false);

    // Terms link exists and clicking opens the Terms modal
    const viewTermsBtns = screen.getAllByRole('button', { name: /View Terms/i });
    expect(viewTermsBtns.length).toBeGreaterThan(0);
    await user.click(viewTermsBtns[0]);

    // Modal is opened
    expect(screen.getByRole('heading', { level: 3, name: /Terms and Conditions/i })).toBeInTheDocument();

    // Close modal via close button
    const closeBtn = screen.getByRole('button', { name: /Close/i });
    await user.click(closeBtn);

    // Submit button is disabled initially
    const submitBtn = screen.getByRole('button', { name: /Submit Final Loan Application/i });
    expect(submitBtn).toBeDisabled();
  });

  it('4. Localized display in Hebrew: Step 2 and Step 3', () => {
    const { unmount } = render(
      <Step2ApplicationCompletion
        lead={dummyLead}
        onCompleted={vi.fn()}
        language="he"
      />
    );

    // Repayment in Hebrew (3, 6, 9 חודשים)
    expect(screen.getByRole('button', { name: /3\s*חודשים/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /6\s*חודשים/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /9\s*חודשים/i })).toBeInTheDocument();
    unmount();

    // Step 3 in Hebrew
    render(
      <Step3FinalSubmission
        breakdown={dummyBreakdown}
        termsVersions={dummyTermsVersions}
        onSubmit={vi.fn()}
        language="he"
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);

    const submitBtn = screen.getByRole('button', { name: /הגשת בקשת הלוואה סופית/i });
    expect(submitBtn).toBeDisabled();
  });
});
