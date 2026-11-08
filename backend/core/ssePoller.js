// Live status updates across processes. Staff decisions are made in the admin backend, whose broadcasts
// reach only its own (empty) set of streams. The borrower backend therefore checks, every few seconds,
// the applications that have an open status stream here, and sends the same events the single backend
// sent: 'status' when the status or flow status changed, 'updated' when only the row changed.
const { dbAll } = require('../services/dbHelpers');
const { sseClients, lastSent, broadcastAppEvent } = require('./sse');

async function checkOnce() {
  const ids = [...sseClients.keys()].filter((id) => sseClients.get(id).size > 0);
  if (ids.length === 0) return;
  const rows = await dbAll(
    `SELECT id, status, flowStatus, updatedAt FROM applications WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  for (const row of rows) {
    const seen = lastSent.get(row.id);
    if (!seen) {
      // First look at this application: remember where it is, nothing to report yet.
      lastSent.set(row.id, { status: row.status, flowStatus: row.flowStatus, updatedAt: row.updatedAt });
      continue;
    }
    if (seen.updatedAt === row.updatedAt) continue;
    if (seen.status !== row.status || seen.flowStatus !== row.flowStatus) {
      broadcastAppEvent(row.id, 'status', {
        applicationId: row.id,
        previousStatus: seen.status || null,
        status: row.status,
        flowStatus: row.flowStatus,
        updatedAt: row.updatedAt,
      });
    } else {
      broadcastAppEvent(row.id, 'updated', { applicationId: row.id, status: row.status, updatedAt: row.updatedAt });
    }
  }
}

/** Starts polling; returns a function that stops it. A failed check is logged and retried next time. */
function startStatusPoller({ intervalMs = 5000 } = {}) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await checkOnce();
    } catch (err) {
      console.warn('[SSE POLL]', err.message);
    } finally {
      running = false;
    }
  }, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

module.exports = { startStatusPoller, checkOnce };
