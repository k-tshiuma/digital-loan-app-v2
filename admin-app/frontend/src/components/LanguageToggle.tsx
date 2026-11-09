import React from 'react';
import { Globe } from 'lucide-react';
import { Language } from '@quickloan/ui-core/types';
import { ENABLED_LANGUAGES, t } from '@quickloan/ui-core/i18n/translations';

interface LanguageToggleProps {
  language: Language;
  onChange: (lang: Language) => void;
}

/** English / Hebrew switch for the dark staff header (sign-in page and Back Office). */
export const LanguageToggle: React.FC<LanguageToggleProps> = ({ language, onChange }) => (
  <div
    role="group"
    aria-label={t(language, 'languageSelector')}
    className="flex items-center gap-1 bg-slate-800/80 border border-slate-700 rounded-xl p-1"
  >
    <Globe className="w-3.5 h-3.5 text-slate-400 ms-1.5" aria-hidden="true" />
    {ENABLED_LANGUAGES.map((lang) => (
      <button
        key={lang.code}
        type="button"
        lang={lang.code}
        aria-pressed={language === lang.code}
        onClick={() => onChange(lang.code)}
        className={`px-2 py-1 rounded-lg text-xs font-bold transition-colors ${
          language === lang.code ? 'bg-sky-600 text-white' : 'text-slate-300 hover:text-white'
        }`}
      >
        {lang.nativeName}
      </button>
    ))}
  </div>
);
