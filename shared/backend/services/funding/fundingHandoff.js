/**
 * "Push to partner": sends an approved loan to the funding partner and follows it until the partner decides.
 *
 *   push(id, req)          staff action. Checks the loan (approved, not repaid), the applicant's consent and
 *                          that it was not sent already; builds the package; sends it, retrying temporary errors
 *                          (FUNDING_MAX_ATTEMPTS, waits doubling from FUNDING_RETRY_BASE_MS). A failed hand-off
 *                          can be pushed again: it reuses the row, and the idempotency key when the last error
 *                          was temporary (the partner may have received it), so the partner never opens it twice.
 *   refresh(handoff, req)  asks the partner for its status; the poller does it for open hand-offs every
 *                          FUNDING_POLL_MS, staff can do it with "Check status".
 *   requestConsent(id, req) reminds the applicant to accept the terms version that covers the transfer.
 *
 * Statuses: SENDING -> SENT (partner RECEIVED) -> IN_REVIEW -> APPROVED | REJECTED, or FAILED (can be pushed
 * again). When the partner receives the loan, the application's status becomes "Forwarded to Funding Entity"
 * (flowStatus stays LOAN_APPROVED). Every step is in audit_log; the applicant is told at SENT, APPROVED and
 * REJECTED. Personal data and documents are never stored here, only a summary and the package's hash.
 */
const crypto = require('crypto');
const { dbGet, dbAll, dbRun, newId, safeJson } = require('../dbHelpers');
const W = require('../workflow');
const { readPartnerConfig, publicPartnerInfo } = require('./config');
const { createPartnerClient, PartnerError } = require('./partnerClient');
const { buildPayload, summarize, payloadHash, PayloadError } = require('./payload');
const { partnerConsentAcceptance } = require('./consent');

const STATUS = { SENDING: 'SENDING', SENT: 'SENT', IN_REVIEW: 'IN_REVIEW', APPROVED: 'APPROVED', REJECTED: 'REJECTED', FAILED: 'FAILED' };
const OPEN_STATUSES = [STATUS.SENT, STATUS.IN_REVIEW];
const TRANSIENT_CODES = ['PARTNER_UNREACHABLE', 'PARTNER_TIMEOUT', 'PARTNER_ERROR'];
const PARTNER_STATUS_MAP = { RECEIVED: STATUS.SENT, IN_COMPLIANCE_REVIEW: STATUS.IN_REVIEW, APPROVED: STATUS.APPROVED, REJECTED: STATUS.REJECTED };
const FORWARDED = 'Forwarded to Funding Entity';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isUniqueError = (err) => err && /UNIQUE|SQLITE_CONSTRAINT/i.test(`${err.code} ${err.message}`);

function handoffView(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicationId: row.applicationId,
    partnerCode: row.partnerCode,
    status: row.status,
    externalReference: row.externalReference,
    partnerStatus: row.partnerStatus,
    decisionReason: row.decisionReason,
    attemptCount: row.attemptCount,
    payloadSha256: row.payloadSha256,
    requestSummary: safeJson(row.requestSummary, null),
    responseStatus: row.responseStatus,
    responseSummary: safeJson(row.responseSummary, null),
    errorCode: row.errorCode,
    error: row.error,
    retryable: row.status === STATUS.FAILED,
    pushedByName: row.pushedByName,
    pushedByRole: row.pushedByRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastAttemptAt: row.lastAttemptAt,
    lastCheckedAt: row.lastCheckedAt,
    completedAt: row.completedAt,
  };
}

/**
 * @param {object} deps
 * @param {Function} deps.getFlowAppById  from routes/flow.js
 * @param {Function} deps.updateFlowApp
 * @param {Function} deps.audit           audit(req, { applicationId, action, metadata, actor })
 * @param {object}   deps.notifier        createFlowNotifier(...)
 * @param {string}   deps.uploadDir
 */
