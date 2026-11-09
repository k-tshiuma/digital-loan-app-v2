/**
 * Versioned terms texts for Step 3: the General Terms & Conditions and the Service Fee Terms.
 * Version 1.0 of the general terms reuses the wording the app already showed (review.term1-7).
 * To publish new wording, add a new version here (or insert into terms_versions) with a later
 * effectiveFrom: applicants are always shown the latest version, and every acceptance records the
 * version and the SHA-256 of the text they were shown.
 */
const { dbGet, dbAll, dbRun, sha256 } = require('./dbHelpers');

const TERMS_TYPES = ['general', 'service_fee'];

const SEED_TERMS = [
  {
    type: 'general',
    version: '1.0',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    textEn: [
      'By submitting this application, you declare that all provided information is accurate and truthful.',
      'You authorize the funding entity to perform background and credit history checks.',
      'You agree to the proposed repayment schedule, which includes processing fees and interest rates as specified in the estimate.',
      'In the event of default, you agree that your employer may be contacted, and late fees may be applied.',
      'Your digital acceptance carries the same legal weight as a physical signature under applicable laws.',
      'All documents uploaded are certified as true copies of the originals.',
      'You understand that this application is subject to final approval by the credit committee.',
    ].map((t, i) => `${i + 1}. ${t}`).join('\n'),
    textHe: [
      'בהגשת בקשה זו, הנך מצהיר/ה שכל המידע שנמסר מדויק ואמיתי.',
      'הנך מתיר/ה לגוף המממן לבצע בדיקות רקע והיסטוריית אשראי.',
      'הנך מסכים/ה ללוח ההחזרים המוצע, הכולל עמלות טיפול ושיעורי ריבית כמפורט בהערכה.',
      'במקרה של אי-תשלום, הנך מסכים/ה שניתן יהיה לפנות למעסיק שלך ושיחולו דמי פיגורים.',
      'לאישורך הדיגיטלי אותו תוקף משפטי כמו לחתימה פיזית, בהתאם לדין החל.',
      'כל המסמכים שהועלו מאושרים כהעתקים נאמנים למקור.',
      'ידוע לך שבקשה זו כפופה לאישור סופי של ועדת האשראי.',
    ].map((t, i) => `${i + 1}. ${t}`).join('\n'),
  },
  {
    type: 'service_fee',
    version: '1.0',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    textEn: [
      'The service fee is a one-time, tiered fee set by the requested loan amount. It is separate from the loan principal and the loan interest.',
      'The service fee is paid in equal monthly instalments together with the loan repayment, over the same repayment period.',
      'The exact service fee, the monthly service fee and the loan repayment amounts are shown to you before you submit, and are recorded with your application.',
      'The service fee remunerates QuickLoan for its intermediary services and does not guarantee that a loan will be granted.',
    ].map((t, i) => `${i + 1}. ${t}`).join('\n'),
    textHe: [
      'עמלת השירות היא עמלה חד-פעמית מדורגת, הנקבעת לפי סכום ההלוואה המבוקש. היא נפרדת מקרן ההלוואה ומריבית ההלוואה.',
      'עמלת השירות משולמת בתשלומים חודשיים שווים יחד עם החזר ההלוואה, לאורך אותה תקופת החזר.',
      'עמלת השירות המדויקת, עמלת השירות החודשית וסכומי החזר ההלוואה מוצגים לך לפני ההגשה ונשמרים יחד עם בקשתך.',
      'עמלת השירות מהווה תמורה עבור שירותי התיווך של QuickLoan ואינה מבטיחה שההלוואה תאושר.',
    ].map((t, i) => `${i + 1}. ${t}`).join('\n'),
  },
];

/** Insert the seed versions that are not stored yet. Safe to call on every start. */
async function seedTerms() {
  for (const t of SEED_TERMS) {
    const existing = await dbGet('SELECT version FROM terms_versions WHERE type = ? AND version = ?', [t.type, t.version]);
    if (!existing) {
      await dbRun(
        'INSERT INTO terms_versions (type, version, textEn, textHe, sha256, effectiveFrom) VALUES (?, ?, ?, ?, ?, ?)',
        [t.type, t.version, t.textEn, t.textHe, sha256(`${t.textEn}\n---\n${t.textHe}`), t.effectiveFrom]
      );
    }
  }
}

/** Latest version (by effectiveFrom) of one terms type that is already in effect. */
let seeded = null;
function ensureSeeded() {
  // Only the schema owner seeds (DB_INIT=false elsewhere), so two processes never insert the same version.
  if (process.env.DB_INIT === 'false') return Promise.resolve();
  if (!seeded) seeded = seedTerms().catch((err) => { seeded = null; throw err; });
  return seeded;
}

async function getCurrentTerms(type) {
  await ensureSeeded();
  const rows = await dbAll('SELECT * FROM terms_versions WHERE type = ? ORDER BY effectiveFrom DESC, version DESC', [type]);
  const now = new Date().toISOString();
  return rows.find((r) => r.effectiveFrom <= now) || rows[0] || null;
}

async function getAllCurrentTerms() {
  const out = {};
  for (const type of TERMS_TYPES) out[type] = await getCurrentTerms(type);
  return out;
}

module.exports = { TERMS_TYPES, SEED_TERMS, seedTerms, ensureSeeded, getCurrentTerms, getAllCurrentTerms };
