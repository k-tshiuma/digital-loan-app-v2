import React, { useState, useEffect } from 'react';
import { Calculator, AlertCircle, ArrowRight, ArrowLeft, Coins, Calendar, Sparkles, Building2, ShieldCheck } from 'lucide-react';
import { Language, LoanRequest, BankAccountDetails } from '@quickloan/ui-core/types';
import {
  LOAN_PERIOD_OPTIONS,
  LOAN_PURPOSE_OPTIONS,
  REPAYMENT_SOURCE_OPTIONS,
  ISRAELI_BANKS,
  calculateLoanRepayment,
  DEFAULT_APP_CONFIG,
} from '@quickloan/ui-core/config/appConfig';
import { t } from '@quickloan/ui-core/i18n/translations';
import { optionLabel } from '@quickloan/ui-core/i18n/options';
import { formatCurrency } from '@quickloan/ui-core/i18n/format';

interface Step6LoanDetailsProps {
  language: Language;
  initialData?: Partial<LoanRequest>;
  initialBankAccount?: Partial<BankAccountDetails>;
  borrowerName?: string;
  onSaveAndNext: (data: LoanRequest, bankAccount: BankAccountDetails) => void;
  onBack: () => void;
}

export const Step6LoanDetails: React.FC<Step6LoanDetailsProps> = ({
  language,
  initialData,
  initialBankAccount,
  borrowerName,
  onSaveAndNext,
  onBack,
}) => {
  const [requestedAmount, setRequestedAmount] = useState<number>(
    initialData?.requestedAmountNis || 5000
  );
  const [repaymentMonths, setRepaymentMonths] = useState<number>(
    initialData?.repaymentPeriodMonths || 6
  );
  const [loanPurpose, setLoanPurpose] = useState<string>(
    initialData?.loanPurpose || 'Cash Flow'
  );
  const [otherPurposeDetails, setOtherPurposeDetails] = useState<string>(
    initialData?.otherPurposeDetails || ''
  );
  const [repaymentSource, setRepaymentSource] = useState<string>(
    initialData?.repaymentSource || 'Bank transfer'
  );

  // Bank account details for loan disbursement
  const [bankName, setBankName] = useState<string>(
    initialBankAccount?.bankName || 'Bank Hapoalim'
  );
  const [branchNumber, setBranchNumber] = useState<string>(
    initialBankAccount?.branchNumber || ''
  );
  const [accountNumber, setAccountNumber] = useState<string>(
    initialBankAccount?.accountNumber || ''
  );
  const [accountHolderName, setAccountHolderName] = useState<string>(
    initialBankAccount?.accountHolderName || borrowerName || ''
  );
  const [bankErrors, setBankErrors] = useState<Record<string, string>>({});

  // Synchronize bank account when initialBankAccount updates from profile
  useEffect(() => {
    if (initialBankAccount) {
      if (initialBankAccount.bankName) setBankName(initialBankAccount.bankName);
      if (initialBankAccount.branchNumber) setBranchNumber(initialBankAccount.branchNumber);
      if (initialBankAccount.accountNumber) setAccountNumber(initialBankAccount.accountNumber);
      if (initialBankAccount.accountHolderName) {
        setAccountHolderName(initialBankAccount.accountHolderName);
      } else if (borrowerName) {
        setAccountHolderName(borrowerName);
      }
    }
  }, [initialBankAccount, borrowerName]);

  const [calculation, setCalculation] = useState(() =>
    calculateLoanRepayment(requestedAmount, repaymentMonths)
  );

  // Live repayment recalculation
  useEffect(() => {
    const calc = calculateLoanRepayment(requestedAmount, repaymentMonths);
    setCalculation(calc);
  }, [requestedAmount, repaymentMonths]);

  const handleAmountSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRequestedAmount(Number(e.target.value));
  };

  const handleAmountInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (!isNaN(val)) {
      setRequestedAmount(val);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!branchNumber.trim()) errs.branchNumber = t(language, 'requiredField');
    if (!accountNumber.trim()) errs.accountNumber = t(language, 'requiredField');
    if (!accountHolderName.trim()) errs.accountHolderName = t(language, 'requiredField');

    if (Object.keys(errs).length > 0) {
      setBankErrors(errs);
      return;
    }

    const selectedBank = ISRAELI_BANKS.find((b) => b.name === bankName);

    onSaveAndNext(
      {
        requestedAmountNis: requestedAmount,
        loanPurpose: loanPurpose as any,
        otherPurposeDetails: loanPurpose === 'Other' ? otherPurposeDetails : undefined,
        repaymentPeriodMonths: repaymentMonths as any,
        repaymentSource: repaymentSource as any,
        estimatedMonthlyPaymentNis: calculation.monthlyPaymentNis,
        totalRepaymentNis: calculation.totalRepaymentNis,
      },
      {
        bankName,
        bankCode: selectedBank?.code,
        branchNumber: branchNumber.trim(),
        accountNumber: accountNumber.trim(),
        accountHolderName: accountHolderName.trim(),
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 max-w-md mx-auto w-full py-2 animate-in fade-in duration-300">
      {/* Header */}
      <div className="space-y-1 mb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t(language, 'loanDetailsTitle')}
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          {t(language, 'loanDetailsSubtitle')}
        </p>
      </div>

      <div className="space-y-5 mb-6">
        {/* Loan Amount Slider & Input */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-700 ">
              {t(language, 'loanAmountLabel')}
            </label>
            <span className="text-[11px] text-slate-400 font-semibold">
              {t(language, 'wizard.amountRange', { min: formatCurrency(DEFAULT_APP_CONFIG.minLoanAmountNis, language), max: formatCurrency(DEFAULT_APP_CONFIG.maxLoanAmountNis, language) })}
            </span>
          </div>

          <div className="flex items-center justify-center py-1">
            <span className="text-3xl font-extrabold text-blue-900 font-mono tracking-tight">
              {formatCurrency(requestedAmount, language)}
            </span>
          </div>

          {/* Range Slider */}
          <div className="space-y-1">
            <input
              type="range"
              min={500}
              max={10000}
              step={500}
              value={requestedAmount}
              onChange={handleAmountSliderChange}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-900"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono font-medium px-1">
              <span>{formatCurrency(DEFAULT_APP_CONFIG.minLoanAmountNis, language)}</span>
              <span>{formatCurrency(5000, language)}</span>
              <span>{formatCurrency(DEFAULT_APP_CONFIG.maxLoanAmountNis, language)}</span>
            </div>
          </div>
        </div>

        {/* Repayment Period in Months */}
        <div className="space-y-1.5">
          <label htmlFor="period-select" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'repaymentPeriodLabel')} <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {LOAN_PERIOD_OPTIONS.map((opt) => {
              const isSelected = repaymentMonths === opt.months;
              return (
                <button
                  key={opt.months}
                  type="button"
                  onClick={() => setRepaymentMonths(opt.months)}
                  className={`py-3 px-2 rounded-xl text-center border font-bold text-xs transition-all ${
                    isSelected
                      ? 'bg-blue-900 text-white border-blue-900 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {t(language, 'wizard.monthsShort', { n: opt.months })}
                </button>
              );
            })}
          </div>
        </div>

        {/* Loan Purpose */}
        <div className="space-y-1.5">
          <label htmlFor="purpose-select" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'loanPurposeLabel')} <span className="text-red-500">*</span>
          </label>
          <select
            id="purpose-select"
            value={loanPurpose}
            onChange={(e) => setLoanPurpose(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none cursor-pointer"
          >
            {LOAN_PURPOSE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {optionLabel(language, 'loanPurpose', p)}
              </option>
            ))}
          </select>

          {loanPurpose === 'Other' && (
            <input
              type="text"
              required
              placeholder={t(language, 'otherPurposePlaceholder')}
              value={otherPurposeDetails}
              onChange={(e) => setOtherPurposeDetails(e.target.value)}
              className="w-full mt-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:border-blue-900 focus:outline-none"
            />
          )}
        </div>

        {/* Repayment Source */}
        <div className="space-y-1.5">
          <label htmlFor="repayment-source-select" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'repaymentSourceLabel')} <span className="text-red-500">*</span>
          </label>
          <select
            id="repayment-source-select"
            value={repaymentSource}
            onChange={(e) => setRepaymentSource(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none cursor-pointer"
          >
            {REPAYMENT_SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {optionLabel(language, 'repaymentSource', s)}
              </option>
            ))}
          </select>
        </div>

        {/* Live Calculation / Transparent Repayment Breakdown Card - FinBest Theme */}
        <div className="p-4.5 rounded-2xl bg-gradient-to-br from-[#0b1a2d] via-[#0d2038] to-[#122846] text-white shadow-xl border border-sky-500/30 space-y-3 relative overflow-hidden">
          <div className="absolute top-0 end-0 w-32 h-32 bg-sky-500/10 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5 relative z-10">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-bold text-sky-200">
                {t(language, 'estimatedRepaymentTitle')}
              </span>
            </div>
            <span className="text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2.5 py-0.5 rounded-full font-bold">
              {t(language, 'wizard.monthsPlan', { n: repaymentMonths })}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1 relative z-10">
            <div>
              <div className="text-[11px] text-slate-300 font-medium">
                {t(language, 'estimatedMonthlyRepayment')}
              </div>
              <div className="text-2xl font-extrabold font-mono text-sky-400 mt-0.5">
                {formatCurrency(calculation.monthlyPaymentNis, language)}
              </div>
            </div>

            <div className="text-end">
              <div className="text-[11px] text-slate-300 font-medium">
                {t(language, 'totalRepayment')}
              </div>
              <div className="text-2xl font-extrabold font-mono text-white mt-0.5">
                {formatCurrency(calculation.totalRepaymentNis, language)}
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 border-t border-slate-700/60 pt-2 flex items-center justify-between relative z-10">
            <span>{t(language, 'wizard.interestAndFee', { rate: calculation.interestRatePercent, fee: formatCurrency(calculation.managementFeeNis, language) })}</span>
            <span className="font-mono text-sky-300 font-semibold">{formatCurrency(calculation.totalInterestNis + calculation.managementFeeNis, language)}</span>
          </div>
        </div>

        {/* Receiving Bank Account Section */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center font-bold">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">
                {t(language, 'bankAccountTitle')}
              </h2>
              <p className="text-[11px] text-slate-500">
                {t(language, 'bankAccountSubtitle')}
              </p>
            </div>
          </div>

          {/* On-File Bank Account Banner */}
          {initialBankAccount?.accountNumber && (
            <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between text-xs animate-in fade-in">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                <span className="text-[11px] text-blue-900 font-medium">{t(language, 'wizard.bankOnFile')}</span>
              </div>
              <span className="text-[10px] font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full shrink-0">
                {t(language, 'wizard.onFile')}
              </span>
            </div>
          )}

          {/* Bank Name Select */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              {t(language, 'bankNameLabel')} <span className="text-red-500">*</span>
            </label>
            <select
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none cursor-pointer"
            >
              {ISRAELI_BANKS.map((b) => (
                <option key={b.code} value={b.name}>
                  {language === 'he' ? b.hebrewName : `${b.name} (${b.hebrewName})`}
                </option>
              ))}
            </select>
          </div>

          {/* Branch Number & Account Number */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                {t(language, 'bankBranchLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                id="bank-branch-input"
                type="text"
                maxLength={4}
                value={branchNumber}
                dir="ltr"
                onChange={(e) => {
                  setBranchNumber(e.target.value.replace(/\D/g, ''));
                  if (bankErrors.branchNumber) {
                    setBankErrors((prev) => ({ ...prev, branchNumber: '' }));
                  }
                }}
                placeholder={t(language, 'bankBranchPlaceholder')}
                className={`w-full px-3.5 py-2.5 rounded-xl border ${
                  bankErrors.branchNumber ? 'border-red-500 bg-red-50/30' : 'border-slate-300 bg-white'
                } text-slate-900 text-sm font-mono focus:border-blue-900 focus:outline-none`}
              />
              {bankErrors.branchNumber && (
                <p className="text-[11px] text-red-500">{bankErrors.branchNumber}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                {t(language, 'bankAccountNumberLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                id="bank-account-input"
                type="text"
                maxLength={12}
                value={accountNumber}
                dir="ltr"
                onChange={(e) => {
                  setAccountNumber(e.target.value.replace(/\D/g, ''));
                  if (bankErrors.accountNumber) {
                    setBankErrors((prev) => ({ ...prev, accountNumber: '' }));
                  }
                }}
                placeholder={t(language, 'bankAccountNumberPlaceholder')}
                className={`w-full px-3.5 py-2.5 rounded-xl border ${
                  bankErrors.accountNumber ? 'border-red-500 bg-red-50/30' : 'border-slate-300 bg-white'
                } text-slate-900 text-sm font-mono focus:border-blue-900 focus:outline-none`}
              />
              {bankErrors.accountNumber && (
                <p className="text-[11px] text-red-500">{bankErrors.accountNumber}</p>
              )}
            </div>
          </div>

          {/* Account Holder Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              {t(language, 'accountHolderNameLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              id="bank-holder-input"
              type="text"
              value={accountHolderName}
              onChange={(e) => {
                setAccountHolderName(e.target.value);
                if (bankErrors.accountHolderName) {
                  setBankErrors((prev) => ({ ...prev, accountHolderName: '' }));
                }
              }}
              placeholder={t(language, 'wizard.accountHolderPlaceholder')}
              className={`w-full px-3.5 py-2.5 rounded-xl border ${
                bankErrors.accountHolderName ? 'border-red-500 bg-red-50/30' : 'border-slate-300 bg-white'
              } text-slate-900 text-sm focus:border-blue-900 focus:outline-none`}
            />
            <p className="text-[10px] text-slate-500">
              {t(language, 'accountHolderNameHint')}
            </p>
            {bankErrors.accountHolderName && (
              <p className="text-[11px] text-red-500">{bankErrors.accountHolderName}</p>
            )}
          </div>

          {/* Compliance & Security Callout */}
          <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-800 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-900 leading-snug">
              {t(language, 'bankAccountOwnershipNotice')}
            </p>
          </div>
        </div>
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
          id="step6-continue-btn"
          className="w-2/3 py-3.5 px-6 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-semibold text-base shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 group"
        >
          <span>{t(language, 'continue')}</span>
          <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
        </button>
      </div>
    </form>
  );
};
