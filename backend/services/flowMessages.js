/**
 * Texts the backend sends for the 3-step workflow (in-app message, SMS, email), in English and
 * Hebrew. Every message says what happened, the current status, whether the applicant has to act,
 * and which step comes next. Hebrew SMS is UCS-2 (70 characters per segment), so SMS texts are short.
 *
 * `FLOW_EVENTS` is the notification matrix: which channels fire for which event.
 * 'optional' = email is sent unless switched off in app_config (key `notifyEmailOptional` = false).
 */
const { resolveMessageLanguage } = require('./messages');

const FLOW_EVENTS = {
  STEP1_SUBMITTED: { inApp: true, sms: true, email: true },
  STEP1_APPROVED: { inApp: true, sms: true, email: 'optional' },
  STEP1_CHANGES_REQUESTED: { inApp: true, sms: true, email: true },
  STEP1_REJECTED: { inApp: true, sms: true, email: true },
  STEP2_SUBMITTED: { inApp: true, sms: true, email: true },
  STEP2_APPROVED: { inApp: true, sms: true, email: 'optional' },
  STEP2_CHANGES_REQUESTED: { inApp: true, sms: true, email: true },
  STEP2_REJECTED: { inApp: true, sms: true, email: true },
  STEP3_SUBMITTED: { inApp: true, sms: true, email: true },
  LOAN_APPROVED: { inApp: true, sms: true, email: true },
  LOAN_REJECTED: { inApp: true, sms: true, email: true },
  STAFF_MESSAGE: { inApp: true, sms: true, email: true },
};

const FLOW_STATUS_NAMES = {
  en: {
    LEAD_REGISTERED: 'Lead / Registered',
    PENDING_STEP1_APPROVAL: 'Pending Step 1 Approval',
    STEP1_CHANGES_REQUESTED: 'Step 1 – Changes Requested',
    STEP1_APPROVED: 'Step 1 Approved – Step 2 Pending',
    PENDING_STEP2_APPROVAL: 'Pending Step 2 Approval',
    STEP2_CHANGES_REQUESTED: 'Step 2 – Changes Requested',
    STEP2_APPROVED: 'Step 2 Approved – Step 3 Pending',
    PENDING_FINAL_PROCESSING: 'Final Application Submitted – Pending Final Processing',
    LOAN_APPROVED: 'Loan Approved',
    LOAN_REJECTED: 'Loan Rejected',
  },
  he: {
    LEAD_REGISTERED: 'ליד / רשום',
    PENDING_STEP1_APPROVAL: 'ממתין לאישור שלב 1',
    STEP1_CHANGES_REQUESTED: 'שלב 1 – נדרשים תיקונים',
    STEP1_APPROVED: 'שלב 1 אושר – שלב 2 ממתין',
    PENDING_STEP2_APPROVAL: 'ממתין לאישור שלב 2',
    STEP2_CHANGES_REQUESTED: 'שלב 2 – נדרשים תיקונים',
    STEP2_APPROVED: 'שלב 2 אושר – שלב 3 ממתין',
    PENDING_FINAL_PROCESSING: 'הבקשה הסופית הוגשה – ממתינה לטיפול סופי',
    LOAN_APPROVED: 'ההלוואה אושרה',
    LOAN_REJECTED: 'ההלוואה נדחתה',
  },
};

