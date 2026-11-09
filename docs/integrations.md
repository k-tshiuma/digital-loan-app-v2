# External Integrations

Only integrations with evidence in source are listed.

| Integration | Status | Code |
|---|---|---|
| Twilio SMS | Implemented. **Optional**: mocked when env vars are missing | `shared/backend/services/smsService.js` |
| SMTP email (Nodemailer) | Implemented. **Optional**: mocked when `SMTP_USER` is missing | `shared/backend/services/emailService.js` |
| pdfkit (local library, not a service) | Implemented | `shared/backend/services/pdfService.js` |
| Google sign-in | **Mock only.** No OAuth | `server.js:522-542`, `Step2Auth.tsx:182-199` |
| Funding partner / bank ("Bank Leumi FinTech Gateway") | **Simulated in browser.** No network | `storage.ts:1233-1266` |
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

## Simulated funding partner

See FIN-07 in [financial-integrity-risks.md](financial-integrity-risks.md). The `FundingIntegrationRecord` type (`types.ts:371`) is a reasonable sketch of a real outbound-integration log (attempt count, request and response metadata, external reference). A real implementation belongs on the server, with persistence, retries, idempotency and reconciliation.

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
