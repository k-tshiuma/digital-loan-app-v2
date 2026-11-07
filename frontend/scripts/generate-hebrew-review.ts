/**
 * Regenerates docs/hebrew-review.csv, the native-speaker review sheet: every Hebrew string next to
 * its English source, legal texts first, then borrower SMS/email, PDF labels and the rest of the app.
 *
 * Run from frontend/:  npx tsx scripts/generate-hebrew-review.ts
 *
 * The "suggested hebrew" and "reviewer notes" columns are carried over from the existing file
 * (matched by where + key), so regenerating never loses review work. Rows whose English or Hebrew
 * changed keep their notes too; check those by hand. Saved as UTF-8 with a BOM so Excel shows Hebrew.
 */
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BASE_TRANSLATIONS } from '../src/i18n/translations';
import { MESSAGE_MODULES } from '../src/i18n/messages';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(root, 'docs/hebrew-review.csv');
const backend = (p: string) => path.join(root, 'backend', p);
const require = createRequire(import.meta.url);
const BOM = String.fromCharCode(0xfeff);
const BOM_RE = new RegExp(`^${BOM}`);

// terms.js requires dbHelpers, which opens the SQLite database. The texts don't need it.
const realLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, ...rest: any[]) {
  if (request === './dbHelpers') return {};
  return realLoad.call(this, request, parent, ...rest);
};
const messages = require(backend('services/messages.js'));
const flowMessages = require(backend('services/flowMessages.js'));
const pdfLabels = require(backend('services/pdfLabels.js'));
const terms = require(backend('services/terms.js'));
(Module as any)._load = realLoad;

/** Legal and consent texts, reviewed first. Keys of the frontend dictionary. */
const LEGAL_KEYS = [
  'termsNotice', 'estimateDisclaimer', 'termsAndConditionsConsent', 'creditCheckConsent', 'consentTermsText',
  'consentCreditCheckText', 'digitalSignatureTitle', 'digitalSignatureSubtitle', 'digitalSignatureLabel',
  'auth.reviewDisclaimer', 'auth.disclaimerText', 'auth.agreeDisclaimer', 'termsAndConditionsTitle',
  'consentRequiredError', 'review.legalConsents', 'review.termsIntro', 'review.term1', 'review.term2',
  'review.term3', 'review.term4', 'review.term5', 'review.term6', 'review.term7',
  // 3-step workflow, Step 3 agreements
  'step3.mandatoryAgreementsTitle', 'step3.termsCheckbox', 'step3.serviceFeeCheckbox',
  'step3.err.termsRequired', 'step3.err.serviceFeeRequired',
];

type Row = { priority: string; where: string; key: string; english: string; hebrew: string };
const rows: Row[] = [];
const add = (priority: string, where: string, en: Record<string, any>, he: Record<string, any>, keys = Object.keys(en)) => {
  for (const key of keys) {
    if (typeof en[key] !== 'string') continue;
    rows.push({ priority, where, key, english: en[key], hebrew: typeof he?.[key] === 'string' ? he[key] : '' });
  }
};

const appEn: Record<string, string> = Object.assign({}, BASE_TRANSLATIONS.en, ...Object.values(MESSAGE_MODULES).map((m) => m.en));
const appHe: Record<string, string> = Object.assign({}, BASE_TRANSLATIONS.he, ...Object.values(MESSAGE_MODULES).map((m) => m.he));

// 1. Legal
add('1 legal', 'app', appEn, appHe, LEGAL_KEYS.filter((k) => k in appEn));
for (const t of terms.SEED_TERMS) {
  rows.push({ priority: '1 legal', where: 'backend terms', key: `${t.type} v${t.version}`, english: t.textEn, hebrew: t.textHe });
}

// 2. Borrower SMS, email and in-app messages
add('2 sms', 'backend status SMS', messages.STATUS_MESSAGES.en, messages.STATUS_MESSAGES.he);
add('2 sms', 'backend messages', messages.MESSAGES.en, messages.MESSAGES.he);
add('2 sms', 'status names', messages.STATUS_NAMES.en, messages.STATUS_NAMES.he);
// Raw templates, so the reviewer sees the {ref}/{note}/{status} placeholders.
const flowEn = flowMessages.FLOW_TEXTS.en;
const flowHe = flowMessages.FLOW_TEXTS.he;
for (const key of Object.keys(flowEn)) {
  const en = flowEn[key];
  const he = flowHe[key];
  if (typeof en === 'string') {
    rows.push({ priority: '2 sms', where: 'backend workflow messages', key, english: en, hebrew: typeof he === 'string' ? he : '' });
    continue;
  }
  for (const field of ['title', 'body', 'sms']) {
    if (typeof en?.[field] !== 'string') continue;
    rows.push({ priority: '2 sms', where: 'backend workflow messages', key: `${key}.${field}`, english: en[field], hebrew: he?.[field] || '' });
  }
}
add('2 sms', 'workflow status names', flowMessages.FLOW_STATUS_NAMES.en, flowMessages.FLOW_STATUS_NAMES.he);

// 3. PDF labels (VALUES share the frontend wording and appear under "app")
add('3 pdf', 'PDF labels', pdfLabels.FIELDS.en, pdfLabels.FIELDS.he);

// 4. Everything else in the app
const legal = new Set(LEGAL_KEYS);
add('4 app', 'app', appEn, appHe, Object.keys(appEn).filter((k) => !legal.has(k)));

// Carry over review columns from the existing sheet.
const csvParse = (text: string): string[][] => {
  const result: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); result.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); result.push(row); }
  return result;
};

const previous = new Map<string, { suggested: string; notes: string }>();
if (fs.existsSync(out)) {
  const [header, ...data] = csvParse(fs.readFileSync(out, 'utf8').replace(BOM_RE, ''));
  const col = (name: string) => header.indexOf(name);
  for (const r of data) {
    const suggested = r[col('suggested hebrew')] || '';
    const notes = r[col('reviewer notes')] || '';
    if (suggested || notes) previous.set(`${r[col('where')]}\u0000${r[col('key')]}`, { suggested, notes });
  }
}

const quote = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const lines = [['priority', 'where', 'key', 'english', 'hebrew', 'suggested hebrew', 'reviewer notes'].map(quote).join(',')];
let carried = 0;
for (const r of rows) {
  const prev = previous.get(`${r.where}\u0000${r.key}`);
  if (prev) carried++;
  lines.push([r.priority, r.where, r.key, r.english, r.hebrew, prev?.suggested || '', prev?.notes || ''].map(quote).join(','));
}
fs.writeFileSync(out, BOM + lines.join('\n') + '\n', 'utf8');

const missing = rows.filter((r) => !r.hebrew).length;
console.log(`Wrote ${rows.length} rows to ${path.relative(root, out)} (${carried} with carried-over review notes, ${missing} without Hebrew).`);
if (carried < previous.size) console.warn(`Warning: ${previous.size - carried} rows with review notes no longer match a key.`);
