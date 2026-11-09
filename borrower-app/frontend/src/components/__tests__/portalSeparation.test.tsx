// Borrower half of the former backOfficeCorrections test: the Back Office is a separate app now, so the
// borrower app shows no way into it and sends old /backoffice and /admin links to the admin app.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../Header';
import { Step3BorrowerDetails } from '../Step3BorrowerDetails';
import App from '../../App';
import { LanguageProvider } from '@quickloan/ui-core/i18n/LanguageContext';
import { goToAdminPortal } from '../../utils/portalRedirect';

vi.mock('../../utils/portalRedirect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/portalRedirect')>()),
  goToAdminPortal: vi.fn(),
}));

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
    vi.mocked(goToAdminPortal).mockClear();
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

  for (const url of ['/backoffice', '/admin', '/?backoffice', '/#admin']) {
    it(`sends ${url} to the admin app and shows nothing of its own`, () => {
      window.history.replaceState({}, '', url);
      const { container } = render(
        <LanguageProvider>
          <App />
        </LanguageProvider>
      );
      expect(goToAdminPortal).toHaveBeenCalledTimes(1);
      expect(container).toBeEmptyDOMElement();
    });
  }

  it('stays on the borrower app for normal URLs', () => {
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );
    expect(goToAdminPortal).not.toHaveBeenCalled();
  });

  it('never defaults Country of Origin to Thailand when no country was selected', () => {
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
