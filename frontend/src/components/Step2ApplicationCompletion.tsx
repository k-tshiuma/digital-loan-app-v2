import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Building2,
  Users,
  UploadCloud,
  FileText,
  Trash2,
  Plus,
  ShieldCheck,
  CreditCard,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Coins,
  FileCheck2,
  X,
} from 'lucide-react';
import {
  Sponsor,
  SponsorType,
  FileAttachment,
  UploadedFile,
  Step2CompletionData,
  LeadData,
  Language,
} from '../types';
import {
  ISRAELI_BANKS,
  calculateLoanRepayment,
  LOAN_PERIOD_OPTIONS,
  MAX_REPAYMENT_PERIOD_MONTHS,
} from '../config/appConfig';
import { formatCurrency } from '../i18n/format';
import { t } from '../i18n/translations';

interface Step2ApplicationCompletionProps {
  lead?: LeadData | null;
  onCompleted: (data: Step2CompletionData) => void;
  onBackToLead?: () => void;
  language?: Language;
}

export const Step2ApplicationCompletion: React.FC<Step2ApplicationCompletionProps> = ({
  lead,
  onCompleted,
  onBackToLead,
  language = 'en',
}) => {
  const getAttachmentName = (doc?: FileAttachment | UploadedFile | null): string => {
    if (!doc) return '';
    return 'name' in doc ? doc.name : doc.originalFilename;
  };

  // ----------------------------------------------------
  // Loan Amount & Repayment Duration State
  // Allowed periods: 3, 6, 9 months (never exceeding 10 / max 9)
  // ----------------------------------------------------
  const [requestedAmountNis, setRequestedAmountNis] = useState<number>(
    lead?.requestedLoanAmountNis || 5000
  );
  const [repaymentMonths, setRepaymentMonths] = useState<number>(() => {
    const initial = lead?.repaymentPeriodMonths;
    return initial && [3, 6, 9].includes(initial) ? initial : 6;
  });

  const repayment = calculateLoanRepayment(requestedAmountNis, repaymentMonths);

  // ----------------------------------------------------
  // 1. Bank Details State
  // ----------------------------------------------------
  const [bankName, setBankName] = useState(ISRAELI_BANKS[0]?.name || 'Bank Hapoalim');
  const [branchCode, setBranchCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolderName, setAccountHolderName] = useState(lead?.fullName || '');

  // ----------------------------------------------------
  // 2. Sponsors State
  // ----------------------------------------------------
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [isAddingSponsor, setIsAddingSponsor] = useState(false);

  // New Sponsor Form fields
  const [sponsorType, setSponsorType] = useState<SponsorType>('israeli');
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorIdNumber, setSponsorIdNumber] = useState('');
  const [sponsorPassportDoc, setSponsorPassportDoc] = useState<FileAttachment | null>(null);
  const [sponsorVisaDoc, setSponsorVisaDoc] = useState<FileAttachment | null>(null);
  const [sponsorFormError, setSponsorFormError] = useState<string | null>(null);

  // ----------------------------------------------------
  // 3. Bank Account Management Authorization State
  // ----------------------------------------------------
  const [bankAuthDoc, setBankAuthDoc] = useState<FileAttachment | null>(null);

  // ----------------------------------------------------
  // 4. Mandatory Agreements State (Not preselected)
  // ----------------------------------------------------
  const [agreedToTerms, setAgreedToTerms] = useState<boolean>(false);
  const [agreedToServiceFee, setAgreedToServiceFee] = useState<boolean>(false);
  const [showTermsModal, setShowTermsModal] = useState<boolean>(false);

  // Submission & Validation States
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Business rule validation: repayment period must be 3, 6, or 9 and <= 9
  const isValidRepaymentPeriod = [3, 6, 9].includes(repaymentMonths) && repaymentMonths <= MAX_REPAYMENT_PERIOD_MONTHS;
  const isAgreementsComplete = agreedToTerms && agreedToServiceFee && isValidRepaymentPeriod;

  // ----------------------------------------------------
  // Sponsor Progress Calculation
  // ----------------------------------------------------
  const getSponsorProgressPercent = (count: number): number => {
    if (count === 1) return 30;
    if (count === 2) return 65;
    if (count >= 3) return 100;
    return 0;
  };

  const sponsorProgress = getSponsorProgressPercent(sponsors.length);

  // ----------------------------------------------------
  // Sponsor Handlers
  // ----------------------------------------------------
  const handleAddSponsorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSponsorFormError(null);

    if (sponsors.length >= 3) {
      setSponsorFormError(t(language, 'step2.err.maxSponsors'));
      return;
    }

    if (!sponsorName.trim()) {
      setSponsorFormError(t(language, 'step2.err.sponsorNameRequired'));
      return;
    }

    if (sponsorType === 'israeli') {
      const cleanId = sponsorIdNumber.replace(/\D/g, '');
      if (!cleanId || cleanId.length < 8) {
        setSponsorFormError(t(language, 'step2.err.israeliIdRequired'));
        return;
      }

      const newSponsor: Sponsor = {
        id: `sp_${Date.now()}`,
        type: 'israeli',
        name: sponsorName.trim(),
        idNumber: cleanId,
      };

      setSponsors([...sponsors, newSponsor]);
    } else {
      if (!sponsorPassportDoc) {
        setSponsorFormError(t(language, 'step2.err.foreignPassportRequired'));
        return;
      }
      if (!sponsorVisaDoc) {
        setSponsorFormError(t(language, 'step2.err.foreignVisaRequired'));
        return;
      }

      const newSponsor: Sponsor = {
        id: `sp_${Date.now()}`,
        type: 'foreign',
        name: sponsorName.trim(),
        passportDoc: sponsorPassportDoc,
        visaDoc: sponsorVisaDoc,
      };

      setSponsors([...sponsors, newSponsor]);
    }

    // Reset sponsor form
    setSponsorName('');
    setSponsorIdNumber('');
    setSponsorPassportDoc(null);
    setSponsorVisaDoc(null);
    setIsAddingSponsor(false);
  };

  const handleRemoveSponsor = (id: string) => {
    setSponsors(sponsors.filter((s) => s.id !== id));
  };

  // ----------------------------------------------------
  // Step 2 Final Submission
  // ----------------------------------------------------
  const handleFinalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!isValidRepaymentPeriod) {
      errors.repaymentMonths = t(language, 'step2.err.invalidRepaymentPeriod');
    }
    if (!branchCode.trim()) {
      errors.branchCode = t(language, 'step2.err.branchCode');
    }
    if (!accountNumber.trim()) {
      errors.accountNumber = t(language, 'step2.err.accountNumber');
    }
    if (!accountHolderName.trim()) {
      errors.accountHolderName = t(language, 'step2.err.accountHolder');
    }
    if (sponsors.length === 0) {
      errors.sponsors = t(language, 'step2.err.atLeastOneSponsor');
    }
    if (!bankAuthDoc) {
      errors.bankAuthDoc = t(language, 'step2.err.bankAuthDoc');
    }
    // Mandatory Agreements Validation
    if (!agreedToTerms) {
      errors.terms = t(language, 'step2.err.termsRequired');
    }
    if (!agreedToServiceFee) {
      errors.serviceFee = t(language, 'step2.err.serviceFeeRequired');
    }

    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    const completionPayload: Step2CompletionData = {
      requestedLoanAmountNis: requestedAmountNis,
      repaymentPeriodMonths: repaymentMonths,
      monthlyPaymentNis: repayment.monthlyPaymentNis,
      serviceFeeNis: repayment.serviceFeeNis,
      agreedToTerms,
      agreedToServiceFee,
      bankAccount: {
        bankName,
        branchNumber: branchCode.trim(),
        accountNumber: accountNumber.trim(),
        accountHolderName: accountHolderName.trim(),
      },
      sponsors,
      bankAccountAuthorizationDoc: bankAuthDoc,
      submittedAt: new Date().toISOString(),
    };

    setTimeout(() => {
      setIsSubmitting(false);
      setIsSubmitted(true);
      onCompleted(completionPayload);
    }, 700);
  };

  // ====================================================
  // SCREEN: COMPLETION SUCCESS VIEW
  // ====================================================
  if (isSubmitted) {
    return (
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto text-center space-y-6 animate-in fade-in">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner border border-emerald-200">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-1">
            {t(language, 'step2.successTitle')}
          </h2>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            {t(language, 'step2.successDesc')}
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-start space-y-2.5">
          <div className="font-bold text-slate-800 border-b border-slate-200 pb-2 flex justify-between">
            <span>{t(language, 'step2.successSummaryTitle')}</span>
            <span className="text-emerald-700 font-bold">{t(language, 'step2.verifiedComplete')}</span>
          </div>
          <div className="text-slate-600">
            <span className="font-semibold text-slate-700">{t(language, 'step2.loanRepaymentSummary')}</span>{' '}
            {t(language, 'step2.loanRepaymentValue', {
              amount: formatCurrency(requestedAmountNis, language),
              months: repaymentMonths,
              monthly: formatCurrency(repayment.monthlyPaymentNis, language),
            })}
          </div>
          <div className="text-slate-600">
            <span className="font-semibold text-slate-700">{t(language, 'step2.bankSummary')}</span>{' '}
            {t(language, 'step2.bankValue', {
              bank: bankName,
              branch: branchCode,
              account: accountNumber,
            })}
          </div>
          <div className="text-slate-600">
            <span className="font-semibold text-slate-700">{t(language, 'step2.sponsorsAddedSummary')}</span>{' '}
            {t(language, 'step2.sponsorsAddedValue', {
              count: sponsors.length,
              benefit: sponsorProgress,
            })}
          </div>
          <div className="text-slate-600">
            <span className="font-semibold text-slate-700">{t(language, 'step2.authDocSummary')}</span>{' '}
            {getAttachmentName(bankAuthDoc)}
          </div>
        </div>

        <button
          type="button"
          onClick={onBackToLead}
          className="w-full py-3.5 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition-all"
        >
          {t(language, 'step2.returnToOverview')}
        </button>
      </div>
    );
  }

  // ====================================================
  // MAIN VIEW: STEP 2 APPLICATION COMPLETION
  // ====================================================
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto space-y-6 animate-in fade-in">
      {/* REQUIRED APPROVED HEADER MESSAGE */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 sm:p-5 text-emerald-950 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-emerald-900 text-sm">
            {t(language, 'step2.approvedBannerTitle')}
          </p>
          <p className="text-emerald-800 leading-relaxed">
            {t(language, 'step2.approvedBannerDesc')}
          </p>
        </div>
      </div>

      <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
            {t(language, 'step2.stepBadge')}
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
            {t(language, 'step2.title')}
          </h1>
        </div>
        {onBackToLead && (
          <button
            type="button"
            onClick={onBackToLead}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
            {t(language, 'back')}
          </button>
        )}
      </div>

      <form onSubmit={handleFinalSubmit} className="space-y-6">
        {/* ==================================================== */}
        {/* PART 1: LOAN AMOUNT & REPAYMENT DURATION             */}
        {/* Options: 3, 6, 9 months (Business rule: max 9 mos)   */}
        {/* ==================================================== */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-blue-600" />
              {t(language, 'step2.part1Title')}
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
              value={requestedAmountNis}
              onChange={(e) => setRequestedAmountNis(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-4"
            />

            <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-4" dir="ltr">
              <span>{formatCurrency(500, language)}</span>
              <span>{formatCurrency(5000, language)}</span>
              <span>{formatCurrency(10000, language)}</span>
            </div>

            {/* Repayment Months Selector: Strictly 3, 6, 9 months */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-2">
                {t(language, 'step2.repaymentDuration')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {LOAN_PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.months}
                    type="button"
                    id={`repayment-period-${opt.months}-btn`}
                    onClick={() => {
                      setRepaymentMonths(opt.months);
                      setValidationErrors((prev) => {
                        const copy = { ...prev };
                        delete copy.repaymentMonths;
                        return copy;
                      });
                    }}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                      repaymentMonths === opt.months
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {t(language, 'wizard.monthsPlan', { n: opt.months })}
                  </button>
                ))}
              </div>
              {validationErrors.repaymentMonths && (
                <p className="text-[11px] text-red-500 mt-1">{validationErrors.repaymentMonths}</p>
              )}
            </div>

            {/* Live Calculation / Transparent Repayment Breakdown Card */}
            <div className="mt-4 p-5 rounded-2xl bg-gradient-to-br from-[#0b1a2d] via-[#0d2038] to-[#122846] text-white shadow-xl border border-sky-500/30 space-y-4 relative overflow-hidden">
              <div className="absolute top-0 end-0 w-36 h-36 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

              {/* Header */}
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

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 pt-1 relative z-10">
                <div>
                  <div className="text-[11px] text-slate-300 font-medium">
                    {t(language, 'estimatedMonthlyRepayment')}
                  </div>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono text-sky-400 mt-0.5">
                    {formatCurrency(repayment.monthlyPaymentNis, language)}
                    <span className="text-xs font-normal text-slate-400 ms-1">{t(language, 'step2.perMonth')}</span>
                  </div>
                </div>

                <div className="text-end">
                  <div className="text-[11px] text-slate-300 font-medium">
                    {t(language, 'totalRepayment')}
                  </div>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono text-white mt-0.5">
                    {formatCurrency(repayment.totalRepaymentNis, language)}
                  </div>
                </div>
              </div>

              {/* Itemized Breakdown */}
              <div className="border-t border-slate-700/60 pt-3 space-y-2 relative z-10">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  {t(language, 'step2.breakdownTitle')}
                </div>

                {/* 1. Payment to Bank */}
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/60 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-sky-400" />
                      <span>{t(language, 'step2.paymentToBank')}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t(language, 'step2.totalLoanToBank', { amount: formatCurrency(repayment.baseMonthlyRepaymentNis * repaymentMonths, language) })}
                    </div>
                  </div>
                  <div className="text-end">
                    <span className="font-mono text-sm font-bold text-white">
                      {formatCurrency(repayment.baseMonthlyRepaymentNis, language)}
                    </span>
                    <span className="text-[10px] text-slate-400 ms-1">{t(language, 'step2.perMonth')}</span>
                  </div>
                </div>

                {/* 2. Service Fee */}
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/60 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-amber-400" />
                      <span>{t(language, 'step2.serviceFee')}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t(language, 'step2.totalFee', { amount: formatCurrency(repayment.serviceFeeNis, language) })}
                    </div>
                  </div>
                  <div className="text-end">
                    <span className="font-mono text-sm font-bold text-amber-300">
                      {formatCurrency(repayment.monthlyServiceFeeNis, language)}
                    </span>
                    <span className="text-[10px] text-slate-400 ms-1">{t(language, 'step2.perMonth')}</span>
                  </div>
                </div>

                {/* 3. Total */}
                <div className="p-3 rounded-xl bg-sky-950/70 border border-sky-500/50 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-sky-200 flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-sky-400" />
                      <span>{t(language, 'step2.totalBoth')}</span>
                    </div>
                    <div className="text-[11px] text-sky-300/80">
                      {t(language, 'step2.overallTotal', { amount: formatCurrency(repayment.totalRepaymentNis, language) })}
                    </div>
                  </div>
                  <div className="text-end">
                    <span className="font-mono text-base font-black text-sky-400">
                      {formatCurrency(repayment.monthlyPaymentNis, language)}
                    </span>
                    <span className="text-[10px] text-sky-300 ms-1">{t(language, 'step2.perMonth')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ==================================================== */}
        {/* PART 2: BANK DETAILS                                */}
        {/* ==================================================== */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'step2.part2Title')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'step2.bankName')} <span className="text-red-500">*</span>
              </label>
              <select
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                {ISRAELI_BANKS.map((bank) => (
                  <option key={bank.code} value={bank.name}>
                    {bank.name} ({bank.hebrewName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'step2.branchCode')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
                placeholder="e.g. 612"
                className={`w-full px-3 py-2 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.branchCode ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {validationErrors.branchCode && (
                <p className="text-[11px] text-red-500 mt-1">{validationErrors.branchCode}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'step2.accountNumber')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g. 123456"
                className={`w-full px-3 py-2 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.accountNumber ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {validationErrors.accountNumber && (
                <p className="text-[11px] text-red-500 mt-1">{validationErrors.accountNumber}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'step2.accountHolder')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={accountHolderName}
                onChange={(e) => setAccountHolderName(e.target.value)}
                placeholder={t(language, 'step2.accountHolderPlaceholder')}
                className={`w-full px-3 py-2 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.accountHolderName ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {validationErrors.accountHolderName && (
                <p className="text-[11px] text-red-500 mt-1">{validationErrors.accountHolderName}</p>
              )}
            </div>
          </div>
        </div>

        {/* ==================================================== */}
        {/* PART 3: SPONSOR(S) & PROGRESS BAR                   */}
        {/* ==================================================== */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-blue-600" />
              {t(language, 'step2.part3Title')} <span className="text-red-500">*</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-400">
              {t(language, 'step2.sponsorsAdded', { count: sponsors.length })}
            </span>
          </div>

          {/* SPONSOR PROGRESS BAR */}
          {sponsors.length > 0 && (
            <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  {t(language, 'step2.sponsorBenefit')}
                </span>
                <span className="font-mono text-blue-700">{sponsorProgress}%</span>
              </div>

              <div className="w-full h-3 bg-blue-100 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-500 rounded-full"
                  style={{ width: `${sponsorProgress}%` }}
                />
              </div>

              <p className="text-xs font-medium text-blue-900 leading-relaxed pt-1">
                {t(language, 'step2.sponsorNotice')}
              </p>
            </div>
          )}

          {/* Added Sponsors List */}
          {sponsors.length > 0 && (
            <div className="space-y-2.5">
              {sponsors.map((sp, idx) => (
                <div
                  key={sp.id}
                  className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-800">
                        {idx + 1}. {sp.name}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          sp.type === 'israeli'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {sp.type === 'israeli' ? t(language, 'step2.israeliSponsor') : t(language, 'step2.foreignSponsor')}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {sp.type === 'israeli' ? (
                        <span>{t(language, 'step2.idNumberLabel')} <bdi dir="ltr">{sp.idNumber}</bdi></span>
                      ) : (
                        <span>
                          {t(language, 'step2.passportLabel')} {getAttachmentName(sp.passportDoc)} • {t(language, 'step2.visaLabel')} {getAttachmentName(sp.visaDoc)}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveSponsor(sp.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50"
                    title={t(language, 'step2.removeSponsor')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Sponsor Trigger / Form */}
          {!isAddingSponsor ? (
            <div>
              <button
                type="button"
                id="add-sponsor-btn"
                disabled={sponsors.length >= 3}
                onClick={() => setIsAddingSponsor(true)}
                className={`w-full py-3 px-4 rounded-2xl border border-dashed text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                  sponsors.length >= 3
                    ? 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed'
                    : 'border-blue-300 text-blue-600 bg-blue-50/40 hover:bg-blue-50 hover:border-blue-400'
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>
                  {sponsors.length >= 3
                    ? t(language, 'step2.maxSponsorsAdded')
                    : sponsors.length === 0
                    ? t(language, 'step2.addSponsorBtn')
                    : t(language, 'step2.addAnotherSponsorBtn')}
                </span>
              </button>
              {validationErrors.sponsors && (
                <p className="text-[11px] text-red-500 mt-1">{validationErrors.sponsors}</p>
              )}
            </div>
          ) : (
            /* Inline Form to Add Sponsor */
            <div className="p-4 rounded-2xl border border-blue-200 bg-blue-50/30 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-blue-100 pb-2">
                <span className="text-xs font-bold text-slate-800">
                  {t(language, 'step2.newSponsorTitle', { current: sponsors.length + 1 })}
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingSponsor(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 font-semibold"
                >
                  {t(language, 'step2.cancel')}
                </button>
              </div>

              {/* Sponsor Type Toggle */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {t(language, 'step2.sponsorType')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSponsorType('israeli')}
                    className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all ${
                      sponsorType === 'israeli'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {t(language, 'step2.israeliSponsor')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSponsorType('foreign')}
                    className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all ${
                      sponsorType === 'foreign'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {t(language, 'step2.foreignSponsor')}
                  </button>
                </div>
              </div>

              {/* Common: Sponsor Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
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

              {/* Conditional 1: Israeli Sponsor */}
              {sponsorType === 'israeli' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t(language, 'step2.israeliIdNumber')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={sponsorIdNumber}
                    onChange={(e) => setSponsorIdNumber(e.target.value)}
                    placeholder={t(language, 'step2.israeliIdPlaceholder')}
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* Conditional 2: Foreign Sponsor */}
              {sponsorType === 'foreign' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t(language, 'step2.passportUpload')} <span className="text-red-500">*</span>
                    </label>
                    <label className="cursor-pointer block text-center p-2.5 rounded-lg border border-dashed border-slate-300 hover:border-purple-400">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) setSponsorPassportDoc({ name: f.name, size: f.size });
                        }}
                        className="hidden"
                      />
                      <FileText className="w-4 h-4 mx-auto text-slate-400 mb-0.5" />
                      <span className="text-[11px] text-slate-600 truncate block">
                        {sponsorPassportDoc ? sponsorPassportDoc.name : t(language, 'step2.uploadPassport')}
                      </span>
                    </label>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t(language, 'step2.visaUpload')} <span className="text-red-500">*</span>
                    </label>
                    <label className="cursor-pointer block text-center p-2.5 rounded-lg border border-dashed border-slate-300 hover:border-purple-400">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) setSponsorVisaDoc({ name: f.name, size: f.size });
                        }}
                        className="hidden"
                      />
                      <FileText className="w-4 h-4 mx-auto text-slate-400 mb-0.5" />
                      <span className="text-[11px] text-slate-600 truncate block">
                        {sponsorVisaDoc ? sponsorVisaDoc.name : t(language, 'step2.uploadVisa')}
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {sponsorFormError && (
                <p className="text-[11px] text-red-500 font-medium">{sponsorFormError}</p>
              )}

              <button
                type="button"
                onClick={handleAddSponsorSubmit}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors"
              >
                {t(language, 'step2.saveSponsor')}
              </button>
            </div>
          )}
        </div>

        {/* ==================================================== */}
        {/* PART 4: BANK ACCOUNT MANAGEMENT AUTHORIZATION       */}
        {/* ==================================================== */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <UploadCloud className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'step2.part4Title')} <span className="text-red-500">*</span>
          </h2>

          <div
            className={`p-4 rounded-2xl border ${
              bankAuthDoc
                ? 'border-emerald-300 bg-emerald-50/40'
                : validationErrors.bankAuthDoc
                ? 'border-red-300 bg-red-50/40'
                : 'border-slate-200 bg-slate-50/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800">
                {t(language, 'step2.bankAuthDocTitle')}
              </span>
              {bankAuthDoc && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            </div>

            <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
              {t(language, 'step2.bankAuthDocDesc')}
            </p>

            <label className="cursor-pointer block text-center p-4 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/40 transition-colors">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setBankAuthDoc({
                      name: file.name,
                      size: file.size,
                      type: file.type,
                    });
                    setValidationErrors((prev) => {
                      const c = { ...prev };
                      delete c.bankAuthDoc;
                      return c;
                    });
                  }
                }}
                className="hidden"
              />
              <FileText className="w-6 h-6 mx-auto text-slate-400 mb-1.5" />
              <span className="text-xs font-medium text-slate-700 block">
                {bankAuthDoc ? getAttachmentName(bankAuthDoc) : t(language, 'step2.uploadDocPlaceholder')}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {t(language, 'step2.maxFileSize')}
              </span>
            </label>

            {validationErrors.bankAuthDoc && (
              <p className="text-[11px] text-red-500 mt-1">{validationErrors.bankAuthDoc}</p>
            )}
          </div>
        </div>

        {/* ==================================================== */}
        {/* PART 5: MANDATORY LOAN AGREEMENTS (Prerequisites)   */}
        {/* 2.a. Terms and Conditions (actively checked)        */}
        {/* 2.b. Service Fee Acceptance (actively checked)      */}
        {/* ==================================================== */}
        <div className="space-y-4">
          <div className="border-b border-slate-100 pb-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <FileCheck2 className="w-3.5 h-3.5 text-blue-600" />
              {t(language, 'step2.part5Title')} <span className="text-red-500">*</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t(language, 'step2.agreementsNotice')}
            </p>
          </div>

          {/* 2.a: Terms and Conditions Agreement */}
          <div
            className={`p-4 rounded-2xl border transition-all ${
              agreedToTerms
                ? 'border-emerald-300 bg-emerald-50/40'
                : validationErrors.terms
                ? 'border-red-300 bg-red-50/40 ring-1 ring-red-400'
                : 'border-slate-200 bg-slate-50/50'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="terms-agreement-checkbox"
                checked={agreedToTerms}
                onChange={(e) => {
                  setAgreedToTerms(e.target.checked);
                  if (e.target.checked) {
                    setValidationErrors((prev) => {
                      const copy = { ...prev };
                      delete copy.terms;
                      return copy;
                    });
                  }
                }}
                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
              />
              <div className="text-xs text-slate-700 leading-relaxed flex-1">
                <label htmlFor="terms-agreement-checkbox" className="font-medium cursor-pointer select-none">
                  {t(language, 'step2.termsCheckboxLabel')}
                </label>
                <div className="mt-1">
                  <button
                    type="button"
                    id="view-terms-link-btn"
                    onClick={() => setShowTermsModal(true)}
                    className="text-blue-600 hover:text-blue-800 underline font-bold inline-flex items-center gap-1 transition-colors"
                  >
                    <span>{t(language, 'step2.viewTermsLink')}</span>
                    <ArrowRight className="w-3 h-3 rtl:rotate-180" />
                  </button>
                </div>
                {validationErrors.terms && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{validationErrors.terms}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* 2.b: Service Fee Confirmation */}
          <div
            className={`p-4 rounded-2xl border transition-all ${
              agreedToServiceFee
                ? 'border-emerald-300 bg-emerald-50/40'
                : validationErrors.serviceFee
                ? 'border-red-300 bg-red-50/40 ring-1 ring-red-400'
                : 'border-slate-200 bg-slate-50/50'
            }`}
          >
            {/* Clear display of service fee amount & calculation method */}
            <div className="mb-3 p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-500" />
                  {t(language, 'step2.serviceFeeBoxTitle')}
                </span>
                <span className="font-mono text-xs font-black text-amber-600">
                  {formatCurrency(repayment.serviceFeeNis, language)}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {t(language, 'step2.serviceFeeCalculationDetails', {
                  fee: formatCurrency(repayment.serviceFeeNis, language),
                  amount: formatCurrency(requestedAmountNis, language),
                  months: repaymentMonths,
                  monthlyFee: formatCurrency(repayment.monthlyServiceFeeNis, language),
                })}
              </p>
            </div>

            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="service-fee-agreement-checkbox"
                checked={agreedToServiceFee}
                onChange={(e) => {
                  setAgreedToServiceFee(e.target.checked);
                  if (e.target.checked) {
                    setValidationErrors((prev) => {
                      const copy = { ...prev };
                      delete copy.serviceFee;
                      return copy;
                    });
                  }
                }}
                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
              />
              <div className="text-xs text-slate-700 leading-relaxed flex-1">
                <label htmlFor="service-fee-agreement-checkbox" className="font-medium cursor-pointer select-none">
                  {t(language, 'step2.serviceFeeCheckboxLabel', {
                    fee: formatCurrency(repayment.serviceFeeNis, language),
                  })}
                </label>
                {validationErrors.serviceFee && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{validationErrors.serviceFee}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Global Validation Error Message */}
        {Object.keys(validationErrors).length > 0 && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl space-y-1">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{t(language, 'step2.globalError')}</span>
            </div>
            {validationErrors.terms && (
              <p className="ps-6 text-[11px] text-red-600">• {validationErrors.terms}</p>
            )}
            {validationErrors.serviceFee && (
              <p className="ps-6 text-[11px] text-red-600">• {validationErrors.serviceFee}</p>
            )}
            {validationErrors.repaymentMonths && (
              <p className="ps-6 text-[11px] text-red-600">• {validationErrors.repaymentMonths}</p>
            )}
          </div>
        )}

        {/* Final Submit Button (Disabled until valid period and both agreements accepted) */}
        <button
          type="submit"
          id="complete-step2-btn"
          disabled={isSubmitting || !isAgreementsComplete}
          className={`w-full py-4 px-6 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 ${
            isAgreementsComplete && !isSubmitting
              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 cursor-pointer'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
          }`}
        >
          {isSubmitting ? (
            <span>{t(language, 'step2.submittingBtn')}</span>
          ) : (
            <>
              <span>{t(language, 'step2.submitBtn')}</span>
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </>
          )}
        </button>
      </form>

      {/* ==================================================== */}
      {/* TERMS & CONDITIONS MODAL                            */}
      {/* ==================================================== */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <h2 className="text-base font-bold text-slate-900">
                {t(language, 'termsAndConditionsTitle')}
              </h2>
              <button
                type="button"
                id="close-terms-modal-x"
                onClick={() => setShowTermsModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition-colors"
                title={t(language, 'step2.termsModalClose')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto text-xs text-slate-600 space-y-3 leading-relaxed">
              <p className="font-medium text-slate-800">
                {t(language, 'review.termsIntro')}
              </p>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 max-h-60 overflow-y-auto">
                <p>{t(language, 'review.term1')}</p>
                <p>{t(language, 'review.term2')}</p>
                <p>{t(language, 'review.term3')}</p>
                <p>{t(language, 'review.term4')}</p>
                <p>{t(language, 'review.term5')}</p>
                <p>{t(language, 'review.term6')}</p>
                <p>{t(language, 'review.term7')}</p>
              </div>
            </div>

            <div className="p-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end">
              <button
                type="button"
                id="close-terms-modal-btn"
                onClick={() => setShowTermsModal(false)}
                className="py-2 px-4 rounded-xl bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 transition-colors shadow-xs"
              >
                {t(language, 'step2.termsModalClose')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
