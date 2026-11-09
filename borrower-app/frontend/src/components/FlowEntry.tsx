import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail, MapPin, Phone, Shield, User as UserIcon } from 'lucide-react';
import { FlowApplicationView, Language, RegistrationConsent, User } from '@quickloan/ui-core/types';
import { t } from '@quickloan/ui-core/i18n/translations';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';
import { apiService, ApiError } from '../services/api';

/**
 * Entry to the 3-step flow, shown before Step 1:
 *   auth     not signed in: sign in (phone/email + password or SMS code, Google), or register:
 *            location access -> conditions -> account (manual or Google)
 *   consent  signed in elsewhere without the registration consent: location access -> conditions
 *   contact  the account lacks a phone (Google) or an email: add it once
 */
export type FlowEntryMode = 'auth' | 'consent' | 'contact';

interface FlowEntryProps {
  language: Language;
  mode: FlowEntryMode;
  account?: FlowApplicationView['account'];
  /** A sign-in or registration succeeded. `application` is set when the endpoint returned it. */
  onAuthenticated: (user: User, application?: FlowApplicationView | null) => void;
  /** Consent or contact details were saved. */
  onApplicationUpdated: (application: FlowApplicationView, user?: User) => void;
}

type Position = RegistrationConsent['location'];
type GoogleProfile = { email: string; name: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const digits = (v: string) => v.replace(/\D/g, '');

const inputClass = (hasError?: boolean, withIcon = true) =>
  `w-full ${withIcon ? 'ps-10' : 'ps-3.5'} pe-3.5 py-2.5 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
    hasError ? 'border-red-500' : 'border-slate-200'
  }`;
const primaryButton =
  'w-full py-3.5 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer';
const card = 'bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto animate-in fade-in';

/** Asks the browser for the position. Only an explicit refusal (or no geolocation at all) blocks the applicant. */
function requestPosition(): Promise<{ ok: true; position: Position } | { ok: false; reason: 'denied' | 'unsupported' }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, reason: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, position: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy } }),
      (err) => {
        // Permission granted but no fix (timeout / position unavailable): the permission is what is required.
        if (err && err.code === 1) resolve({ ok: false, reason: 'denied' });
        else resolve({ ok: true, position: null });
      },
      { timeout: 10000, maximumAge: 600000 }
    );
  });
}

const ErrorBox: React.FC<{ message: string | null; children?: React.ReactNode }> = ({ message, children }) =>
  message ? (
    <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="space-y-1.5">
        <span className="block">{message}</span>
        {children}
      </div>
    </div>
  ) : null;

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="text-[11px] text-red-500 mt-1">{message}</p> : null;

const GoogleIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
);

/**
 * "Continue with Google". There is no Google Identity Services client in the frontend yet, so the button asks for
 * the demo profile the backend accepts in DEMO_MODE.
 */
const GoogleButton: React.FC<{ language: Language; label: string; busy: boolean; initial?: GoogleProfile | null; onProfile: (p: GoogleProfile) => void }> = ({
  language,
  label,
  busy,
  initial,
  onProfile,
}) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(initial?.email || '');
  const [name, setName] = useState(initial?.name || '');
  const valid = EMAIL_RE.test(email.trim());

  if (!open) {
    return (
      <button
        type="button"
        id="google-entry-btn"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="w-full py-3 px-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center justify-center gap-2.5 shadow-2xs transition-all cursor-pointer"
      >
        <GoogleIcon />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 space-y-2.5">
      <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
        <GoogleIcon />
        {t(language, 'entry.googleDemoTitle')}
      </p>
      <input
        type="email"
        aria-label={t(language, 'entry.googleEmail')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t(language, 'entry.googleEmail')}
        dir="ltr"
        className={inputClass(false, false)}
      />
      <input
        type="text"
        aria-label={t(language, 'entry.googleName')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t(language, 'entry.googleName')}
        className={inputClass(false, false)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => onProfile({ email: email.trim(), name: name.trim() })}
          className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs cursor-pointer"
        >
          {busy ? t(language, 'entry.pleaseWait') : label}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold text-xs cursor-pointer">
          {t(language, 'entry.cancel')}
        </button>
      </div>
    </div>
  );
};

