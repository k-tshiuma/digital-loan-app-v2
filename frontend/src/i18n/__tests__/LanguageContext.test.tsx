import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { LanguageProvider, LANGUAGE_STORAGE_KEY, resolveInitialLanguage, useI18n } from '@quickloan/ui-core/i18n/LanguageContext';
import { ENABLED_LANGUAGES, TRANSLATIONS } from '@quickloan/ui-core/i18n/translations';

const wrapper = ({ children }: { children: React.ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LanguageProvider (T1.1)', () => {
  it('defaults to English with ltr when nothing is saved', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.language).toBe('en');
    expect(result.current.hasSavedChoice).toBe(false);
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('restores a saved Hebrew choice on start-up', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'he');
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.language).toBe('he');
    expect(result.current.hasSavedChoice).toBe(true);
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
  });

  it('uses Hebrew when the browser language is Hebrew and nothing is saved', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('he-IL');
    expect(resolveInitialLanguage()).toBe('he');
  });

  it('setLanguage switches dir/lang, saves the choice, and switching back restores ltr', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLanguage('he'));
    expect(result.current.language).toBe('he');
    expect(result.current.dir).toBe('rtl');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('he');
    expect(result.current.hasSavedChoice).toBe(true);

    act(() => result.current.setLanguage('en'));
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('t() follows the current language', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('continue')).toBe(TRANSLATIONS.en.continue);
    act(() => result.current.setLanguage('he'));
    expect(result.current.t('continue')).toBe(TRANSLATIONS.he.continue);
  });

  it('throws a clear error when used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useI18n())).toThrow(/LanguageProvider/);
  });
});

describe('Blocked storage (T1.2)', () => {
  it('still renders and switches when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.language).toBe('en');
    act(() => result.current.setLanguage('he'));
    expect(result.current.language).toBe('he');
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('Languages on hold (T1.2b)', () => {
  it('only English and Hebrew are enabled', () => {
    expect(ENABLED_LANGUAGES.map((l) => l.code).sort()).toEqual(['en', 'he']);
  });

  it('a saved disabled language (th) falls back to English', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'th');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.language).toBe('en');
  });

  it('setLanguage with a disabled language falls back to English', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLanguage('he'));
    act(() => result.current.setLanguage('zh'));
    expect(result.current.language).toBe('en');
  });
});

describe('useI18n in a component', () => {
  it('re-renders consumers when the language changes', () => {
    const Probe = () => {
      const { t, setLanguage } = useI18n();
      return <button onClick={() => setLanguage('he')}>{t('continue')}</button>;
    };
    render(<Probe />, { wrapper });
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent(TRANSLATIONS.en.continue);
    act(() => btn.click());
    expect(btn).toHaveTextContent(TRANSLATIONS.he.continue);
  });
});
