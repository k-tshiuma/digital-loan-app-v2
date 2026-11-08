// Phase 3 render tests: screens shown in Hebrew contain Hebrew headings and no English sentences.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { LanguageProvider, LANGUAGE_STORAGE_KEY } from '@quickloan/ui-core/i18n/LanguageContext';
import { t } from '@quickloan/ui-core/i18n/translations';
import { storageService } from '@quickloan/ui-core/services/storage';
import { authTokens } from '../services/api';
import { Step2Auth } from '../components/Step2Auth';
import { Step10SubmissionSuccess } from '../components/Step10SubmissionSuccess';
import { Step11StatusTimeline } from '../components/Step11StatusTimeline';
import { BackOffice } from '../components/BackOffice';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { LoanApplication } from '@quickloan/ui-core/types';

/** Two or more Latin words in a row (e.g. "Loan Details"). Single brand words like "QuickLoan" are fine. */
const ENGLISH_SENTENCE = /\b[A-Za-z]{3,}(?:\s+[A-Za-z]{3,})+\b/;

/** Visible English sentences inside an element, ignoring user data passed in `allow`. */
function englishIn(el: HTMLElement, allow: string[] = []): string[] {
  let text = el.textContent || '';
  for (const a of allow) text = text.split(a).join(' ');
  const found: string[] = [];
  const re = new RegExp(ENGLISH_SENTENCE.source, 'g');
  for (const m of text.matchAll(re)) found.push(m[0]);
  const attrs = [...el.querySelectorAll('[placeholder],[title],[aria-label]')].flatMap((n) =>
    ['placeholder', 'title', 'aria-label'].map((a) => n.getAttribute(a) || '')
  );
  for (let a of attrs) {
    for (const x of allow) a = a.split(x).join(' ');
    if (ENGLISH_SENTENCE.test(a)) found.push(`[attr] ${a}`);
  }
  return found;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.scrollTo = vi.fn() as any;
  // recharts' ResponsiveContainer needs ResizeObserver
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  storageService.logout();
});

