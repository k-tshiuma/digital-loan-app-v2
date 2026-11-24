/**
 * The applicant's consent to sending their application to the funding partner. It is given by accepting a
 * General T&C version marked `partnerSharing` (services/terms.js, version 2.0 on): in Step 3 for new
 * applications, or afterwards through POST /api/flow/application/partner-consent for applications that
 * accepted an older version. Without it the Back Office cannot push the loan.
 */
const { dbGet, dbAll, dbRun } = require('../dbHelpers');
const { getCurrentTerms, coversPartnerSharing } = require('../terms');
const W = require('../workflow');

/** Statuses in which a missing consent can be given (Step 3 submitted, or the loan approved and not repaid). */
const CONSENT_STATUSES = [W.FLOW_STATUS.PENDING_FINAL_PROCESSING, W.FLOW_STATUS.LOAN_APPROVED];

/** The newest acceptance of this application that covers the transfer, or null. */
async function partnerConsentAcceptance(applicationId) {
  const rows = await dbAll("SELECT * FROM terms_acceptances WHERE applicationId = ? AND termsType = 'general' ORDER BY acceptedAt DESC", [applicationId]);
  return rows.find((r) => coversPartnerSharing(r.version)) || null;
}

/**
 * For the applicant view: whether the app should ask for the consent now, and the terms to show.
 * Returns null when nothing is needed.
 */
async function partnerConsentPrompt(a) {
  if (!CONSENT_STATUSES.includes(a.flowStatus) || a.loanRepaidAt) return null;
  if (await partnerConsentAcceptance(a.id)) return null;
  const terms = await getCurrentTerms('general');
  if (!terms || !coversPartnerSharing(terms.version)) return null;
  return { required: true, terms: { type: 'general', version: terms.version, sha256: terms.sha256, textEn: terms.textEn, textHe: terms.textHe, effectiveFrom: terms.effectiveFrom } };
}

/**
 * Records the consent. Returns { ok: true, acceptance, created } or { ok: false, status, code, error }.
 * Accepting twice (double click, two tabs) stores one row: the id is fixed per application and version.
 */
async function acceptPartnerConsent(a, user, { version, language, ip, userAgent }) {
  if (!CONSENT_STATUSES.includes(a.flowStatus) || a.loanRepaidAt) {
    return { ok: false, status: 409, code: 'CONSENT_NOT_NEEDED', error: 'There is no approved loan waiting for this consent.' };
  }
  const terms = await getCurrentTerms('general');
  if (!terms || !coversPartnerSharing(terms.version) || String(version || '') !== terms.version) {
    return { ok: false, status: 409, code: 'TERMS_VERSION_CHANGED', error: 'The terms have been updated. Please review and accept the current version.', terms };
  }
  const id = `${a.id}:terms:general:partner-${terms.version}`;
  const r = await dbRun(
    `INSERT OR IGNORE INTO terms_acceptances (id, applicationId, userId, termsType, version, textSha256, language, acceptedAt, ipAddress, userAgent)
     VALUES (?, ?, ?, 'general', ?, ?, ?, ?, ?, ?)`,
    [id, a.id, user.id, terms.version, terms.sha256, language === 'he' ? 'he' : 'en', new Date().toISOString(), ip || null, String(userAgent || '').slice(0, 250)]
  );
  const acceptance = await dbGet('SELECT * FROM terms_acceptances WHERE id = ?', [id]);
  return { ok: true, acceptance, created: r.changes === 1 };
}

module.exports = { CONSENT_STATUSES, partnerConsentAcceptance, partnerConsentPrompt, acceptPartnerConsent };
