// Back Office list of all applications (classic and 3-step).
const { dbAll } = require('@quickloan/backend-core/services/dbHelpers');
const { requireStaff } = require('@quickloan/backend-core/core/auth');
const { parseApp } = require('@quickloan/backend-core/core/applications');
const { groupOf } = require('@quickloan/backend-core/services/workflow');

function register(app, { flowRoutes }) {
  // --- Applications -----------------------------------------------------------
  app.get('/api/applications', requireStaff(), async (_req, res) => {
    // 3-step flow applications are only marked isSubmitted after the last step, but staff must see them
    // from registration on (step 1 and 2 need a Back Office decision), so include every flow application.
    const rows = await dbAll(
      'SELECT * FROM applications WHERE isSubmitted = 1 OR flowVersion = 2 ORDER BY COALESCE(submittedAt, updatedAt, createdAt) DESC'
    );
    res.json({
      success: true,
      applications: rows.map((row) => {
        const app = parseApp(row);
        if (!app.flowStatus) return app;
        // Flow applications: bank account number masked; staff reveal it (audited) via GET /api/flow/applications/:id?revealBank=1.
        // Legacy rows are left whole because the Back Office saves them back through PUT /api/applications/:id.
        const masked = { ...app, group: groupOf(app.flowStatus) };
        if (masked.bankAccount) masked.bankAccount = flowRoutes.maskBank(masked.bankAccount);
        if (masked.step3Data && masked.step3Data.bank) masked.step3Data = { ...masked.step3Data, bank: flowRoutes.maskBank(masked.step3Data.bank) };
        return masked;
      }),
    });
  });
}

module.exports = { register };