function createFundingService({ getFlowAppById, updateFlowApp, audit, notifier, uploadDir, readConfig = readPartnerConfig }) {
  let cfg = readConfig();
  let client = null;
  const config = () => {
    if (!cfg.configured) { cfg = readConfig(); client = null; } // e.g. the sandbox certificates were created since
    return cfg;
  };
  const partner = () => { if (!client) client = createPartnerClient(config()); return client; };
  const SYSTEM = { type: 'system', id: null, role: null, name: 'Funding status check' };
  const notify = (app, event) => notifier.notifyFlowEvent({ app, event }).catch((err) => console.error('[FUNDING NOTIFY]', err.message));

  async function listHandoffs(applicationId) {
    return (await dbAll('SELECT * FROM funding_handoffs WHERE applicationId = ? ORDER BY createdAt DESC', [applicationId])).map(handoffView);
  }

  /** Everything the Back Office's Funding panel shows. */
  async function overview(a, role) {
    const c = config();
    const consent = await partnerConsentAcceptance(a.id);
    const handoffs = await listHandoffs(a.id);
    const active = handoffs.find((h) => h.status !== STATUS.FAILED && h.partnerCode === c.code) || null;
    const eligible = a.flowStatus === W.FLOW_STATUS.LOAN_APPROVED && !a.loanRepaidAt;
    const mayPush = W.FUNDING_PUSH_ROLES.includes(role);
    // Why the loan can't be pushed right now (null when it can), so the Back Office can say so next to the button.
    const pushBlockedBy = !mayPush ? 'ROLE'
      : a.flowStatus !== W.FLOW_STATUS.LOAN_APPROVED ? 'NOT_APPROVED'
        : a.loanRepaidAt ? 'LOAN_REPAID'
          : active ? 'ALREADY_SENT'
            : !consent ? 'PARTNER_CONSENT_REQUIRED'
              : !c.configured ? 'FUNDING_PARTNER_NOT_CONFIGURED'
                : null;
    return {
      pushBlockedBy,
      partner: publicPartnerInfo(c),
      consent: { given: !!consent, version: consent ? consent.version : null, acceptedAt: consent ? consent.acceptedAt : null },
      handoffs,
      permissions: {
        push: W.FUNDING_PUSH_ROLES.includes(role) && eligible && !!consent && !active && c.configured,
        requestConsent: W.FUNDING_PUSH_ROLES.includes(role) && eligible && !consent,
        refresh: W.FUNDING_PUSH_ROLES.includes(role) && !!active && OPEN_STATUSES.includes(active.status) && c.configured,
      },
    };
  }

  /** Claims the hand-off row for this push. Returns { row } or { conflict }. */
  async function claim(a, c, req) {
    const now = new Date().toISOString();
    const by = [req.auth.sub, req.auth.name || req.auth.role, req.auth.role];
    const open = await dbGet("SELECT * FROM funding_handoffs WHERE applicationId = ? AND partnerCode = ? AND status <> 'FAILED'", [a.id, c.code]);
    if (open) return { conflict: open };
    const failed = await dbGet("SELECT * FROM funding_handoffs WHERE applicationId = ? AND partnerCode = ? AND status = 'FAILED' ORDER BY createdAt DESC LIMIT 1", [a.id, c.code]);
    try {
      if (failed) {
        // The partner may have received the last try if it failed on the way back: keep the key so it can say so.
        const key = TRANSIENT_CODES.includes(failed.errorCode) ? failed.idempotencyKey : crypto.randomUUID();
        const r = await dbRun(
          `UPDATE funding_handoffs SET status = 'SENDING', idempotencyKey = ?, errorCode = NULL, error = NULL, pushedById = ?, pushedByName = ?, pushedByRole = ?, updatedAt = ?
           WHERE id = ? AND status = 'FAILED'`,
          [key, ...by, now, failed.id]
        );
        if (r.changes !== 1) return { conflict: await dbGet('SELECT * FROM funding_handoffs WHERE id = ?', [failed.id]) };
        return { row: await dbGet('SELECT * FROM funding_handoffs WHERE id = ?', [failed.id]), retry: true };
      }
      const id = newId('fund');
      await dbRun(
        `INSERT INTO funding_handoffs (id, applicationId, partnerCode, status, idempotencyKey, attemptCount, pushedById, pushedByName, pushedByRole, createdAt, updatedAt)
         VALUES (?, ?, ?, 'SENDING', ?, 0, ?, ?, ?, ?, ?)`,
        [id, a.id, c.code, crypto.randomUUID(), ...by, now, now]
      );
      return { row: await dbGet('SELECT * FROM funding_handoffs WHERE id = ?', [id]), retry: false };
    } catch (err) {
      if (isUniqueError(err)) return { conflict: await dbGet("SELECT * FROM funding_handoffs WHERE applicationId = ? AND partnerCode = ? AND status <> 'FAILED'", [a.id, c.code]) };
      throw err;
    }
  }

  async function markForwarded(applicationId, req, reference) {
    const cur = await getFlowAppById(applicationId);
    if (!cur || cur.status !== 'Approved') return cur;
    const now = new Date().toISOString();
    const next = {
      ...cur,
      status: FORWARDED,
      updatedAt: now,
      statusHistory: [{
        id: newId('sh'), applicationId, fromStatus: cur.status, toStatus: FORWARDED, changedByType: req.auth.role,
        changedById: req.auth.sub, changedByName: req.auth.name || req.auth.role, reason: `Funding partner reference ${reference}`, createdAt: now,
      }, ...(cur.statusHistory || [])],
    };
    await updateFlowApp(next, W.FLOW_STATUS.LOAN_APPROVED);
    return getFlowAppById(applicationId);
  }

  /** Returns { status, body } for the route to send. */
  async function push(applicationId, req) {
    const a = await getFlowAppById(applicationId);
    if (!a) return { status: 404, body: { success: false, error: 'Application not found' } };
    if (a.flowStatus !== W.FLOW_STATUS.LOAN_APPROVED) return { status: 409, body: { success: false, code: 'NOT_APPROVED', error: 'Only an approved loan can be sent to the funding partner.' } };
    if (a.loanRepaidAt) return { status: 409, body: { success: false, code: 'LOAN_REPAID', error: 'This loan is already repaid.' } };
    const acceptance = await partnerConsentAcceptance(a.id);
    if (!acceptance) {
      return { status: 409, body: { success: false, code: 'PARTNER_CONSENT_REQUIRED', error: 'The applicant has not accepted the terms that allow sending their application to the funding partner.' } };
    }
    const c = config();
    if (!c.configured) return { status: 503, body: { success: false, code: 'FUNDING_PARTNER_NOT_CONFIGURED', error: c.problem } };

    const claimed = await claim(a, c, req);
    if (claimed.conflict) {
      const h = claimed.conflict;
      const code = h.status === STATUS.SENDING ? 'HANDOFF_IN_PROGRESS' : 'ALREADY_SENT';
      return { status: 409, body: { success: false, code, error: code === 'HANDOFF_IN_PROGRESS' ? 'This loan is being sent right now.' : 'This loan was already sent to the funding partner.', handoff: handoffView(h) } };
    }
    const h = claimed.row;
    const user = await dbGet('SELECT id, fullName, email, phoneNumber FROM users WHERE id = ?', [a.userId]);

    let payload;
    try {
      payload = buildPayload(a, user, acceptance, uploadDir, { id: h.id, createdAt: h.createdAt });
    } catch (err) {
      if (!(err instanceof PayloadError)) throw err;
      return fail(h, a, req, new PartnerError(err.code, err.message), claimed.retry);
    }
    const hash = payloadHash(payload);
    await dbRun('UPDATE funding_handoffs SET payloadSha256 = ?, requestSummary = ? WHERE id = ?', [hash, JSON.stringify(summarize(payload)), h.id]);

    let result = null;
    let lastErr = null;
    for (let i = 0; i < c.maxAttempts; i++) {
      if (i > 0) await sleep(c.retryBaseMs * 2 ** (i - 1));
      await dbRun('UPDATE funding_handoffs SET attemptCount = attemptCount + 1, lastAttemptAt = ? WHERE id = ?', [new Date().toISOString(), h.id]);
      try {
        result = await partner().submitApplication(payload, h.idempotencyKey);
        break;
      } catch (err) {
        if (!(err instanceof PartnerError)) throw err;
        lastErr = err;
        if (!err.transient) break;
      }
    }
    if (!result) return fail(h, a, req, lastErr, claimed.retry);

    const now = new Date().toISOString();
    const status = PARTNER_STATUS_MAP[result.status] || STATUS.SENT;
    await dbRun(
      `UPDATE funding_handoffs SET status = ?, externalReference = ?, partnerStatus = ?, responseStatus = ?, responseSummary = ?, updatedAt = ?, lastCheckedAt = ? WHERE id = ?`,
      [status, result.reference, result.status, result.httpStatus, JSON.stringify({ reference: result.reference, status: result.status, replayed: result.replayed }), now, now, h.id]
    );
    await audit(req, {
      applicationId: a.id, action: 'FUNDING_SENT', fromStatus: a.status, toStatus: FORWARDED,
      metadata: { handoffId: h.id, partner: c.code, reference: result.reference, attempts: (await dbGet('SELECT attemptCount FROM funding_handoffs WHERE id = ?', [h.id])).attemptCount, retry: claimed.retry, payloadSha256: hash },
    });
    const saved = await markForwarded(a.id, req, result.reference);
    if (saved) notify(saved, 'FUNDING_SENT');
    return { status: 200, body: { success: true, handoff: handoffView(await dbGet('SELECT * FROM funding_handoffs WHERE id = ?', [h.id])) } };
  }

  async function fail(h, a, req, err, retry) {
    const now = new Date().toISOString();
    const details = Array.isArray(err.details) ? err.details.map((d) => `${d.field}: ${d.issue}`).slice(0, 20).join('; ') : '';
    await dbRun(
      'UPDATE funding_handoffs SET status = ?, errorCode = ?, error = ?, responseStatus = ?, updatedAt = ? WHERE id = ?',
      [STATUS.FAILED, err.code, (details ? `${err.message} — ${details}` : err.message).slice(0, 2000), err.status, now, h.id]
    );
    await audit(req, { applicationId: a.id, action: 'FUNDING_PUSH_FAILED', metadata: { handoffId: h.id, code: err.code, status: err.status, retry, transient: !!err.transient } });
    const row = await dbGet('SELECT * FROM funding_handoffs WHERE id = ?', [h.id]);
    return { status: 502, body: { success: false, code: err.code, error: row.error, handoff: handoffView(row) } };
  }

  /** Asks the partner for the status of one open hand-off. Returns the hand-off view. */
  async function refresh(row, req) {
    if (!OPEN_STATUSES.includes(row.status) || !row.externalReference) return handoffView(row);
    const view = await partner().getApplication(row.externalReference);
    const now = new Date().toISOString();
    const status = PARTNER_STATUS_MAP[view.status] || row.status;
    const decision = view.decision || null;
    const changed = status !== row.status;
    const done = status === STATUS.APPROVED || status === STATUS.REJECTED;
    const r = await dbRun(
      `UPDATE funding_handoffs SET status = ?, partnerStatus = ?, decisionReason = ?, responseSummary = ?, lastCheckedAt = ?, updatedAt = ?, completedAt = ?
       WHERE id = ? AND status = ?`,
      [status, view.status, decision ? decision.reason || decision.reasonCode || null : null,
        JSON.stringify({ reference: view.reference, status: view.status, decision, fundingReference: view.fundingReference || null }),
        now, changed ? now : row.updatedAt, done ? now : null, row.id, row.status]
    );
    // Only the process that made the change reports it (the poller and a staff click may run together).
    if (changed && r.changes === 1 && done) {
      const action = status === STATUS.APPROVED ? 'FUNDING_APPROVED' : 'FUNDING_REJECTED';
      await audit(req, {
        applicationId: row.applicationId, action, actor: req ? undefined : SYSTEM,
        metadata: { handoffId: row.id, reference: row.externalReference, reasonCode: decision && decision.reasonCode, reason: decision && decision.reason, fundingReference: view.fundingReference || null },
      });
      const app = await getFlowAppById(row.applicationId);
      if (app) notify(app, action);
    }
    return handoffView(await dbGet('SELECT * FROM funding_handoffs WHERE id = ?', [row.id]));
  }

  async function refreshForApplication(applicationId, req) {
    const c = config();
    if (!(await getFlowAppById(applicationId))) return { status: 404, body: { success: false, error: 'Application not found' } };
    const row = await dbGet(`SELECT * FROM funding_handoffs WHERE applicationId = ? AND partnerCode = ? AND status IN ('SENT', 'IN_REVIEW')`, [applicationId, c.code]);
    if (!row) return { status: 409, body: { success: false, code: 'NOTHING_TO_CHECK', error: 'There is no hand-off waiting for the partner.' } };
    if (!c.configured) return { status: 503, body: { success: false, code: 'FUNDING_PARTNER_NOT_CONFIGURED', error: c.problem } };
    try {
      return { status: 200, body: { success: true, handoff: await refresh(row, req) } };
    } catch (err) {
      if (!(err instanceof PartnerError)) throw err;
      return { status: 502, body: { success: false, code: err.code, error: err.message } };
    }
  }

  async function requestConsent(applicationId, req) {
    const a = await getFlowAppById(applicationId);
    if (!a) return { status: 404, body: { success: false, error: 'Application not found' } };
    if (a.flowStatus !== W.FLOW_STATUS.LOAN_APPROVED || a.loanRepaidAt) return { status: 409, body: { success: false, code: 'NOT_APPROVED', error: 'Only an approved loan needs this consent.' } };
    if (await partnerConsentAcceptance(a.id)) return { status: 409, body: { success: false, code: 'CONSENT_ALREADY_GIVEN', error: 'The applicant has already accepted these terms.' } };
    await audit(req, { applicationId: a.id, action: 'PARTNER_CONSENT_REQUESTED' });
    const delivery = await notifier.notifyFlowEvent({ app: a, event: 'PARTNER_CONSENT_REQUESTED' });
    return { status: 200, body: { success: true, delivery } };
  }

  /** One pass over the open hand-offs (the admin API's poller). */
  let polling = false;
  async function pollOpen() {
    const c = config();
    if (!c.configured || polling) return 0;
    polling = true;
    try {
      const rows = await dbAll(`SELECT * FROM funding_handoffs WHERE partnerCode = ? AND status IN ('SENT', 'IN_REVIEW') ORDER BY lastCheckedAt ASC LIMIT 50`, [c.code]);
      for (const row of rows) {
        try { await refresh(row, null); } catch (err) { console.warn(`[FUNDING] status check for ${row.id} failed: ${err.message}`); }
      }
      return rows.length;
    } finally {
      polling = false;
    }
  }

  function startPoller() {
    const ms = config().pollMs;
    if (!ms || ms <= 0) return null;
    const timer = setInterval(() => { pollOpen().catch((err) => console.warn('[FUNDING] poll failed:', err.message)); }, ms);
    timer.unref();
    return timer;
  }

  return { overview, listHandoffs, push, refreshForApplication, requestConsent, pollOpen, startPoller, config };
}

module.exports = { createFundingService, STATUS, handoffView };
