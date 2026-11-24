import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { FlowApplicationView, Language } from '@quickloan/ui-core/types';
import { t } from '@quickloan/ui-core/i18n/translations';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';
import { apiService, ApiError } from '../services/api';

interface PartnerConsentCardProps {
  application: FlowApplicationView;
  language: Language;
  /** The application after the consent (or reloaded, when the terms changed meanwhile). */
  onUpdated: (app: FlowApplicationView) => void;
}

/**
 * Shown on the status hub when the applicant accepted an older version of the terms in Step 3: the updated
 * General T&C (version 2.0 on) allow QuickLoan to send the approved loan to its funding partner. Until they
 * are accepted, staff cannot send the loan (POST /api/flow/application/partner-consent).
 */
export const PartnerConsentCard: React.FC<PartnerConsentCardProps> = ({ application, language, onUpdated }) => {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = application.partnerConsent;
  if (!prompt) return null;
  const text = language === 'he' ? prompt.terms.textHe : prompt.terms.textEn;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await apiService.acceptPartnerConsent(prompt.terms.version, language));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TERMS_VERSION_CHANGED') {
        // Newer terms were published meanwhile: show them and ask again.
        setAccepted(false);
        setError(t(language, 'hub.partnerConsent.changed'));
        try { onUpdated(await apiService.getFlowApplication()); } catch { /* keep the message */ }
      } else {
        setError(localizeError(err, language));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="partner-consent-card" className="p-4 sm:p-5 rounded-2xl bg-blue-50 border border-blue-300 text-slate-800 space-y-3">
      <div className="flex items-center gap-2 font-bold text-sm text-blue-900">
        <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0" />
        <span>{t(language, 'hub.partnerConsent.title')}</span>
      </div>
      <p className="text-xs leading-relaxed">{t(language, 'hub.partnerConsent.intro')}</p>
      <div
        className="max-h-56 overflow-y-auto p-3 rounded-xl bg-white border border-blue-200 text-xs leading-relaxed whitespace-pre-line"
        tabIndex={0}
        aria-label={t(language, 'hub.partnerConsent.textLabel', { version: prompt.terms.version })}
      >
        {text}
      </div>
      <label className="flex items-start gap-2 text-xs font-semibold cursor-pointer">
        <input
          type="checkbox"
          id="partner-consent-checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 w-4 h-4 shrink-0"
        />
        <span>{t(language, 'hub.partnerConsent.checkbox', { version: prompt.terms.version })}</span>
      </label>
      {error && <p role="alert" className="text-xs font-bold text-red-700">{error}</p>}
      <button
        type="button"
        id="partner-consent-accept"
        disabled={!accepted || busy}
        onClick={accept}
        className="w-full py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? t(language, 'hub.partnerConsent.saving') : t(language, 'hub.partnerConsent.accept')}
      </button>
    </div>
  );
};

export default PartnerConsentCard;
