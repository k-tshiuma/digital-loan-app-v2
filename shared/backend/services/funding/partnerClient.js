/**
 * HTTP client for the funding partner's API: mutual TLS on every request (our client certificate, their CA
 * only), and an OAuth2 client-credentials token that is cached until shortly before it expires. A 401 from
 * the API drops the cached token and asks for a new one once.
 *
 * Every failure is a PartnerError with `transient` set when trying again may help (network errors,
 * timeouts, 429 and 5xx), so the caller can retry those and stop on the rest.
 */
const fs = require('fs');
const https = require('https');

class PartnerError extends Error {
  constructor(code, message, { status = null, transient = false, details = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.transient = transient;
    this.details = details;
  }
}

function createPartnerClient(cfg) {
  const agent = new https.Agent({
    cert: fs.readFileSync(cfg.certFile),
    key: fs.readFileSync(cfg.keyFile),
    ca: fs.readFileSync(cfg.caFile),
    keepAlive: true,
    maxSockets: 4,
  });
  let cached = null; // { token, expiresAt }

  function rawRequest(method, path, { headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(cfg.url + path);
      const req = https.request(url, { method, agent, headers: { Accept: 'application/json', ...headers }, timeout: cfg.timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      });
      req.on('timeout', () => req.destroy(new PartnerError('PARTNER_TIMEOUT', `No answer from the partner within ${cfg.timeoutMs} ms.`, { transient: true })));
      req.on('error', (err) => reject(err instanceof PartnerError ? err
        : new PartnerError('PARTNER_UNREACHABLE', `Could not reach the partner: ${err.code || err.message}`, { transient: true })));
      if (body) req.write(body);
      req.end();
    });
  }

  async function getToken() {
    if (cached && cached.expiresAt > Date.now() + 30000) return cached.token;
    const basic = Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64');
    const r = await rawRequest('POST', '/oauth/token', {
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (r.status !== 200 || !r.json || !r.json.access_token) {
      const transient = r.status >= 500 || r.status === 429;
      throw new PartnerError(transient ? 'PARTNER_ERROR' : 'PARTNER_AUTH_FAILED',
        `The partner refused our credentials (HTTP ${r.status}${r.json && r.json.error ? `: ${r.json.error}` : ''}).`, { status: r.status, transient });
    }
    cached = { token: r.json.access_token, expiresAt: Date.now() + (Number(r.json.expires_in) || 300) * 1000 };
    return cached.token;
  }

  async function call(method, path, { json, headers = {} } = {}) {
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const send = async () => rawRequest(method, path, {
      headers: { Authorization: `Bearer ${await getToken()}`, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}), ...headers },
      body,
    });
    let r = await send();
    if (r.status === 401) { cached = null; r = await send(); }
    return r;
  }

  const errorFrom = (r, fallbackCode) => {
    const e = (r.json && r.json.error) || {};
    const transient = r.status >= 500 || r.status === 429;
    const code = transient ? 'PARTNER_ERROR' : r.status === 422 ? 'PARTNER_VALIDATION' : r.status === 401 || r.status === 403 ? 'PARTNER_AUTH_FAILED' : fallbackCode;
    return new PartnerError(code, `${e.message || `HTTP ${r.status}`}${e.code ? ` (${e.code})` : ''}`, { status: r.status, transient, details: e.details || null });
  };

  /** Submits a loan application. Returns { reference, status, replayed }. */
  async function submitApplication(payload, idempotencyKey) {
    const r = await call('POST', '/v1/loan-applications', { json: payload, headers: { 'Idempotency-Key': idempotencyKey } });
    if (r.status === 200 || r.status === 201 || r.status === 202) {
      return { reference: r.json.reference, status: r.json.status, replayed: r.headers['idempotent-replayed'] === 'true', httpStatus: r.status };
    }
    // The partner already has this application (sent before, the answer got lost): treat as received.
    if (r.status === 409 && r.json && r.json.error && r.json.error.code === 'DUPLICATE_APPLICATION' && r.json.error.reference) {
      return { reference: r.json.error.reference, status: 'RECEIVED', replayed: true, httpStatus: r.status };
    }
    throw errorFrom(r, 'PARTNER_REFUSED');
  }

  /** The partner's current view of an application: { status, decision, fundingReference }. */
  async function getApplication(reference) {
    const r = await call('GET', `/v1/loan-applications/${encodeURIComponent(reference)}`);
    if (r.status === 200 && r.json) return r.json;
    throw errorFrom(r, 'PARTNER_REFUSED');
  }

  return { submitApplication, getApplication, close: () => agent.destroy() };
}

module.exports = { createPartnerClient, PartnerError };
