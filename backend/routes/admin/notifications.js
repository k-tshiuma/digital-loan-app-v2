// Staff-sent notifications: manual in-app/SMS notice and raw SMS.
const { dbGet } = require('../../services/dbHelpers');
const { normalizePhone, requireStaff } = require('../../core/auth');
const { createNotification } = require('../../core/notifications');
const { sendSms } = require('../../services/smsService');

function register(app) {
  // --- Notifications (Phase 5) ------------------------------------------------
  app.post('/api/notifications', requireStaff(), async (req, res) => {
    const { userId, applicationId, title, message, notificationType, channel } = req.body;
    if (!userId || !title || !message) return res.status(400).json({ success: false, error: 'userId, title and message are required' });
    const user = await dbGet('SELECT phoneNumber, preferredLanguage FROM users WHERE id = ?', [userId]);
    const notification = await createNotification({
      userId, applicationId, title, message,
      notificationType: notificationType || 'MANUAL',
      channel: channel === 'push' ? 'push' : 'sms',
      language: user && user.preferredLanguage,
      phoneNumber: user && user.phoneNumber,
    });
    res.json({ success: true, notification });
  });

  // Raw SMS stub — logs to console unless Twilio credentials are configured (see services/smsService.js)
  app.post('/api/notifications/send-sms', requireStaff('system_admin', 'customer_service'), async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ success: false, error: 'to and message are required' });
    const result = await sendSms(normalizePhone(to), message);
    res.status(result.success ? 200 : 502).json(result);
  });
}

module.exports = { register };