describe('Login screen in Hebrew (T3.2)', () => {
  it('shows Hebrew text and no English sentences, including after going to registration', async () => {
    const user = userEvent.setup();
    const { container } = render(<Step2Auth language="he" onAuthenticated={() => {}} onBack={() => {}} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t('he', 'auth.welcomeBack'));
    expect(screen.getByRole('button', { name: t('he', 'continue') })).toBeInTheDocument();
    expect(englishIn(container, ['Somchai', 'Maria'])).toEqual([]);

    await user.click(screen.getByRole('button', { name: t('he', 'auth.createYourAccount') }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t('he', 'auth.locationRequired'));
    expect(englishIn(container)).toEqual([]);
  });

  it('shows a translated validation error', async () => {
    const user = userEvent.setup();
    const { container } = render(<Step2Auth language="he" onAuthenticated={() => {}} onBack={() => {}} />);
    await user.clear(container.querySelector('#signin-phone-input') as HTMLInputElement);
    await user.click(screen.getByRole('button', { name: t('he', 'continue') }));
    expect(screen.getByText(t('he', 'auth.err.invalidPhone'))).toBeInTheDocument();
  });
});

describe('Wizard steps in Hebrew (T3.3)', () => {
  const steps: Array<[number, string]> = [
    [3, 'borrowerDetailsTitle'],
    [4, 'residencyDetailsTitle'],
    [5, 'employmentDetailsTitle'],
    [6, 'loanDetailsTitle'],
    [7, 'guarantorTitle'],
    [8, 'documentUploadTitle'],
    [9, 'reviewTitle'],
  ];

  for (const [step, titleKey] of steps) {
    it(`step ${step} shows a Hebrew title and no English sentences`, async () => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, 'he');
      const { user } = storageService.loginWithGoogle(
        { email: `he-step-${step}-${Math.random()}@example.com`, name: 'Test' },
        'he'
      );
      const app = storageService.getOrCreateActiveApplication(user, 'he');
      app.currentStep = step;
      storageService.saveApplication(app);
      authTokens.set('test-token');

      render(
        <LanguageProvider>
          <App />
        </LanguageProvider>
      );

      const heading = await screen.findByRole('heading', { level: 1, name: t('he', titleKey) });
      expect(heading).toBeInTheDocument();
      // Example passport names in the Step 3 placeholder stay in Latin letters on purpose.
      expect(englishIn(document.body, ['Somchai Prasert', 'Maria Santos'])).toEqual([]);
    });
  }

  it('step 10 (submission success) is fully in Hebrew', () => {
    const app = {
      id: 'app_t',
      requestNumber: 'QL-2026-0001',
      status: 'Received',
      isSubmitted: true,
      documents: [],
    } as unknown as LoanApplication;
    const { container } = render(<Step10SubmissionSuccess language="he" application={app} onTrackStatus={() => {}} />);
    expect(englishIn(container)).toEqual([]);
    expect(screen.getByText(t('he', 'pdf.download'))).toBeInTheDocument();
  });

  it('step 11 (status timeline) is fully in Hebrew', () => {
    const app = {
      id: 'app_t11',
      requestNumber: 'QL-2026-0002',
      status: 'Received',
      isSubmitted: true,
      documents: [],
      statusHistory: [],
      borrowerDetails: { fullName: 'Test Person', countryOfOrigin: 'Thailand' },
      loanRequest: { repaymentPeriodMonths: 6, repaymentSource: 'Bank transfer', requestedAmountNis: 5000 },
    } as unknown as LoanApplication;
    const { container } = render(
      <Step11StatusTimeline language="he" application={app} onApplicationUpdated={() => {}} onStartNewApplication={() => {}} />
    );
    expect(screen.getByText(t('he', 'statusReceivedTitle'))).toBeInTheDocument();
    expect(screen.getAllByText(t('he', 'statusReceived')).length).toBeGreaterThan(0);
    expect(englishIn(container, ['Test Person'])).toEqual([]);
  });

  it('step 11 loan package shows amounts in the Hebrew currency format (T5)', async () => {
    const user = userEvent.setup();
    const app = {
      id: 'app_t11b',
      requestNumber: 'QL-2026-0003',
      status: 'Received',
      isSubmitted: true,
      documents: [],
      statusHistory: [],
      borrowerDetails: { fullName: 'Test Person', countryOfOrigin: 'Thailand' },
      employmentDetails: { monthlySalaryNis: 8000 },
      loanRequest: { repaymentPeriodMonths: 6, repaymentSource: 'Bank transfer', requestedAmountNis: 5000, estimatedMonthlyPaymentNis: 912.5 },
    } as unknown as LoanApplication;
    const { container } = render(
      <Step11StatusTimeline language="he" application={app} onApplicationUpdated={() => {}} onStartNewApplication={() => {}} />
    );
    await user.click(screen.getByRole('button', { name: t('he', 'status.loanPackage') }));
    const text = (container.textContent || '').replace(/[‎‏]/g, '').replace(/[\s  ]+/g, ' ');
    expect(text).toMatch(/5,000 ?₪/);
    expect(text).toMatch(/8,000 ?₪/);
    expect(text).toMatch(/912\.50 ?₪/);
    expect(text).not.toMatch(/₪ ?\d/);
  });
});

describe('Back office in Hebrew (T3.5)', () => {
  it('queue headers, filters and actions are Hebrew; the inspector shows Hebrew sections', async () => {
    const user = userEvent.setup();
    render(<BackOffice language="he" currentRole="credit_reviewer" onRoleChange={() => {}} onCloseBackOffice={() => {}} />);

    const table = screen.getByRole('table');
    const headerRow = within(table).getAllByRole('row')[0];
    expect(englishIn(headerRow)).toEqual([]);
    expect(within(headerRow).getByText(t('he', 'bo.col.borrower'))).toBeInTheDocument();

    const statusFilter = screen.getByDisplayValue(t('he', 'bo.allStatuses', { n: storageService.getAllApplications().length }));
    expect(within(statusFilter).getByText(t('he', 'statusUnderReview'))).toBeInTheDocument();

    const inspect = screen.getAllByRole('button', { name: t('he', 'bo.inspect') });
    expect(inspect.length).toBeGreaterThan(0);
    await user.click(inspect[0]);

    expect(screen.getByText(t('he', 'bo.borrowerProfile'))).toBeInTheDocument();
    expect(screen.getByText(t('he', 'bo.riskTitle'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('he', 'bo.approve') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('he', 'bo.reject') })).toBeInTheDocument();
  });
});

describe('Analytics dashboard in Hebrew (T3.7)', () => {
  it('titles and KPI labels are Hebrew', () => {
    const { container } = render(<AnalyticsDashboard applications={storageService.getAllApplications()} language="he" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(t('he', 'an.title'));
    expect(screen.getByText(t('he', 'an.totalApps'))).toBeInTheDocument();
    expect(screen.getByText(t('he', 'an.approvalRate'))).toBeInTheDocument();
    expect(englishIn(container)).toEqual([]);
  });
});