const Divider: React.FC<{ label: string }> = ({ label }) => (
  <div className="relative text-center">
    <div className="absolute inset-0 flex items-center">
      <div className="w-full border-t border-slate-200" />
    </div>
    <span className="relative px-3 bg-white text-[11px] font-semibold text-slate-400">{label}</span>
  </div>
);

/** Phone number + "send code" + 6-digit code. */
const PhoneVerification: React.FC<{
  language: Language;
  phone: string;
  onPhone: (v: string) => void;
  code: string;
  onCode: (v: string) => void;
  codeSent: boolean;
  onCodeSent: () => void;
  errors: Record<string, string>;
  onError: (message: string) => void;
}> = ({ language, phone, onPhone, code, onCode, codeSent, onCodeSent, errors, onError }) => {
  const [sending, setSending] = useState(false);
  const sendCode = async () => {
    if (digits(phone).length < 7) {
      onError(t(language, 'auth.err.invalidMobile'));
      return;
    }
    setSending(true);
    try {
      const res = await apiService.requestOtp(phone.trim(), language);
      onCodeSent();
      if (res.demoCode) onCode(res.demoCode);
    } catch (err) {
      onError(localizeError(err, language));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="entry-phone" className="block text-xs font-bold text-slate-700 mb-1">
          {t(language, 'auth.mobileNumber')} <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Phone className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
          <input id="entry-phone" type="tel" value={phone} onChange={(e) => onPhone(e.target.value)} placeholder="050-123-4567" dir="ltr" className={inputClass(!!errors.phoneNumber)} />
        </div>
        <FieldError message={errors.phoneNumber} />
      </div>
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-700">{t(language, 'lead.otpCodeLabel')}</span>
          <button type="button" onClick={sendCode} disabled={sending} className="text-xs text-blue-600 font-bold hover:underline cursor-pointer">
            {sending ? t(language, 'entry.sending') : codeSent ? t(language, 'entry.resendCode') : t(language, 'entry.sendCode')}
          </button>
        </div>
        {codeSent && (
          <input
            type="text"
            inputMode="numeric"
            aria-label={t(language, 'auth.sixDigitCode')}
            maxLength={6}
            value={code}
            onChange={(e) => onCode(digits(e.target.value))}
            placeholder="123456"
            dir="ltr"
            className="w-full text-center text-sm font-mono tracking-widest py-2 rounded-xl border border-slate-300 bg-white"
          />
        )}
        <FieldError message={errors.code} />
      </div>
    </div>
  );
};

/** Registration consent: location access (mandatory), then the regulatory conditions. */
const ConsentScreens: React.FC<{
  language: Language;
  stepLabel?: (n: number) => string | null;
  busy: boolean;
  error: string | null;
  onDone: (consent: RegistrationConsent) => void;
}> = ({ language, stepLabel, busy, error, onDone }) => {
  const [phase, setPhase] = useState<'location' | 'conditions'>('location');
  const [position, setPosition] = useState<Position>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState<string | null>(null);

  const askLocation = async () => {
    setChecking(true);
    setLocationError(null);
    const res = await requestPosition();
    setChecking(false);
    if ('reason' in res) {
      setLocationError(t(language, res.reason === 'denied' ? 'entry.locationDenied' : 'entry.locationUnsupported'));
    } else {
      setPosition(res.position);
      setPhase('conditions');
    }
  };

  const label = stepLabel?.(phase === 'location' ? 1 : 2);

  if (phase === 'location') {
    return (
      <div>
        {label && <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600 text-center mb-4">{label}</p>}
        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
          <MapPin className="w-8 h-8" />
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 text-center mb-3">{t(language, 'lead.locationTitle')}</h1>
        <p className="text-sm text-slate-600 text-center mb-6 leading-relaxed">{t(language, 'lead.locationDesc')}</p>
        {locationError && (
          <div role="alert" className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
            <span>{locationError}</span>
          </div>
        )}
        <button type="button" id="grant-location-btn" onClick={askLocation} disabled={checking} className={primaryButton}>
          {checking ? (
            <span>{t(language, 'lead.checkingPermission')}</span>
          ) : (
            <>
              <Shield className="w-4 h-4" />
              <span>{locationError ? t(language, 'entry.tryAgain') : t(language, 'lead.grantLocation')}</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!agreed) {
          setAgreeError(t(language, 'lead.disclaimerError'));
          return;
        }
        setAgreeError(null);
        onDone({ disclaimerAccepted: true, locationGranted: true, location: position });
      }}
      className="space-y-6"
    >
      {label && <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600 text-center">{label}</p>}
      <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
        <Shield className="w-8 h-8" />
      </div>
      <div className="text-center">
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 mb-2">{t(language, 'lead.disclaimerTitle')}</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{t(language, 'lead.disclaimerBadge')}</p>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 text-xs text-slate-700 space-y-3 max-h-60 overflow-y-auto leading-relaxed">
        <p className="font-semibold text-slate-900">{t(language, 'lead.disclaimerP1')}</p>
        <p>{t(language, 'lead.disclaimerP2')}</p>
        <p>{t(language, 'lead.disclaimerP3')}</p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          id="disclaimer-checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
        <span className="text-xs text-slate-700 leading-normal font-medium">{t(language, 'lead.disclaimerConsent')}</span>
      </label>
      <ErrorBox message={agreeError || error} />
      <button type="submit" id="accept-conditions-btn" disabled={busy} className={primaryButton}>
        <span>{busy ? t(language, 'entry.pleaseWait') : t(language, 'lead.continueToReg')}</span>
        {!busy && <ArrowRight className="w-4 h-4 rtl:rotate-180" />}
      </button>
    </form>
  );
};

export const FlowEntry: React.FC<FlowEntryProps> = ({ language, mode, account, onAuthenticated, onApplicationUpdated }) => {
  const [view, setView] = useState<'signIn' | 'forgot' | 'register'>('signIn');
  const [regStep, setRegStep] = useState<'consent' | 'account'>('consent');
  const [consent, setConsent] = useState<RegistrationConsent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingGoogle, setPendingGoogle] = useState<GoogleProfile | null>(null);

  // Sign in
  const [identifier, setIdentifier] = useState('');
  const [method, setMethod] = useState<'none' | 'password' | 'otp'>('none');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [noAccount, setNoAccount] = useState(false);

  // Forgot password
  const [resetSent, setResetSent] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // Registration account form (also used for "complete your account")
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const reset = () => {
    setError(null);
    setErrors({});
  };

  const run = async (fn: () => Promise<void>, fallbackKey = 'err.generic') => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(localizeError(err, language, fallbackKey));
    } finally {
      setBusy(false);
    }
  };

  const goRegister = (message: string | null = null) => {
    reset();
    setNotice(message);
    setView('register');
    setRegStep(consent ? 'account' : 'consent');
  };

  const goSignIn = () => {
    reset();
    setNotice(null);
    setView('signIn');
    setMethod('none');
  };

  // ---------------------------------------------------------------- sign in
  const startOtp = async (target: string) => {
    const res = await apiService.requestOtp(target, language);
    setMethod('otp');
    setCodeSent(true);
    setCode(res.demoCode || '');
  };

  const handleSignInContinue = (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setNoAccount(false);
    const id = identifier.trim();
    if (method === 'none') {
      if (id.includes('@')) {
        if (!EMAIL_RE.test(id)) return setErrors({ identifier: t(language, 'auth.err.invalidEmail') });
        setMethod('password');
        return;
      }
      if (digits(id).length < 7) return setErrors({ identifier: t(language, 'auth.err.enterIdentifier') });
      run(async () => {
        const res = await apiService.lookupPhone(id);
        if (!res.exists) {
          setNoAccount(true);
          return;
        }
        if (res.hasPassword) setMethod('password');
        else await startOtp(id);
      });
      return;
    }
    if (method === 'password') {
      if (!password) return setErrors({ password: t(language, 'auth.err.enterPassword') });
      run(async () => onAuthenticated(await apiService.loginWithPassword(id, password)), 'err.incorrectPassword');
      return;
    }
    if (code.length !== 6) return setErrors({ code: t(language, 'entry.err.codeRequired') });
    run(async () => onAuthenticated(await apiService.verifyOTP(id, code, language)), 'err.incorrectOtp');
  };

  const handleGoogleSignIn = (profile: GoogleProfile) =>
    run(async () => {
      try {
        const res = await apiService.flowGoogle({ demo: profile, language });
        onAuthenticated(res.user, res.application);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'REGISTRATION_REQUIRED') {
          setPendingGoogle(profile);
          goRegister(t(language, 'entry.googleNoAccount'));
          return;
        }
        throw err;
      }
    });

  // ---------------------------------------------------------------- register
  const handleGoogleRegister = (profile: GoogleProfile) =>
    run(async () => {
      if (!consent) return;
      const res = await apiService.flowGoogle({ demo: profile, language, registration: consent });
      onAuthenticated(res.user, res.application);
    });

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    const errs: Record<string, string> = {};
    const name = fullName.replace(/\s+/g, ' ').trim();
    if (!name || !NAME_RE.test(name)) errs.fullName = t(language, 'auth.err.enterFullName');
    if (digits(phone).length < 7) errs.phoneNumber = t(language, 'auth.err.invalidMobile');
    if (!codeSent) errs.code = t(language, 'entry.err.sendCodeFirst');
    else if (code.length !== 6) errs.code = t(language, 'entry.err.codeRequired');
    if (!EMAIL_RE.test(email.trim())) errs.email = t(language, 'auth.err.invalidEmail');
    if (password.length < 8) errs.password = t(language, 'auth.err.passwordMin8');
    else if (password !== confirmPassword) errs.confirmPassword = t(language, 'auth.err.passwordsMismatch');
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !consent) return;
    run(async () => {
      const res = await apiService.flowRegister({
        fullName: name,
        email: email.trim(),
        phoneNumber: phone.trim(),
        password,
        code,
        language,
        registration: consent,
      });
      onAuthenticated(res.user, res.application);
    }, 'auth.err.registrationFailed');
  };

  // ---------------------------------------------------------------- forgot password
  const handleForgot = (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    const id = identifier.trim();
    if (!id) return setErrors({ identifier: t(language, 'auth.err.enterIdentifier') });
    if (!resetSent) {
      run(async () => {
        const res = await apiService.forgotPassword(id, language);
        setResetSent(true);
        setNotice(t(language, 'auth.resetCodeSentIfExists'));
        if (res.demoCode) setCode(res.demoCode);
      });
      return;
    }
    if (code.length !== 6) return setErrors({ code: t(language, 'auth.err.enterResetCode') });
    if (newPassword.length < 8) return setErrors({ password: t(language, 'auth.err.passwordMin8') });
    run(async () => onAuthenticated(await apiService.resetPassword(id, code, newPassword)), 'auth.err.resetFailed');
  };

  // ================================================================ consent (signed in, no consent yet)
  if (mode === 'consent') {
    return (
      <div className={card}>
        <div className="mb-6 text-center">
          <h2 className="text-sm font-black text-slate-900">{t(language, 'entry.consentTitle')}</h2>
          <p className="text-xs text-slate-500 mt-1">{t(language, 'entry.consentSubtitle')}</p>
        </div>
        <ConsentScreens
          language={language}
          busy={busy}
          error={error}
          onDone={(c) => run(async () => onApplicationUpdated(await apiService.submitRegistrationConsent(c)))}
        />
      </div>
    );
  }

  // ================================================================ contact (account lacks phone or email)
  if (mode === 'contact') {
    const needPhone = !account?.phoneNumber;
    const needEmail = !account?.email;
    const handleContact = (e: React.FormEvent) => {
      e.preventDefault();
      reset();
      const errs: Record<string, string> = {};
      if (needPhone) {
        if (digits(phone).length < 7) errs.phoneNumber = t(language, 'auth.err.invalidMobile');
        if (!codeSent) errs.code = t(language, 'entry.err.sendCodeFirst');
        else if (code.length !== 6) errs.code = t(language, 'entry.err.codeRequired');
      }
      if (needEmail && !EMAIL_RE.test(email.trim())) errs.email = t(language, 'auth.err.invalidEmail');
      setErrors(errs);
      if (Object.keys(errs).length > 0) return;
      run(async () => {
        const res = await apiService.completeFlowAccountContact({
          ...(needPhone ? { phoneNumber: phone.trim(), code } : {}),
          ...(needEmail ? { email: email.trim() } : {}),
        });
        if (res.application) onApplicationUpdated(res.application, res.user);
      });
    };
    return (
      <div className={card}>
        <h1 className="text-xl font-black text-slate-900 mb-1">{t(language, 'entry.completeTitle')}</h1>
        <p className="text-xs text-slate-600 mb-6">{t(language, 'entry.completeSubtitle')}</p>
        <form onSubmit={handleContact} className="space-y-4">
          {needPhone && (
            <PhoneVerification
              language={language}
              phone={phone}
              onPhone={setPhone}
              code={code}
              onCode={setCode}
              codeSent={codeSent}
              onCodeSent={() => setCodeSent(true)}
              errors={errors}
              onError={setError}
            />
          )}
          {needEmail && (
            <div>
              <label htmlFor="entry-email" className="block text-xs font-bold text-slate-700 mb-1">
                {t(language, 'auth.emailAddress')} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
                <input id="entry-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /* i18n-ignore */ dir="ltr" className={inputClass(!!errors.email)} />
              </div>
              <FieldError message={errors.email} />
            </div>
          )}
          <ErrorBox message={error} />
          <button type="submit" id="save-contact-btn" disabled={busy} className={primaryButton}>
            {busy ? t(language, 'entry.pleaseWait') : t(language, 'entry.saveAndContinue')}
          </button>
        </form>
      </div>
    );
  }

  // ================================================================ register
  if (view === 'register') {
    return (
      <div className={card}>
        {notice && <p className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs">{notice}</p>}
        {regStep === 'consent' ? (
          <ConsentScreens
            language={language}
            busy={false}
            error={null}
            stepLabel={(n) => t(language, 'entry.registerStepOf', { n })}
            onDone={(c) => {
              setConsent(c);
              setRegStep('account');
              setNotice(null);
            }}
          />
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600 mb-1">{t(language, 'entry.registerStepOf', { n: 3 })}</p>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900">{t(language, 'entry.accountTitle')}</h1>
              <p className="text-xs text-slate-600 mt-1">{t(language, 'entry.accountSubtitle')}</p>
            </div>

            <GoogleButton language={language} label={t(language, 'entry.googleRegister')} busy={busy} initial={pendingGoogle} onProfile={handleGoogleRegister} />
            <Divider label={t(language, 'entry.orManual')} />

            <form onSubmit={handleRegister} className="space-y-4" noValidate>
              <div>
                <label htmlFor="entry-fullname" className="block text-xs font-bold text-slate-700 mb-1">
                  {t(language, 'auth.fullName')} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
                  <input id="entry-fullname" type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t(language, 'auth.fullNamePlaceholder')} className={inputClass(!!errors.fullName)} />
                </div>
                <FieldError message={errors.fullName} />
              </div>

              <PhoneVerification
                language={language}
                phone={phone}
                onPhone={setPhone}
                code={code}
                onCode={setCode}
                codeSent={codeSent}
                onCodeSent={() => setCodeSent(true)}
                errors={errors}
                onError={setError}
              />

              <div>
                <label htmlFor="entry-email" className="block text-xs font-bold text-slate-700 mb-1">
                  {t(language, 'auth.emailAddress')} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
                  <input id="entry-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /* i18n-ignore */ dir="ltr" className={inputClass(!!errors.email)} />
                </div>
                <FieldError message={errors.email} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="entry-password" className="block text-xs font-bold text-slate-700 mb-1">
                    {t(language, 'auth.password')} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
                    <input
                      id="entry-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t(language, 'entry.passwordMin8')}
                      dir="ltr"
                      className={`${inputClass(!!errors.password)} pe-10`}
                    />
                    <button
                      type="button"
                      aria-label={t(language, 'entry.togglePassword')}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute end-3.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <FieldError message={errors.password} />
                </div>
                <div>
                  <label htmlFor="entry-password2" className="block text-xs font-bold text-slate-700 mb-1">
                    {t(language, 'auth.confirmPassword')} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
                    <input
                      id="entry-password2"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t(language, 'auth.reenterPassword')}
                      dir="ltr"
                      className={inputClass(!!errors.confirmPassword)}
                    />
                  </div>
                  <FieldError message={errors.confirmPassword} />
                </div>
              </div>

              <ErrorBox message={error} />
              <button type="submit" id="create-account-btn" disabled={busy} className={primaryButton}>
                {busy ? t(language, 'entry.pleaseWait') : t(language, 'auth.createAccount')}
              </button>
            </form>
          </div>
        )}
        <p className="mt-6 text-center text-xs text-slate-600">
          {t(language, 'auth.alreadyHaveAccount')}{' '}
          <button type="button" onClick={goSignIn} className="font-bold text-blue-600 hover:underline cursor-pointer">
            {t(language, 'auth.signIn')}
          </button>
        </p>
      </div>
    );
  }

  // ================================================================ forgot password
  if (view === 'forgot') {
    return (
      <div className={card}>
        <h1 className="text-xl font-black text-slate-900 mb-1">{t(language, 'auth.resetYourPassword')}</h1>
        <p className="text-xs text-slate-600 mb-6">{t(language, 'auth.resetInstructions')}</p>
        <form onSubmit={handleForgot} className="space-y-4">
          <div>
            <label htmlFor="entry-identifier" className="block text-xs font-bold text-slate-700 mb-1">{t(language, 'auth.phoneOrEmail')}</label>
            <input id="entry-identifier" type="text" value={identifier} disabled={resetSent} onChange={(e) => setIdentifier(e.target.value)} placeholder={t(language, 'entry.identifierPlaceholder')} dir="ltr" className={inputClass(!!errors.identifier, false)} />
            <FieldError message={errors.identifier} />
          </div>
          {resetSent && (
            <>
              {notice && <p className="text-xs text-emerald-700">{notice}</p>}
              <input
                type="text"
                inputMode="numeric"
                aria-label={t(language, 'auth.enterResetCode')}
                maxLength={6}
                value={code}
                onChange={(e) => setCode(digits(e.target.value))}
                placeholder="123456"
                dir="ltr"
                className="w-full text-center text-sm font-mono tracking-widest py-2 rounded-xl border border-slate-300 bg-white"
              />
              <FieldError message={errors.code} />
              <input
                type="password"
                aria-label={t(language, 'auth.newPasswordMin8')}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t(language, 'auth.newPasswordMin8')}
                dir="ltr"
                className={inputClass(!!errors.password, false)}
              />
              <FieldError message={errors.password} />
            </>
          )}
          <ErrorBox message={error} />
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? t(language, 'entry.pleaseWait') : resetSent ? t(language, 'auth.resetAndSignIn') : t(language, 'auth.sendResetCode')}
          </button>
        </form>
        <button type="button" onClick={goSignIn} className="mt-4 w-full text-center text-xs font-bold text-blue-600 hover:underline cursor-pointer">
          {t(language, 'auth.returnToSignIn')}
        </button>
      </div>
    );
  }

  // ================================================================ sign in (entry point)
  return (
    <div className={card}>
      <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-inner">
        <Lock className="w-7 h-7" />
      </div>
      <h1 className="text-xl sm:text-2xl font-black text-slate-900 text-center mb-1">{t(language, 'entry.signInTitle')}</h1>
      <p className="text-xs text-slate-600 text-center mb-6">{t(language, 'entry.signInSubtitle')}</p>

      <div className="space-y-4">
        <GoogleButton language={language} label={t(language, 'auth.continueWithGoogle')} busy={busy} onProfile={handleGoogleSignIn} />
        <Divider label={t(language, 'auth.or')} />

        <form onSubmit={handleSignInContinue} className="space-y-4" noValidate>
          <div>
            <label htmlFor="entry-identifier" className="block text-xs font-bold text-slate-700 mb-1">{t(language, 'entry.identifierLabel')}</label>
            <input
              id="entry-identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setMethod('none');
                setNoAccount(false);
                setCodeSent(false);
                setCode('');
              }}
              placeholder={t(language, 'entry.identifierPlaceholder')}
              dir="ltr"
              className={inputClass(!!errors.identifier, false)}
            />
            <FieldError message={errors.identifier} />
          </div>

          {method === 'password' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="entry-signin-password" className="text-xs font-bold text-slate-700">{t(language, 'auth.password')}</label>
                <button type="button" onClick={() => { reset(); setResetSent(false); setView('forgot'); }} className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
                  {t(language, 'auth.forgotPassword')}
                </button>
              </div>
              <input
                id="entry-signin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t(language, 'auth.passwordPlaceholder')}
                dir="ltr"
                className={inputClass(!!errors.password, false)}
              />
              <FieldError message={errors.password} />
              {!identifier.includes('@') && (
                <button type="button" onClick={() => run(() => startOtp(identifier.trim()))} className="mt-2 text-[11px] font-bold text-slate-500 hover:text-blue-600 hover:underline cursor-pointer">
                  {t(language, 'auth.useSmsInstead')}
                </button>
              )}
            </div>
          )}

          {method === 'otp' && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <p className="text-xs text-slate-600">
                {t(language, 'auth.codeSentTo')} <bdi dir="ltr">{identifier.trim()}</bdi>
              </p>
              <input
                type="text"
                inputMode="numeric"
                aria-label={t(language, 'auth.sixDigitCode')}
                maxLength={6}
                value={code}
                onChange={(e) => setCode(digits(e.target.value))}
                placeholder="123456"
                dir="ltr"
                className="w-full text-center text-sm font-mono tracking-widest py-2 rounded-xl border border-slate-300 bg-white"
              />
              <FieldError message={errors.code} />
              <button type="button" onClick={() => run(() => startOtp(identifier.trim()))} className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
                {t(language, 'entry.resendCode')}
              </button>
            </div>
          )}

          <ErrorBox message={noAccount ? t(language, 'entry.noAccountFound') : error}>
            {noAccount && (
              <button type="button" onClick={() => goRegister()} className="font-bold underline cursor-pointer">
                {t(language, 'auth.createYourAccount')}
              </button>
            )}
          </ErrorBox>

          <button type="submit" id="signin-continue-btn" disabled={busy} className={primaryButton}>
            <span>{busy ? t(language, 'entry.pleaseWait') : method === 'none' ? t(language, 'entry.continue') : t(language, 'auth.signIn')}</span>
            {!busy && <ArrowRight className="w-4 h-4 rtl:rotate-180" />}
          </button>
        </form>
      </div>

      <div className="mt-6 pt-5 border-t border-slate-100 text-center">
        <p className="text-xs text-slate-600 mb-2">{t(language, 'auth.newHere')}</p>
        <button type="button" id="go-register-btn" onClick={() => goRegister()} className="w-full py-3 rounded-2xl border-2 border-blue-600 text-blue-700 font-bold text-sm hover:bg-blue-50 transition-all cursor-pointer">
          {t(language, 'auth.createYourAccount')}
        </button>
      </div>
    </div>
  );
};
