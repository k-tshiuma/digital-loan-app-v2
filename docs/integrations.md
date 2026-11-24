# External Integrations

Only integrations with evidence in source are listed.

| Integration | Status | Code |
|---|---|---|
| Twilio SMS | Implemented. **Optional**: mocked when env vars are missing | `shared/backend/services/smsService.js` |
| SMTP email (Nodemailer) | Implemented. **Optional**: mocked when `SMTP_USER` is missing | `shared/backend/services/emailService.js` |
| pdfkit (local library, not a service) | Implemented | `shared/backend/services/pdfService.js` |
| Google sign-in | **Mock only.** No OAuth | `server.js:522-542`, `Step2Auth.tsx:182-199` |
| Funding partner / bank ("Push to partner") | **Implemented on the admin API** against the partner-bank **sandbox** (mutual TLS, OAuth2 client credentials, idempotent submission, status checks). No real partner connected yet | `shared/backend/services/funding/`, `admin-app/backend/routes/funding.js`, `sandbox/partner-bank/` |
| OCR / document quality | **Simulated** with `Math.random` | `Step8DocumentUpload.tsx:148-171` |
| Google Gemini (`@google/genai`) | **Declared dependency, never used** | `borrower-app/frontend/package.json` |
| Object storage (S3 etc.) | Not implemented. The `s3://` string is cosmetic | `Step11StatusTimeline.tsx:130` |
| **Google Fonts** (Heebo, Plus Jakarta Sans, Sarabun, Noto Sans SC) | Implemented. Loaded from `fonts.googleapis.com` / `fonts.gstatic.com` on every page view | `borrower-app/frontend/index.html:12-14` |
| Google AI Studio applet manifest | Metadata only. Declares `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` and the `camera` frame permission, but no code uses Gemini | `borrower-app/frontend/metadata.json` |
| Credit bureau, KYC/identity provider, payment gateway, push notifications, analytics, crash reporting | Not implemented | — |

---

## Twilio SMS

| Item | Detail |
|---|---|
| Purpose | OTP codes, password-reset codes, application status messages, staff free-form SMS |
| SDK | `twilio` ^6.1.2, required lazily on each send (`smsService.js:10`) |
| Configuration | `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` |
| Auth | Account SID and auth token (Basic auth inside the SDK) |
| Request | `messages.create({ body, from: TWILIO_FROM, to })` |
| Response handling | `{ success:true, sid }` or `{ success:false, error }`. Errors are logged with `console.error` |
| Mock mode | If SID or token is missing: logs `[SMS MOCK] To: … | Message: …`, **including OTP codes**, and returns `{ success:true, mock:true }` |
| Timeout / retry | SDK defaults. **No application-level retry.** A failed status SMS is recorded as `deliveryStatus='failed'` and never retried |
| Callers | `request-otp` (`server.js:436`), `forgot-password` (`:567`), `createNotification` (`:338-341`), `send-sms` (`:1184`) |
| Language | All server SMS text is English, whatever the borrower's language |
| Webhooks | None (no delivery-status callbacks) |
| Risks | Toll fraud through the unthrottled `request-otp` (SEC-08). The `TWILIO_FROM` value is not validated at startup, so a misconfiguration surfaces as per-message failures. `request-otp` ignores the send result and returns success even when the SMS fails |

## SMTP email

| Item | Detail |
|---|---|
| Purpose | Password-reset code (the only caller, `server.js:568`) |
| Library | `nodemailer` ^10.0.14. Transporter created at module load (`emailService.js:3-8`) |
| Configuration | `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`. `secure:false` (STARTTLS negotiated by Nodemailer when the server offers it) |
| From | `"QuickLoan Israel" <SMTP_USER>`. Note the branding mismatch with "LendGlobal" in the SMS text |
| Mock mode | No `SMTP_USER`: logs recipient and subject only |
| Errors | Logged and returned. The caller ignores them |

## Mock Google sign-in

