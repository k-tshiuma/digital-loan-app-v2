import React, { useState } from 'react';
import { Shield, Lock, AlertCircle, Globe } from 'lucide-react';
import { Language } from '@quickloan/ui-core/types';
import { apiService, StaffAccount } from '../services/api';
import { ENABLED_LANGUAGES, t } from '@quickloan/ui-core/i18n/translations';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';

interface StaffLoginGateProps {
  language: Language;
  onLanguageChange?: (lang: Language) => void;
  isClientBlocked: boolean;
  onAuthenticated: (staff: StaffAccount, token: string) => void;
  onReturnToPublic: () => void;
}

export const StaffLoginGate: React.FC<StaffLoginGateProps> = ({
  language,
  onLanguageChange,
  isClientBlocked,
  onAuthenticated,
  onReturnToPublic,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError(t(language, 'bo.staffLogin.errRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiService.flowStaffLogin(trimmedEmail, password);
      onAuthenticated(res.staff, res.token);
    } catch (err) {
      setError(localizeError(language, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1a2d] text-white flex flex-col justify-between p-4">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-600 flex items-center justify-center shadow-xs">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight text-white">
              {/* i18n-ignore-next-line: brand name */}
              QuickLoan
            </span>
            <span className="ms-2 text-[10px] bg-sky-500/15 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-mono uppercase font-semibold">
              {t(language, 'bo.staffLogin.badge')}
            </span>
          </div>
        </div>

        {onLanguageChange && (
          <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700 rounded-xl p-1">
            <Globe className="w-3.5 h-3.5 text-slate-400 ms-1.5" />
            {ENABLED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => onLanguageChange(lang.code)}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition-colors ${
                  language === lang.code
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {lang.nativeName}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center py-8">
        {isClientBlocked ? (
          <div
            data-testid="backoffice-client-blocked"
            className="w-full max-w-md bg-white text-slate-900 rounded-3xl shadow-2xl border border-slate-200 p-6 sm:p-8 space-y-5 text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center mx-auto">
              <Lock className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h1 className="text-lg font-extrabold text-slate-900">
                {t(language, 'bo.accessDenied.title')}
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                {t(language, 'bo.accessDenied.clientBody')}
              </p>
            </div>
            <button
              type="button"
              onClick={onReturnToPublic}
              className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs"
            >
              {t(language, 'bo.accessDenied.returnBtn')}
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            data-testid="backoffice-staff-login-form"
            className="w-full max-w-md bg-white text-slate-900 rounded-3xl shadow-2xl border border-slate-200 p-6 sm:p-8 space-y-5"
          >
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200 text-[11px] font-bold">
                <Lock className="w-3.5 h-3.5" />
                <span>{t(language, 'bo.staffLogin.badge')}</span>
              </div>
              <h1 className="text-xl font-extrabold text-slate-900">
                {t(language, 'bo.staffLogin.title')}
              </h1>
              <p className="text-xs text-slate-500 leading-relaxed">
                {t(language, 'bo.staffLogin.subtitle')}
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="staff-email-input" className="block text-xs font-bold text-slate-700">
                  {t(language, 'bo.staffLogin.emailLabel')}
                </label>
                <input
                  id="staff-email-input"
                  dir="ltr"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t(language, 'bo.staffLogin.emailPlaceholder')}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="staff-password-input" className="block text-xs font-bold text-slate-700">
                  {t(language, 'bo.staffLogin.passwordLabel')}
                </label>
                <input
                  id="staff-password-input"
                  dir="ltr"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t(language, 'bo.staffLogin.passwordPlaceholder')}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none"
                />
              </div>
            </div>

            <button
              id="staff-login-submit-btn"
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-[#0b1a2d] hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold transition-colors shadow-xs"
            >
              {submitting ? t(language, 'bo.staffLogin.submitting') : t(language, 'bo.staffLogin.submit')}
            </button>

            <div className="pt-2 border-t border-slate-100 text-center">
              <button
                type="button"
                onClick={onReturnToPublic}
                className="text-xs font-semibold text-slate-500 hover:text-blue-600 transition-colors"
              >
                {t(language, 'bo.staffLogin.backToSite')}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="h-4" />
    </div>
  );
};
