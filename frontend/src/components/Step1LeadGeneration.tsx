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
  Globe,
} from 'lucide-react';
import {
  Step1FormData,
  UploadedDocRef,
  Language,
} from '../types';
import { STEP1_ORIGIN_COUNTRIES } from '../config/appConfig';
import { DateInput } from './DateInput';
import { formatCurrency } from '../i18n/format';
import { optionLabel } from '../i18n/options';
import { t } from '../i18n/translations';
import { localizeError } from '../i18n/apiErrors';
import { apiService, ApiError } from '../services/api';

interface Step1LeadGenerationProps {
  language?: Language;
  initialData?: Step1FormData | null;
  userPhone?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  hasCompletedDisclaimer?: boolean;
  isReadOnly?: boolean;
  onSubmit?: (data: Step1FormData) => Promise<void>;
  onRegisterAccount?: (creds: {
    fullName: string;
    email: string;
    phoneNumber: string;
    password: string;
    code: string;
    uploadedFiles: string[];
  }) => Promise<void>;
  existingLead?: any;
  onLeadCreated?: (lead: any) => void;
  onLeadStatusChange?: (status: any) => void;
  onProceedToStep2?: () => void;
}

type Step1Phase = 'location' | 'disclaimer' | 'form';

// Backend validation field (services/flowValidation.js validateStep1, /api/flow/register) ->
// [form error slot, message key]. Document errors from the server mean the file was not accepted
// for this account, so the applicant is asked to upload it again.
const SERVER_FIELD_ERRORS: Record<string, [string, string]> = {
  fullName: ['fullName', 'lead.err.fullName'],
  phoneNumber: ['phoneNumber', 'lead.err.phoneNumber'],
  dateOfBirth: ['dateOfBirth', 'lead.err.dob'],
  address: ['address', 'lead.err.address'],
  passportNumber: ['passportNumber', 'lead.err.passportNumber'],
  countryOfOrigin: ['countryOfOrigin', 'lead.err.countryOfOrigin'],
  visaStartDate: ['visaStartDate', 'lead.err.visaStartDate'],
  visaExpiryDate: ['visaExpiryDate', 'lead.err.visaExpiryDate'],
  monthlySalaryNis: ['monthlySalaryNis', 'lead.err.monthlySalary'],
  passport: ['passportDoc', 'lead.err.docReupload'],
  visa: ['visaDoc', 'lead.err.docReupload'],
  payslip: ['payslipDoc', 'lead.err.docReupload'],
  employerName: ['employerName', 'lead.err.employer'],
  companyName: ['companyName', 'lead.err.company'],
  requestedAmountNis: ['requestedAmountNis', 'lead.err.amount'],
  email: ['email', 'lead.err.email'],
  password: ['password', 'lead.err.password'],
};

type FieldErrorMap = Record<string, string>;

