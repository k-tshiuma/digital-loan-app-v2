// Credit rule configuration (Phase 8.4).
const { dbAll, dbRun } = require('@quickloan/backend-core/services/dbHelpers');
const { requireStaff } = require('@quickloan/backend-core/core/auth');
const { parseApp, getCreditRules } = require('@quickloan/backend-core/core/applications');
const { runCreditScreening, DEFAULT_CREDIT_RULES, normalizeRules } = require('@quickloan/backend-core/creditEngine');

function register(app) {
  // --- Credit rule configuration (Phase 8.4) ---------------------------------
  app.get('/api/config/credit-rules', requireStaff(), async (_req, res) => {
    res.json({ success: true, rules: await getCreditRules(), defaults: DEFAULT_CREDIT_RULES });
  });

  app.put('/api/config/credit-rules', requireStaff('system_admin'), async (req, res) => {
    const rules = normalizeRules({ ...(await getCreditRules()), ...(req.body && req.body.rules) });
    if (rules.mediumRiskMinScore > rules.lowRiskMinScore) {
      return res.status(400).json({ success: false, error: 'Medium-risk threshold cannot exceed the low-risk threshold.' });
    }
    if (rules.hardMinTenureMonths > rules.minTenureMonths) {
      return res.status(400).json({ success: false, error: 'Hard minimum tenure cannot exceed the warning tenure.' });
    }
    const now = new Date().toISOString();
    await dbRun(
      `INSERT INTO app_config (key, value, updatedAt) VALUES ('creditRules', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      [JSON.stringify(rules), now]
    );

    // Re-score every submitted application so the queue reflects the new policy.
    const apps = (await dbAll('SELECT * FROM applications WHERE isSubmitted = 1')).map(parseApp);
    for (const a of apps) {
      const r = runCreditScreening(a, rules);
      await dbRun('UPDATE applications SET riskScore = ?, riskLevel = ?, riskFlags = ? WHERE id = ?', [r.score, r.riskLevel, JSON.stringify(r.flags), a.id]);
    }
    res.json({ success: true, rules, rescored: apps.length });
  });
}

module.exports = { register };
