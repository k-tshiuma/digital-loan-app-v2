// Back Office analytics summary (Phase 3).
const { dbAll } = require('@quickloan/backend-core/services/dbHelpers');
const { requireStaff } = require('@quickloan/backend-core/core/auth');
const { parseApp } = require('@quickloan/backend-core/core/applications');

const OPEN_STATUSES = ['Received', 'Under Review', 'Additional Document Required', 'Approved', 'Forwarded to Funding Entity'];
const DECIDED_STATUSES = ['Approved', 'Rejected', 'Forwarded to Funding Entity'];

function register(app) {
  // --- Analytics (Phase 3) ----------------------------------------------------
  app.get('/api/analytics/summary', requireStaff('credit_reviewer', 'system_admin'), async (_req, res) => {
    const apps = (await dbAll('SELECT * FROM applications WHERE isSubmitted = 1')).map(parseApp);

    const byStatus = {};
    const byPurpose = {};
    const byRisk = { Low: 0, Medium: 0, High: 0 };
    let amountSum = 0;
    let amountCount = 0;
    const processingDays = [];

    apps.forEach((a) => {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      const purpose = (a.loanRequest && a.loanRequest.loanPurpose) || 'Unspecified';
      byPurpose[purpose] = (byPurpose[purpose] || 0) + 1;
      if (a.riskLevel && byRisk[a.riskLevel] !== undefined) byRisk[a.riskLevel] += 1;

      const amount = Number(a.loanRequest && a.loanRequest.requestedAmountNis);
      if (amount > 0) { amountSum += amount; amountCount += 1; }

      const decision = (a.statusHistory || [])
        .filter((h) => DECIDED_STATUSES.includes(h.toStatus))
        .sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt))[0];
      const start = a.submittedAt || a.createdAt;
      if (decision && start) {
        const days = (new Date(decision.createdAt) - new Date(start)) / 86400000;
        if (days >= 0) processingDays.push(days);
      }
    });

    const decided = (byStatus['Approved'] || 0) + (byStatus['Forwarded to Funding Entity'] || 0) + (byStatus['Rejected'] || 0);
    const approved = (byStatus['Approved'] || 0) + (byStatus['Forwarded to Funding Entity'] || 0);

    // Daily submissions for the last 30 days (inclusive of today)
    const days = [];
    const counts = {};
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push(key);
      counts[key] = 0;
    }
    apps.forEach((a) => {
      const key = String(a.submittedAt || a.createdAt || '').slice(0, 10);
      if (counts[key] !== undefined) counts[key] += 1;
    });

    res.json({
      success: true,
      summary: {
        totalApplications: apps.length,
        openApplications: apps.filter((a) => OPEN_STATUSES.includes(a.status)).length,
        approvalRate: decided > 0 ? Math.round((approved / decided) * 1000) / 10 : null,
        avgLoanAmountNis: amountCount > 0 ? Math.round(amountSum / amountCount) : null,
        totalRequestedNis: amountSum,
        avgProcessingDays: processingDays.length > 0
          ? Math.round((processingDays.reduce((s, d) => s + d, 0) / processingDays.length) * 10) / 10
          : null,
        byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
        byPurpose: Object.entries(byPurpose).map(([purpose, count]) => ({ purpose, count })),
        byRisk: Object.entries(byRisk).map(([level, count]) => ({ level, count })),
        dailySubmissions: days.map((date) => ({ date, count: counts[date] })),
        generatedAt: new Date().toISOString(),
      },
    });
  });
}

module.exports = { register };