function mapServerFieldErrors(fieldErrors: FieldErrorMap, language: Language): FieldErrorMap {
  const errs: FieldErrorMap = {};
  for (const [field, code] of Object.entries(fieldErrors)) {
    const entry = SERVER_FIELD_ERRORS[field];
    if (!entry) continue;
    const key =
      field === 'dateOfBirth' && code === 'invalid'
        ? 'lead.err.dobInvalid'
        : field === 'visaExpiryDate' && code === 'before_start'
        ? 'lead.err.visaRange'
        : entry[1];
    errs[entry[0]] = t(language, key);
  }
  return errs;
}

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
  const [passportNumber, setPassportNumber] = useState(initialData?.personal?.passportNumber || '');
  const [countryOfOrigin, setCountryOfOrigin] = useState(initialData?.personal?.countryOfOrigin || '');
  const [visaStartDate, setVisaStartDate] = useState(initialData?.personal?.visaStartDate || '');
  const [visaExpiryDate, setVisaExpiryDate] = useState(initialData?.personal?.visaExpiryDate || '');
  const [monthlySalary, setMonthlySalary] = useState<string>(() => {
    const initSalary = initialData?.personal?.monthlySalaryNis ?? initialData?.employment?.monthlySalaryNis;
    return typeof initSalary === 'number' && initSalary > 0 ? String(initSalary) : '';
  });

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
        [fieldKey]: localizeError(err, language),
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
      setServerError(localizeError(err, language));
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

    // Additional Personal / Employee Information (above Documents)
    if (!passportNumber.trim()) errs.passportNumber = t(language, 'lead.err.passportNumber');
    if (!countryOfOrigin || !(STEP1_ORIGIN_COUNTRIES as readonly string[]).includes(countryOfOrigin)) {
      errs.countryOfOrigin = t(language, 'lead.err.countryOfOrigin');
    }
    if (!visaStartDate) errs.visaStartDate = t(language, 'lead.err.visaStartDate');
    if (!visaExpiryDate) {
      errs.visaExpiryDate = t(language, 'lead.err.visaExpiryDate');
    } else if (visaStartDate && visaExpiryDate < visaStartDate) {
      errs.visaExpiryDate = t(language, 'lead.err.visaRange');
    }
    const parsedSalary = Number(monthlySalary);
    if (!monthlySalary.trim() || !Number.isFinite(parsedSalary) || parsedSalary <= 0) {
      errs.monthlySalaryNis = t(language, 'lead.err.monthlySalary');
    }

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
      if (!password || password.length < 8) errs.password = t(language, 'lead.err.password');
      if (!otpCode || otpCode.trim().length !== 6) errs.otpCode = t(language, 'lead.err.otpCode');
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
          uploadedFiles: [passportDoc, visaDoc, payslipDoc]
            .map((doc) => doc?.filename)
            .filter((f): f is string => !!f),
        });
      }

      const salaryValue = Math.round(Number(monthlySalary) * 100) / 100;
      await onSubmit?.({
        personal: {
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim(),
          dateOfBirth,
          address: address.trim(),
          passportNumber: passportNumber.trim(),
          countryOfOrigin,
          visaStartDate,
          visaExpiryDate,
          monthlySalaryNis: salaryValue,
          salaryCurrency: 'ILS',
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
          monthlySalaryNis: salaryValue,
          salaryCurrency: 'ILS',
        },
        loan: {
          requestedAmountNis,
        },
      });
    } catch (err: unknown) {
      const fieldErrs = mapServerFieldErrors(err instanceof ApiError ? err.fieldErrors || {} : {}, language);
      if (Object.keys(fieldErrs).length > 0) {
        setFormErrors(fieldErrs);
        if (fieldErrs.passportDoc) setPassportDoc(null);
        if (fieldErrs.visaDoc) setVisaDoc(null);
        if (fieldErrs.payslipDoc) setPayslipDoc(null);
        setServerError(t(language, 'lead.completeRequiredFields'));
      } else {
        setServerError(localizeError(err, language));
      }
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

      <form noValidate onSubmit={handleSubmit} className="space-y-6">
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
                disabled={isReadOnly}
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
                  {isSendingOtp
                    ? t(language, 'lead.sendingOtp')
                    : isOtpSent
                    ? t(language, 'lead.resendOtp')
                    : t(language, 'lead.sendOtp')}
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

        {/* ADDITIONAL EMPLOYEE & VISA INFORMATION (Immediately above Documents) */}
        <div className="space-y-4" data-testid="step1-employee-info-section">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-blue-600" />
            {t(language, 'lead.additionalPersonalTitle')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="step1-passport-number" className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'lead.passportNumberLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                id="step1-passport-number"
                type="text"
                dir="ltr"
                value={passportNumber}
                disabled={isReadOnly}
                onChange={(e) => {
                  setPassportNumber(e.target.value);
                  if (formErrors.passportNumber) {
                    setFormErrors((prev) => ({ ...prev, passportNumber: '' }));
                  }
                }}
                placeholder={t(language, 'lead.passportNumberPlaceholder')}
                className={`w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  formErrors.passportNumber ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              {formErrors.passportNumber && (
                <p className="text-[11px] text-red-500 mt-1">{formErrors.passportNumber}</p>
              )}
            </div>

            <div>
              <label htmlFor="step1-country-origin" className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'lead.countryOfOriginLabel')} <span className="text-red-500">*</span>
              </label>
              <select
                id="step1-country-origin"
                value={countryOfOrigin}
                disabled={isReadOnly}
                onChange={(e) => {
                  setCountryOfOrigin(e.target.value);
                  if (formErrors.countryOfOrigin) {
                    setFormErrors((prev) => ({ ...prev, countryOfOrigin: '' }));
                  }
                }}
                className={`w-full px-3.5 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  formErrors.countryOfOrigin ? 'border-red-500' : 'border-slate-200'
                }`}
              >
                <option value="">{t(language, 'lead.countryOfOriginPlaceholder')}</option>
                {STEP1_ORIGIN_COUNTRIES.map((country) => (
                  <option key={country} value={country}>
                    {optionLabel(language, 'country', country)}
                  </option>
                ))}
              </select>
              {formErrors.countryOfOrigin && (
                <p className="text-[11px] text-red-500 mt-1">{formErrors.countryOfOrigin}</p>
              )}
            </div>
          </div>

          {/* Visa Validity Period (Date-Range Selector) */}
          <div className="p-3.5 rounded-2xl bg-slate-50/70 border border-slate-200 space-y-3">
            <div className="text-xs font-bold text-slate-700">
              {t(language, 'lead.visaValidityTitle')} <span className="text-red-500">*</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="step1-visa-start" className="block text-[11px] font-semibold text-slate-600 mb-1">
                  {t(language, 'lead.visaStartDateLabel')} <span className="text-red-500">*</span>
                </label>
                <DateInput
                  id="step1-visa-start"
                  value={visaStartDate}
                  onChange={(val) => {
                    setVisaStartDate(val);
                    if (formErrors.visaStartDate) {
                      setFormErrors((prev) => ({ ...prev, visaStartDate: '' }));
                    }
                  }}
                  language={language}
                  max={visaExpiryDate || undefined}
                  disabled={isReadOnly}
                  required
                  className={formErrors.visaStartDate ? 'border-red-500' : 'border-slate-200'}
                />
                {formErrors.visaStartDate && (
                  <p className="text-[11px] text-red-500 mt-1">{formErrors.visaStartDate}</p>
                )}
              </div>

              <div>
                <label htmlFor="step1-visa-expiry" className="block text-[11px] font-semibold text-slate-600 mb-1">
                  {t(language, 'lead.visaExpiryDateLabel')} <span className="text-red-500">*</span>
                </label>
                <DateInput
                  id="step1-visa-expiry"
                  value={visaExpiryDate}
                  onChange={(val) => {
                    setVisaExpiryDate(val);
                    if (formErrors.visaExpiryDate) {
                      setFormErrors((prev) => ({ ...prev, visaExpiryDate: '' }));
                    }
                  }}
                  language={language}
                  min={visaStartDate || undefined}
                  disabled={isReadOnly}
                  required
                  className={formErrors.visaExpiryDate ? 'border-red-500' : 'border-slate-200'}
                />
                {formErrors.visaExpiryDate && (
                  <p className="text-[11px] text-red-500 mt-1">{formErrors.visaExpiryDate}</p>
                )}
              </div>
            </div>
          </div>

          {/* Monthly Salary (Numeric with Currency) */}
          <div>
            <label htmlFor="step1-monthly-salary" className="block text-xs font-bold text-slate-700 mb-1">
              {t(language, 'lead.monthlySalaryLabel')} <span className="text-red-500">*</span>
            </label>
            <div className="relative" dir="ltr">
              <span
                className="absolute start-3.5 top-2.5 text-xs font-bold text-slate-500 select-none"
                aria-hidden="true"
              >
                {t(language, 'currencySymbol')}
              </span>
              <input
                id="step1-monthly-salary"
                type="number"
                inputMode="decimal"
                min={1}
                step="any"
                value={monthlySalary}
                disabled={isReadOnly}
                onChange={(e) => {
                  setMonthlySalary(e.target.value);
                  if (formErrors.monthlySalaryNis) {
                    setFormErrors((prev) => ({ ...prev, monthlySalaryNis: '' }));
                  }
                }}
                placeholder={t(language, 'lead.monthlySalaryPlaceholder')}
                className={`w-full ps-9 pe-14 py-2.5 text-xs font-mono rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  formErrors.monthlySalaryNis ? 'border-red-500' : 'border-slate-200'
                }`}
              />
              <span className="absolute end-3 top-2 px-2 py-0.5 rounded-md bg-slate-200/70 text-[10px] font-bold text-slate-600 select-none">
                {t(language, 'lead.salaryCurrencyCode')}
              </span>
            </div>
            {formErrors.monthlySalaryNis && (
              <p className="text-[11px] text-red-500 mt-1">{formErrors.monthlySalaryNis}</p>
            )}
          </div>
        </div>

        {/* REORGANIZED SECTION 3: Verification Documents (Image or PDF) */}
        <div className="space-y-4" data-testid="step1-documents-section">
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
                    ? t(language, 'lead.uploading')
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
                    ? t(language, 'lead.uploading')
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
                    ? t(language, 'lead.uploading')
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
            {formErrors.requestedAmountNis && (
              <p className="text-[10px] text-red-500 mt-2">{formErrors.requestedAmountNis}</p>
            )}
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
