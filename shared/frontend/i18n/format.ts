import { Language } from '../types';

// Locale per app language. English uses en-IL: Israeli date order (21/10/2026) with ₪.
const LOCALES: Record<Language, string> = {
  en: 'en-IL',
  he: 'he-IL',
  th: 'th-TH',
  zh: 'zh-CN',
  tl: 'en-PH',
  ar: 'ar-IL',
  fr: 'fr-FR',
  es: 'es-ES',
};
const TIME_ZONE = 'Asia/Jerusalem';
const EMPTY = '—';

export const localeFor = (lang: Language): string => LOCALES[lang] ?? 'en-IL';

type NumberInput = number | string | null | undefined;
type DateInput = Date | string | number | null | undefined;

function toNumber(value: NumberInput): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Amount in shekels: "₪5,000" in English, "5,000 ₪" in Hebrew. Whole amounts have no decimals, others have 2. */
export function formatCurrency(value: NumberInput, lang: Language): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  return new Intl.NumberFormat(localeFor(lang), {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(value: NumberInput, lang: Language, maximumFractionDigits = 2): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  return new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits }).format(n);
}

/** Date-only strings ("2026-10-21") are calendar dates: format them as-is, not shifted by time zone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: DateInput): { date: Date; dateOnly: boolean } | null {
  if (value === null || value === undefined || value === '') return null;
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  const date = value instanceof Date ? value : new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly };
}

/** Short date: 21/10/2026 (en), 21.10.2026 (he). */
export function formatDate(value: DateInput, lang: Language): string {
  const d = toDate(value);
  if (!d) return typeof value === 'string' && value ? value : EMPTY;
  return new Intl.DateTimeFormat(localeFor(lang), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: d.dateOnly ? 'UTC' : TIME_ZONE,
  }).format(d.date);
}

/** 24-hour time in Israel: 17:05. */
export function formatTime(value: DateInput, lang: Language): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return new Intl.DateTimeFormat(localeFor(lang), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(d.date);
}

/** Date and time: "21/10/2026, 17:05". */
export function formatDateTime(value: DateInput, lang: Language): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return `${formatDate(d.date, lang)}, ${formatTime(d.date, lang)}`;
}
