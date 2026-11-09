import React, { useState, useEffect } from 'react';
import { Building2, Briefcase, DollarSign, ArrowRight, ArrowLeft, ShieldCheck, Calendar } from 'lucide-react';
import { Language, EmploymentDetails } from '@quickloan/ui-core/types';
import { SALARY_PAYMENT_METHODS, calculateJobTenureMonths } from '@quickloan/ui-core/config/appConfig';
import { t } from '@quickloan/ui-core/i18n/translations';
import { optionLabel } from '@quickloan/ui-core/i18n/options';
import { DateInput } from '@quickloan/ui-core/components/DateInput';

interface Step5EmploymentDetailsProps {
  language: Language;
  initialData?: Partial<EmploymentDetails>;
  onSaveAndNext: (data: EmploymentDetails) => void;
  onBack: () => void;
}

export const Step5EmploymentDetails: React.FC<Step5EmploymentDetailsProps> = ({
  language,
  initialData,
  onSaveAndNext,
  onBack,
}) => {
  // Helper to derive approximate start date if tenure is present from seed/profile
  const getInitialStartDate = (): string => {
    if (initialData?.employmentStartDate) return initialData.employmentStartDate;
    if (initialData?.jobTenureMonths && initialData.jobTenureMonths > 0) {
      const d = new Date();
      d.setMonth(d.getMonth() - initialData.jobTenureMonths);
      return d.toISOString().split('T')[0];
    }
    // Default to ~18 months ago as initial sensible placeholder date if nothing provided
    const defaultDate = new Date();
    defaultDate.setMonth(defaultDate.getMonth() - 18);
    return defaultDate.toISOString().split('T')[0];
  };

  const initialStartDate = getInitialStartDate();
  const initialTenure = initialData?.jobTenureMonths ?? calculateJobTenureMonths(initialStartDate);

  const [formData, setFormData] = useState<EmploymentDetails>({
    employerName: initialData?.employerName || '',
    staffingAgencyName: initialData?.staffingAgencyName || '',
    employmentStartDate: initialStartDate,
    jobTenureMonths: initialTenure,
    monthlySalaryNis: initialData?.monthlySalaryNis || 7500,
    salaryPaymentMethod: initialData?.salaryPaymentMethod || 'Bank Transfer',
  });

  // Sync formData whenever initialData updates
  useEffect(() => {
    if (initialData) {
      setFormData((prev) => {
        const start = initialData.employmentStartDate ?? prev.employmentStartDate;
        const tenure = initialData.jobTenureMonths ?? (start ? calculateJobTenureMonths(start) : prev.jobTenureMonths);
        return {
          ...prev,
          employerName: initialData.employerName ?? prev.employerName,
          staffingAgencyName: initialData.staffingAgencyName ?? prev.staffingAgencyName,
          employmentStartDate: start,
          jobTenureMonths: tenure,
          monthlySalaryNis: initialData.monthlySalaryNis ?? prev.monthlySalaryNis,
          salaryPaymentMethod: initialData.salaryPaymentMethod ?? prev.salaryPaymentMethod,
        };
      });
    }
  }, [initialData]);

  const handleStartDateChange = (dateVal: string) => {
    const calculatedMonths = calculateJobTenureMonths(dateVal);
    setFormData((prev) => ({
      ...prev,
      employmentStartDate: dateVal,
      jobTenureMonths: calculatedMonths,
    }));
    if (errors.employmentStartDate || errors.jobTenureMonths) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.employmentStartDate;
        delete next.jobTenureMonths;
        return next;
      });
    }
  };

  const isPreFilled = Boolean(initialData && initialData.employerName);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!formData.employerName.trim()) {
      errs.employerName = t(language, 'requiredField');
    }

    if (!formData.employmentStartDate) {
      errs.employmentStartDate = t(language, 'requiredField');
    } else if (new Date(formData.employmentStartDate) > new Date()) {
      errs.employmentStartDate = t(language, 'wizard.err.startInFuture');
    }

    if (formData.jobTenureMonths === undefined || formData.jobTenureMonths < 0) {
      errs.jobTenureMonths = t(language, 'requiredField');
    }

    if (!formData.monthlySalaryNis || formData.monthlySalaryNis < 1000) {
      errs.monthlySalaryNis = t(language, 'wizard.err.minSalary');
    }

    if (formData.salaryPaymentMethod === 'Other' && (!formData.otherSalaryPaymentMethodDetails || !formData.otherSalaryPaymentMethodDetails.trim())) {
      errs.otherSalaryPaymentMethodDetails = t(language, 'wizard.err.otherPaymentDetails');
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSaveAndNext(formData);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 max-w-md mx-auto w-full py-2 animate-in fade-in duration-300">
      {/* Header */}
      <div className="space-y-1 mb-4">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t(language, 'employmentDetailsTitle')}
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          {t(language, 'employmentDetailsSubtitle')}
        </p>
      </div>

      {/* On-File Profile Banner */}
      {isPreFilled && (
        <div className="p-3 mb-4 rounded-2xl bg-blue-50 border border-blue-200/90 flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
            <div>
              <span className="font-bold text-blue-950 block">{t(language, 'wizard.employmentOnFile')}</span>
              <span className="text-[11px] text-blue-800">{t(language, 'wizard.employmentOnFileHint')}</span>
            </div>
          </div>
          <span className="text-[10px] font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full shrink-0">
            {t(language, 'wizard.onFile')}
          </span>
        </div>
      )}

      <div className="space-y-4 mb-8">
        {/* Employer Name */}
        <div className="space-y-1.5">
          <label htmlFor="employer-name-input" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'employerNameLabel')} <span className="text-red-500">*</span>
          </label>
          <input
            id="employer-name-input"
            type="text"
            required
            placeholder={t(language, 'wizard.employerPlaceholder')}
            value={formData.employerName}
            onChange={(e) => setFormData({ ...formData, employerName: e.target.value })}
            className={`w-full px-4 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 transition-all ${
              errors.employerName
                ? 'border-red-400 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
            }`}
          />
          {errors.employerName && <p className="text-xs text-red-600">{errors.employerName}</p>}
        </div>

        {/* Staffing Agency */}
        <div className="space-y-1.5">
          <label htmlFor="agency-name-input" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'staffingAgencyLabel')}
          </label>
          <input
            id="agency-name-input"
            type="text"
            placeholder={t(language, 'wizard.agencyPlaceholder')}
            value={formData.staffingAgencyName}
            onChange={(e) => setFormData({ ...formData, staffingAgencyName: e.target.value })}
            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none transition-all"
          />
        </div>

        {/* Employment Start Date */}
        <div className="space-y-1.5">
          <label htmlFor="start-date-input" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'employmentStartDateLabel')} <span className="text-red-500">*</span>
          </label>
          <DateInput
            id="start-date-input"
            language={language}
            required
            max={new Date().toISOString().split('T')[0]}
            value={formData.employmentStartDate || ''}
            onChange={handleStartDateChange}
            className={
              errors.employmentStartDate
                ? 'border-red-400 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
            }
          />
          {errors.employmentStartDate && <p className="text-xs text-red-600">{errors.employmentStartDate}</p>}
        </div>

        {/* Derived Job Tenure display card */}
        <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-900">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-blue-900">
                {t(language, 'jobTenureMonthsLabel')}
              </div>
              <div className="text-xs text-slate-500">
                {t(language, 'wizard.calcFromStart')}
              </div>
            </div>
          </div>
          <div className="text-end">
            <span className="text-2xl font-extrabold text-blue-950 font-mono">
              {formData.jobTenureMonths}
            </span>
            <span className="text-xs text-blue-700 font-semibold ms-1">
              {t(language, 'jobTenureMonthsSuffix')}
            </span>
            {formData.jobTenureMonths >= 12 && (
              <div className="text-[10px] text-slate-500 font-medium">
                ({Math.floor(formData.jobTenureMonths / 12)}y {formData.jobTenureMonths % 12}m)
              </div>
            )}
          </div>
        </div>

        {/* Monthly Salary in NIS ₪ */}
        <div className="space-y-1.5">
          <label htmlFor="salary-input" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'monthlySalaryLabel')} <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute start-4 top-3 text-base font-bold text-blue-900 pointer-events-none">
              ₪
            </div>
            <input
              id="salary-input"
              type="number"
              step={100}
              min={1000}
              max={50000}
              required
              value={formData.monthlySalaryNis}
              onChange={(e) => setFormData({ ...formData, monthlySalaryNis: parseInt(e.target.value) || 0 })}
              className={`w-full ps-9 pe-12 py-3 rounded-xl border bg-white text-slate-900 text-base font-bold font-mono focus:outline-none focus:ring-2 transition-all ${
                errors.monthlySalaryNis
                  ? 'border-red-400 focus:ring-red-200'
                  : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
              }`}
            />
            <span className="absolute end-4 top-3.5 text-xs text-slate-400 font-bold uppercase">
              NIS
            </span>
          </div>
          {errors.monthlySalaryNis && <p className="text-xs text-red-600">{errors.monthlySalaryNis}</p>}
        </div>

        {/* Salary Payment Method */}
        <div className="space-y-1.5">
          <label htmlFor="payment-method-select" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'salaryPaymentMethodLabel')}
          </label>
          <select
            id="payment-method-select"
            value={formData.salaryPaymentMethod}
            onChange={(e) => setFormData({ ...formData, salaryPaymentMethod: e.target.value as any })}
            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none transition-all cursor-pointer"
          >
            {SALARY_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {optionLabel(language, 'salaryMethod', m)}
              </option>
            ))}
          </select>
        </div>

        {/* Other Salary Payment Method Details */}
        {formData.salaryPaymentMethod === 'Other' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-300">
            <label htmlFor="other-payment-method-input" className="block text-xs font-bold text-slate-700 ">
              {t(language, 'pleaseSpecify')} <span className="text-red-500">*</span>
            </label>
            <input
              id="other-payment-method-input"
              type="text"
              required
              placeholder={t(language, 'provideDetails')}
              value={formData.otherSalaryPaymentMethodDetails || ''}
              onChange={(e) => setFormData({ ...formData, otherSalaryPaymentMethodDetails: e.target.value })}
              className={`w-full px-4 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 transition-all ${
                errors.otherSalaryPaymentMethodDetails
                  ? 'border-red-400 focus:ring-red-200'
                  : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
              }`}
            />
            {errors.otherSalaryPaymentMethodDetails && <p className="text-xs text-red-600">{errors.otherSalaryPaymentMethodDetails}</p>}
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="mt-auto pt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-1/3 py-3.5 px-4 rounded-xl border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          <span>{t(language, 'back')}</span>
        </button>

        <button
          type="submit"
          id="step5-continue-btn"
          className="w-2/3 py-3.5 px-6 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-semibold text-base shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 group"
        >
          <span>{t(language, 'continue')}</span>
          <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
        </button>
      </div>
    </form>
  );
};
