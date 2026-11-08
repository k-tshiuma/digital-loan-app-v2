import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Header } from '../Header';
import { BackOffice } from '../BackOffice';
import { FlowApplicationInspector } from '../FlowApplicationInspector';
import { Step3BorrowerDetails } from '../Step3BorrowerDetails';
import App from '../../App';
import { authTokens } from '../../services/api';
import { storageService } from '../../services/storage';
import { LanguageProvider } from '../../i18n/LanguageContext';

describe('Back Office Security & Employee Information Consistency', () => {
  const originalPath = window.location.pathname;
  const originalHash = window.location.hash;
  const originalSearch = window.location.search;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    window.history.replaceState({}, '', `${originalPath}${originalSearch}${originalHash}`);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('removes all Back Office / Borrower View links from the client Header and User Account menu', () => {
    const clientUser = {
      id: 'user_client_1',
      phoneNumber: '+972549500083',
      email: 'chang.meifen28@gmail.com',
      fullName: 'Chang Meifen',
      roles: ['borrower' as const],
      preferredLanguage: 'en' as const,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(
      <Header
        currentLanguage="en"
        onLanguageChange={() => {}}
        currentUser={clientUser}
        onSignOut={() => {}}
        onOpenHelp={() => {}}
        isOnline={true}
        draftSaved={false}
      />
    );

    expect(document.getElementById('portal-toggle-btn')).toBeNull();
    expect(screen.queryByText(/Back Office/i)).toBeNull();
    expect(screen.queryByText(/Borrower View/i)).toBeNull();

    // Open client user account dropdown
    fireEvent.click(document.getElementById('header-user-menu-btn')!);
    expect(screen.getByText('Chang Meifen')).toBeInTheDocument();
    expect(screen.queryByText(/Open Back Office/i)).toBeNull();
    expect(screen.queryByText(/Back Office/i)).toBeNull();
  });

  it('removes "Borrower view" from the Back Office role dropdown and blocks borrower role rendering', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, token: 'staff.jwt.token', applications: [], rules: {} }), { status: 200 }))
    );

    const { unmount } = render(
      <BackOffice
        language="en"
        currentRole="credit_reviewer"
        onRoleChange={() => {}}
        onCloseBackOffice={() => {}}
      />
    );

    const roleSelect = screen.getByTestId('backoffice-role-select') as HTMLSelectElement;
    const optionValues = Array.from(roleSelect.options).map((o) => o.value);
    const optionTexts = Array.from(roleSelect.options).map((o) => o.textContent);

    expect(optionValues).not.toContain('borrower');
    expect(optionValues).toEqual(['customer_service', 'credit_reviewer', 'system_admin', 'funding_entity']);
    expect(optionTexts.some((txt) => /borrower/i.test(txt || ''))).toBe(false);
    expect(screen.queryByText(/Return to borrower view/i)).toBeNull();

    unmount();

    // Defense-in-depth: passing currentRole="borrower" renders access denied instead of workbench
    render(
      <BackOffice
        language="en"
        currentRole="borrower"
        onRoleChange={() => {}}
        onCloseBackOffice={() => {}}
      />
    );
    expect(screen.getByTestId('backoffice-borrower-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('backoffice-role-select')).toBeNull();
  });

  it('blocks signed-in clients on direct /backoffice URL and requires staff login for unauthenticated visitors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url).replace(/^.*\/api/, '');
        if (path === '/auth/staff-login') {
          return new Response(
            JSON.stringify({
              success: true,
              token: 'staff.jwt.token',
              staff: {
                id: 'staff_reviewer',
                email: 'reviewer@quickloan.co.il',
                fullName: 'Credit Reviewer',
                role: 'credit_reviewer',
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ success: true, applications: [], rules: {} }), { status: 200 });
      })
    );

    // 1. Active client session trying direct /backoffice URL -> strictly blocked
    const clientUser = storageService.adoptUser({
      id: 'user_client_direct',
      phoneNumber: '+972541112233',
      email: 'client@example.com',
      fullName: 'Client Borrower',
      roles: ['borrower'],
      preferredLanguage: 'en',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(clientUser.id).toBe('user_client_direct');
    authTokens.set('borrower.mock.token');
    window.history.replaceState({}, '', '/backoffice');

    const { unmount } = render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );

    expect(screen.getByTestId('backoffice-client-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('backoffice-role-select')).toBeNull();
    unmount();

    // 2. Unauthenticated visitor on /backoffice -> sees Staff Login Gate, then enters Back Office after valid staff login
    localStorage.clear();
    window.history.replaceState({}, '', '/backoffice');

    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );

    expect(screen.getByTestId('backoffice-staff-login-form')).toBeInTheDocument();
    expect(screen.queryByTestId('backoffice-role-select')).toBeNull();

    fireEvent.change(document.getElementById('staff-email-input')!, {
      target: { value: 'reviewer@quickloan.co.il' },
    });
    fireEvent.change(document.getElementById('staff-password-input')!, {
      target: { value: 'Reviewer123456!' },
    });
    fireEvent.click(document.getElementById('staff-login-submit-btn')!);

    await waitFor(() => {
      expect(screen.getByTestId('backoffice-role-select')).toBeInTheDocument();
    });
  });

  it('displays Passport Number, Country of Origin, Visa Validity Period, and Monthly Salary consistently across Step 1, Step 2, and Step 3', () => {
    const detail = {
      id: 'app_china_1',
      requestNumber: 'REQ-2026-200001',
      flowVersion: 2,
      flowStatus: 'PENDING_FINAL_PROCESSING',
      group: 'pending',
      account: {
        fullName: 'Chang Meifen',
        phoneNumber: '+972549500083',
        email: 'chang.meifen28@gmail.com',
        authProvider: 'manual',
      },
      steps: {
        1: {
          status: 'APPROVED',
          data: {
            personal: {
              fullName: 'Chang Meifen',
              phoneNumber: '+972549500083',
              dateOfBirth: '2001-01-15',
              address: '236 Haaron M, Ashdod',
              passportNumber: 'E012345678',
              countryOfOrigin: 'China',
              visaStartDate: '2025-03-01',
              visaExpiryDate: '2027-02-28',
              monthlySalaryNis: 7600,
              salaryCurrency: 'ILS',
            },
            employment: {
              employerName: 'Jaakov Marcus',
              companyName: 'Agro Tech Negev Ltd',
            },
            loan: { requestedAmountNis: 7500 },
          },
        },
        2: {
          status: 'APPROVED',
          data: {
            sponsors: [{ id: 'sp_1', fullName: 'Li Wei', idOrPassportNumber: 'CN9988776' }],
            loan: { requestedAmountNis: 7500, repaymentPeriodMonths: 6, estimatedMonthlyPaymentNis: 1320 },
          },
        },
        3: {
          status: 'SUBMITTED',
          data: {
            bank: {
              bankName: 'Bank Hapoalim',
              bankCode: '12',
              branchNumber: '600',
              accountNumber: '****4321',
              accountHolderName: 'Chang Meifen',
            },
          },
        },
      },
      termsAcceptances: [],
      reviews: [],
      audit: [],
    };

    render(
      <FlowApplicationInspector
        detail={detail}
        language="en"
        currentRole="credit_reviewer"
        onClose={() => {}}
        onApproveStep={vi.fn()}
        onRequestStepChanges={vi.fn()}
        onRejectStep={vi.fn()}
        onFinalDecision={vi.fn()}
        onSendMessage={vi.fn()}
      />
    );

    const assertAllFourEmployeeFieldsVisible = () => {
      expect(screen.getByText('E012345678')).toBeInTheDocument();
      expect(screen.getByText('China')).toBeInTheDocument();
      expect(screen.queryByText('Thailand')).toBeNull();
      expect(screen.getByText(/01\/03\/2025\s*–\s*28\/02\/2027/)).toBeInTheDocument();
      expect(screen.getByText(/7,600/)).toBeInTheDocument();
    };

    // Step 1 tab (default)
    assertAllFourEmployeeFieldsVisible();

    // Step 2 tab
    fireEvent.click(screen.getByRole('button', { name: /Step 2: Guarantors & term/i }));
    assertAllFourEmployeeFieldsVisible();
    expect(screen.getByText('Li Wei')).toBeInTheDocument();

    // Step 3 tab
    fireEvent.click(screen.getByRole('button', { name: /Step 3: Bank & terms/i }));
    assertAllFourEmployeeFieldsVisible();
    expect(screen.getByText('Bank Hapoalim')).toBeInTheDocument();
  });

  it('never defaults Country of Origin to Thailand when no country was selected', () => {
    const emptyDetail = {
      id: 'app_empty_country',
      requestNumber: 'REQ-2026-200002',
      flowVersion: 2,
      flowStatus: 'LEAD_REGISTERED',
      group: 'draft',
      account: {
        fullName: 'New Applicant',
        phoneNumber: '+972521234567',
        email: 'new@example.com',
      },
      steps: {
        1: { status: 'AVAILABLE', data: { personal: { fullName: 'New Applicant' } } },
        2: { status: 'LOCKED', data: {} },
        3: { status: 'LOCKED', data: {} },
      },
    };

    const { unmount } = render(
      <FlowApplicationInspector
        detail={emptyDetail}
        language="en"
        currentRole="credit_reviewer"
        onClose={() => {}}
        onApproveStep={vi.fn()}
        onRequestStepChanges={vi.fn()}
        onRejectStep={vi.fn()}
        onFinalDecision={vi.fn()}
        onSendMessage={vi.fn()}
      />
    );
    expect(screen.queryByText('Thailand')).toBeNull();
    unmount();

    render(
      <Step3BorrowerDetails
        language="en"
        onSaveAndNext={() => {}}
        onBack={() => {}}
      />
    );
    const countrySelect = document.getElementById('country-origin-select') as HTMLSelectElement;
    expect(countrySelect.value).toBe('');
  });
});
