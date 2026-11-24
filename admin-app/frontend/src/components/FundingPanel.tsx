import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Clock, Landmark, RefreshCw, Send, ShieldCheck, XCircle } from 'lucide-react';
import { Language } from '@quickloan/ui-core/types';
import { formatDateTime } from '@quickloan/ui-core/i18n/format';
import { t } from '@quickloan/ui-core/i18n/translations';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';
import { apiService, ApiError, type FundingHandoff, type FundingHandoffStatus, type FundingOverview } from '../services/api';

interface FundingPanelProps {
  applicationId: string;
  language: Language;
  /** Called after a push, so the inspector reloads the application (its status changes). */
  onChanged?: () => void;
}

/** How often the panel reloads while the partner is still deciding (the server asks the partner itself). */
const RELOAD_MS = 10000;

const STATUS_STYLE: Record<FundingHandoffStatus, string> = {
  SENDING: 'bg-blue-50 text-blue-800 border-blue-300',
  SENT: 'bg-indigo-50 text-indigo-800 border-indigo-300',
  IN_REVIEW: 'bg-amber-50 text-amber-800 border-amber-300',
  APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-red-50 text-red-800 border-red-300',
  FAILED: 'bg-red-50 text-red-800 border-red-300',
};

/** Error codes from the funding endpoints that have their own text (fund.err.<code>). */
const ERROR_CODES = new Set([
  'FUNDING_PARTNER_NOT_CONFIGURED', 'NOT_APPROVED', 'LOAN_REPAID', 'PARTNER_CONSENT_REQUIRED', 'HANDOFF_IN_PROGRESS', 'ALREADY_SENT',
  'PARTNER_UNREACHABLE', 'PARTNER_TIMEOUT', 'PARTNER_ERROR', 'PARTNER_AUTH_FAILED', 'PARTNER_VALIDATION', 'PARTNER_REFUSED',
  'DOCUMENT_MISSING', 'NOTHING_TO_CHECK', 'CONSENT_ALREADY_GIVEN',
]);

const DOC_KEYS = ['PASSPORT', 'WORK_VISA', 'PAY_SLIP', 'GUARANTOR_ID', 'BANK_ACCOUNT_DOCUMENT', 'ADDITIONAL_DOCUMENT'];

/**
 * The Funding section of a loan in the Back Office: the partner, the applicant's consent, "Push to partner"
 * (with a confirmation of what is sent), every hand-off with its status, attempts and errors, "Try again",
 * "Check status" and the consent reminder. What staff may do comes from the server (`permissions`).
 */
