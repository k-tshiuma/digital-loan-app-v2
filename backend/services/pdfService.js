const path = require('path');
const PDFDocument = require('pdfkit');
const { FIELDS, VALUES, DOC_TITLE_KEYS, LEGACY_VALUES } = require('./pdfLabels');
const { statusName, resolveMessageLanguage } = require('./messages');
const { HEBREW, ltr, stripBidiControls, drawParagraph, wrapLines } = require('./pdfRtl');

const BRAND = '#1e3a8a';
const MUTED = '#64748b';
const INK = '#0f172a';
const TIME_ZONE = 'Asia/Jerusalem';
const EMPTY = '—';

// Heebo (SIL Open Font License, see assets/fonts/Heebo-OFL.txt) covers Hebrew, Latin and digits.
// English PDFs use Helvetica and switch to Heebo only for values that contain Hebrew.
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const HEEBO = path.join(FONT_DIR, 'Heebo-Regular.ttf');
const HEEBO_BOLD = path.join(FONT_DIR, 'Heebo-Bold.ttf');

const MARGIN = 50;
const LABEL_WIDTH = 170;
const VALUE_OFFSET = 175; // value column starts this far from the margin

/** PDF language: the requested one, else the application's; anything but en/he falls back to English. */
function resolvePdfLanguage(requested, applicationLanguage) {
  return resolveMessageLanguage(requested, applicationLanguage);
}

// ---------------------------------------------------------------------------
// Labels and formatting
// ---------------------------------------------------------------------------

function fill(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
}

function makeLabels(lang) {
  const field = (key, params) => fill(FIELDS[lang][key] || FIELDS.en[key] || key, params);
  const value = (key, params) => fill(VALUES[lang][key] || VALUES.en[key] || key, params);

  /** Stored dropdown value → label (keys are matched case-insensitively, like the frontend). */
  const option = (group, stored) => {
    if (stored === undefined || stored === null || stored === '') return '';
    // Older records stored the display label instead of the code.
    const legacy = Object.entries(LEGACY_VALUES[group] || {}).find(([label]) => label.toLowerCase() === String(stored).trim().toLowerCase());
    if (legacy) stored = legacy[1];
    const exact = `opt.${group}.${stored}`;
    const key = VALUES.en[exact] ? exact : Object.keys(VALUES.en).find((k) => k.toLowerCase() === exact.toLowerCase());
    return key ? value(key) : String(stored);
  };

  const docType = (code) => {
    const key = DOC_TITLE_KEYS[code] || (VALUES.en[`doc.${code}`] ? `doc.${code}` : null);
    return key ? value(key) : String(code || '');
  };

  const quality = (q) => (q && VALUES.en[`bo.quality.${q}`] ? value(`bo.quality.${q}`) : q || field('notAvailable'));
  const riskLevel = (level) => (level && VALUES.en[`bo.riskLevel.${level}`] ? value(`bo.riskLevel.${level}`) : level || '');

  /** "TENURE_WARN: Job tenure under 6 months" → translated text with the number kept. */
  const riskFlag = (flag) => {
    const [code, ...rest] = String(flag).split(':');
    const key = `bo.risk.${code.trim()}`;
    if (!VALUES.en[key]) return String(flag);
    const months = (/(\d+)/.exec(rest.join(':')) || [])[1] || '';
    return value(key, { months });
  };

  /** System-written status reasons are translated; staff notes are shown as typed. */
  const reason = (text) => {
    if (!text) return '';
    const trimmed = String(text).trim();
    const fixed = Object.keys(VALUES.en).find((k) => k.startsWith('reason.') && !k.includes('{') && VALUES.en[k] === trimmed);
    if (fixed) return value(fixed);
    let m = /^Status updated to (.+)$/.exec(trimmed);
    if (m) return value('reason.statusUpdatedTo', { status: statusName(lang, m[1]) });
    m = /^Borrower uploaded additional document: (.+)$/.exec(trimmed);
    if (m) return value('reason.docUploadedFile', { file: m[1] });
    return String(text);
  };

  return { field, option, docType, quality, riskLevel, riskFlag, reason, status: (s) => statusName(lang, s) };
}

const LOCALES = { en: 'en-IL', he: 'he-IL' };
const stripMarks = (s) => s.replace(/[‎‏؜]/g, '');

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : { d, dateOnly };
}

/** 21.10.2026 (he), 21/10/2026 (en). Date-only values are not shifted by time zone. */
function formatDate(value, lang) {
  const parsed = toDate(value);
  if (!parsed) return value ? String(value) : EMPTY;
  return stripMarks(new Intl.DateTimeFormat(LOCALES[lang], {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: parsed.dateOnly ? 'UTC' : TIME_ZONE,
  }).format(parsed.d));
}

