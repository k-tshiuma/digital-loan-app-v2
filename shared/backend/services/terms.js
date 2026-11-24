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
    // 2.0: adds the transfer of the application to the funding partner (a licensed bank or lender) once the
    // loan is approved: what is sent, why, how, and the sponsors' agreement. A loan is pushed to the partner
    // only with an acceptance of a version marked partnerSharing (services/funding/consent.js).
    type: 'general',
    version: '2.0',
    effectiveFrom: '2026-11-24T00:00:00.000Z',
    partnerSharing: true,
    textEn: [
      'By submitting this application, you declare that all provided information is accurate and truthful.',
      'You authorize the funding entity to perform background and credit history checks.',
      'You agree to the proposed repayment schedule, which includes processing fees and interest rates as specified in the estimate.',
      'In the event of default, you agree that your employer may be contacted, and late fees may be applied.',
      'Your digital acceptance carries the same legal weight as a physical signature under applicable laws.',
      'All documents uploaded are certified as true copies of the originals.',
      'You understand that this application is subject to final approval by the credit committee.',
      'Once your loan is approved, QuickLoan will transfer your application to a licensed bank or lending institution (the "funding partner") that grants and funds the loan. The transfer includes your personal details, your passport and visa details, your employment and salary details, your bank account details, the details of your sponsors, copies of the documents you uploaded (passport, visa, payslip, your sponsors\' ID or passport copies and your bank document) and the loan terms.',
      'The funding partner uses this information to verify your identity, to run its own compliance checks (identity, anti-money-laundering and credit checks) and to grant, manage and collect the loan. As a result of these checks, the funding partner may decline to fund the loan.',
      'You confirm that each of your sponsors has agreed that their details and the copy of their ID or passport may be transferred to the funding partner for the same purposes.',
      'The information is sent only over encrypted and authenticated connections. QuickLoan keeps your information for as long as the law requires, including under the Prohibition on Money Laundering Law. The funding partner keeps the information it receives under its own privacy policy and legal obligations.',
      'Under the Protection of Privacy Law you may ask QuickLoan to see or correct your information. If you withdraw this consent before the transfer, the transfer will not take place, and the loan cannot then be funded.',
    ].map((t, i) => `${i + 1}. ${t}`).join('\n'),
    textHe: [
      'בהגשת בקשה זו, הנך מצהיר/ה שכל המידע שנמסר מדויק ואמיתי.',
      'הנך מתיר/ה לגוף המממן לבצע בדיקות רקע והיסטוריית אשראי.',
      'הנך מסכים/ה ללוח ההחזרים המוצע, הכולל עמלות טיפול ושיעורי ריבית כמפורט בהערכה.',
      'במקרה של אי-תשלום, הנך מסכים/ה שניתן יהיה לפנות למעסיק שלך ושיחולו דמי פיגורים.',
      'לאישורך הדיגיטלי אותו תוקף משפטי כמו לחתימה פיזית, בהתאם לדין החל.',
      'כל המסמכים שהועלו מאושרים כהעתקים נאמנים למקור.',
      'ידוע לך שבקשה זו כפופה לאישור סופי של ועדת האשראי.',
      'לאחר אישור ההלוואה, QuickLoan תעביר את בקשתך לבנק או לגוף הלוואות מורשה ("הגוף המממן") המעניק ומממן את ההלוואה. ההעברה כוללת את פרטיך האישיים, פרטי הדרכון והוויזה, פרטי התעסוקה והשכר, פרטי חשבון הבנק, פרטי הערבים, העתקי המסמכים שהעלית (דרכון, ויזה, תלוש שכר, העתקי תעודת הזהות או הדרכון של הערבים ומסמך הבנק) ואת תנאי ההלוואה.',
      'הגוף המממן משתמש במידע זה כדי לאמת את זהותך, לבצע בדיקות ציות משלו (בדיקות זהות, איסור הלבנת הון ואשראי) וכדי להעניק, לנהל ולגבות את ההלוואה. בעקבות בדיקות אלה, הגוף המממן רשאי לסרב לממן את ההלוואה.',
      'הנך מאשר/ת שכל אחד מהערבים שלך הסכים שפרטיו והעתק תעודת הזהות או הדרכון שלו יועברו לגוף המממן לאותן מטרות.',
      'המידע נשלח רק בחיבורים מוצפנים ומאומתים. QuickLoan שומרת את המידע שלך כל עוד הדין מחייב זאת, לרבות לפי חוק איסור הלבנת הון. הגוף המממן שומר את המידע שהוא מקבל בהתאם למדיניות הפרטיות שלו ולחובותיו לפי דין.',
      'לפי חוק הגנת הפרטיות, באפשרותך לבקש מ-QuickLoan לעיין במידע שלך או לתקנו. אם תחזור/י בך מהסכמה זו לפני ההעברה, ההעברה לא תתבצע, ולא ניתן יהיה לממן את ההלוואה.',
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
  {
    // 2.0: the fee became a flat 3,000 NIS for every loan amount (was tiered by amount).
    type: 'service_fee',
    version: '2.0',
    effectiveFrom: '2026-11-16T00:00:00.000Z',
    textEn: [
      'The service fee is a one-time, flat fee of 3,000 NIS, the same for every loan amount. It is separate from the loan principal and the loan interest.',
      'The service fee is paid in equal monthly instalments together with the loan repayment, over the same repayment period.',
      'The exact service fee, the monthly service fee and the loan repayment amounts are shown to you before you submit, and are recorded with your application.',
      'The service fee remunerates QuickLoan for its intermediary services and does not guarantee that a loan will be granted.',
    ].map((t, i) => `${i + 1}. ${t}`).join('\n'),
    textHe: [
      'עמלת השירות היא עמלה חד-פעמית קבועה בסך 3,000 ש"ח, זהה לכל סכום הלוואה. היא נפרדת מקרן ההלוואה ומריבית ההלוואה.',
      'עמלת השירות משולמת בתשלומים חודשיים שווים יחד עם החזר ההלוואה, לאורך אותה תקופת החזר.',
      'עמלת השירות המדויקת, עמלת השירות החודשית וסכומי החזר ההלוואה מוצגים לך לפני ההגשה ונשמרים יחד עם בקשתך.',
      'עמלת השירות מהווה תמורה עבור שירותי התיווך של QuickLoan ואינה מבטיחה שההלוואה תאושר.',
    ].map((t, i) => `${i + 1}. ${t}`).join('\n'),
  },
  {
    // 3.0: the fee amount is set in the Back Office configuration, so the text no longer names a number.
    // An application takes the configured fee at Step 2 and keeps it (services/serviceFee.js).
    type: 'service_fee',
    version: '3.0',
    effectiveFrom: '2026-11-17T00:00:00.000Z',
    textEn: [
      'The service fee is a one-time, flat fee, the same for every loan amount. Its amount is shown to you in Step 2 and is fixed for your application from the moment you submit Step 2. It is separate from the loan principal and the loan interest.',
      'The service fee is paid in equal monthly instalments together with the loan repayment, over the same repayment period.',
      'The exact service fee, the monthly service fee and the loan repayment amounts are shown to you before you submit, and are recorded with your application.',
      'The service fee remunerates QuickLoan for its intermediary services and does not guarantee that a loan will be granted.',
    ].map((t, i) => `${i + 1}. ${t}`).join('\n'),
    textHe: [
      'עמלת השירות היא עמלה חד-פעמית קבועה, זהה לכל סכום הלוואה. סכומה מוצג לך בשלב 2, והוא נקבע לבקשתך מרגע הגשת שלב 2. היא נפרדת מקרן ההלוואה ומריבית ההלוואה.',
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

/** General terms versions whose wording covers sending the application to the funding partner. */
const PARTNER_SHARING_VERSIONS = SEED_TERMS.filter((t) => t.type === 'general' && t.partnerSharing).map((t) => t.version);
const coversPartnerSharing = (version) => PARTNER_SHARING_VERSIONS.includes(String(version || ''));

module.exports = {
  TERMS_TYPES, SEED_TERMS, PARTNER_SHARING_VERSIONS, coversPartnerSharing, seedTerms, ensureSeeded, getCurrentTerms, getAllCurrentTerms,
};
