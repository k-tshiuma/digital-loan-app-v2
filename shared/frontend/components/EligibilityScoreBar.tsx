import React, { useState } from 'react';
import { ShieldCheck, Info, ChevronDown, ChevronUp, CheckCircle2, AlertCircle } from 'lucide-react';
import { Language, EligibilityScoreBreakdown, EligibilityFactorDetail } from '../types';
import { t } from '../i18n/translations';
import { formatNumber } from '../i18n/format';

interface EligibilityScoreBarProps {
  scoreData: EligibilityScoreBreakdown;
  language?: Language;
  showBreakdownToggle?: boolean;
  className?: string;
}

export const EligibilityScoreBar: React.FC<EligibilityScoreBarProps> = ({
  scoreData,
  language = 'en',
  showBreakdownToggle = true,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  // Numbers in the params are formatted for the current language. Older saved breakdowns
  // have pre-formatted strings, or only the English description.
  const describe = (f: EligibilityFactorDetail) => {
    if (!f.descriptionKey) return f.description;
    const params = Object.fromEntries(
      Object.entries(f.descriptionParams ?? {}).map(([k, v]) => [k, typeof v === 'number' ? formatNumber(v, language) : v])
    );
    return t(language, f.descriptionKey, params);
  };

  // Score metrics
  const { rawScore, maxRawScore, percentageOfMax, segmentsFilled, factors } = scoreData;

  // Segment colors based on score tiers (0-100% scale)
  const getSegmentColor = (index: number) => {
    if (index < segmentsFilled) {
      if (rawScore >= 70) return 'bg-emerald-600';
      if (rawScore >= 40) return 'bg-blue-600';
      return 'bg-amber-500';
    }
    return 'bg-slate-200';
  };

  return (
    <div className={`p-4 rounded-2xl bg-white border border-slate-200/90 shadow-xs space-y-3.5 transition-all ${className}`}>
      {/* Header with Title and Score Display */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-900 shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 tracking-tight">
              {t(language, 'elig.title')}
            </h3>
            <p className="text-[11px] text-slate-500">
              {t(language, 'elig.subtitle')}
            </p>
          </div>
        </div>

        {/* Score Badge */}
        <div className="text-end">
          <div className="flex items-baseline justify-end gap-1">
            <span className="text-xl font-extrabold text-blue-950 font-mono tracking-tight">
              {rawScore}%
            </span>
            <span className="text-[11px] font-medium text-slate-400">
              / {maxRawScore}%
            </span>
          </div>
          <span className="text-[10px] font-semibold text-slate-500 block">
            {t(language, 'elig.sectionsOf', { n: segmentsFilled })}
          </span>
        </div>
      </div>

      {/* 10-Segment Progress Bar */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-10 gap-1 sm:gap-1.5 w-full" role="progressbar" aria-valuenow={rawScore} aria-valuemin={0} aria-valuemax={100}>
          {Array.from({ length: 10 }).map((_, idx) => (
            <div
              key={idx}
              className={`h-2.5 rounded-full transition-all duration-300 ${getSegmentColor(idx)}`}
              title={t(language, 'elig.segmentTitle', { n: idx + 1, pct: (idx + 1) * 10 })}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium px-0.5">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Explanatory Notice */}
      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-600 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-blue-700 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t(language, 'elig.notice')}
        </p>
      </div>

      {/* Optional Factors Breakdown Toggle */}
      {showBreakdownToggle && (
        <div className="pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between text-xs font-semibold text-blue-900 hover:text-blue-800 transition-colors py-1"
          >
            <span>{t(language, 'elig.viewBreakdown')}</span>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {isExpanded && (
            <div className="mt-2.5 space-y-2 text-xs animate-in fade-in slide-in-from-top-1 duration-200">
              {/* Factor 1: Identity & Visa Document */}
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className="font-semibold text-slate-800 block">{t(language, 'elig.f.identity')}</span>
                  <span className="text-[11px] text-slate-500">{describe(factors.identity)}</span>
                </div>
                <span className="font-mono font-bold text-slate-900 shrink-0">
                  {factors.identity.awarded} / {factors.identity.max}%
                </span>
              </div>

              {/* Factor 2: Monthly Salary */}
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className="font-semibold text-slate-800 block">{t(language, 'elig.f.salary')}</span>
                  <span className="text-[11px] text-slate-500">{describe(factors.salary)}</span>
                </div>
                <span className="font-mono font-bold text-slate-900 shrink-0">
                  {factors.salary.awarded} / {factors.salary.max}%
                </span>
              </div>

              {/* Factor 3: Employment Tenure */}
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className="font-semibold text-slate-800 block">{t(language, 'elig.f.duration')}</span>
                  <span className="text-[11px] text-slate-500">{describe(factors.employmentDuration)}</span>
                </div>
                <span className="font-mono font-bold text-slate-900 shrink-0">
                  {factors.employmentDuration.awarded} / {factors.employmentDuration.max}%
                </span>
              </div>

              {/* Factor 4: Visa Validity Remaining */}
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className="font-semibold text-slate-800 block">{t(language, 'elig.f.visa')}</span>
                  <span className="text-[11px] text-slate-500">{describe(factors.visaValidity)}</span>
                </div>
                <span className="font-mono font-bold text-slate-900 shrink-0">
                  {factors.visaValidity.awarded} / {factors.visaValidity.max}%
                </span>
              </div>

              {/* Factor 5: Number of Guarantors */}
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className="font-semibold text-slate-800 block">{t(language, 'elig.f.guarantors')}</span>
                  <span className="text-[11px] text-slate-500">{describe(factors.guarantors)}</span>
                </div>
                <span className="font-mono font-bold text-slate-900 shrink-0">
                  {factors.guarantors.awarded} / {factors.guarantors.max}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
