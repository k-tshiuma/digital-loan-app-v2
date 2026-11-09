// In-app notifications for the classic flow, with an SMS copy (Phase 5).
const { dbGet, dbRun, newId } = require('../services/dbHelpers');
const { sendSms } = require('../services/smsService');
const { resolveMessageLanguage, msg, statusName, statusMessage } = require('../services/messages');
const { broadcastAppEvent } = require('./sse');

function parseNotification(row) {
  return { ...row, read: row.read === 1, applicationId: row.applicationId || undefined };
}

async function createNotification({ userId, applicationId, notificationType, title, message, language, phoneNumber, channel = 'sms' }) {
  const id = newId('notif');
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO notifications (id, userId, applicationId, channel, notificationType, title, message, deliveryStatus, read, language, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [id, userId, applicationId || null, channel, notificationType, title, message, language || 'en', now]
  );

  let deliveryStatus = 'sent';
  if (channel === 'sms' && phoneNumber) {
    const result = await sendSms(phoneNumber, `${title}: ${message}`);
    deliveryStatus = result.success ? 'delivered' : 'failed';
  }
  await dbRun('UPDATE notifications SET deliveryStatus = ? WHERE id = ?', [deliveryStatus, id]);
  return parseNotification(await dbGet('SELECT * FROM notifications WHERE id = ?', [id]));
}

// Status texts live in services/messages.js (English and Hebrew).
async function notifyStatusChange(a, previousStatus) {
  const user = await dbGet('SELECT phoneNumber, preferredLanguage FROM users WHERE id = ?', [a.userId]);
  const phoneNumber = (a.borrowerDetails && a.borrowerDetails.mobilePhoneNumber) || (user && user.phoneNumber);
  // The user's current choice wins over the language the application was filled in.
  const lang = resolveMessageLanguage(user && user.preferredLanguage, a.language);
  const isSubmission = !previousStatus;
  let message = statusMessage(lang, a.status);
  // Notes typed by staff are sent as typed.
  if (a.status === 'Additional Document Required' && a.missingDocumentNotes) message = a.missingDocumentNotes;
  if (isSubmission) message = msg(lang, 'notif.submitted', { requestNumber: a.requestNumber });

  const notification = await createNotification({
    userId: a.userId,
    applicationId: a.id,
    notificationType: isSubmission ? 'SUBMISSION_CONFIRMATION' : `STATUS_${a.status}`,
    title: isSubmission ? msg(lang, 'notif.submittedTitle') : msg(lang, 'notif.statusTitle', { status: statusName(lang, a.status) }),
    message: `[${a.requestNumber}] ${message}`,
    language: lang,
    phoneNumber,
  });

  broadcastAppEvent(a.id, 'status', {
    applicationId: a.id,
    previousStatus: previousStatus || null,
    status: a.status,
    updatedAt: a.updatedAt,
    notification,
  });
}

module.exports = { parseNotification, createNotification, notifyStatusChange };