export const FundingPanel: React.FC<FundingPanelProps> = ({ applicationId, language, onChanged }) => {
  const [overview, setOverview] = useState<FundingOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'push' | 'refresh' | 'consent' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const errorText = useCallback((err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    return code && ERROR_CODES.has(code) ? t(language, `fund.err.${code}`) : localizeError(err, language);
  }, [language]);

  const load = useCallback(async () => {
    try {
      setOverview(await apiService.getFunding(applicationId));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [applicationId, errorText]);

  useEffect(() => { load(); }, [load]);

  const waiting = !!overview && overview.handoffs.some((h) => h.status === 'SENT' || h.status === 'IN_REVIEW' || h.status === 'SENDING');
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(load, RELOAD_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const act = async (kind: 'push' | 'refresh' | 'consent') => {
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === 'push') {
        const r = await apiService.pushToPartner(applicationId);
        setNotice({ kind: 'ok', text: t(language, 'fund.msg.sent', { ref: r.handoff.externalReference || '' }) });
        onChanged?.();
      } else if (kind === 'refresh') {
        await apiService.refreshFunding(applicationId);
        setNotice({ kind: 'ok', text: t(language, 'fund.msg.checked') });
      } else {
        await apiService.requestPartnerConsent(applicationId);
        setNotice({ kind: 'ok', text: t(language, 'fund.msg.consentRequested') });
      }
      setConfirming(false);
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err) });
      setConfirming(false);
    } finally {
      setBusy(null);
      load();
    }
  };

  if (!overview) {
    return (
      <div id="funding-panel" className="p-4 rounded-2xl border border-slate-200 bg-white text-xs text-slate-500">
        {loadError || t(language, 'fund.loading')}
      </div>
    );
  }

  const { partner, consent, handoffs, permissions } = overview;
  const failed = handoffs.find((h) => h.status === 'FAILED');
  const active = handoffs.find((h) => h.status !== 'FAILED');

  return (
    <div id="funding-panel" className="space-y-4 text-xs text-slate-700">
      {/* Partner and consent */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <Landmark className="w-4 h-4 text-[#003366]" />
            <span>{t(language, 'fund.partner')}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{partner.name}</span>
            {partner.sandbox && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold">
                {t(language, 'fund.sandbox')}
              </span>
            )}
          </div>
          {!partner.configured && (
            <div className="p-2 rounded-xl bg-red-50 border border-red-200 text-red-800 space-y-1" id="funding-not-configured">
              <div className="font-bold">{t(language, 'fund.notConfigured')}</div>
              {partner.problem && <bdi dir="ltr" className="block text-[11px] text-red-700">{partner.problem}</bdi>}
            </div>
          )}
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-1.5" id="funding-consent">
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <ShieldCheck className="w-4 h-4 text-[#003366]" />
            <span>{t(language, 'fund.consent')}</span>
          </div>
          {consent.given ? (
            <div className="flex items-center gap-1.5 text-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {t(language, 'fund.consent.given', { version: consent.version || '', date: consent.acceptedAt ? formatDateTime(consent.acceptedAt, language) : '—' })}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start gap-1.5 text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t(language, 'fund.consent.missing')}</span>
              </div>
              {permissions.requestConsent && (
                <button
                  type="button"
                  id="funding-request-consent-btn"
                  disabled={busy !== null}
                  onClick={() => act('consent')}
                  className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center gap-1 disabled:opacity-50"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>{t(language, 'fund.consent.remind')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`p-3 rounded-xl border font-bold ${notice.kind === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-red-50 border-red-300 text-red-800'}`}
        >
          {notice.text}
        </div>
      )}

      {/* Push, with a confirmation of exactly what is sent */}
      {/* Push. When it isn't possible, the button stays visible but disabled, with the reason next to it. */}
      {!confirming && (permissions.push || (overview.pushBlockedBy && overview.pushBlockedBy !== 'ROLE')) && (
        <div className="space-y-1.5">
          <button
            type="button"
            id="funding-push-btn"
            disabled={!permissions.push || busy !== null}
            aria-describedby={permissions.push ? undefined : 'funding-push-blocked'}
            onClick={() => setConfirming(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{failed && permissions.push ? t(language, 'fund.retry') : t(language, 'bo.pushToPartner')}</span>
          </button>
          {!permissions.push && overview.pushBlockedBy && (
            <p id="funding-push-blocked" className="text-amber-800 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {overview.pushBlockedBy === 'PARTNER_CONSENT_REQUIRED'
                  ? t(language, 'fund.blocked.consent')
                  : t(language, `fund.err.${overview.pushBlockedBy}`)}
              </span>
            </p>
          )}
        </div>
      )}
      {overview.pushBlockedBy === 'ROLE' && !active && (
        <p className="text-slate-500">{t(language, 'fund.pushNotAllowed')}</p>
      )}

      {confirming && (
        <div id="funding-confirm" className="p-4 rounded-2xl border border-indigo-300 bg-indigo-50 space-y-2">
          <div className="font-bold text-indigo-900">{t(language, 'fund.confirm.title', { partner: partner.name })}</div>
          <ul className="list-disc ps-5 space-y-0.5 text-indigo-900">
            <li>{t(language, 'fund.confirm.personal')}</li>
            <li>{t(language, 'fund.confirm.employment')}</li>
            <li>{t(language, 'fund.confirm.bank')}</li>
            <li>{t(language, 'fund.confirm.sponsors')}</li>
            <li>{t(language, 'fund.confirm.documents')}</li>
            <li>{t(language, 'fund.confirm.loan')}</li>
          </ul>
          <p className="text-indigo-800">{t(language, 'fund.confirm.note')}</p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setConfirming(false)} className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 font-bold">
              {t(language, 'fund.cancel')}
            </button>
            <button
              type="button"
              id="funding-confirm-btn"
              disabled={busy !== null}
              onClick={() => act('push')}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{busy === 'push' ? t(language, 'fund.sending') : t(language, 'fund.confirm.send')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Hand-offs */}
      <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-slate-900">{t(language, 'fund.history')}</span>
          {permissions.refresh && (
            <button
              type="button"
              id="funding-refresh-btn"
              disabled={busy !== null}
              onClick={() => act('refresh')}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 font-bold flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
              <span>{t(language, 'fund.check')}</span>
            </button>
          )}
        </div>
        {handoffs.length === 0 && <p className="text-slate-500">{t(language, 'fund.none')}</p>}
        {handoffs.map((h) => (
          <HandoffRow key={h.id} h={h} language={language} errorLabel={errorText} />
        ))}
      </div>
    </div>
  );
};

const HandoffRow: React.FC<{ h: FundingHandoff; language: Language; errorLabel: (err: unknown) => string }> = ({ h, language, errorLabel }) => {
  const Icon = h.status === 'APPROVED' ? CheckCircle2 : h.status === 'REJECTED' || h.status === 'FAILED' ? XCircle : Clock;
  const docs = (h.requestSummary && h.requestSummary.documents) || [];
  return (
    <div className="p-3 rounded-xl border border-slate-200 space-y-1.5" data-handoff-status={h.status}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold flex items-center gap-1 ${STATUS_STYLE[h.status]}`}>
          <Icon className="w-3.5 h-3.5" />
          {t(language, `fund.status.${h.status}`)}
        </span>
        {h.externalReference && (
          <span>
            {t(language, 'fund.reference')} <bdi dir="ltr" className="font-mono font-semibold">{h.externalReference}</bdi>
          </span>
        )}
        {h.responseSummary && h.responseSummary.fundingReference && (
          <span>
            {t(language, 'fund.fundingReference')} <bdi dir="ltr" className="font-mono font-semibold">{h.responseSummary.fundingReference}</bdi>
          </span>
        )}
      </div>
      <div className="text-slate-500">
        {t(language, 'fund.pushedBy', { name: h.pushedByName || '—', date: formatDateTime(h.createdAt, language) })}
        {' · '}
        {t(language, 'fund.attempts', { count: h.attemptCount })}
        {h.lastCheckedAt && <> · {t(language, 'fund.lastChecked', { date: formatDateTime(h.lastCheckedAt, language) })}</>}
      </div>
      {h.decisionReason && (
        <div className={h.status === 'REJECTED' ? 'text-red-800' : 'text-emerald-800'}>
          {t(language, 'fund.decisionReason')} <bdi dir="ltr">{h.decisionReason}</bdi>
        </div>
      )}
      {h.status === 'FAILED' && (
        <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 space-y-0.5">
          <div className="font-bold">{errorLabel(new ApiError(h.error || '', 502, { code: h.errorCode || undefined }))}</div>
          {h.error && <bdi dir="ltr" className="block text-[11px] text-red-700">{h.error}</bdi>}
        </div>
      )}
      {docs.length > 0 && (
        <div className="text-slate-500">
          {t(language, 'fund.documentsSent')}{' '}
          <span>{docs.map((d) => (DOC_KEYS.includes(d.type) ? t(language, `fund.doc.${d.type}`) : d.type)).join(', ')}</span>
        </div>
      )}
    </div>
  );
};

export default FundingPanel;
