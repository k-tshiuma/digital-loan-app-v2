# Partner-bank sandbox

A stand-in for the funding partner's API (a bank, later a licensed lender), so "Push to partner" can be
built, demoed and tested without a real bank. The admin API talks to it exactly as it would to a real
partner: HTTPS with mutual TLS, an OAuth2 token, idempotent submission, then status checks.

```
npm run partner:sandbox      # https://localhost:5300
```

The first start creates test certificates in `sandbox/partner-bank/certs/` (gitignored; needs `openssl`, which
comes with Git for Windows). In demo mode the admin API uses the sandbox with no settings at all. Restart
the admin API once after the first sandbox start, or it keeps saying the certificates are missing.

## What it checks

| | |
|---|---|
| Network | Only `PARTNER_SANDBOX_ALLOWED_IPS` (default loopback) |
| Mutual TLS | The client certificate must be signed by `client-ca.crt`, with CN `quickloan-sandbox-client` |
| OAuth2 | `POST /oauth/token`, `grant_type=client_credentials`, client id and secret in HTTP Basic. The token lasts 15 minutes and works only with the certificate that asked for it |
| Submission | `POST /v1/loan-applications` with an `Idempotency-Key` header. Same key and body: the same answer again. Same key, different body: 409. Missing fields, documents or the partner-sharing consent: 422 with a list of problems. Document SHA-256 and size must match |
| Status | `GET /v1/loan-applications/:reference`: `RECEIVED`, `IN_COMPLIANCE_REVIEW`, then `APPROVED` or `REJECTED` after `PARTNER_SANDBOX_REVIEW_MS` (default 20 s) |

Its compliance rules decline a loan when the visa ends before the last repayment, when the monthly payment
is more than 40% of the salary, or when there is no sponsor. Everything else is approved.

## Controls for demos and tests

These need the client certificate but no token:

```
GET  /sandbox/applications                       what the bank has received (no file contents)
POST /sandbox/applications/:reference/decision   {"decision":"APPROVED"|"REJECTED","reason":"..."}
POST /sandbox/faults                             {"next":[{"status":503},{"delayMs":5000}]}  next submissions fail or wait
POST /sandbox/reset                              forget everything
```

From Git Bash, for example:

```
C=sandbox/partner-bank/certs
curl --cacert $C/bank-ca.crt --cert $C/client.crt --key $C/client.key https://localhost:5300/sandbox/applications
```

What it received is kept in `sandbox/partner-bank/data/store.json` (gitignored; `PARTNER_SANDBOX_STORE=:memory:`
keeps nothing). The document contents are dropped and only their hashes are kept.

## Settings

`PARTNER_SANDBOX_PORT` (5300), `PARTNER_SANDBOX_HOST` (127.0.0.1), `PARTNER_SANDBOX_CLIENT_ID` (`quickloan-sandbox`),
`PARTNER_SANDBOX_CLIENT_SECRET` (`sandbox-secret-change-me`), `PARTNER_SANDBOX_CLIENT_CN`, `PARTNER_SANDBOX_ALLOWED_IPS`,
`PARTNER_SANDBOX_REVIEW_MS`, `PARTNER_SANDBOX_STORE`, `PARTNER_SANDBOX_CERT_DIR`.

The request format is `quickloan.loan-application.v1`, built in `shared/backend/services/funding/payload.js`.
A real partner gets its own copy of that description, and its answers are mapped in
`shared/backend/services/funding/partnerClient.js`.
