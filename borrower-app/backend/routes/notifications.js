// Borrower notification inbox: list, mark one read, mark all read.
const { dbGet, dbAll, dbRun } = require('@quickloan/backend-core/services/dbHelpers');
const { canAccessUser } = require('@quickloan/backend-core/core/auth');
const { parseNotification } = require('@quickloan/backend-core/core/notifications');

function register(app) {
  app.get('/api/notifications/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!canAccessUser(req, userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
    const rows = await dbAll('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 100', [userId]);
    const notifications = rows.map(parseNotification);
    res.json({ success: true, notifications, unreadCount: notifications.filter((n) => !n.read).length });
  });

  app.patch('/api/notifications/:id/read', async (req, res) => {
    const row = await dbGet('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ success: false, error: 'Notification not found' });
    if (!canAccessUser(req, row.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
    await dbRun('UPDATE notifications SET read = 1 WHERE id = ?', [row.id]);
    res.json({ success: true });
  });

  app.post('/api/notifications/:userId/read-all', async (req, res) => {
    const { userId } = req.params;
    if (!canAccessUser(req, userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
    await dbRun('UPDATE notifications SET read = 1 WHERE userId = ?', [userId]);
    res.json({ success: true });
  });
}

module.exports = { register };
