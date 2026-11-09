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
import { LoanApplication } from '@quickloan/ui-core/types';
import { englishIn } from '@quickloan/ui-core/test-utils/hebrewText';

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