const T = {
  en: {
    STEP1_SUBMITTED: {
      title: 'Step 1 received',
      body: 'We received your Step 1 application (ref {ref}). Current status: {status}. You do not need to do anything now: our team is verifying your details and documents. We will notify you as soon as Step 2 is available.',
      sms: 'QuickLoan: Step 1 received (ref {ref}). Status: Pending Step 1 Approval. No action needed now. We will text you after verification.',
    },
    STEP1_APPROVED: {
      title: 'Step 1 approved',
      body: 'Good news: your Step 1 was approved (ref {ref}). Current status: {status}. Action needed: please open the app and complete Step 2 (sponsors and loan amount). Step 3 follows after Step 2 is approved.',
      sms: 'QuickLoan: Step 1 approved (ref {ref}). You can now proceed to Step 2. Open the app to continue.',
    },
    STEP1_CHANGES_REQUESTED: {
      title: 'Step 1: changes requested',
      body: 'Your Step 1 application (ref {ref}) needs a correction. Current status: {status}. Message from our team: "{note}". Action needed: please update Step 1 in the app and submit it again.',
      sms: 'QuickLoan: Step 1 needs a change (ref {ref}): {note} Open the app to update and resubmit.',
    },
    STEP1_REJECTED: {
      title: 'Application not approved',
      body: 'We are sorry: your application (ref {ref}) was not approved at Step 1. Current status: {status}. Reason: {reason}. No further action is available on this application.',
      sms: 'QuickLoan: your application (ref {ref}) was not approved at Step 1. Reason: {reason}',
    },
    STEP2_SUBMITTED: {
      title: 'Step 2 received',
      body: 'We received your Step 2 information (ref {ref}). Current status: {status}. You do not need to do anything now: our team is reviewing it. We will notify you as soon as the final stage (Step 3) is available.',
      sms: 'QuickLoan: Step 2 received (ref {ref}). Status: Pending Step 2 Approval. No action needed now.',
    },
    STEP2_APPROVED: {
      title: 'Step 2 approved',
      body: 'Good news: your Step 2 was approved (ref {ref}). Current status: {status}. Action needed: please open the app and complete the final stage (Step 3): bank details, the bank account management document and the terms.',
      sms: 'QuickLoan: Step 2 approved (ref {ref}). You can now proceed to the final stage (Step 3). Open the app to continue.',
    },
    STEP2_CHANGES_REQUESTED: {
      title: 'Step 2: changes requested',
      body: 'Your Step 2 information (ref {ref}) needs a correction. Current status: {status}. Message from our team: "{note}". Action needed: please update Step 2 in the app and submit it again.',
      sms: 'QuickLoan: Step 2 needs a change (ref {ref}): {note} Open the app to update and resubmit.',
    },
    STEP2_REJECTED: {
      title: 'Application not approved',
      body: 'We are sorry: your application (ref {ref}) was not approved at Step 2. Current status: {status}. Reason: {reason}. No further action is available on this application.',
      sms: 'QuickLoan: your application (ref {ref}) was not approved at Step 2. Reason: {reason}',
    },
    STEP3_SUBMITTED: {
      title: 'Final application submitted',
      body: 'Your complete loan application (ref {ref}) was submitted successfully. Current status: {status}. This is not yet a loan approval: your application now goes to final processing. You do not need to do anything now. We will notify you of the final decision.',
      sms: 'QuickLoan: your full application (ref {ref}) was submitted and is pending final processing. No action needed. This is not a loan approval yet.',
    },
    LOAN_APPROVED: {
      title: 'Loan approved',
      body: 'Congratulations! Your loan (ref {ref}) has been approved. Current status: {status}. We will contact you with the next steps for your loan.',
      sms: 'QuickLoan: congratulations, your loan (ref {ref}) was approved. We will contact you with the next steps.',
    },
    LOAN_REJECTED: {
      title: 'Loan not approved',
      body: 'We are sorry: your loan application (ref {ref}) was not approved. Current status: {status}. {reason} No further action is available on this application.',
      sms: 'QuickLoan: your loan application (ref {ref}) was not approved. {reason}',
    },
    STAFF_MESSAGE: {
      title: 'Message about your application',
      body: 'Message from our team about your application (ref {ref}), current status: {status}: "{note}"',
      sms: 'QuickLoan (ref {ref}): {note}',
    },
    emailGreeting: 'Hello {name},',
    emailFooter: 'QuickLoan',
    reasonNone: 'No reason was provided.',
  },
  he: {
    STEP1_SUBMITTED: {
      title: 'שלב 1 התקבל',
      body: 'קיבלנו את בקשתך בשלב 1 (אסמכתא {ref}). סטטוס נוכחי: {status}. אין צורך בפעולה כרגע: הצוות שלנו בודק את הפרטים והמסמכים שלך. נעדכן אותך ברגע ששלב 2 ייפתח.',
      sms: 'QuickLoan: בקשת שלב 1 התקבלה (אסמכתא {ref}). סטטוס: ממתין לאישור שלב 1. אין צורך בפעולה. נעדכן לאחר הבדיקה.',
    },
    STEP1_APPROVED: {
      title: 'שלב 1 אושר',
      body: 'חדשות טובות: שלב 1 אושר (אסמכתא {ref}). סטטוס נוכחי: {status}. נדרשת פעולה: היכנס/י לאפליקציה והשלם/י את שלב 2 (ערבים וסכום ההלוואה). שלב 3 ייפתח לאחר אישור שלב 2.',
      sms: 'QuickLoan: שלב 1 אושר (אסמכתא {ref}). ניתן לעבור לשלב 2. היכנס/י לאפליקציה להמשך.',
    },
    STEP1_CHANGES_REQUESTED: {
      title: 'שלב 1: נדרשים תיקונים',
      body: 'בקשתך בשלב 1 (אסמכתא {ref}) דורשת תיקון. סטטוס נוכחי: {status}. הודעה מהצוות שלנו: "{note}". נדרשת פעולה: עדכן/י את שלב 1 באפליקציה ושלח/י אותו מחדש.',
      sms: 'QuickLoan: שלב 1 דורש תיקון (אסמכתא {ref}): {note} היכנס/י לאפליקציה לעדכון ולשליחה מחדש.',
    },
    STEP1_REJECTED: {
      title: 'הבקשה לא אושרה',
      body: 'למרבה הצער, בקשתך (אסמכתא {ref}) לא אושרה בשלב 1. סטטוס נוכחי: {status}. סיבה: {reason}. אין פעולות נוספות זמינות בבקשה זו.',
      sms: 'QuickLoan: בקשתך (אסמכתא {ref}) לא אושרה בשלב 1. סיבה: {reason}',
    },
    STEP2_SUBMITTED: {
      title: 'שלב 2 התקבל',
      body: 'קיבלנו את הפרטים שלך בשלב 2 (אסמכתא {ref}). סטטוס נוכחי: {status}. אין צורך בפעולה כרגע: הצוות שלנו בודק אותם. נעדכן אותך ברגע שהשלב האחרון (שלב 3) ייפתח.',
      sms: 'QuickLoan: שלב 2 התקבל (אסמכתא {ref}). סטטוס: ממתין לאישור שלב 2. אין צורך בפעולה.',
    },
    STEP2_APPROVED: {
      title: 'שלב 2 אושר',
      body: 'חדשות טובות: שלב 2 אושר (אסמכתא {ref}). סטטוס נוכחי: {status}. נדרשת פעולה: היכנס/י לאפליקציה והשלם/י את השלב האחרון (שלב 3): פרטי חשבון הבנק, אישור ניהול חשבון והתנאים.',
      sms: 'QuickLoan: שלב 2 אושר (אסמכתא {ref}). ניתן לעבור לשלב האחרון (שלב 3). היכנס/י לאפליקציה להמשך.',
    },
    STEP2_CHANGES_REQUESTED: {
      title: 'שלב 2: נדרשים תיקונים',
      body: 'הפרטים שלך בשלב 2 (אסמכתא {ref}) דורשים תיקון. סטטוס נוכחי: {status}. הודעה מהצוות שלנו: "{note}". נדרשת פעולה: עדכן/י את שלב 2 באפליקציה ושלח/י אותו מחדש.',
      sms: 'QuickLoan: שלב 2 דורש תיקון (אסמכתא {ref}): {note} היכנס/י לאפליקציה לעדכון ולשליחה מחדש.',
    },
    STEP2_REJECTED: {
      title: 'הבקשה לא אושרה',
      body: 'למרבה הצער, בקשתך (אסמכתא {ref}) לא אושרה בשלב 2. סטטוס נוכחי: {status}. סיבה: {reason}. אין פעולות נוספות זמינות בבקשה זו.',
      sms: 'QuickLoan: בקשתך (אסמכתא {ref}) לא אושרה בשלב 2. סיבה: {reason}',
    },
    STEP3_SUBMITTED: {
      title: 'הבקשה הסופית הוגשה',
      body: 'בקשת ההלוואה המלאה שלך (אסמכתא {ref}) הוגשה בהצלחה. סטטוס נוכחי: {status}. זהו עדיין לא אישור הלוואה: הבקשה עוברת כעת לטיפול סופי. אין צורך בפעולה כרגע. נעדכן אותך בהחלטה הסופית.',
      sms: 'QuickLoan: בקשתך המלאה (אסמכתא {ref}) הוגשה וממתינה לטיפול סופי. אין צורך בפעולה. זה עדיין לא אישור הלוואה.',
    },
    LOAN_APPROVED: {
      title: 'ההלוואה אושרה',
      body: 'מזל טוב! ההלוואה שלך (אסמכתא {ref}) אושרה. סטטוס נוכחי: {status}. ניצור איתך קשר עם השלבים הבאים להלוואה.',
      sms: 'QuickLoan: מזל טוב, ההלוואה שלך (אסמכתא {ref}) אושרה. ניצור איתך קשר עם השלבים הבאים.',
    },
    LOAN_REJECTED: {
      title: 'ההלוואה לא אושרה',
      body: 'למרבה הצער, בקשת ההלוואה שלך (אסמכתא {ref}) לא אושרה. סטטוס נוכחי: {status}. {reason} אין פעולות נוספות זמינות בבקשה זו.',
      sms: 'QuickLoan: בקשת ההלוואה שלך (אסמכתא {ref}) לא אושרה. {reason}',
    },
    STAFF_MESSAGE: {
      title: 'הודעה בנוגע לבקשתך',
      body: 'הודעה מהצוות שלנו בנוגע לבקשתך (אסמכתא {ref}), סטטוס נוכחי: {status}: "{note}"',
      sms: 'QuickLoan (אסמכתא {ref}): {note}',
    },
    emailGreeting: 'שלום {name},',
    emailFooter: 'QuickLoan',
    reasonNone: 'לא צוינה סיבה.',
  },
};

