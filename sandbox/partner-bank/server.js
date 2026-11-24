/**
 * Partner-bank sandbox: a stand-in for a bank's loan-origination API, so the "Push to partner" hand-off can
 * be built and tested end to end without a real bank. It behaves the way a bank API usually does:
 *
 *   - HTTPS with mutual TLS: the client must show a certificate signed by the client CA (certs.js).
 *   - An IP allowlist (PARTNER_SANDBOX_ALLOWED_IPS, default loopback only).
 *   - OAuth2 client credentials: POST /oauth/token (client_secret_basic or form fields) gives a Bearer token
 *     bound to the client certificate that asked for it (RFC 8705), valid for 15 minutes.
 *   - POST /v1/loan-applications with an Idempotency-Key header: the same key and body gives back the same
 *     answer; the same key with a different body is refused (409).
 *   - GET /v1/loan-applications/:reference: RECEIVED, then IN_COMPLIANCE_REVIEW, then APPROVED or REJECTED
 *     after PARTNER_SANDBOX_REVIEW_MS (default 20 s), from simple compliance rules (see decide()).
 *
 * Sandbox-only controls (mutual TLS, no OAuth token), for demos and tests:
 *   GET  /sandbox/applications                     what the bank has received (no document contents)
 *   POST /sandbox/applications/:reference/decision { decision: 'APPROVED' | 'REJECTED', reason }
 *   POST /sandbox/faults                           { next: [{ status: 503 }, { delayMs: 5000 }, ...] } queued
 *                                                   for the next loan-application submissions
 *   POST /sandbox/reset                            forget everything
 *
 * Run: node sandbox/partner-bank/server.js   (creates the certificates first if they are missing)
 * Settings: PARTNER_SANDBOX_PORT (5300), PARTNER_SANDBOX_HOST (127.0.0.1), PARTNER_SANDBOX_CLIENT_ID and
 * PARTNER_SANDBOX_CLIENT_SECRET (defaults below), PARTNER_SANDBOX_CLIENT_CN, PARTNER_SANDBOX_ALLOWED_IPS,
 * PARTNER_SANDBOX_REVIEW_MS, PARTNER_SANDBOX_STORE (a JSON file; ':memory:' keeps nothing).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { ensureCerts, CLIENT_CN } = require('./certs');

const SCHEMA_VERSION = 'quickloan.loan-application.v1';
const DEFAULT_CLIENT_ID = 'quickloan-sandbox';
const DEFAULT_CLIENT_SECRET = 'sandbox-secret-change-me';
const TOKEN_TTL_S = 15 * 60;
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const REQUIRED_DOCS = ['PASSPORT', 'WORK_VISA', 'PAY_SLIP', 'BANK_ACCOUNT_DOCUMENT'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const nowIso = () => new Date().toISOString();
const normalizeIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

function createSandbox(options = {}) {
  const o = {
    clientId: process.env.PARTNER_SANDBOX_CLIENT_ID || DEFAULT_CLIENT_ID,
    clientSecret: process.env.PARTNER_SANDBOX_CLIENT_SECRET || DEFAULT_CLIENT_SECRET,
    clientCn: process.env.PARTNER_SANDBOX_CLIENT_CN || CLIENT_CN,
    allowedIps: (process.env.PARTNER_SANDBOX_ALLOWED_IPS || '127.0.0.1,::1').split(',').map((s) => normalizeIp(s.trim())).filter(Boolean),
    reviewMs: parseInt(process.env.PARTNER_SANDBOX_REVIEW_MS || '20000', 10),
    store: process.env.PARTNER_SANDBOX_STORE || path.join(__dirname, 'data', 'store.json'),
    log: (...a) => console.log('[partner-bank]', ...a),
    ...options,
  };
  const certs = o.certs || ensureCerts();

  // --- state ----------------------------------------------------------------
  const tokens = new Map(); // access token -> { clientId, certFingerprint, expiresAt }
  let faults = [];
  let state = { applications: {}, idempotency: {} };
  const persistent = o.store && o.store !== ':memory:';
  if (persistent && fs.existsSync(o.store)) {
    try { state = JSON.parse(fs.readFileSync(o.store, 'utf8')); } catch { /* start empty */ }
  }
  const save = () => {
    if (!persistent) return;
    fs.mkdirSync(path.dirname(o.store), { recursive: true });
    fs.writeFileSync(o.store, JSON.stringify(state, null, 2));
  };

  // --- helpers --------------------------------------------------------------
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, message, extra = {}) => send(res, status, { error: { code, message, ...extra } });

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const certFingerprint = (req) => {
    const c = req.socket.getPeerCertificate && req.socket.getPeerCertificate();
    return c && c.fingerprint256 ? c.fingerprint256 : null;
  };

  function bearer(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    const t = tokens.get(m[1]);
    if (!t || t.expiresAt < Date.now()) return null;
    if (t.certFingerprint !== certFingerprint(req)) return null; // token used with another certificate
    return t;
  }

  /** Simple compliance rules, so the sandbox approves most good applications and declines a few. */
  function decide(app) {
    const p = app.payload;
    const loan = p.loan || {};
    const months = Number(loan.repaymentPeriodMonths) || 0;
    const loanEnds = new Date(app.receivedAt);
    loanEnds.setMonth(loanEnds.getMonth() + months);
    const visaExpiry = p.applicant && p.applicant.visa && p.applicant.visa.expiryDate;
    if (visaExpiry && new Date(visaExpiry) < loanEnds) {
      return { outcome: 'REJECTED', reasonCode: 'VISA_EXPIRES_BEFORE_LOAN_END', reason: 'The work visa expires before the last repayment.' };
    }
    const salary = Number(p.employment && p.employment.monthlySalaryNis) || 0;
    const monthly = Number(loan.monthlyPaymentTotalNis) || 0;
    if (salary && monthly && monthly > salary * 0.4) {
      return { outcome: 'REJECTED', reasonCode: 'AFFORDABILITY', reason: 'The monthly payment is more than 40% of the salary.' };
    }
    if (!Array.isArray(p.sponsors) || p.sponsors.length === 0) {
      return { outcome: 'REJECTED', reasonCode: 'NO_SPONSOR', reason: 'At least one sponsor is required.' };
    }
    return { outcome: 'APPROVED', reasonCode: 'COMPLIANCE_PASSED', reason: 'Identity, AML and credit checks passed.' };
  }

  function currentView(app) {
    if (!app.decision) {
      const elapsed = Date.now() - Date.parse(app.receivedAt);
      if (elapsed >= o.reviewMs) {
        app.decision = { ...decide(app), decidedAt: nowIso() };
        if (app.decision.outcome === 'APPROVED') app.fundingReference = `SBX-FUND-${crypto.randomInt(100000, 999999)}`;
        save();
      }
    }
    const status = app.decision ? app.decision.outcome : (Date.now() - Date.parse(app.receivedAt) >= o.reviewMs / 2 ? 'IN_COMPLIANCE_REVIEW' : 'RECEIVED');
    return {
      reference: app.reference,
      externalId: app.externalId,
      status,
      receivedAt: app.receivedAt,
      decision: app.decision || null,
      fundingReference: app.fundingReference || null,
    };
  }

  /** Checks the request body. Returns a list of problems (empty when it is acceptable). */
  function validate(p) {
    const problems = [];
    const need = (cond, field) => { if (!cond) problems.push({ field, issue: 'required' }); };
    if (!p || typeof p !== 'object') return [{ field: '(body)', issue: 'not an object' }];
    if (p.schemaVersion !== SCHEMA_VERSION) problems.push({ field: 'schemaVersion', issue: `must be ${SCHEMA_VERSION}` });
    const a = p.applicant || {};
    need(p.source && p.source.applicationId, 'source.applicationId');
    need(a.fullName, 'applicant.fullName');
    need(a.dateOfBirth, 'applicant.dateOfBirth');
    need(a.passportNumber, 'applicant.passportNumber');
    need(a.countryOfOrigin, 'applicant.countryOfOrigin');
    need(a.phoneNumber, 'applicant.phoneNumber');
    need(a.visa && a.visa.expiryDate, 'applicant.visa.expiryDate');
    need(p.employment && p.employment.monthlySalaryNis > 0, 'employment.monthlySalaryNis');
    const l = p.loan || {};
    need(l.requestedAmountNis > 0, 'loan.requestedAmountNis');
    need(l.repaymentPeriodMonths > 0, 'loan.repaymentPeriodMonths');
    need(l.monthlyPaymentTotalNis > 0, 'loan.monthlyPaymentTotalNis');
    const b = p.bankAccount || {};
    for (const f of ['bankCode', 'branchNumber', 'accountNumber', 'accountHolderName']) need(b[f], `bankAccount.${f}`);
    const c = p.consent || {};
    need(c.termsVersion && c.termsSha256 && c.acceptedAt, 'consent');
    need(c.partnerSharing === true, 'consent.partnerSharing');
    if (!Array.isArray(p.sponsors)) problems.push({ field: 'sponsors', issue: 'must be a list' });
    const docs = Array.isArray(p.documents) ? p.documents : [];
    for (const type of REQUIRED_DOCS) if (!docs.some((d) => d.type === type)) problems.push({ field: 'documents', issue: `missing ${type}` });
    docs.forEach((d, i) => {
      if (!d.contentBase64) { problems.push({ field: `documents[${i}].contentBase64`, issue: 'required' }); return; }
      const buf = Buffer.from(d.contentBase64, 'base64');
      if (sha256(buf) !== d.sha256) problems.push({ field: `documents[${i}].sha256`, issue: 'does not match the content' });
      if (d.size !== undefined && buf.length !== d.size) problems.push({ field: `documents[${i}].size`, issue: 'does not match the content' });
    });
    return problems;
  }

  // --- routes -----------------------------------------------------------------
  async function handle(req, res) {
    const ip = normalizeIp(req.socket.remoteAddress);
    if (!o.allowedIps.includes(ip)) return fail(res, 403, 'IP_NOT_ALLOWED', `Address ${ip} is not on the allowlist.`);
    if (!req.client.authorized) return fail(res, 401, 'CLIENT_CERTIFICATE_REQUIRED', 'A valid client certificate is required.');

    const url = new URL(req.url, 'https://sandbox');
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /health') return send(res, 200, { ok: true, service: 'partner-bank-sandbox' });

    if (route === 'POST /oauth/token') {
      const form = new URLSearchParams((await readBody(req)).toString('utf8'));
      let id = form.get('client_id');
      let secret = form.get('client_secret');
      const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
      if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString('utf8').split(':').map(decodeURIComponent);
      if (form.get('grant_type') !== 'client_credentials') return send(res, 400, { error: 'unsupported_grant_type' });
      const cn = req.socket.getPeerCertificate().subject && req.socket.getPeerCertificate().subject.CN;
      const ok = id === o.clientId && !!secret
        && crypto.timingSafeEqual(Buffer.from(sha256(secret), 'hex'), Buffer.from(sha256(o.clientSecret), 'hex'));
      if (!ok || cn !== o.clientCn) return send(res, 401, { error: 'invalid_client' });
      const token = crypto.randomBytes(32).toString('base64url');
      tokens.set(token, { clientId: id, certFingerprint: certFingerprint(req), expiresAt: Date.now() + TOKEN_TTL_S * 1000 });
      return send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_S, scope: 'loan-applications:write loan-applications:read' });
    }

    if (route === 'GET /sandbox/applications') {
      return send(res, 200, { applications: Object.values(state.applications).map((a) => ({ ...currentView(a), applicant: a.payload.applicant && a.payload.applicant.fullName, documents: a.payload.documents.length })) });
    }
    if (route === 'POST /sandbox/faults') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      faults = Array.isArray(body.next) ? body.next : [];
      return send(res, 200, { queued: faults.length });
    }
    if (route === 'POST /sandbox/reset') {
      state = { applications: {}, idempotency: {} }; faults = []; tokens.clear(); save();
      return send(res, 200, { ok: true });
    }
    let m = /^\/sandbox\/applications\/([^/]+)\/decision$/.exec(url.pathname);
    if (req.method === 'POST' && m) {
      const app = state.applications[m[1]];
      if (!app) return fail(res, 404, 'NOT_FOUND', 'No such application.');
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (!['APPROVED', 'REJECTED'].includes(body.decision)) return fail(res, 400, 'BAD_DECISION', 'decision must be APPROVED or REJECTED');
      app.decision = { outcome: body.decision, reasonCode: 'MANUAL', reason: body.reason || 'Set from the sandbox controls.', decidedAt: nowIso() };
      app.fundingReference = body.decision === 'APPROVED' ? `SBX-FUND-${crypto.randomInt(100000, 999999)}` : null;
      save();
      return send(res, 200, currentView(app));
    }

    // Everything under /v1 needs a Bearer token from /oauth/token, used with the same certificate.
    if (url.pathname.startsWith('/v1/')) {
      if (!bearer(req)) return send(res, 401, { error: { code: 'INVALID_TOKEN', message: 'Missing, expired or not bound to this certificate.' } }, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });

      if (route === 'POST /v1/loan-applications') {
        const raw = await readBody(req);
        const fault = faults.shift();
        if (fault && fault.delayMs) await new Promise((r) => setTimeout(r, fault.delayMs));
        if (fault && fault.status) return fail(res, fault.status, 'SANDBOX_FAULT', 'Simulated failure from /sandbox/faults.');
        const key = String(req.headers['idempotency-key'] || '');
        if (!key || key.length > 200) return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (up to 200 characters).');
        const bodyHash = sha256(raw);
        const seen = state.idempotency[key];
        if (seen) {
          if (seen.bodyHash !== bodyHash) return fail(res, 409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with a different request.');
          return send(res, seen.status, seen.body, { 'Idempotent-Replayed': 'true' });
        }
        let payload;
        try { payload = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, 'BAD_JSON', 'The body is not valid JSON.'); }
        const problems = validate(payload);
        if (problems.length) return fail(res, 422, 'VALIDATION', 'The application is incomplete.', { details: problems });
        const existing = Object.values(state.applications).find((a) => a.externalId === payload.source.applicationId);
        if (existing) return fail(res, 409, 'DUPLICATE_APPLICATION', 'This application was already received.', { reference: existing.reference });

        const reference = `SBX-LN-${crypto.randomInt(100000, 999999)}`;
        // The bank keeps the data; this sandbox drops the document contents and keeps their hashes.
        const stored = { ...payload, documents: payload.documents.map(({ contentBase64, ...d }) => d) };
        state.applications[reference] = { reference, externalId: payload.source.applicationId, receivedAt: nowIso(), payload: stored, decision: null };
        const body = { reference, status: 'RECEIVED', receivedAt: state.applications[reference].receivedAt };
        state.idempotency[key] = { bodyHash, status: 202, body };
        save();
        o.log(`received ${payload.source.requestNumber || payload.source.applicationId} as ${reference} (${payload.documents.length} documents)`);
        return send(res, 202, body);
      }

      m = /^\/v1\/loan-applications\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const app = state.applications[m[1]];
        if (!app) return fail(res, 404, 'NOT_FOUND', 'No such application.');
        return send(res, 200, currentView(app));
      }
    }
    return fail(res, 404, 'NOT_FOUND', 'Not found.');
  }

  const server = https.createServer({
    key: fs.readFileSync(certs.serverKey),
    cert: fs.readFileSync(certs.serverCert),
    ca: fs.readFileSync(certs.clientCa),
    requestCert: true,
    rejectUnauthorized: false, // answer 401 with a reason instead of dropping the connection
  }, (req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return;
      fail(res, err.status || 500, err.status === 413 ? 'TOO_LARGE' : 'SERVER_ERROR', err.status === 413 ? 'The request is too large.' : 'Unexpected error.');
    });
  });
  return { server, options: o, certs };
}

module.exports = { createSandbox, SCHEMA_VERSION, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET };

if (require.main === module) {
  const { server, options, certs } = createSandbox();
  const port = parseInt(process.env.PARTNER_SANDBOX_PORT || '5300', 10);
  const host = process.env.PARTNER_SANDBOX_HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`[partner-bank] sandbox on https://${host === '127.0.0.1' ? 'localhost' : host}:${port} (mutual TLS, OAuth2 client credentials)`);
    console.log(`[partner-bank] client id ${options.clientId}; certificates in ${path.dirname(certs.serverCert)}; decisions after ${options.reviewMs / 1000} s`);
  });
}
