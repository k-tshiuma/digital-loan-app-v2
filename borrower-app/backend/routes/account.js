// The signed-in borrower's account and language choice.
const { dbGet, dbRun } = require('@quickloan/backend-core/services/dbHelpers');
const { sanitizeUser } = require('@quickloan/backend-core/core/auth');

// Languages a user can currently pick. th/zh/tl are on hold (see hebrew-localization-plan.md).
const ENABLED_LANGUAGES = ['en', 'he'];

function register(app) {
  app.get('/api/users/me', async (req, res) => {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.auth.sub]);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user: sanitizeUser(user) });
  });

  app.put('/api/users/me/language', async (req, res) => {
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
