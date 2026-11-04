import React, { useState } from 'react';
import {
  Shield,
  MapPin,
  CheckCircle2,
  AlertCircle,
  UploadCloud,
  FileText,
  User,
  Mail,
  Lock,
  Phone,
  Home,
  Building,
  Briefcase,
  Users,
  ChevronRight,
  Eye,
  EyeOff,
  Clock,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { LeadData, LeadStatus, FileAttachment, Language } from '../types';
import { DateInput } from './DateInput';
import { formatCurrency, formatDate } from '../i18n/format';
import {
  calculateLoanRepayment,
} from '../config/appConfig';
import { t } from '../i18n/translations';

interface Step1LeadGenerationProps {
  onLeadCreated: (lead: LeadData) => void;
  onProceedToStep2?: () => void;
  existingLead?: LeadData | null;
  onLeadStatusChange?: (newStatus: LeadStatus) => void;
  language?: Language;
}

type Step1Phase = 'location' | 'disclaimer' | 'form' | 'submitted';

export const Step1LeadGeneration: React.FC<Step1LeadGenerationProps> = ({
  onLeadCreated,
  onProceedToStep2,
  existingLead,
  onLeadStatusChange,
  language = 'en',
}) => {
  // Navigation internal phase
  const [phase, setPhase] = useState<Step1Phase>(() =>
    existingLead ? 'submitted' : 'location'
  );

  // Location permission state
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);

  // Disclaimer agreement state
  const [hasAgreedToDisclaimer, setHasAgreedToDisclaimer] = useState(false);
  const [disclaimerError, setDisclaimerError] = useState<string | null>(null);

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');

  // File Uploads
  const [passportDoc, setPassportDoc] = useState<FileAttachment | null>(null);
  const [visaDoc, setVisaDoc] = useState<FileAttachment | null>(null);
  const [payslipDoc, setPayslipDoc] = useState<FileAttachment | null>(null);

  // Employment Details
  const [employerName, setEmployerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [manpowerAgent, setManpowerAgent] = useState('');

  // Requested Loan Amount
  const [requestedAmountNis, setRequestedAmountNis] = useState<number>(5000);
  const repaymentMonths = 6;

  // Submission / Error state
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active Lead State (mock)
  const [activeLead, setActiveLead] = useState<LeadData | null>(existingLead || null);

  // ----------------------------------------------------
  // Location Handlers
  // ----------------------------------------------------
  const handleRequestLocation = () => {
    setIsRequestingLocation(true);
    setLocationError(null);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setHasLocationPermission(true);
      setIsRequestingLocation(false);
      setPhase('disclaimer');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        setIsRequestingLocation(false);
        setHasLocationPermission(true);
        setPhase('disclaimer');
      },
      () => {
        setIsRequestingLocation(false);
        setHasLocationPermission(true);
        setPhase('disclaimer');
      },
      { timeout: 5000 }
    );
  };

  // ----------------------------------------------------
  // Disclaimer Handler
  // ----------------------------------------------------
  const handleDisclaimerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAgreedToDisclaimer) {
      setDisclaimerError(t(language, 'lead.disclaimerError'));
      return;
    }
    setDisclaimerError(null);
    setPhase('form');
  };

  // ----------------------------------------------------
  // Generic File Upload Helper
  // ----------------------------------------------------
  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (file: FileAttachment | null) => void,
    fieldKey: string
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      setter({
        name: file.name,
        size: file.size,
        type: file.type,
      });
      setFormErrors((prev) => {
        const copy = { ...prev };
        delete copy[fieldKey];
        return copy;
      });
    }
  };

  // ----------------------------------------------------
  // Form Validation
  // ----------------------------------------------------
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!email.trim() || !email.includes('@')) {
      errors.email = t(language, 'lead.err.email');
    }
    if (!password || password.length < 6) {
      errors.password = t(language, 'lead.err.password');
    }
    if (!fullName.trim()) {
      errors.fullName = t(language, 'lead.err.fullName');
    }
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      errors.phoneNumber = t(language, 'lead.err.phoneNumber');
    }
    if (!dateOfBirth) {
      errors.dateOfBirth = t(language, 'lead.err.dob');
    }
    if (!address.trim()) {
      errors.address = t(language, 'lead.err.address');
    }
    if (!passportDoc) {
      errors.passportDoc = t(language, 'lead.err.passport');
    }
    if (!visaDoc) {
      errors.visaDoc = t(language, 'lead.err.visa');
    }
    if (!payslipDoc) {
      errors.payslipDoc = t(language, 'lead.err.payslip');
    }
    if (!employerName.trim()) {
      errors.employerName = t(language, 'lead.err.employer');
    }
    if (!companyName.trim()) {
      errors.companyName = t(language, 'lead.err.company');
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ----------------------------------------------------
  // Lead Generation Submit
  // ----------------------------------------------------
  const handleSubmitLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);

    const newLead: LeadData = {
      id: `lead_${Date.now()}`,
      email: email.trim(),
      password,
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      dateOfBirth,
      address: address.trim(),
      passportDoc,
      visaDoc,
      payslipDoc,
      employerName: employerName.trim(),
      companyName: companyName.trim(),
      manpowerAgent: manpowerAgent.trim() || undefined,
      requestedLoanAmountNis: requestedAmountNis,
      repaymentPeriodMonths: repaymentMonths,
      serviceFeeNis: 0,
      displayedMonthlyPaymentNis: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    setTimeout(() => {
      setIsSubmitting(false);
      setActiveLead(newLead);
      setPhase('submitted');
      onLeadCreated(newLead);
    }, 600);
  };

  // Mock status toggle handler
  const handleToggleLeadStatus = (newStatus: LeadStatus) => {
    if (!activeLead) return;
    const updatedLead: LeadData = {
      ...activeLead,
      status: newStatus,
    };
    setActiveLead(updatedLead);
    onLeadStatusChange?.(newStatus);
  };

  // ====================================================
  // SCREEN 1: LOCATION PERMISSION
  // ====================================================
  if (phase === 'location') {
    return (
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto animate-in fade-in">
        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
          <MapPin className="w-8 h-8" />
        </div>

        <h1 className="text-xl sm:text-2xl font-black text-slate-900 text-center mb-3">
          {t(language, 'lead.locationTitle')}
        </h1>

        <p className="text-sm text-slate-600 text-center mb-6 leading-relaxed">
          {t(language, 'lead.locationDesc')}
        </p>

        {locationError && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
            <span>{locationError}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleRequestLocation}
          disabled={isRequestingLocation}
          className="w-full py-3.5 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
        >
          {isRequestingLocation ? (
            <span>{t(language, 'lead.checkingPermission')}</span>
          ) : (
            <>
              <Shield className="w-4 h-4" />
              <span>{t(language, 'lead.grantLocation')}</span>
            </>
          )}
        </button>
      </div>
    );
  }

  // ====================================================
  // SCREEN 2: REGULATORY DISCLAIMER
  // ====================================================
  if (phase === 'disclaimer') {
    return (
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto animate-in fade-in">
        <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
          <Shield className="w-8 h-8" />
        </div>

        <h1 className="text-xl sm:text-2xl font-black text-slate-900 text-center mb-2">
          {t(language, 'lead.disclaimerTitle')}
        </h1>

        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 text-center mb-6">
          {t(language, 'lead.disclaimerBadge')}
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 text-xs text-slate-700 space-y-3 mb-6 max-h-60 overflow-y-auto leading-relaxed">
          <p className="font-semibold text-slate-900">
            {t(language, 'lead.disclaimerP1')}
          </p>
          <p>
            {t(language, 'lead.disclaimerP2')}
          </p>
          <p>
            {t(language, 'lead.disclaimerP3')}
          </p>
        </div>

        <form onSubmit={handleDisclaimerSubmit} className="space-y-6">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hasAgreedToDisclaimer}
              onChange={(e) => setHasAgreedToDisclaimer(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <span className="text-xs text-slate-700 leading-normal font-medium">
              {t(language, 'lead.disclaimerConsent')}
            </span>
          </label>

          {disclaimerError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{disclaimerError}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPhase('location')}
              className="py-3 px-4 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
            >
              {t(language, 'back')}
            </button>
            <button
              type="submit"
              className="flex-1 py-3 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>{t(language, 'lead.continueToReg')}</span>
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ====================================================
  // SCREEN 4: SUBMITTED PENDING / APPROVED CONFIRMATION
  // ====================================================
  if (phase === 'submitted' && activeLead) {
    const isApproved = activeLead.status === 'approved';

    return (
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto space-y-6 animate-in fade-in">
        {/* Status Graphic */}
        <div className="text-center">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner ${
              isApproved
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                : 'bg-amber-50 text-amber-600 border border-amber-200'
            }`}
          >
            {isApproved ? (
              <CheckCircle2 className="w-9 h-9" />
            ) : (
              <Clock className="w-9 h-9 animate-pulse" />
            )}
          </div>

          <div
            className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 ${
              isApproved
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {t(language, 'lead.statusBadge', { status: activeLead.status })}
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-2">
            {isApproved
              ? t(language, 'lead.statusApproved')
              : t(language, 'lead.statusPending')}
          </h2>

          {/* Messages */}
          {!isApproved ? (
            <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-4 text-sm text-amber-900 font-medium leading-relaxed max-w-md mx-auto">
              {t(language, 'lead.pendingMessage')}
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm text-emerald-900 font-medium leading-relaxed max-w-md mx-auto">
              {t(language, 'lead.approvedMessage')}
            </div>
          )}
        </div>

        {/* Lead Summary Card */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs space-y-2">
          <div className="font-bold text-slate-800 border-b border-slate-200 pb-2 flex justify-between items-center">
            <span>{t(language, 'lead.appRef', { id: activeLead.id })}</span>
            <span className="font-mono text-slate-500">
              {formatDate(activeLead.createdAt, language)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-600 pt-1">
            <div>
              <span className="font-semibold text-slate-700">{t(language, 'lead.summaryApplicant')}</span>{' '}
              {activeLead.fullName}
            </div>
            <div>
              <span className="font-semibold text-slate-700">{t(language, 'lead.summaryPhone')}</span>{' '}
              <bdi dir="ltr">{activeLead.phoneNumber}</bdi>
            </div>
            <div>
              <span className="font-semibold text-slate-700">{t(language, 'lead.summaryCompany')}</span>{' '}
              {activeLead.companyName}
            </div>
            <div>
              <span className="font-semibold text-slate-700">{t(language, 'lead.summaryEmployer')}</span>{' '}
              {activeLead.employerName}
            </div>
            {activeLead.manpowerAgent && (
              <div className="col-span-2">
                <span className="font-semibold text-slate-700">{t(language, 'lead.summaryManpower')}</span>{' '}
                {activeLead.manpowerAgent}
              </div>
            )}
            <div className="col-span-2">
              <span className="font-semibold text-slate-700">{t(language, 'lead.summaryRequestedAmount')}</span>{' '}
              {formatCurrency(activeLead.requestedLoanAmountNis, language)}
            </div>
          </div>
        </div>

        {/* Action Button: Proceed to Step 2 when Approved */}
        {isApproved && (
          <button
            type="button"
            id="proceed-step2-btn"
            onClick={onProceedToStep2}
            className="w-full py-4 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 group"
          >
            <span>{t(language, 'lead.completeStep2Btn')}</span>
            <ChevronRight className="w-5 h-5 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
          </button>
        )}

        {/* MOCK TOGGLE */}
        <div className="mt-8 pt-6 border-t border-dashed border-slate-300 bg-slate-100/70 -mx-6 -mb-6 sm:-mx-8 sm:-mb-8 p-6 rounded-b-3xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              {t(language, 'lead.mockSimulatorTitle')}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {t(language, 'lead.mockSimulatorBadge')}
            </span>
          </div>

          <p className="text-xs text-slate-600 mb-3">
            {t(language, 'lead.mockSimulatorDesc')}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleToggleLeadStatus('pending')}
              className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                activeLead.status === 'pending'
                  ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t(language, 'lead.mockSimulatePending')}
            </button>
            <button
              type="button"
              id="simulate-approved-btn"
              onClick={() => handleToggleLeadStatus('approved')}
              className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                activeLead.status === 'approved'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t(language, 'lead.mockSimulateApproved')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ====================================================
  // SCREEN 3: REGISTRATION & LEAD GENERATION FORM
  // ====================================================
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto animate-in fade-in">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
            {t(language, 'lead.step1Badge')}
          </span>
          <span className="text-xs text-slate-500 font-medium">
            {t(language, 'lead.preScreenTag')}
          </span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          {t(language, 'lead.regTitle')}
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          {t(language, 'lead.regSubtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmitLead} className="space-y-6">
        {/* SECTION A: Account Credentials */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'lead.credentialsTitle')}
          </h2>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {t(language, 'lead.emailLabel')} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-3.5" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com" // i18n-ignore
                dir="ltr"
                className={`w-full ps-10 pe-3.5 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  formErrors.email ? 'border-red-500' : 'border-slate-200'
                }`}
              />
            </div>
            {formErrors.email && (
              <p className="text-[11px] text-red-500 mt-1">{formErrors.email}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {t(language, 'lead.passwordLabel')} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute start-3.5 top-3.5" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t(language, 'lead.passwordPlaceholder')}
                dir="ltr"
                className={`w-full ps-10 pe-10 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  formErrors.password ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute end-3.5 top-3 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {formErrors.password && (
              <p className="text-[11px] text-red-500 mt-1">{formErrors.password}</p>
            )}
          </div>
        </div>

        {/* SECTION B: Personal Details */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'lead.personalDetailsTitle')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'lead.fullNameLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t(language, 'lead.fullNamePlaceholder')}
                className={`w-full px-3.5 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  formErrors.fullName ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {formErrors.fullName && (
                <p className="text-[11px] text-red-500 mt-1">{formErrors.fullName}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'lead.phoneLabel')} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute start-3.5 top-3.5" />
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="050-123-4567"
                  dir="ltr"
                  className={`w-full ps-10 pe-3.5 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                    formErrors.phoneNumber ? 'border-red-500' : 'border-slate-200'
                  }`}
                />
              </div>
              {formErrors.phoneNumber && (
                <p className="text-[11px] text-red-500 mt-1">{formErrors.phoneNumber}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'lead.dobLabel')} <span className="text-red-500">*</span>
              </label>
              <DateInput
                id="dob-input"
                value={dateOfBirth}
                onChange={(val) => {
                  setDateOfBirth(val);
                  setFormErrors((prev) => {
                    const c = { ...prev };
                    delete c.dateOfBirth;
                    return c;
                  });
                }}
                language={language}
                max={new Date().toISOString().split('T')[0]}
                required
                className={formErrors.dateOfBirth ? 'border-red-500' : 'border-slate-200'}
              />
              {formErrors.dateOfBirth && (
                <p className="text-[11px] text-red-500 mt-1">{formErrors.dateOfBirth}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'lead.addressLabel')} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Home className="w-4 h-4 text-slate-400 absolute start-3.5 top-3.5" />
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t(language, 'lead.addressPlaceholder')}
                  className={`w-full ps-10 pe-3.5 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                    formErrors.address ? 'border-red-500' : 'border-slate-200'
                  }`}
                />
              </div>
              {formErrors.address && (
                <p className="text-[11px] text-red-500 mt-1">{formErrors.address}</p>
              )}
            </div>
          </div>
        </div>

        {/* SECTION C: Document Uploads */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <UploadCloud className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'lead.documentsTitle')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Passport */}
            <div
              className={`p-3.5 rounded-2xl border ${
                passportDoc
                  ? 'border-emerald-300 bg-emerald-50/40'
                  : formErrors.passportDoc
                  ? 'border-red-300 bg-red-50/40'
                  : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-800">
                  {t(language, 'lead.passportLabel')} <span className="text-red-500">*</span>
                </span>
                {passportDoc && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              </div>
              <label className="cursor-pointer block text-center p-3 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => handleFileUpload(e, setPassportDoc, 'passportDoc')}
                  className="hidden"
                />
                <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                <span className="text-[11px] text-slate-600 truncate block">
                  {passportDoc ? passportDoc.name : t(language, 'lead.uploadPlaceholder')}
                </span>
              </label>
              {formErrors.passportDoc && (
                <p className="text-[10px] text-red-500 mt-1">{formErrors.passportDoc}</p>
              )}
            </div>

            {/* Visa */}
            <div
              className={`p-3.5 rounded-2xl border ${
                visaDoc
                  ? 'border-emerald-300 bg-emerald-50/40'
                  : formErrors.visaDoc
                  ? 'border-red-300 bg-red-50/40'
                  : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-800">
                  {t(language, 'lead.visaLabel')} <span className="text-red-500">*</span>
                </span>
                {visaDoc && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              </div>
              <label className="cursor-pointer block text-center p-3 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => handleFileUpload(e, setVisaDoc, 'visaDoc')}
                  className="hidden"
                />
                <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                <span className="text-[11px] text-slate-600 truncate block">
                  {visaDoc ? visaDoc.name : t(language, 'lead.uploadPlaceholder')}
                </span>
              </label>
              {formErrors.visaDoc && (
                <p className="text-[10px] text-red-500 mt-1">{formErrors.visaDoc}</p>
              )}
            </div>

            {/* Payslip */}
            <div
              className={`p-3.5 rounded-2xl border ${
                payslipDoc
                  ? 'border-emerald-300 bg-emerald-50/40'
                  : formErrors.payslipDoc
                  ? 'border-red-300 bg-red-50/40'
                  : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-800">
                  {t(language, 'lead.payslipLabel')} <span className="text-red-500">*</span>
                </span>
                {payslipDoc && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              </div>
              <label className="cursor-pointer block text-center p-3 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => handleFileUpload(e, setPayslipDoc, 'payslipDoc')}
                  className="hidden"
                />
                <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                <span className="text-[11px] text-slate-600 truncate block">
                  {payslipDoc ? payslipDoc.name : t(language, 'lead.uploadPlaceholder')}
                </span>
              </label>
              {formErrors.payslipDoc && (
                <p className="text-[10px] text-red-500 mt-1">{formErrors.payslipDoc}</p>
              )}
            </div>
          </div>
        </div>

        {/* SECTION D: Employment Details */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'lead.employmentTitle')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-0.5">
                {t(language, 'lead.employerNameLabel')} <span className="text-red-500">*</span>
              </label>
              <p className="text-[11px] text-slate-500 mb-1 italic">
                {t(language, 'lead.employerNameHint')}
              </p>
              <input
                type="text"
                value={employerName}
                onChange={(e) => setEmployerName(e.target.value)}
                placeholder={t(language, 'lead.employerNamePlaceholder')}
                className={`w-full px-3.5 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  formErrors.employerName ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {formErrors.employerName && (
                <p className="text-[11px] text-red-500 mt-1">{formErrors.employerName}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-0.5">
                {t(language, 'lead.companyNameLabel')} <span className="text-red-500">*</span>
              </label>
              <p className="text-[11px] text-slate-500 mb-1">
                {t(language, 'lead.companyNameHint')}
              </p>
              <div className="relative">
                <Building className="w-4 h-4 text-slate-400 absolute start-3.5 top-3.5" />
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={t(language, 'lead.companyNamePlaceholder')}
                  className={`w-full ps-10 pe-3.5 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                    formErrors.companyName ? 'border-red-500' : 'border-slate-200'
                  }`}
                />
              </div>
              {formErrors.companyName && (
                <p className="text-[11px] text-red-500 mt-1">{formErrors.companyName}</p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">
                {t(language, 'lead.manpowerLabel')}
              </label>
              <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                {t(language, 'lead.optionalTag')}
              </span>
            </div>
            <div className="relative">
              <Users className="w-4 h-4 text-slate-400 absolute start-3.5 top-3.5" />
              <input
                type="text"
                value={manpowerAgent}
                onChange={(e) => setManpowerAgent(e.target.value)}
                placeholder={t(language, 'lead.manpowerPlaceholder')}
                className="w-full ps-10 pe-3.5 py-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* SECTION E: Requested Loan Amount */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              {t(language, 'lead.loanAmountTitle')}
            </span>
          </h2>

          <div className="bg-slate-50 rounded-2xl p-4 sm:p-5 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-700">{t(language, 'lead.loanAmountLabel')}</span>
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

            <div className="flex justify-between text-[11px] font-mono text-slate-400" dir="ltr">
              <span>{formatCurrency(500, language)}</span>
              <span>{formatCurrency(5000, language)}</span>
              <span>{formatCurrency(10000, language)}</span>
            </div>
          </div>
        </div>

        {/* Global Error Banner */}
        {Object.keys(formErrors).length > 0 && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{t(language, 'lead.completeRequiredFields')}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          id="submit-lead-btn"
          disabled={isSubmitting}
          className="w-full py-4 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <span>{t(language, 'lead.submittingButton')}</span>
          ) : (
            <>
              <span>{t(language, 'lead.submitButton')}</span>
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </>
          )}
        </button>
      </form>
    </div>
  );
};
