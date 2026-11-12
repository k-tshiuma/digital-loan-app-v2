import { CanonicalStatus, Language } from '../types';
import { TRANSLATIONS, t } from './translations';
import { DOCUMENT_TYPE_CONFIG, STEP1_VISA_TYPES, VISA_TYPES } from '../config/appConfig';

/**
 * Option groups whose stored values are English words (from config/appConfig.ts).
 * The stored value never changes; only the label shown to the user is translated.
 */
export type OptionGroup =
  | 'country'
  | 'marital'
  | 'salaryMethod'
  | 'loanPurpose'
  | 'repaymentSource'
  | 'relationship'
  | 'visa';

/** Display label for a stored option value, e.g. optionLabel('he', 'marital', 'Single') → 'רווק/ה'. */
/**
 * Older records stored the visa's display label ("B-1 Work Visa (Agriculture / חקלאות)") instead of
 * its code ("b1_agri"). Map such labels back to the code so they are shown translated.
 */
export function canonicalOptionValue(group: OptionGroup, value: string): string {
  if (group === 'visa') {
    const match = VISA_TYPES.find((v) => v.label.toLowerCase() === value.trim().toLowerCase());
    if (match) return match.code;
  }
  return value;
}

export function optionLabel(lang: Language, group: OptionGroup, value: string | undefined | null): string {
  if (!value) return '';
  value = canonicalOptionValue(group, value);
  const key = `opt.${group}.${value}`;
  if (TRANSLATIONS.en[key]) return t(lang, key);
  // Values are not always cased consistently ("Bank transfer" vs "Bank Transfer").
  const prefix = `opt.${group}.`;
  const match = Object.keys(TRANSLATIONS.en).find((k) => k.startsWith(prefix) && k.toLowerCase() === key.toLowerCase());
  return match ? t(lang, match) : value;
}

/**
 * Display label for a Step 1 visa type id: the visa code and its description, e.g. "B/1 – Work Visa".
 * The code is wrapped in a left-to-right isolate so "2(a)(5)" keeps its order in Hebrew (it is also
 * used inside <option>, where <bdi> can't be). Unknown ids are shown as-is; empty gives ''.
 */
export function step1VisaTypeLabel(lang: Language, id: string | undefined | null): string {
  if (!id) return '';
  const visa = STEP1_VISA_TYPES.find((v) => v.id === id);
  if (!visa) return id;
  return `⁦${visa.code}⁩ – ${t(lang, `opt.visaType.${visa.id}`)}`;
}

const STATUS_KEYS: Record<CanonicalStatus, string> = {
  Received: 'statusReceived',
  'Under Review': 'statusUnderReview',
  'Additional Document Required': 'statusAdditionalDoc',
  Approved: 'statusApproved',
  Rejected: 'statusRejected',
  'Forwarded to Funding Entity': 'statusForwarded',
};

/** Display label for an application status. Unknown statuses are shown as-is. */
export function statusLabel(lang: Language, status: string | undefined | null): string {
  if (!status) return '';
  const flowKey = `flowStatus.${status}`;
  if (TRANSLATIONS.en[flowKey]) return t(lang, flowKey);
  const key = STATUS_KEYS[status as CanonicalStatus];
  return key ? t(lang, key) : status;
}

export function flowGroupLabel(lang: Language, group: string | undefined | null): string {
  if (!group) return '';
  const key = `flowGroup.${group}`;
  return TRANSLATIONS.en[key] ? t(lang, key) : group;
}

/** Risk flag codes produced by backend/creditEngine.js (kept in sync by a test). */
export const RISK_FLAG_CODES = [
  'SALARY_RATIO_FAIL',
  'SALARY_RATIO_WARN',
  'DATA_MISSING',
  'VISA_EXPIRY_RISK',
  'TENURE_FAIL',
  'TENURE_WARN',
] as const;

/**
 * Risk flags are stored as "CODE: English text". Show the translated text for known codes,
 * passing the first number in the text (e.g. tenure months) as {months}.
 */
export function riskFlagLabel(lang: Language, flag: string): string {
  const [code, ...rest] = flag.split(':');
  const key = `bo.risk.${code.trim()}`;
  if (!TRANSLATIONS.en[key]) return flag;
  const months = /(\d+)/.exec(rest.join(':'))?.[1] ?? '';
  return t(lang, key, { months });
}

export const riskLevelLabel = (lang: Language, level: string | undefined | null) =>
  level && TRANSLATIONS.en[`bo.riskLevel.${level}`] ? t(lang, `bo.riskLevel.${level}`) : level || '';

export const roleLabel = (lang: Language, role: string) =>
  TRANSLATIONS.en[`role.${role}`] ? t(lang, `role.${role}`) : role;

export const qualityLabel = (lang: Language, quality: string | undefined | null) =>
  quality && TRANSLATIONS.en[`bo.quality.${quality}`] ? t(lang, `bo.quality.${quality}`) : quality || '';

/** Display name for a document type code (PASSPORT, PAY_SLIP, ...). */
export function docTypeLabel(lang: Language, code: string | undefined | null): string {
  if (!code) return '';
  const titleKey = DOCUMENT_TYPE_CONFIG.find((d) => d.code === code)?.titleKey;
  if (titleKey && TRANSLATIONS.en[titleKey]) return t(lang, titleKey);
  return TRANSLATIONS.en[`doc.${code}`] ? t(lang, `doc.${code}`) : code;
}

/**
 * Reasons the app itself writes into the status history (the backend writes the same English
 * text in server.js). They stay stored in English and are shown translated. Any other reason
 * was typed by staff and is shown as typed.
 */
export const DEFAULT_STATUS_REASONS = {
  approved: 'Loan criteria satisfied and credit risk approved.',
  docRequested: 'Additional documentation requested.',
  rejected: 'Underwriting criteria not met.',
  submitted: 'Application submitted with signed consents and uploaded documentation.',
  docUploaded: 'Borrower uploaded the requested document.',
} as const;

const STATUS_UPDATED_TO = /^Status updated to (.+)$/;
const DOC_UPLOADED_FILE = /^Borrower uploaded additional document: (.+)$/;

/** Display text for a status-history reason: system defaults are translated, staff notes stay as typed. */
export function statusReasonLabel(lang: Language, reason: string | undefined | null): string {
  if (!reason) return '';
  const text = reason.trim();
  for (const [code, english] of Object.entries(DEFAULT_STATUS_REASONS)) {
    if (text === english) return t(lang, `reason.${code}`);
  }
  let m = STATUS_UPDATED_TO.exec(text);
  if (m) return t(lang, 'reason.statusUpdatedTo', { status: statusLabel(lang, m[1]) });
  m = DOC_UPLOADED_FILE.exec(text);
  if (m) return t(lang, 'reason.docUploadedFile', { file: m[1] });
  return reason;
}
