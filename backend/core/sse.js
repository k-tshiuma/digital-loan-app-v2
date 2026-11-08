// Real-time updates via Server-Sent Events (Phase 4). Clients are held in memory in this process.
const sseClients = new Map(); // applicationId -> Set<res>

function broadcastAppEvent(applicationId, event, payload) {
  const clients = sseClients.get(applicationId);
  if (!clients || clients.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((res) => res.write(frame));
}

module.exports = { sseClients, broadcastAppEvent };
