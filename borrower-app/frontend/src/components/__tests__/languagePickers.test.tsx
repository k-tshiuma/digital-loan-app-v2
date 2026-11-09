import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from '../Header';
import { Step1Language } from '../Step1Language';
import { Language } from '@quickloan/ui-core/types';
import { t } from '@quickloan/ui-core/i18n/translations';

function HeaderHarness({ initial = 'en' as Language }) {
  const [lang, setLang] = useState<Language>(initial);
  return (
    <Header
      currentLanguage={lang}
      onLanguageChange={setLang}
      currentUser={null}
      onSignOut={() => {}}
      currentRole="borrower"
      onRoleChange={() => {}}
      onOpenHelp={() => {}}
      isOnline
      draftSaved={false}
    />
  );
}

function renderHeader(currentLanguage: Language, onLanguageChange = vi.fn()) {
  render(
    <Header
      currentLanguage={currentLanguage}
      onLanguageChange={onLanguageChange}
      currentUser={null}
      onSignOut={() => {}}
      currentRole="borrower"
      onRoleChange={() => {}}
      onOpenHelp={() => {}}
      isOnline
      draftSaved={false}
    />
  );
  return onLanguageChange;
}

describe('Header language dropdown (T1.3)', () => {
  it('shows a dropdown button with the current language, closed at first', () => {
    render(<HeaderHarness />);
    const button = screen.getByRole('button', { name: t('en', 'languageSelector') });
    expect(button).toHaveTextContent('EN');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lists English and Hebrew with the current one checked', async () => {
    const user = userEvent.setup();
    render(<HeaderHarness />);
    await user.click(screen.getByRole('button', { name: t('en', 'languageSelector') }));
    const menu = screen.getByRole('menu');
    const options = within(menu).getAllByRole('menuitemradio');
    expect(options.map((o) => o.getAttribute('lang'))).toEqual(['he', 'en']);
    expect(within(menu).getByRole('menuitemradio', { name: /English/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: /עברית/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches language from the menu, closes it, and updates the button', async () => {
    const user = userEvent.setup();
    render(<HeaderHarness />);
    await user.click(screen.getByRole('button', { name: t('en', 'languageSelector') }));
    await user.click(screen.getByRole('menuitemradio', { name: /עברית/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    const button = screen.getByRole('button', { name: t('he', 'languageSelector') });
    expect(button).toHaveTextContent('עב');

    await user.click(button);
    await user.click(screen.getByRole('menuitemradio', { name: /English/ }));
    expect(screen.getByRole('button', { name: t('en', 'languageSelector') })).toHaveTextContent('EN');
  });

  it('does not call onLanguageChange when the current language is picked again', async () => {
    const user = userEvent.setup();
    const onChange = renderHeader('he');
    await user.click(screen.getByRole('button', { name: t('he', 'languageSelector') }));
    await user.click(screen.getByRole('menuitemradio', { name: /עברית/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('calls onLanguageChange with the chosen language', async () => {
    const user = userEvent.setup();
    const onChange = renderHeader('he');
    await user.click(screen.getByRole('button', { name: t('he', 'languageSelector') }));
    await user.click(screen.getByRole('menuitemradio', { name: /English/ }));
    expect(onChange).toHaveBeenCalledWith('en');
  });

  it('closes on an outside click and on Escape', async () => {
    const user = userEvent.setup();
    render(<HeaderHarness />);
    const button = screen.getByRole('button', { name: t('en', 'languageSelector') });

    await user.click(button);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Step 1 language picker (T1.2c)', () => {
  it('lists only English and Hebrew', () => {
    render(<Step1Language selectedLanguage="en" onSelectLanguage={() => {}} onNext={() => {}} />);
    expect(document.getElementById('lang-select-en')).not.toBeNull();
    expect(document.getElementById('lang-select-he')).not.toBeNull();
    for (const code of ['th', 'zh', 'tl']) {
      expect(document.getElementById(`lang-select-${code}`)).toBeNull();
    }
  });
});
