// Real-time updates via Server-Sent Events (Phase 4). Clients are held in memory in this process.
const sseClients = new Map(); // applicationId -> Set<res>

// The last state sent to each application's stream, so the status poller (ssePoller.js) does not repeat
// an event this process already sent. applicationId -> { status, flowStatus, updatedAt }
const lastSent = new Map();

function broadcastAppEvent(applicationId, event, payload) {
  const clients = sseClients.get(applicationId);
  if (!clients || clients.size === 0) return;
  if (payload && payload.updatedAt) {
    const prev = lastSent.get(applicationId) || {};
    lastSent.set(applicationId, {
      status: payload.status !== undefined ? payload.status : prev.status,
      flowStatus: payload.flowStatus !== undefined ? payload.flowStatus : prev.flowStatus,
      updatedAt: payload.updatedAt,
    });
  }
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((res) => res.write(frame));
}

module.exports = { sseClients, lastSent, broadcastAppEvent };
