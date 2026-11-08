import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Building2,
  DollarSign,
  FileText,
  CreditCard,
  Edit2,
  ArrowRight,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Language, LoanApplication, BankAccountDetails } from '@quickloan/ui-core/types';
import { ISRAELI_BANKS } from '@quickloan/ui-core/config/appConfig';
import { t } from '@quickloan/ui-core/i18n/translations';
import { formatCurrency } from '@quickloan/ui-core/i18n/format';

interface ReturningUserConfirmModalProps {
  language: Language;
  application: LoanApplication;
  onConfirmEverything: () => void;
  onUpdateDetails: (updated: {
    passportNumber?: string;
    employerName?: string;
    monthlySalaryNis?: number;
    bankAccount?: BankAccountDetails;
  }) => void;
  onClose?: () => void;
}

export const ReturningUserConfirmModal: React.FC<ReturningUserConfirmModalProps> = ({
  language,
  application,
  onConfirmEverything,
  onUpdateDetails,
  onClose,
}) => {
  const [isEditing, setIsEditing] = useState(false);

  const b = application.borrowerDetails;
  const em = application.employmentDetails;
  const bank = application.bankAccount;
  const docs = application.documents || [];

  const [passportNumber, setPassportNumber] = useState(b?.passportNumber || '');
  const [employerName, setEmployerName] = useState(em?.employerName || '');
  const [monthlySalary, setMonthlySalary] = useState<number>(em?.monthlySalaryNis || 0);
  const [bankName, setBankName] = useState(bank?.bankName || 'Bank Hapoalim');
  const [branchNumber, setBranchNumber] = useState(bank?.branchNumber || '');
  const [accountNumber, setAccountNumber] = useState(bank?.accountNumber || '');

  // Calculate document validity summaries
  const passportDoc = docs.find((d) => d.documentTypeCode === 'PASSPORT');
  const visaDoc = docs.find((d) => d.documentTypeCode === 'WORK_VISA' || d.documentTypeCode === 'WORKERS_CARD');
  const paySlipDoc = docs.find((d) => d.documentTypeCode === 'PAY_SLIP');
  const bankDoc = docs.find((d) => d.documentTypeCode === 'BANK_ACCOUNT_DOCUMENT');

  const visaExpiry = application.residencyDetails?.visaExpiryDate;
  const isVisaExpired = !visaExpiry || new Date(visaExpiry) < new Date(Date.now() + 180 * 86400000);

  const isPaySlipOutdated = !paySlipDoc || (paySlipDoc.uploadedAt && new Date(paySlipDoc.uploadedAt) < new Date(Date.now() - 90 * 86400000));

  const handleSaveUpdatedDetails = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateDetails({
      passportNumber: passportNumber.trim(),
      employerName: employerName.trim(),
      monthlySalaryNis: Number(monthlySalary),
      bankAccount: {
        bankName,
        branchNumber: branchNumber.trim(),
        accountNumber: accountNumber.trim(),
        accountHolderName: b?.fullName || '',
      },
    });
    setIsEditing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-blue-900 to-indigo-900 text-white flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">
                {t(language, 'returningUserConfirmTitle')}
              </h2>
              <p className="text-xs text-blue-200">
                {t(language, 'returningUserConfirmSubtitle')}
              </p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {!isEditing ? (
            <>
              {/* Profile Details Card */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {t(language, 'employmentAndIdDetails')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="text-xs font-bold text-blue-900 hover:text-blue-700 flex items-center gap-1 hover:underline"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    {t(language, 'edit')}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">{t(language, 'passportOrId')}:</span>
                    <span className="font-mono font-bold text-slate-800">{b?.passportNumber || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">{t(language, 'employerName')}:</span>
                    <span className="font-semibold text-slate-800 truncate block">{em?.employerName || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">{t(language, 'monthlySalary')}:</span>
                    <span className="font-mono font-bold text-emerald-800">
                      {formatCurrency(em?.monthlySalaryNis, language)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">{t(language, 'bankAccount')}:</span>
                    <span className="font-semibold text-slate-800 truncate block">
                      {bank?.bankName
                        ? t(language, 'returning.bankWithBranch', { bank: bank.bankName, branch: bank.branchNumber })
                        : t(language, 'returning.toBeProvided')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Document Validity Status Checklist */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2.5">
                <div className="text-xs font-bold text-slate-700">
                  {t(language, 'documentVerificationStatus')}
                </div>

                {/* Passport Doc */}
                <div className="flex items-center justify-between text-xs py-1 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="font-medium text-slate-800">{t(language, 'doc.PASSPORT')}</span>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    {t(language, 'returning.validReused')}
                  </span>
                </div>

                {/* Visa Doc */}
                <div className="flex items-center justify-between text-xs py-1 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    {!isVisaExpired ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                    <span className="font-medium text-slate-800">{t(language, 'returning.workVisa')}</span>
                  </div>
                  {!isVisaExpired ? (
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      {t(language, 'returning.validReused')}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">
                      {t(language, 'returning.needsRenewal')}
                    </span>
                  )}
                </div>

                {/* Pay Slip Doc */}
                <div className="flex items-center justify-between text-xs py-1 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    {!isPaySlipOutdated ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                    <span className="font-medium text-slate-800">{t(language, 'doc.PAY_SLIP')}</span>
                  </div>
                  {!isPaySlipOutdated ? (
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      {t(language, 'returning.recentReused')}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">
                      {t(language, 'returning.needsLatestPaySlip')}
                    </span>
                  )}
                </div>

                {/* Bank Doc */}
                <div className="flex items-center justify-between text-xs py-1">
                  <div className="flex items-center gap-2">
                    {bankDoc ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-blue-500" />
                    )}
                    <span className="font-medium text-slate-800">{t(language, 'returning.bankCert')}</span>
                  </div>
                  {bankDoc ? (
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      {t(language, 'wizard.onFileCheck')}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-full">
                      {t(language, 'returning.uploadInStep8')}
                    </span>
                  )}
                </div>
              </div>

              {/* Security & Audit notice */}
              <p className="text-[11px] text-slate-500 leading-relaxed text-center">
                {t(language, 'returningUserAuditNotice')}
              </p>
            </>
          ) : (
            /* Quick Edit Form */
            <form onSubmit={handleSaveUpdatedDetails} className="space-y-3 animate-in fade-in">
              <div className="text-xs font-bold text-slate-800 border-b border-slate-200 pb-1.5">
                {t(language, 'returning.updateTitle')}
              </div>

              {/* Employer Name */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  {t(language, 'returning.currentEmployer')}
                </label>
                <input
                  type="text"
                  required
                  value={employerName}
                  onChange={(e) => setEmployerName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-900 focus:outline-none"
                  placeholder={t(language, 'returning.employerPlaceholder')}
                />
              </div>

              {/* Monthly Salary */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  {t(language, 'returning.currentSalary')}
                </label>
                <input
                  type="number"
                  required
                  min={1000}
                  value={monthlySalary || ''}
                  onChange={(e) => setMonthlySalary(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-900 focus:outline-none"
                  placeholder={t(language, 'egValue', { value: '7500' })}
                />
              </div>

              {/* Bank Name */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  {t(language, 'returning.disbursementBank')}
                </label>
                <select
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-900 focus:outline-none"
                >
                  {ISRAELI_BANKS.map((b) => (
                    <option key={b.code} value={b.name}>
                      {language === 'he' ? b.hebrewName : `${b.name} (${b.hebrewName})`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    {t(language, 'returning.branchNumber')}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={4}
                    dir="ltr"
                    value={branchNumber}
                    onChange={(e) => setBranchNumber(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-900 focus:outline-none"
                    placeholder={t(language, 'egValue', { value: '612' })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    {t(language, 'returning.accountNumber')}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    dir="ltr"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-900 focus:outline-none"
                    placeholder={t(language, 'egValue', { value: '123456' })}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="w-1/2 py-2 px-3 text-xs font-semibold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  {t(language, 'cancel')}
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2 px-3 text-xs font-semibold rounded-xl bg-blue-900 text-white hover:bg-blue-800"
                >
                  {t(language, 'returning.saveChanges')}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer Actions */}
        {!isEditing && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col gap-2">
            <button
              type="button"
              id="confirm-everything-btn"
              onClick={onConfirmEverything}
              className="w-full py-3.5 px-4 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 group"
            >
              <span>{t(language, 'everythingIsCorrect')}</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
            </button>

            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-white transition-colors"
            >
              {t(language, 'updateMyDetails')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
