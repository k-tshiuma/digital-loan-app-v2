// Credit rule configuration (Phase 8.4).
const { dbAll, dbRun, newId } = require('@quickloan/backend-core/services/dbHelpers');
const { requireStaff } = require('@quickloan/backend-core/core/auth');
const { parseApp, getCreditRules } = require('@quickloan/backend-core/core/applications');
const { runCreditScreening, DEFAULT_CREDIT_RULES, normalizeRules } = require('@quickloan/backend-core/creditEngine');
const {
  DEFAULT_SERVICE_FEE_NIS, MIN_SERVICE_FEE_NIS, MAX_SERVICE_FEE_NIS, normalizeServiceFee, getServiceFeeNis, setServiceFeeNis,
} = require('@quickloan/backend-core/services/serviceFee');

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

  // --- Service fee ------------------------------------------------------------
  // The flat service fee new applications take at Step 2 (services/serviceFee.js). Applications that
  // already took a fee keep it, so nothing is recalculated here.
  const feeLimits = { min: MIN_SERVICE_FEE_NIS, max: MAX_SERVICE_FEE_NIS, default: DEFAULT_SERVICE_FEE_NIS };

  app.get('/api/config/service-fee', requireStaff(), async (_req, res) => {
    res.json({ success: true, serviceFeeNis: await getServiceFeeNis(), ...feeLimits });
  });

  app.put('/api/config/service-fee', requireStaff('system_admin'), async (req, res) => {
    const value = normalizeServiceFee(req.body && req.body.serviceFeeNis);
    if (value === null) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SERVICE_FEE',
        error: `The service fee must be a whole number of NIS from ${MIN_SERVICE_FEE_NIS} to ${MAX_SERVICE_FEE_NIS}.`,
      });
    }
    const previous = await getServiceFeeNis();
    await setServiceFeeNis(value);
    if (previous !== value) {
      const now = new Date().toISOString();
      await dbRun(
        `INSERT INTO audit_log (id, applicationId, actorType, actorId, actorRole, actorName, action, metadata, ipAddress, userAgent, createdAt)
         VALUES (?, NULL, 'staff', ?, ?, ?, 'SERVICE_FEE_CHANGED', ?, ?, ?, ?)`,
        [newId('aud'), req.auth.sub || null, req.auth.role || null, req.auth.name || null, JSON.stringify({ from: previous, to: value }),
          req.ip || null, String(req.headers['user-agent'] || '').slice(0, 250), now]
      );
    }
    res.json({ success: true, serviceFeeNis: value, ...feeLimits });
  });
}

module.exports = { register };
