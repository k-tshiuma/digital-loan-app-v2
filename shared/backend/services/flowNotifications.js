/**
 * Workflow notification dispatcher. One call per workflow event; it creates the in-app message and
 * sends SMS and email as the matrix in flowMessages.js says. Every channel is logged in
 * notification_deliveries. A failed send is recorded (and can be retried by staff) but never
 * stops or undoes the workflow step that caused it.
 */
const { dbGet, dbAll, dbRun, newId, safeJson } = require('./dbHelpers');
const { resolveMessageLanguage } = require('./messages');
const { FLOW_EVENTS, flowMessage } = require('./flowMessages');

/** E.164 for Israeli local numbers ("050-123-4567" -> "+972501234567"); other numbers pass through. */
function toE164(raw) {
  const cleaned = String(raw || '').replace(/[\s()-]/g, '');
  if (!cleaned || cleaned.startsWith('google:')) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`;
  if (cleaned.startsWith('0')) return `+972${cleaned.slice(1)}`;
  return cleaned;
}

async function emailOptionalEnabled() {
  const row = await dbGet('SELECT value FROM app_config WHERE key = ?', ['notifyEmailOptional']);
  if (!row) return true;
  return safeJson(row.value, true) !== false;
}

function createFlowNotifier({ sendSms, sendEmail, broadcastAppEvent }) {
  async function logDelivery(fields) {
    const id = newId('dlv');
    const now = new Date().toISOString();
    await dbRun(
      `INSERT INTO notification_deliveries (id, notificationId, applicationId, userId, event, channel, recipient, subject, body, status, providerId, error, attempts, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, fields.notificationId || null, fields.applicationId, fields.userId, fields.event, fields.channel, fields.recipient || null,
        fields.subject || null, fields.body || null, fields.status, fields.providerId || null, fields.error || null, fields.attempts || 0, now, now]
    );
    return id;
  }

  async function attempt(channel, recipient, subject, body, lang) {
    try {
      if (channel === 'sms') {
        const r = await sendSms(recipient, body);
        return r.success ? { status: 'sent', providerId: r.sid || (r.mock ? 'mock' : null) } : { status: 'failed', error: r.error || 'SMS failed' };
      }
      const r = await sendEmail(recipient, subject, body, { lang });
      return r.success ? { status: 'sent', providerId: r.mock ? 'mock' : null } : { status: 'failed', error: r.error || 'Email failed' };
    } catch (err) {
      return { status: 'failed', error: err.message };
    }
  }

  /**
   * @param {object} p
   * @param {object} p.app     parsed application (needs id, userId, requestNumber, flowStatus, language, borrowerDetails)
   * @param {string} p.event   key of FLOW_EVENTS
   * @param {string} [p.note]  staff note / message text
   * @param {string} [p.reason] rejection reason
   */
  async function notifyFlowEvent({ app, event, note, reason }) {
    const rules = FLOW_EVENTS[event];
    if (!rules) throw new Error(`Unknown workflow event: ${event}`);

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [app.userId]);
    const lang = resolveMessageLanguage(user && user.preferredLanguage, app.language);
    const phone = toE164((app.borrowerDetails && app.borrowerDetails.mobilePhoneNumber) || (user && user.phoneNumber));
    const email = user && user.email ? String(user.email).trim() : '';
    const name = (app.borrowerDetails && app.borrowerDetails.fullName) || (user && user.fullName) || '';
    const m = flowMessage(lang, event, { ref: app.requestNumber, name, flowStatus: app.flowStatus, note, reason });
    const now = new Date().toISOString();

    // 1. In-app message (shown in the notification drawer)
    const notificationId = newId('notif');
    await dbRun(
      `INSERT INTO notifications (id, userId, applicationId, channel, notificationType, title, message, deliveryStatus, read, language, createdAt)
       VALUES (?, ?, ?, 'in_app', ?, ?, ?, 'sent', 0, ?, ?)`,
      [notificationId, app.userId, app.id, event, m.title, `[${app.requestNumber}] ${m.body}`, lang, now]
    );
    await logDelivery({ notificationId, applicationId: app.id, userId: app.userId, event, channel: 'in_app', recipient: app.userId, subject: m.title, body: m.body, status: 'sent', attempts: 1 });

    // 2. SMS
    const results = { inApp: 'sent' };
    if (rules.sms) {
      if (!phone) {
        await logDelivery({ notificationId, applicationId: app.id, userId: app.userId, event, channel: 'sms', status: 'skipped', error: 'No phone number on file', body: m.sms });
        results.sms = 'skipped';
      } else {
        const r = await attempt('sms', phone, null, m.sms, lang);
        await logDelivery({ notificationId, applicationId: app.id, userId: app.userId, event, channel: 'sms', recipient: phone, body: m.sms, attempts: 1, ...r });
        results.sms = r.status;
      }
    }

    // 3. Email (always, or only while the optional switch is on)
    const emailWanted = rules.email === true || (rules.email === 'optional' && (await emailOptionalEnabled()));
    if (emailWanted) {
      if (!email) {
        await logDelivery({ notificationId, applicationId: app.id, userId: app.userId, event, channel: 'email', status: 'skipped', error: 'No email address on file', subject: m.emailSubject, body: m.emailHtml });
        results.email = 'skipped';
      } else {
        const r = await attempt('email', email, m.emailSubject, m.emailHtml, lang);
        await logDelivery({ notificationId, applicationId: app.id, userId: app.userId, event, channel: 'email', recipient: email, subject: m.emailSubject, body: m.emailHtml, attempts: 1, ...r });
        results.email = r.status;
      }
    }

    // 4. Live update for an open status screen
    broadcastAppEvent(app.id, 'status', {
      applicationId: app.id,
      flowStatus: app.flowStatus,
      status: app.status,
      event,
      updatedAt: app.updatedAt,
      notification: { id: notificationId, title: m.title, message: m.body, notificationType: event, createdAt: now },
    });
    return { notificationId, ...results };
  }

  /** Staff retry of a failed SMS or email delivery. */
  async function retryDelivery(deliveryId) {
    const d = await dbGet('SELECT * FROM notification_deliveries WHERE id = ?', [deliveryId]);
    if (!d) return { ok: false, status: 404, error: 'Delivery not found' };
    if (d.channel === 'in_app') return { ok: false, status: 400, error: 'In-app messages are not retried' };
    if (d.status === 'sent') return { ok: false, status: 409, error: 'Already delivered' };

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [d.userId]);
    const app = await dbGet('SELECT language, borrowerDetails FROM applications WHERE id = ?', [d.applicationId]);
    const lang = resolveMessageLanguage(user && user.preferredLanguage, app && app.language);
    let recipient = d.recipient;
    if (!recipient) {
      const borrower = app ? safeJson(app.borrowerDetails, {}) : {};
      recipient = d.channel === 'sms'
        ? toE164((borrower && borrower.mobilePhoneNumber) || (user && user.phoneNumber))
        : (user && user.email) || '';
    }
    if (!recipient) return { ok: false, status: 422, error: 'Still no recipient on file' };

    const r = await attempt(d.channel, recipient, d.subject, d.body, lang);
    await dbRun(
      'UPDATE notification_deliveries SET status = ?, providerId = ?, error = ?, recipient = ?, attempts = attempts + 1, updatedAt = ? WHERE id = ?',
      [r.status, r.providerId || null, r.error || null, recipient, new Date().toISOString(), d.id]
    );
    return { ok: r.status === 'sent', status: r.status === 'sent' ? 200 : 502, delivery: await dbGet('SELECT * FROM notification_deliveries WHERE id = ?', [d.id]), error: r.error };
  }

  async function listDeliveries(applicationId) {
    return dbAll('SELECT id, notificationId, event, channel, recipient, subject, status, error, attempts, createdAt, updatedAt FROM notification_deliveries WHERE applicationId = ? ORDER BY createdAt DESC', [applicationId]);
  }

  return { notifyFlowEvent, retryDelivery, listDeliveries };
}

module.exports = { createFlowNotifier, toE164 };
