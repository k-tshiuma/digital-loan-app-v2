import React from 'react';
import { Globe, Check, ArrowRight } from 'lucide-react';
import { Language } from '@quickloan/ui-core/types';
import { ENABLED_LANGUAGES, t } from '@quickloan/ui-core/i18n/translations';

interface Step1LanguageProps {
  selectedLanguage: Language;
  onSelectLanguage: (lang: Language) => void;
  onNext: () => void;
}

export const Step1Language: React.FC<Step1LanguageProps> = ({
  selectedLanguage,
  onSelectLanguage,
  onNext,
}) => {
  return (
    <div className="flex flex-col flex-1 max-w-md mx-auto w-full py-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Icon badge */}
      <div className="flex justify-center mb-5">
        <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-xs">
          <Globe className="w-8 h-8" />
        </div>
      </div>

      {/* Header text */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t(selectedLanguage, 'chooseLanguageTitle')}
        </h1>
        <p className="text-sm text-slate-500 mt-2 max-w-xs mx-auto leading-relaxed">
          {t(selectedLanguage, 'chooseLanguageSubtitle')}
        </p>
      </div>

      {/* Language cards */}
      <div className="space-y-3 mb-8">
        {ENABLED_LANGUAGES.map((lang) => {
          const isSelected = selectedLanguage === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              id={`lang-select-${lang.code}`}
              onClick={() => onSelectLanguage(lang.code)}
              className={`w-full p-4 rounded-2xl border text-start flex items-center justify-between transition-all duration-200 ${
                isSelected
                  ? 'border-blue-900 bg-white ring-2 ring-blue-900/10 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm transition-colors ${
                    isSelected ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {lang.abbr}
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-slate-900 text-base leading-snug">
                    {lang.nativeName}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {lang.name}
                  </span>
                </div>
              </div>

              <div className="flex items-center">
                {isSelected ? (
                  <div className="w-6 h-6 rounded-full bg-blue-900 text-white flex items-center justify-center shadow-xs">
                    <Check className="w-4 h-4 stroke-[2.5]" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full border-2 border-slate-200" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Continue button */}
      <div className="mt-auto pt-4">
        <button
          type="button"
          id="step1-continue-btn"
          onClick={onNext}
          className="w-full py-3.5 px-6 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-semibold text-base shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 group"
        >
          <span>{t(selectedLanguage, 'continue')}</span>
          <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
};
