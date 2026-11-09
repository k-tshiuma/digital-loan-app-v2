// The signed-in staff member: their role. (Staff have no stored language preference.)
function register(app) {
  app.get('/api/users/me', (req, res) => {
    res.json({ success: true, staff: { role: req.auth.role } });
  });
}

module.exports = { register };
