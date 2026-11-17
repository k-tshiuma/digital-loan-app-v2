/**
 * The configured service (agent) fee, set by a system admin in the Back Office ("Credit Policy &
 * Config") and stored in app_config under `serviceFeeNis`. Both APIs read it from the database on
 * every use, so a change made on the admin API applies at once on the borrower API.
 *
 * An application takes the configured fee when its Step 2 is first submitted (stored in
 * loanBreakdown.totalServiceFeeNis) and keeps it through Step 3 and the final decision; see
 * lockedServiceFee() and routes/flow.js.
 */
const { dbGet, dbRun } = require('./dbHelpers');
const { SERVICE_FEE_NIS } = require('./loanCalculator');

const CONFIG_KEY = 'serviceFeeNis';
const DEFAULT_SERVICE_FEE_NIS = SERVICE_FEE_NIS;
const MIN_SERVICE_FEE_NIS = 0;
const MAX_SERVICE_FEE_NIS = 50000;

/** A whole number of NIS within the allowed range, or null. */
function normalizeServiceFee(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_SERVICE_FEE_NIS || n > MAX_SERVICE_FEE_NIS) return null;
  return n;
}

/** The fee new applications get. Falls back to the default when nothing (valid) is stored. */
async function getServiceFeeNis() {
  const row = await dbGet('SELECT value FROM app_config WHERE key = ?', [CONFIG_KEY]);
  if (!row) return DEFAULT_SERVICE_FEE_NIS;
  let stored;
  try { stored = JSON.parse(row.value); } catch { stored = null; }
  const n = normalizeServiceFee(stored);
  return n === null ? DEFAULT_SERVICE_FEE_NIS : n;
}

/** Store a new fee (already normalized). Returns the stored value. */
async function setServiceFeeNis(value) {
  await dbRun(
    `INSERT INTO app_config (key, value, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    [CONFIG_KEY, JSON.stringify(value), new Date().toISOString()]
  );
  return value;
}

/** The fee an application already took at Step 2, or null if it has none yet. */
function lockedServiceFee(app) {
  const fee = app && app.loanBreakdown && app.loanBreakdown.totalServiceFeeNis;
  return typeof fee === 'number' && Number.isFinite(fee) ? fee : null;
}

module.exports = {
  CONFIG_KEY,
  DEFAULT_SERVICE_FEE_NIS,
  MIN_SERVICE_FEE_NIS,
  MAX_SERVICE_FEE_NIS,
  normalizeServiceFee,
  getServiceFeeNis,
  setServiceFeeNis,
  lockedServiceFee,
};