- The frontend always sends the fixed profile `{ name: 'Demo Borrower', email: 'borrower@lendglobal.io' }` (`Step2Auth.tsx:186-189`).
- The server returns 404 unless DEMO_MODE is on. If the call fails, the client logs in locally anyway (`Step2Auth.tsx:194-198`).
- To make this real: an OAuth 2.0 / OIDC authorization-code flow with server-side ID-token verification, and account linking rules.

## Funding partner ("Push to partner")

Approved 3-step loans are sent to the funding partner from the admin API. Staff press "Push to Partner" in the
Back Office (Funding tab of the application), confirm, and the server does the rest:

| | |
|---|---|
| Who | `credit_reviewer`, `system_admin` (`FUNDING_PUSH_ROLES` in `services/workflow.js`). Every staff role can see the Funding tab |
| When | `LOAN_APPROVED`, not repaid, and the applicant accepted a General T&C version with the partner-sharing clauses (2.0 on). Applicants who accepted 1.0 are asked to accept 2.0 in the app (`POST /api/flow/application/partner-consent`); staff can send a reminder |
| What is sent | `quickloan.loan-application.v1` (`services/funding/payload.js`): applicant, passport and visa, employment and salary, loan terms, the full bank account, sponsors, the terms acceptance and signature, every document as base64 with its SHA-256 and size |
| Transport | HTTPS with mutual TLS (our client certificate, the partner's CA only), OAuth2 client-credentials token cached until shortly before it expires |
| Retries | Network errors, timeouts, 429 and 5xx are retried (`FUNDING_MAX_ATTEMPTS`, waits doubling from `FUNDING_RETRY_BASE_MS`); other errors stop at once. A failed hand-off can be pushed again: after a temporary error with the same idempotency key (the partner may have received it), after a permanent one with a new key |
| No double sends | One hand-off per application and partner that is not failed (unique index); two clicks at once give one push and a 409 |
| Follow-up | The admin API asks the partner for open hand-offs every `FUNDING_POLL_MS`; staff can press "Check status". The partner's decision is audited and told to the applicant once |
| Records | `funding_handoffs`: status, partner reference, attempts, error, the package's SHA-256 and a summary (amounts, document types and hashes). Never personal data or file contents. `audit_log`: `FUNDING_SENT`, `FUNDING_PUSH_FAILED`, `FUNDING_APPROVED`, `FUNDING_REJECTED`, `PARTNER_CONSENT_REQUESTED` |
| Status | When the partner receives the loan, the application's status becomes "Forwarded to Funding Entity" (`flowStatus` stays `LOAN_APPROVED`) |

Settings are `FUNDING_PARTNER_*` (`services/funding/config.js`, `.env.example`, `deploy/env/admin.env.example`). In
demo mode with none set, the admin API uses the sandbox (`npm run partner:sandbox`, see
`sandbox/partner-bank/README.md`). The partner answers are mapped in `services/funding/partnerClient.js`; a real
partner (bank or licensed lender) needs its own mapping if its API differs from the sandbox's.

Not done yet: a webhook from the partner (we ask it instead, so the VPN-limited admin API needs no inbound
access), reconciliation of funded amounts, and more than one partner at a time.

## Google Fonts

| Item | Detail |
|---|---|
| Purpose | Web fonts for Latin, Hebrew (Heebo), Thai (Sarabun) and Chinese (Noto Sans SC) text |
| Mechanism | `<link rel="preconnect">` plus a stylesheet `<link>` in `borrower-app/frontend/index.html:12-14` |
| Privacy | Every visitor's browser contacts Google servers, which disclose the visitor's IP address and user agent. Consider self-hosting the fonts, and mention this in the privacy notice |
| Availability | If Google Fonts is blocked or offline, the CSS fallback fonts are used |
| CSP | Any future Content-Security-Policy must allow these origins, or the fonts must be self-hosted |

## Sandbox vs production

There is no configuration that separates sandbox from production for any provider. The only switch is whether credentials are present. The demo behaviours are tied to `DEMO_MODE` (backend) and to nothing at all in the frontend.
