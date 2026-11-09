// Demo staff tokens (role picker). Public (before `authenticate`). Real staff login is in routes/flow.js (registerStaffPublic).
const { DEMO_MODE, STAFF_ROLES } = require('@quickloan/backend-core/core/config');
const { signStaffToken } = require('@quickloan/backend-core/core/auth');
const { setSessionCookie, clearSessionCookie } = require('@quickloan/backend-core/core/sessionCookie');

function register(app) {
  // Sign out: removes the staff session cookie (the dashboard can't, it is HttpOnly). Public, so it works
  // with an expired session.
  app.post('/api/auth/logout', (_req, res) => {
    clearSessionCookie(res, 'staff');
    res.json({ success: true });
  });

  // Back-office demo login: strictly blocked for borrower sessions.
  app.post('/api/auth/staff-token', (req, res) => {
    if (!DEMO_MODE) return res.status(404).json({ success: false, error: 'Not available' });
    if (req.headers.authorization && req.auth && req.auth.type === 'borrower') {
      return res.status(403).json({ success: false, error: 'Back-office access required' });
    }
    const { role } = req.body;
    if (!STAFF_ROLES.includes(role)) return res.status(400).json({ success: false, error: 'Unknown staff role' });
    res.json({ success: true, token: setSessionCookie(res, 'staff', signStaffToken(role)), role });
  });
}

module.exports = { register };