const fill = (template, params = {}) =>
  String(template).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function flowStatusName(lang, flowStatus) {
  const l = resolveMessageLanguage(lang);
  return (FLOW_STATUS_NAMES[l] && FLOW_STATUS_NAMES[l][flowStatus]) || flowStatus;
}

/**
 * Build the texts for an event. `params`: { ref, name, flowStatus, note, reason }.
 * Returns { title, body, sms, emailSubject, emailHtml }.
 */
function flowMessage(lang, event, params = {}) {
  const l = resolveMessageLanguage(lang);
  const dict = T[l];
  const entry = dict[event] || T.en[event];
  if (!entry) throw new Error(`Unknown workflow event: ${event}`);
  const none = dict.reasonNone;
  const p = {
    ref: params.ref || '',
    status: flowStatusName(l, params.flowStatus),
    note: (params.note || '').trim() || '-',
    reason: (params.reason || '').trim() || none,
  };
  // A rejection reason that is empty must not leave a dangling "Reason:" sentence in LOAN_REJECTED.
  if (event === 'LOAN_REJECTED') p.reason = (params.reason || '').trim() ? (l === 'he' ? `סיבה: ${params.reason.trim()}` : `Reason: ${params.reason.trim()}`) : '';
  const title = fill(entry.title, p);
  const body = fill(entry.body, p).replace(/\s{2,}/g, ' ').trim();
  const sms = fill(entry.sms, p).replace(/\s{2,}/g, ' ').trim();
  const emailHtml =
    `<p>${escapeHtml(fill(dict.emailGreeting, { name: params.name || '' }).replace(/\s+,/, ','))}</p>` +
    `<p>${escapeHtml(body)}</p>` +
    `<p><strong>${escapeHtml(p.status)}</strong></p>` +
    `<p>${escapeHtml(dict.emailFooter)}</p>`;
  return { title, body, sms, emailSubject: `QuickLoan: ${title}`, emailHtml };
}

module.exports = { FLOW_EVENTS, FLOW_STATUS_NAMES, FLOW_TEXTS: T, flowStatusName, flowMessage };
