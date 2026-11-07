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
  Eye,
  EyeOff,
  Clock,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import {
  Step1FormData,
  UploadedDocRef,
  Language,
} from '../types';
import { DateInput } from './DateInput';
import { formatCurrency } from '../i18n/format';
import { t } from '../i18n/translations';
import { apiService } from '../services/api';

interface Step1LeadGenerationProps {
  language?: Language;
  initialData?: Step1FormData | null;
  userPhone?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  hasCompletedDisclaimer?: boolean;
  isReadOnly?: boolean;
  onSubmit?: (data: Step1FormData) => Promise<void>;
  onRegisterAccount?: (creds: { fullName: string; email: string; phoneNumber: string; password: string; code: string }) => Promise<void>;
  onGoogleSignIn?: (demo?: { email: string; name: string }) => Promise<void>;
  existingLead?: any;
  onLeadCreated?: (lead: any) => void;
  onLeadStatusChange?: (status: any) => void;
  onProceedToStep2?: () => void;
}

type Step1Phase = 'location' | 'disclaimer' | 'form';

export const Step1LeadGeneration: React.FC<Step1LeadGenerationProps> = ({
  language = 'en',
  initialData,
  userPhone,
  userEmail,
  userName,
  hasCompletedDisclaimer = false,
  isReadOnly = false,
  onSubmit,
  onRegisterAccount,
  onGoogleSignIn,
  existingLead,
  onLeadCreated,
  onLeadStatusChange,
  onProceedToStep2,
}) => {
  // Navigation internal phase
  const [phase, setPhase] = useState<Step1Phase>(() =>
    hasCompletedDisclaimer ? 'form' : 'location'
  );

  // Location & Disclaimer states
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [hasAgreedToDisclaimer, setHasAgreedToDisclaimer] = useState(false);
  const [disclaimerError, setDisclaimerError] = useState<string | null>(null);

  // Form Fields: Personal Details
  const [fullName, setFullName] = useState(initialData?.personal?.fullName || userName || '');
  const [phoneNumber, setPhoneNumber] = useState(initialData?.personal?.phoneNumber || userPhone || '');
  const [dateOfBirth, setDateOfBirth] = useState(initialData?.personal?.dateOfBirth || '');
  const [address, setAddress] = useState(initialData?.personal?.address || '');

  // Form Fields: Account Credentials (if registering as new user)
  const [email, setEmail] = useState(userEmail || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  // Uploaded Documents
  const [passportDoc, setPassportDoc] = useState<UploadedDocRef | null>(initialData?.documents?.passport || null);
  const [visaDoc, setVisaDoc] = useState<UploadedDocRef | null>(initialData?.documents?.visa || null);
  const [payslipDoc, setPayslipDoc] = useState<UploadedDocRef | null>(initialData?.documents?.payslip || null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  // Employment Details
  const [employerName, setEmployerName] = useState(initialData?.employment?.employerName || '');
  const [companyName, setCompanyName] = useState(initialData?.employment?.companyName || '');
  const [manpowerAgent, setManpowerAgent] = useState(initialData?.employment?.manpowerAgent || '');

  // Requested Loan Amount
  const [requestedAmountNis, setRequestedAmountNis] = useState<number>(
    initialData?.loan?.requestedAmountNis || 5000
  );

  // Form errors & submit states
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

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

  const handleDisclaimerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAgreedToDisclaimer) {
      setDisclaimerError(t(language, 'lead.disclaimerError'));
      return;
    }
    setDisclaimerError(null);
    setPhase('form');
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (doc: UploadedDocRef | null) => void,
    fieldKey: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingField(fieldKey);
    setFormErrors((prev) => {
      const copy = { ...prev };
      delete copy[fieldKey];
      return copy;
    });

    try {
      const res = await apiService.uploadFile(file);
      setter({
        filename: res.filename,
        fileUrl: res.url,
        originalName: res.originalName,
        mimeType: res.mimeType,
        size: res.size,
      });
    } catch (err: any) {
      setFormErrors((prev) => ({
        ...prev,
        [fieldKey]: err.message || 'File upload failed',
      }));
    } finally {
      setUploadingField(null);
    }
  };

  const handleRequestOtp = async () => {
    const clean = phoneNumber.replace(/\D/g, '');
    if (!clean || clean.length < 7) {
      setFormErrors((prev) => ({ ...prev, phoneNumber: t(language, 'lead.err.phoneNumber') }));
      return;
    }
    setIsSendingOtp(true);
    try {
      const res = await apiService.requestOtp(phoneNumber, language);
      setIsOtpSent(true);
      if (res.demoCode) {
        setOtpCode(res.demoCode);
      }
    } catch (err: any) {
      setServerError(err.message || 'Could not send verification code');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!fullName.trim()) errs.fullName = t(language, 'lead.err.fullName');
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) errs.phoneNumber = t(language, 'lead.err.phoneNumber');
    if (!dateOfBirth) errs.dateOfBirth = t(language, 'lead.err.dob');
    if (!address.trim()) errs.address = t(language, 'lead.err.address');

    // Documents
    if (!passportDoc) errs.passportDoc = t(language, 'lead.err.passport');
    if (!visaDoc) errs.visaDoc = t(language, 'lead.err.visa');
    if (!payslipDoc) errs.payslipDoc = t(language, 'lead.err.payslip');

    // Employment
    if (!employerName.trim()) errs.employerName = t(language, 'lead.err.employer');
    if (!companyName.trim()) errs.companyName = t(language, 'lead.err.company');

    // Account registration credentials if not logged in
    if (onRegisterAccount) {
      if (!email.trim() || !email.includes('@')) errs.email = t(language, 'lead.err.email');
      if (!password || password.length < 6) errs.password = t(language, 'lead.err.password');
      if (!otpCode || otpCode.trim().length !== 6) errs.otpCode = 'Enter 6-digit code';
    }

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      if (onRegisterAccount) {
        await onRegisterAccount({
          fullName: fullName.trim(),
          email: email.trim(),
          phoneNumber: phoneNumber.trim(),
          password,
          code: otpCode.trim(),
        });
      }

      await onSubmit({
        personal: {
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim(),
          dateOfBirth,
          address: address.trim(),
        },
        documents: {
          passport: passportDoc,
          visa: visaDoc,
          payslip: payslipDoc,
        },
        employment: {
          employerName: employerName.trim(),
          companyName: companyName.trim(),
          manpowerAgent: manpowerAgent.trim() || undefined,
        },
        loan: {
          requestedAmountNis,
        },
      });
    } catch (err: any) {
      setServerError(err.message || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1. LOCATION SCREEN
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
          className="w-full py-3.5 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
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

  // 2. REGULATORY DISCLAIMER
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
          <p className="font-semibold text-slate-900">{t(language, 'lead.disclaimerP1')}</p>
          <p>{t(language, 'lead.disclaimerP2')}</p>
          <p>{t(language, 'lead.disclaimerP3')}</p>
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

          <button
            type="submit"
            className="w-full py-3.5 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>{t(language, 'lead.continueToReg')}</span>
            <ArrowRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </form>
      </div>
    );
  }

  // 3. REGISTRATION & STEP 1 FORM (Reorganized order: Personal -> Account -> Docs -> Employment -> Loan)
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto animate-in fade-in">
      {/* Header */}
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

      {/* Google Sign-in Option at top if registering */}
      {onGoogleSignIn && (
        <div className="mb-6 pb-6 border-b border-slate-100 space-y-3">
          <button
            type="button"
            onClick={() => onGoogleSignIn({ email: `google_${Date.now()}@gmail.com`, name: fullName || 'Google User' })}
            className="w-full py-3 px-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center justify-center gap-2.5 shadow-2xs transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>{t(language, 'lead.continueWithGoogle')}</span>
          </button>
          <div className="relative text-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
            <span className="relative px-3 bg-white text-[11px] font-semibold text-slate-400">
              {t(language, 'lead.orManualRegister')}
            </span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* REORGANIZED SECTION 1: Personal Details */}
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
                disabled={isReadOnly}
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
                  disabled={isReadOnly}
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
                onChange={(val) => setDateOfBirth(val)}
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
                  disabled={isReadOnly}
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

        {/* REORGANIZED SECTION 2: Account Credentials (for unregistered users) */}
        {onRegisterAccount && (
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
                  placeholder="name@example.com" /* i18n-ignore */
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

            {/* OTP verification block */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">{t(language, 'lead.otpCodeLabel')}</span>
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={isSendingOtp}
                  className="text-xs text-blue-600 font-bold hover:underline"
                >
                  {isSendingOtp ? 'Sending...' : isOtpSent ? 'Resend SMS Code' : 'Send SMS Code'}
                </button>
              </div>

              {isOtpSent && (
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  dir="ltr"
                  className="w-full text-center text-sm font-mono tracking-widest py-2 rounded-xl border border-slate-300 bg-white"
                />
              )}
              {formErrors.otpCode && (
                <p className="text-[11px] text-red-500">{formErrors.otpCode}</p>
              )}
            </div>
          </div>
        )}

        {/* REORGANIZED SECTION 3: Verification Documents (Image or PDF) */}
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
                  disabled={isReadOnly || uploadingField === 'passport'}
                  onChange={(e) => handleFileUpload(e, setPassportDoc, 'passportDoc')}
                  className="hidden"
                />
                <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                <span className="text-[11px] text-slate-600 truncate block font-medium">
                  {uploadingField === 'passport'
                    ? 'Uploading...'
                    : passportDoc
                    ? passportDoc.originalName
                    : t(language, 'lead.uploadPlaceholder')}
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
                  disabled={isReadOnly || uploadingField === 'visa'}
                  onChange={(e) => handleFileUpload(e, setVisaDoc, 'visaDoc')}
                  className="hidden"
                />
                <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                <span className="text-[11px] text-slate-600 truncate block font-medium">
                  {uploadingField === 'visa'
                    ? 'Uploading...'
                    : visaDoc
                    ? visaDoc.originalName
                    : t(language, 'lead.uploadPlaceholder')}
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
                  disabled={isReadOnly || uploadingField === 'payslip'}
                  onChange={(e) => handleFileUpload(e, setPayslipDoc, 'payslipDoc')}
                  className="hidden"
                />
                <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                <span className="text-[11px] text-slate-600 truncate block font-medium">
                  {uploadingField === 'payslip'
                    ? 'Uploading...'
                    : payslipDoc
                    ? payslipDoc.originalName
                    : t(language, 'lead.uploadPlaceholder')}
                </span>
              </label>
              {formErrors.payslipDoc && (
                <p className="text-[10px] text-red-500 mt-1">{formErrors.payslipDoc}</p>
              )}
            </div>
          </div>
        </div>

        {/* REORGANIZED SECTION 4: Employment Details */}
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
                disabled={isReadOnly}
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
                  disabled={isReadOnly}
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
                disabled={isReadOnly}
                onChange={(e) => setManpowerAgent(e.target.value)}
                placeholder={t(language, 'lead.manpowerPlaceholder')}
                className="w-full ps-10 pe-3.5 py-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* REORGANIZED SECTION 5: Requested Loan Amount */}
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
              disabled={isReadOnly}
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

        {/* 2.3 MANDATORY GUARANTOR NOTICE (Immediately above submit button) */}
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
          <span className="text-xs font-bold leading-relaxed">
            {t(language, 'lead.mandatoryGuarantorNotice')}
          </span>
        </div>

        {/* Global Error */}
        {serverError && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          id="submit-step1-btn"
          disabled={isSubmitting || isReadOnly}
          className="w-full py-4 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
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
