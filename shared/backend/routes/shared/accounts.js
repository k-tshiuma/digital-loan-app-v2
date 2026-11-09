// The signed-in account (borrower profile, or the staff role) and the borrower's language choice.
const { dbGet, dbRun } = require('../../services/dbHelpers');
const { sanitizeUser, isStaff } = require('../../core/auth');

// Languages a user can currently pick. th/zh/tl are on hold (see hebrew-localization-plan.md).
const ENABLED_LANGUAGES = ['en', 'he'];

function register(app) {
  app.get('/api/users/me', async (req, res) => {
    if (isStaff(req)) return res.json({ success: true, staff: { role: req.auth.role } });
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.auth.sub]);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user: sanitizeUser(user) });
  });

  app.put('/api/users/me/language', async (req, res) => {
    if (isStaff(req)) return res.status(403).json({ success: false, error: 'Staff accounts have no language preference' });
    const { language } = req.body || {};
    if (!ENABLED_LANGUAGES.includes(language)) {
      return res.status(400).json({ success: false, error: `language must be one of: ${ENABLED_LANGUAGES.join(', ')}` });
    }
    const result = await dbRun('UPDATE users SET preferredLanguage = ? WHERE id = ?', [language, req.auth.sub]);
    if (!result || result.changes === 0) return res.status(404).json({ success: false, error: 'User not found' });
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.auth.sub]);
    res.json({ success: true, user: sanitizeUser(user) });
  });
}

module.exports = { register };
