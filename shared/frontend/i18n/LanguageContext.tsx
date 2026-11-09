import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Language } from '../types';
import { DEFAULT_LANGUAGE, getLanguageDir, isEnabledLanguage, t as translate } from './translations';
import * as fmt from './format';

export const LANGUAGE_STORAGE_KEY = 'quickloan_language';

function readStoredLanguage(): Language | null {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isEnabledLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredLanguage(lang: Language) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Private mode or blocked storage: the choice just won't survive a reload.
  }
}

function browserLanguage(): Language | null {
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('he') || nav.toLowerCase().startsWith('iw') ? 'he' : null;
}

/** Start-up order: saved choice → browser language (Hebrew only) → English. */
export function resolveInitialLanguage(): Language {
  return readStoredLanguage() ?? browserLanguage() ?? DEFAULT_LANGUAGE;
}

interface LanguageContextValue {
  language: Language;
  dir: 'ltr' | 'rtl';
  /** True once the user has picked a language on this device (it is saved in localStorage). */
  hasSavedChoice: boolean;
  /** Switch language and remember it. Disabled or unknown languages fall back to English. */
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Formatters from ./format bound to the current language. */
  formatCurrency: (value: Parameters<typeof fmt.formatCurrency>[0]) => string;
  formatNumber: (value: Parameters<typeof fmt.formatNumber>[0], maximumFractionDigits?: number) => string;
  formatDate: (value: Parameters<typeof fmt.formatDate>[0]) => string;
  formatDateTime: (value: Parameters<typeof fmt.formatDateTime>[0]) => string;
  formatTime: (value: Parameters<typeof fmt.formatTime>[0]) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode; initialLanguage?: Language }> = ({
  children,
  initialLanguage,
}) => {
  const [hasSavedChoice, setHasSavedChoice] = useState<boolean>(() => readStoredLanguage() !== null);
  const [language, setLanguageState] = useState<Language>(() =>
    initialLanguage && isEnabledLanguage(initialLanguage) ? initialLanguage : resolveInitialLanguage()
  );
  const dir = getLanguageDir(language);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
  }, [language, dir]);

  const setLanguage = useCallback((lang: Language) => {
    const next = isEnabledLanguage(lang) ? lang : DEFAULT_LANGUAGE;
    writeStoredLanguage(next);
    setHasSavedChoice(true);
    setLanguageState(next);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(language, key, params),
    [language]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      dir,
      hasSavedChoice,
      setLanguage,
      t,
      formatCurrency: (v) => fmt.formatCurrency(v, language),
      formatNumber: (v, digits) => fmt.formatNumber(v, language, digits),
      formatDate: (v) => fmt.formatDate(v, language),
      formatDateTime: (v) => fmt.formatDateTime(v, language),
      formatTime: (v) => fmt.formatTime(v, language),
    }),
    [language, dir, hasSavedChoice, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useI18n must be used inside <LanguageProvider>');
  return ctx;
}
