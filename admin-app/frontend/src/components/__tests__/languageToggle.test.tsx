// The dashboard must offer English and Hebrew after sign-in too, not only on the staff sign-in page.
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackOffice } from '../BackOffice';
import { StaffLoginGate } from '../StaffLoginGate';
import { t } from '@quickloan/ui-core/i18n/translations';
import { Language } from '@quickloan/ui-core/types';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Dashboard() {
  const [language, setLanguage] = useState<Language>('en');
  return (
    <BackOffice
      language={language}
      onLanguageChange={setLanguage}
      currentRole="credit_reviewer"
      onRoleChange={() => {}}
      onCloseBackOffice={() => {}}
    />
  );
}

describe('Back Office language switch', () => {
  it('switches the dashboard between English and Hebrew', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const group = screen.getByRole('group', { name: t('en', 'languageSelector') });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('en', 'bo.staffSignOut') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'עברית' }));
    expect(screen.getByRole('button', { name: t('he', 'bo.staffSignOut') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'עברית' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('button', { name: t('en', 'bo.staffSignOut') })).toBeInTheDocument();
  });

  it('is still on the staff sign-in page', async () => {
    const user = userEvent.setup();
    const onLanguageChange = vi.fn();
    render(
      <StaffLoginGate language="en" onLanguageChange={onLanguageChange} isClientBlocked={false} onAuthenticated={() => {}} onReturnToPublic={() => {}} />
    );
    await user.click(screen.getByRole('button', { name: 'עברית' }));
    expect(onLanguageChange).toHaveBeenCalledWith('he');
  });
});
