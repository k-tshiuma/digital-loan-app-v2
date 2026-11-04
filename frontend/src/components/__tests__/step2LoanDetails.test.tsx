import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step2ApplicationCompletion } from '../Step2ApplicationCompletion';
import { LOAN_PERIOD_OPTIONS, MAX_REPAYMENT_PERIOD_MONTHS } from '../../config/appConfig';
import { t } from '../../i18n/translations';

import { LeadData } from '../../types';

describe('Step 2: Loan Details and Repayment Terms', () => {
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

  it('2. Mandatory Agreements: checkboxes are not preselected and Terms modal opens', async () => {
    const user = userEvent.setup();
    render(
      <Step2ApplicationCompletion
        lead={dummyLead}
        onCompleted={vi.fn()}
        language="en"
      />
    );

    const termsCheckbox = screen.getByRole('checkbox', { name: /Terms and Conditions/i }) as HTMLInputElement;
    const feeCheckbox = screen.getByRole('checkbox', { name: /service fee/i }) as HTMLInputElement;

    // Both checkboxes MUST not be preselected
    expect(termsCheckbox.checked).toBe(false);
    expect(feeCheckbox.checked).toBe(false);

    // Terms link exists and clicking opens the Terms & Conditions modal
    const viewTermsBtn = screen.getByRole('button', { name: /View Terms and Conditions/i });
    expect(viewTermsBtn).toBeInTheDocument();

    await user.click(viewTermsBtn);

    // Modal is opened
    expect(screen.getByRole('heading', { level: 2, name: /Terms & conditions/i })).toBeInTheDocument();

    // Close modal via close button
    const closeBtn = document.getElementById('close-terms-modal-btn')!;
    await user.click(closeBtn);
    expect(screen.queryByRole('heading', { level: 2, name: /Terms & conditions/i })).toBeNull();
  });

  it('3. Submission Validation: submit button remains disabled until both agreements are accepted', async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();

    render(
      <Step2ApplicationCompletion
        lead={dummyLead}
        onCompleted={onCompleted}
        language="en"
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Submit Completed Application/i });
    const termsCheckbox = screen.getByRole('checkbox', { name: /Terms and Conditions/i });
    const feeCheckbox = screen.getByRole('checkbox', { name: /service fee/i });

    // Initially disabled
    expect(submitBtn).toBeDisabled();

    // Accept only terms -> still disabled
    await user.click(termsCheckbox);
    expect(submitBtn).toBeDisabled();

    // Uncheck terms and check only service fee -> still disabled
    await user.click(termsCheckbox);
    await user.click(feeCheckbox);
    expect(submitBtn).toBeDisabled();

    // Check both -> button becomes enabled
    await user.click(termsCheckbox);
    expect(submitBtn).not.toBeDisabled();
  });

  it('4. Localized display in Hebrew: terms, service fee, and validation are in Hebrew', () => {
    render(
      <Step2ApplicationCompletion
        lead={dummyLead}
        onCompleted={vi.fn()}
        language="he"
      />
    );

    // Header and terms in Hebrew
    expect(screen.getByText(t('he', 'step2.part5Title'))).toBeInTheDocument();
    expect(screen.getByText(t('he', 'step2.viewTermsLink'))).toBeInTheDocument();
    expect(screen.getByText(t('he', 'step2.serviceFeeBoxTitle'))).toBeInTheDocument();

    const termsCheckbox = screen.getByRole('checkbox', { name: /תנאי השימוש וההלוואה/i }) as HTMLInputElement;
    const feeCheckbox = screen.getByRole('checkbox', { name: /דמי השירות/i }) as HTMLInputElement;

    expect(termsCheckbox.checked).toBe(false);
    expect(feeCheckbox.checked).toBe(false);

    const submitBtn = screen.getByRole('button', { name: t('he', 'step2.submitBtn') });
    expect(submitBtn).toBeDisabled();
  });
});