/** Date and 24-hour time in Israel: "21.10.2026, 17:05". */
function formatDateTime(value, lang) {
  const parsed = toDate(value);
  if (!parsed) return EMPTY;
  const time = new Intl.DateTimeFormat(LOCALES[lang], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TIME_ZONE })
    .format(parsed.d);
  return `${formatDate(parsed.d, lang)}, ${stripMarks(time)}`;
}

/** "12,500 ₪" in Hebrew. English keeps "NIS 12,500" because Helvetica has no ₪ glyph. */
function formatMoney(value, lang) {
  if (value === undefined || value === null || value === '') return EMPTY;
  const n = Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  const digits = Number.isInteger(n) ? 0 : 2;
  const amount = new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(n);
  return lang === 'he' ? `${amount} ₪` : `NIS ${amount}`;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Drawing helpers bound to one document. In Hebrew every x position is mirrored, so labels sit
 * on the right and values on the left, and all text goes through the bidi helper.
 */
function makeCanvas(doc, lang) {
  const rtl = lang === 'he';
  const pageWidth = doc.page.width;
  let heeboRegistered = false;

  const useHeebo = (text) => rtl || HEBREW.test(text);
  const setFont = (text, { bold = false, size = 10, color = INK } = {}) => {
    if (useHeebo(text)) {
      if (!heeboRegistered) {
        doc.registerFont('he', HEEBO);
        doc.registerFont('he-bold', HEEBO_BOLD);
        heeboRegistered = true;
      }
      doc.font(bold ? 'he-bold' : 'he');
    } else {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    }
    doc.fontSize(size).fillColor(color);
  };

  /** x of a box that starts `pos` from the left in English (mirrored in Hebrew). */
  const X = (pos, width) => (rtl ? pageWidth - pos - width : pos);

  /** Height a text block will take, without drawing it. */
  const measure = (text, width, style) => {
    const s = text === undefined || text === null || text === '' ? EMPTY : String(text);
    setFont(s, style);
    if (!useHeebo(s)) return doc.heightOfString(stripBidiControls(s), { width });
    return wrapLines(s, width, (t) => doc.widthOfString(t)).length * doc.currentLineHeight(true);
  };

  /**
   * Draw text in a box. `align` is 'start' or 'end' (logical), or a physical 'left'/'right'/'center'.
   * Returns the y below the text.
   */
  const put = (text, x, y, width, style = {}) => {
    const s = text === undefined || text === null || text === '' ? EMPTY : String(text);
    setFont(s, style);
    const logical = style.align || 'start';
    const align = logical === 'start' ? (rtl ? 'right' : 'left') : logical === 'end' ? (rtl ? 'left' : 'right') : logical;
    let bottom;
    if (useHeebo(s)) {
      // Hebrew document: right-to-left paragraphs. English document with a Hebrew value: direction from the text.
      bottom = drawParagraph(doc, s, x, y, width, { dir: rtl ? 'rtl' : 'auto', align });
    } else {
      doc.text(stripBidiControls(s), x, y, { width, align });
      bottom = doc.y;
    }
    doc.y = bottom;
    return bottom;
  };

  return { rtl, pageWidth, X, put, measure, setFont };
}

/**
 * Stream a formatted PDF summary of a loan application to an HTTP response.
 * @param {Object} app              Parsed application object
 * @param {import('express').Response} res
 * @param {{ includeRisk?: boolean, maskBankAccount?: boolean, lang?: string }} options
 *   includeRisk: risk data is only shown to staff. maskBankAccount: show only the last 4 digits of the
 *   account number (staff copies). lang: 'en' or 'he' (see resolvePdfLanguage).
 */
/** Keeps only the last 4 digits, e.g. ****5678. */
function maskAccountNumber(value) {
  if (!value) return value;
  const s = String(value);
  return s.length <= 4 ? '****' : `****${s.slice(-4)}`;
}

function streamApplicationPdf(app, res, options = {}) {
  const lang = resolvePdfLanguage(options.lang, app.language);
  const L = makeLabels(lang);
  const ref = app.requestNumber || app.id;

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    lang: lang === 'he' ? 'he-IL' : 'en-US',
    info: { Title: `${L.field('title')} ${ref}` },
  });
  // Keep the download name ASCII so it works in every browser.
  const filename = `${String(ref).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;

  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Language', lang);
  }
  doc.pipe(res);

  const c = makeCanvas(doc, lang);
  const W = c.pageWidth;
  const contentWidth = W - 2 * MARGIN;
  const valueWidth = contentWidth - VALUE_OFFSET;
  const bottomLimit = () => doc.page.height - MARGIN;

  // Header band
  doc.rect(0, 0, W, 80).fill(BRAND);
  c.put(L.field('brand'), c.X(MARGIN, 300), 22, 300, { bold: true, size: 20, color: '#ffffff' });
  c.put(L.field('title'), c.X(MARGIN, 300), 50, 300, { size: 10, color: '#ffffff' });
  c.put(L.field('generated', { date: formatDateTime(new Date(), lang) }), c.X(W - MARGIN - 220, 220), 50, 220,
    { size: 10, color: '#ffffff', align: 'end' });

  c.put(ref, c.X(MARGIN, contentWidth), 100, contentWidth, { bold: true, size: 16 });
  const appLang = app.language === 'he' || app.language === 'en' ? L.field(`lang.${app.language}`) : String(app.language || 'en').toUpperCase();
  const meta = [
    `${L.field('status')}: ${L.status(app.status) || EMPTY}`,
    `${L.field('submitted')}: ${formatDate(app.submittedAt, lang)}`,
    `${L.field('language')}: ${appLang}`,
  ].join('  ·  ');
  c.put(meta, c.X(MARGIN, contentWidth), doc.y + 2, contentWidth, { size: 11, color: MUTED });
  doc.y += 8;

  const ensureSpace = (height) => {
    if (doc.y + height > bottomLimit()) {
      doc.addPage();
      doc.y = MARGIN;
    }
  };

  const section = (title) => {
    if (doc.y > doc.page.height - 140) {
      doc.addPage();
      doc.y = MARGIN;
    }
    doc.y += 10;
    const bottom = c.put(c.rtl ? title : title.toUpperCase(), c.X(MARGIN, contentWidth), doc.y, contentWidth,
      { bold: true, size: 12, color: BRAND });
    const y = bottom + 2;
    doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).strokeColor('#cbd5e1').lineWidth(0.7).stroke();
    doc.y = y + 7;
  };

  const row = (label, value) => {
    const text = value === undefined || value === null || value === '' ? EMPTY : String(value);
    const height = Math.max(
      c.measure(label, LABEL_WIDTH, { size: 10 }),
      c.measure(text, valueWidth, { bold: true, size: 10 })
    );
    ensureSpace(height);
    const y = doc.y;
    const labelBottom = c.put(label, c.X(MARGIN, LABEL_WIDTH), y, LABEL_WIDTH, { size: 10, color: MUTED });
    const valueBottom = c.put(text, c.X(MARGIN + VALUE_OFFSET, valueWidth), y, valueWidth, { bold: true, size: 10 });
    doc.y = Math.max(labelBottom, valueBottom) + 3;
  };

  const b = app.borrowerDetails || {};
  section(L.field('sec.borrower'));
  row(L.field('fullName'), b.fullName);
  row(L.field('passport'), b.passportNumber);
  row(L.field('country'), L.option('country', b.countryOfOrigin));
  row(L.field('dob'), b.dateOfBirth ? formatDate(b.dateOfBirth, lang) : undefined);
  row(L.field('phone'), ltr(b.mobilePhoneNumber));
  row(L.field('address'), b.addressFull || [b.addressStreet, b.addressCity].filter(Boolean).join(', '));
  row(L.field('marital'), L.option('marital', b.maritalStatus));

  const r = app.residencyDetails || {};
  section(L.field('sec.residency'));
  row(L.field('visaType'), L.option('visa', r.visaType));
  row(L.field('visaExpiry'), r.visaExpiryDate ? formatDate(r.visaExpiryDate, lang) : undefined);
  row(L.field('entryDate'), r.dateOfEntry ? formatDate(r.dateOfEntry, lang) : undefined);
  row(L.field('yearsInIsrael'), r.yearsOfResidency);

  const e = app.employmentDetails || {};
  section(L.field('sec.employment'));
  row(L.field('employer'), e.employerName);
  row(L.field('agency'), e.staffingAgencyName);
  row(L.field('startDate'), e.employmentStartDate ? formatDate(e.employmentStartDate, lang) : undefined);
  row(L.field('tenure'), e.jobTenureMonths !== undefined && e.jobTenureMonths !== null && e.jobTenureMonths !== ''
    ? L.field('monthsN', { n: e.jobTenureMonths }) : undefined);
  row(L.field('salary'), formatMoney(e.monthlySalaryNis, lang));
  row(L.field('salaryMethod'), L.option('salaryMethod', e.salaryPaymentMethod));

  const l = app.loanRequest || {};
  section(L.field('sec.loan'));
  row(L.field('amount'), formatMoney(l.requestedAmountNis, lang));
  row(L.field('purpose'), l.loanPurpose === 'Other' && l.otherPurposeDetails
    ? L.field('otherPurpose', { details: l.otherPurposeDetails })
    : L.option('loanPurpose', l.loanPurpose));
  row(L.field('period'), l.repaymentPeriodMonths ? L.field('monthsN', { n: l.repaymentPeriodMonths }) : undefined);
  row(L.field('monthly'), formatMoney(l.estimatedMonthlyPaymentNis, lang));
  row(L.field('total'), formatMoney(l.totalRepaymentNis, lang));
  row(L.field('source'), L.option('repaymentSource', l.repaymentSource));

  const bAccount = app.bankAccount || {};
  section(L.field('sec.bank'));
  if (bAccount.bankName || bAccount.accountNumber) {
    row(L.field('bankName'), bAccount.bankName);
    row(L.field('branch'), bAccount.branchNumber);
    row(L.field('account'), ltr(options.maskBankAccount ? maskAccountNumber(bAccount.accountNumber) : bAccount.accountNumber));
    row(L.field('holder'), bAccount.accountHolderName);
  } else {
    row(L.field('bankAccount'), app.bankAccountConfirmed ? L.field('bankConfirmed') : L.field('bankPending'));
  }

  const guarantors = (Array.isArray(app.guarantors) && app.guarantors.length > 0)
    ? app.guarantors
    : (app.guarantor && app.guarantor.hasGuarantor ? [app.guarantor] : []);

  section(L.field('sec.guarantors', { n: guarantors.length }));
  if (guarantors.length > 0) {
    guarantors.forEach((g, idx) => {
      row(L.field('guarantorN', { n: idx + 1 }), L.field('guarantorLine', {
        name: g.fullName || EMPTY,
        id: ltr(g.passportOrIdNumber) || EMPTY,
        phone: ltr(g.mobilePhoneNumber) || EMPTY,
        relationship: L.option('relationship', g.relationship || 'Co-worker'),
      }));
    });
  } else {
    row(L.field('guarantor'), L.field('noneProvided'));
  }

  if (typeof app.eligibilityScore === 'number') {
    section(L.field('sec.eligibility'));
    row(L.field('score'), L.field('scoreValue', { score: app.eligibilityScore }));
  }

  const documents = app.documents || [];
  section(L.field('sec.documents', { n: documents.length }));
  if (documents.length === 0) {
    row(L.field('documents'), L.field('noDocs'));
  } else {
    documents.forEach((d) => row(L.docType(d.documentTypeCode), `${d.originalFilename || EMPTY} · ${L.quality(d.qualityStatus)}`));
  }

  if (options.includeRisk && app.riskLevel) {
    section(L.field('sec.risk'));
    row(L.field('riskLevel'), L.field('riskValue', { level: L.riskLevel(app.riskLevel), score: app.riskScore ?? EMPTY }));
    (app.riskFlags || []).forEach((f) => row(L.field('flag'), L.riskFlag(f)));
  }

  section(L.field('sec.history'));
  const history = app.statusHistory || [];
  if (history.length === 0) {
    row(L.field('history'), L.field('noHistory'));
  } else {
    history.forEach((h) => {
      const why = L.reason(h.reason);
      row(formatDate(h.createdAt, lang), `${L.status(h.toStatus)}${why ? ` — ${why}` : ''}`);
    });
  }

  const sig = app.digitalSignature;
  section(L.field('sec.signature'));
  row(L.field('method'), sig && sig.signatureMethod ? L.field(sig.signatureMethod === 'draw' ? 'drawn' : 'typed') : EMPTY);

  if (sig && sig.signatureMethod === 'type') {
    row(L.field('signedBy'), sig.signatureValue || EMPTY);
  } else if (sig && sig.signatureMethod === 'draw' && sig.signatureValue) {
    let drawn = false;
    if (typeof sig.signatureValue === 'string' && sig.signatureValue.startsWith('data:image')) {
      try {
        const imgBuffer = Buffer.from(sig.signatureValue.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        ensureSpace(45);
        const y = doc.y;
        c.put(L.field('signature'), c.X(MARGIN, LABEL_WIDTH), y, LABEL_WIDTH, { size: 10, color: MUTED });
        // The image sits at the start of the value column (right side in Hebrew).
        const imgX = c.rtl ? c.X(MARGIN + VALUE_OFFSET, valueWidth) + valueWidth - 140 : MARGIN + VALUE_OFFSET;
        doc.image(imgBuffer, imgX, y, { fit: [140, 40] });
        doc.y = y + 45;
        drawn = true;
      } catch {
        drawn = false;
      }
    }
    if (!drawn) row(L.field('signature'), L.field('signatureOnFile'));
  } else {
    row(L.field('signedBy'), EMPTY);
  }

  row(L.field('signedAt'), sig && sig.signedAt ? formatDateTime(sig.signedAt, lang) : EMPTY);

  doc.end();
}

module.exports = { streamApplicationPdf, resolvePdfLanguage, formatMoney, formatDate, formatDateTime };
