import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { LanguageProvider, LANGUAGE_STORAGE_KEY } from '@quickloan/ui-core/i18n/LanguageContext';
import { storageService } from '@quickloan/ui-core/services/storage';
import { authTokens } from '../services/api';
import { t } from '@quickloan/ui-core/i18n/translations';

// Backend is "offline" except for the language endpoint, which we record.
let languageCalls: Array<{ language: string }> = [];

beforeEach(() => {
  languageCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/users/me/language') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        languageCalls.push(body);
        return new Response(JSON.stringify({ success: true, user: { preferredLanguage: body.language } }), { status: 200 });
      }
      throw new TypeError('Failed to fetch');
    })
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  window.scrollTo = vi.fn() as any;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  storageService.logout();
});

/** Log a borrower in locally and park their draft on Step 6 with "Other" as the loan purpose. */
function seedUserOnStep6(preferredLanguage: 'en' | 'he' = 'en') {
  const { user } = storageService.loginWithGoogle(
    { email: `lang-test-${Date.now()}-${Math.random()}@example.com`, name: 'Lang Tester' },
    preferredLanguage
  );
  const app = storageService.getOrCreateActiveApplication(user, preferredLanguage);
  app.currentStep = 6;
  app.loanRequest = { ...(app.loanRequest || {}), requestedAmountNis: 7500, repaymentPeriodMonths: 6, loanPurpose: 'Other' } as any;
  storageService.saveApplication(app);
  authTokens.set('test-token');
  return user;
}

const renderApp = () =>
  render(
    <LanguageProvider>
      <App />
    </LanguageProvider>
  );

describe('Switching language mid-wizard (T1.4)', () => {
  it('keeps the step and typed values, flips direction, and saves the choice to the account', async () => {
    const user = seedUserOnStep6('en');
    const ui = userEvent.setup();
    renderApp();

    // On Step 6 in English
    expect(await screen.findByRole('heading', { level: 1, name: t('en', 'loanDetailsTitle') })).toBeInTheDocument();
    const purposeInput = screen.getByPlaceholderText(t('en', 'otherPurposePlaceholder'));
    await ui.type(purposeInput, 'Buy a laptop');

    // Switch to Hebrew
    await ui.click(screen.getByRole('button', { name: t('en', 'languageSelector') }));
    await ui.click(screen.getByRole('menuitemradio', { name: /עברית/ }));

    expect(await screen.findByRole('heading', { level: 1, name: t('he', 'loanDetailsTitle') })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Buy a laptop')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('he');
    await waitFor(() => expect(languageCalls).toContainEqual({ language: 'he' }));
    expect(storageService.getCurrentUser()?.preferredLanguage).toBe('he');

    // And back to English
    await ui.click(screen.getByRole('button', { name: t('he', 'languageSelector') }));
    await ui.click(screen.getByRole('menuitemradio', { name: /English/ }));
    expect(await screen.findByRole('heading', { level: 1, name: t('en', 'loanDetailsTitle') })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Buy a laptop')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('ltr');
    expect(user.id).toBe(storageService.getCurrentUser()?.id);
  });

  it("uses the account's language on a device with no saved choice", async () => {
    seedUserOnStep6('he');
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: t('he', 'loanDetailsTitle') })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(languageCalls).toEqual([]);
  });

  it("a choice saved on this device wins over the account's language and is sent to the backend", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'he');
    seedUserOnStep6('en');
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: t('he', 'loanDetailsTitle') })).toBeInTheDocument();
    await waitFor(() => expect(languageCalls).toContainEqual({ language: 'he' }));
  });
});
