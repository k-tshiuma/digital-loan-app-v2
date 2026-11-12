import React, { useState } from 'react';
import {
  Users,
  Percent,
  Plus,
  Trash2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  Calendar,
  X,
} from 'lucide-react';
import {
  SimplifiedSponsor,
  Step2FormData,
  Language,
} from '@quickloan/ui-core/types';
import {
  calculateLoanRepayment,
  LOAN_PERIOD_OPTIONS,
  MAX_REPAYMENT_PERIOD_MONTHS,
} from '@quickloan/ui-core/config/appConfig';
import { formatCurrency } from '@quickloan/ui-core/i18n/format';
import { t } from '@quickloan/ui-core/i18n/translations';

interface Step2ApplicationCompletionProps {
  language: Language;
  initialData?: Step2FormData | null;
  defaultAmount?: number;
  isReadOnly?: boolean;
  onSubmit?: (data: Step2FormData) => Promise<void>;
  onCompleted?: (data: any) => void;
  lead?: any;
  onBackToLead?: () => void;
}

export const Step2ApplicationCompletion: React.FC<Step2ApplicationCompletionProps> = ({
  language = 'en',
  initialData,
  defaultAmount = 5000,
  isReadOnly = false,
  onSubmit,
  onCompleted,
  lead,
  onBackToLead,
}) => {
  // 1. Sponsors State (Simplified: only Full Name + ID or Passport)
  const [sponsors, setSponsors] = useState<SimplifiedSponsor[]>(initialData?.sponsors || []);
  const [isAddingSponsor, setIsAddingSponsor] = useState(false);
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorIdOrPassport, setSponsorIdOrPassport] = useState('');
  const [sponsorError, setSponsorError] = useState<string | null>(null);

  // 2. Loan Amount & Duration State
  const [requestedAmountNis, setRequestedAmountNis] = useState<number>(
    initialData?.loan?.requestedAmountNis || defaultAmount
  );
  const [repaymentMonths, setRepaymentMonths] = useState<number>(() => {
    const m = initialData?.loan?.repaymentPeriodMonths;
    return m && [3, 6, 9].includes(m) ? m : 6;
  });

  const repayment = calculateLoanRepayment(requestedAmountNis, repaymentMonths);

  // Validation & Form States
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Sponsor benefit visual progress
  const getSponsorProgressPercent = (count: number): number => {
    if (count === 1) return 33;
    if (count === 2) return 66;
    if (count >= 3) return 100;
    return 0;
  };
  const sponsorProgress = getSponsorProgressPercent(sponsors.length);

  const handleAddSponsor = (e: React.FormEvent) => {
    e.preventDefault();
    setSponsorError(null);
    if (isReadOnly) return;

    if (sponsors.length >= 3) {
      setSponsorError(t(language, 'step2.err.maxSponsors'));
      return;
    }
    if (!sponsorName.trim()) {
      setSponsorError(t(language, 'step2.err.sponsorNameRequired'));
      return;
    }
    if (!sponsorIdOrPassport.trim() || sponsorIdOrPassport.trim().length < 4) {
      setSponsorError(t(language, 'step3.sponsorIdOrPassport') + ' is required');
      return;
    }

    const newSponsor: SimplifiedSponsor = {
      id: `sp_${Date.now()}_${sponsors.length + 1}`,
      fullName: sponsorName.trim(),
      idOrPassportNumber: sponsorIdOrPassport.trim(),
    };

    setSponsors([...sponsors, newSponsor]);
    setSponsorName('');
    setSponsorIdOrPassport('');
    setIsAddingSponsor(false);
    setValidationErrors((prev) => {
      const c = { ...prev };
      delete c.sponsors;
      return c;
    });
  };

  const handleRemoveSponsor = (id: string) => {
    if (isReadOnly) return;
    setSponsors(sponsors.filter((s) => s.id !== id));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (sponsors.length === 0) {
      errs.sponsors = t(language, 'step2.err.atLeastOneSponsor');
    }
    if (![3, 6, 9].includes(repaymentMonths)) {
      errs.repaymentMonths = t(language, 'step2.err.invalidRepaymentPeriod');
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    // Read-only steps are a historical record: nothing can be submitted from them.
    if (isReadOnly) return;
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit({
          loan: {
            requestedAmountNis,
            repaymentPeriodMonths: repaymentMonths,
          },
          sponsors,
        });
      } else if (onCompleted) {
        onCompleted({
          loan: {
            requestedAmountNis,
            repaymentPeriodMonths: repaymentMonths,
          },
          sponsors,
        });
      }
    } catch (err: any) {
      setServerError(err.message || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto animate-in fade-in">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
            {t(language, 'step2.stepBadge')}
          </span>
          <span className="text-xs text-slate-500 font-medium">
            {t(language, 'step2.title')}
          </span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          {t(language, 'step2.title')}
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          {t(language, 'step2.approvedBannerDesc')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* SECTION 1: SPONSORS (Simplified) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-blue-600" />
              <span>{t(language, 'step2.part3Title')}</span>
            </h2>
            <span className="text-[11px] font-bold text-slate-500">
              {t(language, 'step2.sponsorsAdded', { count: sponsors.length })}
            </span>
          </div>

          {/* Progress benefit indicator */}
          {sponsors.length > 0 && (
            <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-semibold text-blue-900">{t(language, 'step2.sponsorBenefit')}</span>
                <span className="font-bold text-blue-700">{sponsorProgress}%</span>
              </div>
              <div className="w-full bg-blue-200/50 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${sponsorProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Sponsors List */}
          <div className="space-y-2">
            {sponsors.map((sp, idx) => (
              <div
                key={sp.id}
                className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between"
              >
                <div className="space-y-0.5 text-xs">
                  <div className="font-bold text-slate-900">
                    {idx + 1}. {sp.fullName}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono" dir="ltr">
                    {t(language, 'step3.sponsorIdOrPassport')}: {sp.idOrPassportNumber}
                  </div>
                </div>

                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSponsor(sp.id)}
                    className="p-1 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add Sponsor Form / Trigger */}
          {!isReadOnly && sponsors.length < 3 && !isAddingSponsor && (
            <button
              type="button"
              onClick={() => setIsAddingSponsor(true)}
              className="w-full py-3 px-4 rounded-xl border border-dashed border-blue-300 text-blue-700 bg-blue-50/40 hover:bg-blue-50 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>
                {sponsors.length === 0
                  ? t(language, 'step2.addSponsorBtn')
                  : t(language, 'step2.addAnotherSponsorBtn')}
              </span>
            </button>
          )}

          {isAddingSponsor && (
            <div className="p-4 rounded-2xl border border-blue-200 bg-blue-50/20 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  {t(language, 'step2.newSponsorTitle', { current: sponsors.length + 1 })}
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingSponsor(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  {t(language, 'step2.sponsorFullName')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={sponsorName}
                  onChange={(e) => setSponsorName(e.target.value)}
                  placeholder={t(language, 'step2.sponsorFullNamePlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  {t(language, 'step3.sponsorIdOrPassport')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={sponsorIdOrPassport}
                  onChange={(e) => setSponsorIdOrPassport(e.target.value)}
                  placeholder={t(language, 'step3.sponsorIdOrPassportPlaceholder')}
                  dir="ltr"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {sponsorError && (
                <p className="text-[11px] text-red-500 font-medium">{sponsorError}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAddingSponsor(false)}
                  className="py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  {t(language, 'step2.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleAddSponsor}
                  className="py-1.5 px-3 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  {t(language, 'step2.saveSponsor')}
                </button>
              </div>
            </div>
          )}

          {validationErrors.sponsors && (
            <p className="text-[11px] text-red-500">{validationErrors.sponsors}</p>
          )}
        </div>

        {/* SECTION 2: LOAN AMOUNT & REPAYMENT DURATION */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span>{t(language, 'step2.part1Title')}</span>
            </span>
          </h2>

          <div className="bg-slate-50 rounded-2xl p-4 sm:p-5 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-700">{t(language, 'step2.selectAmount')}</span>
              <span className="text-xl font-black text-blue-600">
                {formatCurrency(requestedAmountNis, language)}
              </span>
            </div>

            <input
              type="range"
              min={500}
              max={10000}
              step={500}
              disabled={isReadOnly}
              value={requestedAmountNis}
              onChange={(e) => setRequestedAmountNis(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-4"
            />

            <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-5" dir="ltr">
              <span>{formatCurrency(500, language)}</span>
              <span>{formatCurrency(5000, language)}</span>
              <span>{formatCurrency(10000, language)}</span>
            </div>

            {/* Repayment Duration Selector (Months) */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                {t(language, 'step2.repaymentDuration')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {LOAN_PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.months}
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => setRepaymentMonths(opt.months)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                      repaymentMonths === opt.months
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {t(language, 'monthsFormat', { months: opt.months })}
                  </button>
                ))}
              </div>
            </div>

            {/* Live Calculation Estimate */}
            <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-slate-500 block">
                  {t(language, 'step3.overallMonthlyPayment')}
                </span>
                <span className="text-lg font-black text-slate-900">
                  {formatCurrency(repayment.monthlyPaymentNis, language)}{' '}
                  <span className="text-xs font-normal text-slate-500">{t(language, 'step2.perMonth')}</span>
                </span>
              </div>
              <div className="text-end">
                <span className="text-xs font-medium text-slate-500 block">
                  {t(language, 'step3.overallTotalPayment')}
                </span>
                <span className="text-sm font-bold text-slate-800">
                  {formatCurrency(repayment.totalRepaymentNis, language)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Global Error */}
        {serverError && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Action Button */}
        <div className="flex gap-3">
          {onBackToLead && (
            <button
              type="button"
              onClick={onBackToLead}
              disabled={isSubmitting}
              className="py-3.5 px-4 rounded-2xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-colors"
            >
              {t(language, 'back')}
            </button>
          )}

          <button
            type="submit"
            id="submit-step2-btn"
            disabled={sponsors.length === 0 || isSubmitting || isReadOnly}
            className={`flex-1 py-4 px-6 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 ${
              sponsors.length > 0 && !isSubmitting && !isReadOnly
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-70'
            }`}
          >
            {isSubmitting ? (
              <span>{t(language, 'step2.submittingBtn')}</span>
            ) : (
              <>
                <span>{t(language, 'lead.submitButton')}</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
