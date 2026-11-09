/**
 * Text the backend sends to borrowers (status SMS/notifications, OTP and password-reset codes),
 * in English and Hebrew. Thai, Chinese and Filipino are on hold and fall back to English.
 *
 * Hebrew SMS is sent as UCS-2 (70 characters per segment), so keep the Hebrew texts short.
 * Status names match the frontend (`statusReceived`, `statusUnderReview`, ... in translations.ts).
 */

const MESSAGE_LANGUAGES = ['en', 'he'];
const DEFAULT_LANGUAGE = 'en';

/** Status SMS / notification bodies, per language, keyed by canonical status. */
const STATUS_MESSAGES = {
  en: {
    'Received': 'Your application has been received and is queued for review.',
    'Under Review': 'A credit officer is now reviewing your application.',
    'Additional Document Required': 'We need an additional document to continue. Please open the app to upload it.',
    'Approved': 'Congratulations! Your loan has been approved.',
    'Rejected': 'Unfortunately your application was not approved at this time.',
    'Forwarded to Funding Entity': 'Your approved loan has been sent to our funding partner for disbursement.',
  },
  he: {
    'Received': 'בקשתך התקבלה ותיבדק בקרוב.',
    'Under Review': 'נציג אשראי בודק כעת את בקשתך.',
    'Additional Document Required': 'נדרש מסמך נוסף. נא להעלות אותו באפליקציה.',
    'Approved': 'מזל טוב! ההלוואה שלך אושרה.',
    'Rejected': 'לצערנו בקשתך לא אושרה בשלב זה.',
    'Forwarded to Funding Entity': 'ההלוואה הועברה לגוף המממן להעברת הכספים.',
  },
};

/** Display names for statuses (same wording as the frontend). */
const STATUS_NAMES = {
  en: {
    'Received': 'Received',
    'Under Review': 'Under Review',
    'Additional Document Required': 'Additional Document Required',
    'Approved': 'Approved',
    'Rejected': 'Rejected',
    'Forwarded to Funding Entity': 'Forwarded to Funding Entity',
  },
  he: {
    'Received': 'נקלטה במערכת',
    'Under Review': 'בבדיקת חתם אשראי',
    'Additional Document Required': 'נדרש מסמך נוסף',
    'Approved': 'אושרה',
    'Rejected': 'נדחתה',
    'Forwarded to Funding Entity': 'הועברה לגוף מממן',
  },
};

const MESSAGES = {
  en: {
    'notif.statusTitle': 'QuickLoan: {status}',
    'notif.statusFallback': 'Status updated to {status}.',
    'notif.submittedTitle': 'Application submitted',
    'notif.submitted': 'Your request number is {requestNumber}. Keep it for reference.',
    'sms.otp': 'Your QuickLoan verification code is {code}. It expires in 5 minutes.',
    'sms.passwordReset': 'Your QuickLoan password reset code is {code}. It expires in 15 minutes.',
    'email.passwordResetSubject': 'Reset your QuickLoan password',
  },
  he: {
    'notif.statusTitle': 'QuickLoan: {status}',
    'notif.statusFallback': 'סטטוס הבקשה עודכן: {status}.',
    'notif.submittedTitle': 'הבקשה הוגשה',
    'notif.submitted': 'מספר הבקשה שלך: {requestNumber}. נא לשמור אותו.',
    'sms.otp': 'קוד האימות שלך ב-QuickLoan: {code}. תקף ל-5 דקות.',
    'sms.passwordReset': 'קוד איפוס הסיסמה שלך ב-QuickLoan: {code}. תקף ל-15 דקות.',
    'email.passwordResetSubject': 'איפוס הסיסמה ב-QuickLoan',
  },
};

/**
 * The language to send a message in: the first candidate that is set, if it is English or Hebrew.
 * Anything else (including on-hold languages such as 'th') falls back to English.
 */
function resolveMessageLanguage(...candidates) {
  const first = candidates.find((c) => typeof c === 'string' && c.trim() !== '');
  const lang = first ? first.trim().toLowerCase() : DEFAULT_LANGUAGE;
  return MESSAGE_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

function fill(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? String(params[name]) : match));
}

/** Translate a message key, falling back to English and then to the key itself. */
function msg(lang, key, params) {
  const l = resolveMessageLanguage(lang);
  const template = (MESSAGES[l] && MESSAGES[l][key]) || MESSAGES.en[key] || key;
  return fill(template, params);
}

function statusName(lang, status) {
  const l = resolveMessageLanguage(lang);
  return (STATUS_NAMES[l] && STATUS_NAMES[l][status]) || status;
}

/** Body text for a status change, or a generic "status updated" line for unknown statuses. */
function statusMessage(lang, status) {
  const l = resolveMessageLanguage(lang);
  return (STATUS_MESSAGES[l] && STATUS_MESSAGES[l][status]) || msg(l, 'notif.statusFallback', { status: statusName(l, status) });
}

module.exports = {
  MESSAGE_LANGUAGES,
  STATUS_MESSAGES,
  STATUS_NAMES,
  MESSAGES,
  resolveMessageLanguage,
  msg,
  statusName,
  statusMessage,
};
