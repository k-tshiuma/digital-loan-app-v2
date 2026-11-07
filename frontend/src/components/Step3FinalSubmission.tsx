import React, { useState } from 'react';
import {
  Building2,
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Percent,
  Banknote,
  Calendar,
  X,
  ExternalLink,
} from 'lucide-react';
import {
  Language,
  LoanBreakdown,
  Step3FormData,
  UploadedDocRef,
  TermsVersionRecord,
} from '../types';
import { ISRAELI_BANKS } from '../config/appConfig';
import { formatCurrency } from '../i18n/format';
import { t } from '../i18n/translations';
import { apiService } from '../services/api';

interface Step3FinalSubmissionProps {
  language: Language;
  breakdown: LoanBreakdown | null;
  initialData?: Step3FormData | null;
  termsVersions: Record<string, TermsVersionRecord> | null;
  isReadOnly?: boolean;
  onSubmit: (data: Step3FormData) => Promise<void>;
  onBack?: () => void;
}

export const Step3FinalSubmission: React.FC<Step3FinalSubmissionProps> = ({
  language,
  breakdown,
  initialData,
  termsVersions,
  isReadOnly = false,
  onSubmit,
  onBack,
}) => {
  // Bank Account Fields
  const [bankName, setBankName] = useState<string>(initialData?.bank.bankName || ISRAELI_BANKS[0]?.name || 'Bank Hapoalim');
  const [bankCode, setBankCode] = useState<string>(initialData?.bank.bankCode || ISRAELI_BANKS[0]?.code || '12');
  const [branchNumber, setBranchNumber] = useState<string>(initialData?.bank.branchNumber || '');
  const [accountNumber, setAccountNumber] = useState<string>(initialData?.bank.accountNumber || '');
  const [accountHolderName, setAccountHolderName] = useState<string>(initialData?.bank.accountHolderName || '');

  // Document state
  const [bankDoc, setBankDoc] = useState<UploadedDocRef | null>(initialData?.bankDocument || null);
  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);

  // Mandatory Agreements Checkboxes
  const [generalAccepted, setGeneralAccepted] = useState<boolean>(initialData?.terms.generalAccepted || false);
  const [serviceFeeAccepted, setServiceFeeAccepted] = useState<boolean>(initialData?.terms.serviceFeeAccepted || false);

  // Terms Modal State
  const [activeTermsModal, setActiveTermsModal] = useState<'general' | 'service_fee' | null>(null);

  // Validation & Submission States
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleBankChange = (name: string) => {
    setBankName(name);
    const found = ISRAELI_BANKS.find((b) => b.name === name);
    if (found) setBankCode(found.code);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingDoc(true);
    setErrors((prev) => {
      const copy = { ...prev };
      delete copy.bankDoc;
      return copy;
    });

    try {
      const res = await apiService.uploadFile(file);
      setBankDoc({
        filename: res.filename,
        fileUrl: res.url,
        originalName: res.originalName,
        mimeType: res.mimeType,
        size: res.size,
      });
    } catch (err: any) {
      setErrors((prev) => ({
        ...prev,
        bankDoc: err.message || 'Failed to upload bank document',
      }));
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!bankName.trim()) errs.bankName = t(language, 'step3.err.bankName');
    if (!branchNumber.trim()) errs.branchNumber = t(language, 'step3.err.branchNumber');
    if (!accountNumber.trim()) errs.accountNumber = t(language, 'step3.err.accountNumber');
    if (!accountHolderName.trim()) errs.accountHolder = t(language, 'step3.err.accountHolder');
    if (!bankDoc) errs.bankDoc = t(language, 'step3.err.bankDoc');
    if (!generalAccepted) errs.generalAccepted = t(language, 'step3.err.termsRequired');
    if (!serviceFeeAccepted) errs.serviceFeeAccepted = t(language, 'step3.err.serviceFeeRequired');

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const payload: Step3FormData = {
        bank: {
          bankName,
          bankCode,
          branchNumber: branchNumber.trim(),
          accountNumber: accountNumber.trim(),
          accountHolderName: accountHolderName.trim(),
        },
        bankDocument: bankDoc,
        terms: {
          generalVersion: termsVersions?.general?.version || '1.0',
          serviceFeeVersion: termsVersions?.service_fee?.version || '1.0',
          generalAccepted,
          serviceFeeAccepted,
        },
      };
      await onSubmit(payload);
    } catch (err: any) {
      setServerError(err.message || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid =
    bankName.trim() !== '' &&
    branchNumber.trim() !== '' &&
    accountNumber.trim() !== '' &&
    accountHolderName.trim() !== '' &&
    bankDoc !== null &&
    generalAccepted &&
    serviceFeeAccepted;

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto animate-in fade-in">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
            {t(language, 'step3.stepBadge')}
          </span>
          <span className="text-xs text-slate-500 font-medium">
            {t(language, 'step3.title')}
          </span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          {t(language, 'step3.title')}
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          {t(language, 'step3.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* SECTION 1: FINANCIAL BREAKDOWN */}
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Percent className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'step3.financialBreakdownTitle')}
          </h2>

          {breakdown ? (
            <div className="bg-slate-50/80 rounded-2xl p-4 sm:p-5 border border-slate-200 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs pb-3 border-b border-slate-200/80">
                <div>
                  <span className="text-slate-500 block">{t(language, 'step3.requestedLoanAmount')}</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {formatCurrency(breakdown.requestedAmountNis, language)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">{t(language, 'step3.totalInterest')}</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {formatCurrency(breakdown.totalInterestNis, language)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">{t(language, 'step3.totalLoanToRepay')}</span>
                  <span className="font-bold text-blue-700 text-sm">
                    {formatCurrency(breakdown.totalLoanRepaymentNis, language)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">{t(language, 'step3.totalServiceFee')}</span>
                  <span className="font-bold text-purple-700 text-sm">
                    {formatCurrency(breakdown.totalServiceFeeNis, language)}
                  </span>
                </div>
              </div>

              {/* Monthly Distinction Card */}
              <div className="bg-white rounded-xl p-3 border border-slate-200/90 shadow-2xs space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">
                    {t(language, 'step3.monthlyLoanRepayment')}
                  </span>
                  <span className="font-bold text-slate-900">
                    {formatCurrency(breakdown.monthlyLoanRepaymentNis, language)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-purple-700 font-medium">
                    {t(language, 'step3.monthlyServiceFee')}
                  </span>
                  <span className="font-bold text-purple-700">
                    {formatCurrency(breakdown.monthlyServiceFeeNis, language)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-sm font-black text-slate-900">
                  <span>{t(language, 'step3.overallMonthlyPayment')}</span>
                  <span className="text-blue-600">
                    {formatCurrency(breakdown.monthlyPaymentTotalNis, language)}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 leading-normal italic">
                {t(language, 'step3.breakdownExplanation')}
              </p>
            </div>
          ) : (
            <div className="p-4 bg-slate-50 rounded-xl text-xs text-slate-500">
              {t(language, 'step3.loadingBreakdown')}
            </div>
          )}
        </div>

        {/* SECTION 2: BANK ACCOUNT DETAILS */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'step3.bankSectionTitle')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'step3.bankNameLabel')} <span className="text-red-500">*</span>
              </label>
              <select
                value={bankName}
                disabled={isReadOnly}
                onChange={(e) => handleBankChange(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                {ISRAELI_BANKS.map((b) => (
                  <option key={b.code} value={b.name}>
                    {language === 'he' ? b.hebrewName : b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'step3.branchNumberLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={branchNumber}
                disabled={isReadOnly}
                onChange={(e) => setBranchNumber(e.target.value)}
                placeholder="e.g. 612"
                dir="ltr"
                className={`w-full px-3 py-2 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  errors.branchNumber ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {errors.branchNumber && (
                <p className="text-[11px] text-red-500 mt-1">{errors.branchNumber}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'step3.accountNumberLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={accountNumber}
                disabled={isReadOnly}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g. 12345678"
                dir="ltr"
                className={`w-full px-3 py-2 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  errors.accountNumber ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {errors.accountNumber && (
                <p className="text-[11px] text-red-500 mt-1">{errors.accountNumber}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'step3.accountHolderLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={accountHolderName}
                disabled={isReadOnly}
                onChange={(e) => setAccountHolderName(e.target.value)}
                placeholder={t(language, 'step3.accountHolderNamePlaceholder')}
                className={`w-full px-3 py-2 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  errors.accountHolder ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {errors.accountHolder && (
                <p className="text-[11px] text-red-500 mt-1">{errors.accountHolder}</p>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 3: BANK ACCOUNT MANAGEMENT DOCUMENT */}
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <UploadCloud className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'step3.bankDocSectionTitle')}
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed">
            {t(language, 'step3.bankDocSectionDesc')}
          </p>

          <div
            className={`p-3.5 rounded-2xl border ${
              bankDoc
                ? 'border-emerald-300 bg-emerald-50/40'
                : errors.bankDoc
                ? 'border-red-300 bg-red-50/40'
                : 'border-slate-200 bg-slate-50/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800">
                {t(language, 'step3.bankDocSectionTitle')} <span className="text-red-500">*</span>
              </span>
              {bankDoc && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            </div>

            <label className="cursor-pointer block text-center p-3 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
              <input
                type="file"
                accept="image/*,application/pdf"
                disabled={isReadOnly || isUploadingDoc}
                onChange={handleFileUpload}
                className="hidden"
              />
              <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1" />
              <span className="text-[11px] text-slate-600 truncate block font-medium">
                {isUploadingDoc
                  ? t(language, 'step3.uploadingDoc')
                  : bankDoc
                  ? bankDoc.originalName
                  : t(language, 'step2.uploadDocPlaceholder')}
              </span>
            </label>
            {errors.bankDoc && (
              <p className="text-[11px] text-red-500 mt-1">{errors.bankDoc}</p>
            )}
          </div>
        </div>

        {/* SECTION 4: MANDATORY AGREEMENTS & TERMS */}
        <div className="space-y-3 pt-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'step3.mandatoryAgreementsTitle')}
          </h2>

          <div className="space-y-2.5">
            {/* 1. General Terms */}
            <div
              className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${
                generalAccepted ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-slate-50/40'
              }`}
            >
              <input
                type="checkbox"
                id="terms-general-checkbox"
                checked={generalAccepted}
                disabled={isReadOnly}
                onChange={(e) => setGeneralAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div className="flex-1 text-xs">
                <label
                  htmlFor="terms-general-checkbox"
                  className="font-bold text-slate-800 cursor-pointer select-none"
                >
                  {t(language, 'step3.termsCheckbox')}
                </label>
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setActiveTermsModal('general')}
                    className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                  >
                    <span>{t(language, 'step3.viewTerms')}</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
            {errors.generalAccepted && (
              <p className="text-[11px] text-red-500 ps-1">{errors.generalAccepted}</p>
            )}

            {/* 2. Service Fee Terms */}
            <div
              className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${
                serviceFeeAccepted ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-slate-50/40'
              }`}
            >
              <input
                type="checkbox"
                id="terms-service-fee-checkbox"
                checked={serviceFeeAccepted}
                disabled={isReadOnly}
                onChange={(e) => setServiceFeeAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div className="flex-1 text-xs">
                <label
                  htmlFor="terms-service-fee-checkbox"
                  className="font-bold text-slate-800 cursor-pointer select-none"
                >
                  {t(language, 'step3.serviceFeeCheckbox')}
                </label>
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setActiveTermsModal('service_fee')}
                    className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                  >
                    <span>{t(language, 'step3.viewTerms')}</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
            {errors.serviceFeeAccepted && (
              <p className="text-[11px] text-red-500 ps-1">{errors.serviceFeeAccepted}</p>
            )}
          </div>
        </div>

        {/* Global Error Banner */}
        {serverError && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Navigation & Submit Button */}
        <div className="flex gap-3 pt-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
              className="py-3.5 px-4 rounded-2xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-colors"
            >
              {t(language, 'back')}
            </button>
          )}

          <button
            type="submit"
            id="submit-step3-final-btn"
            disabled={!isFormValid || isSubmitting || isReadOnly}
            className={`flex-1 py-4 px-6 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 ${
              isFormValid && !isSubmitting && !isReadOnly
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-70'
            }`}
          >
            {isSubmitting ? (
              <span>{t(language, 'step3.submittingBtn')}</span>
            ) : (
              <>
                <span>{t(language, 'step3.submitBtn')}</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* TERMS VIEW MODAL */}
      {activeTermsModal && termsVersions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <h3 className="text-sm font-bold text-slate-900">
                {activeTermsModal === 'general'
                  ? t(language, 'step2.termsAgreementTitle')
                  : t(language, 'step2.serviceFeeBoxTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setActiveTermsModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto text-xs text-slate-600 whitespace-pre-line leading-relaxed">
              {activeTermsModal === 'general'
                ? language === 'he'
                  ? termsVersions.general?.textHe
                  : termsVersions.general?.textEn
                : language === 'he'
                ? termsVersions.service_fee?.textHe
                : termsVersions.service_fee?.textEn}
            </div>

            <div className="p-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setActiveTermsModal(null)}
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
