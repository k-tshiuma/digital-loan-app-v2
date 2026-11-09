# Security and Privacy Review

> An evidence-based **documentation review** of source code. It is **not** a penetration test and **not** a compliance assessment. Nothing here certifies that the application is secure or compliant. No exploit procedures are included: findings name the weakness class and its location only.
>
> Status: **Verified** = confirmed by reading the code, or by running it where noted. **Suspected** = plausible from the code but not exercised. **Unverified** = depends on environment or configuration that cannot be seen.

Related: [threat-model.md](threat-model.md) · [security-remediation-roadmap.md](security-remediation-roadmap.md) · [financial-integrity-risks.md](financial-integrity-risks.md)

---

## 1. Headline

The backend contains real security controls: bcrypt password hashing, JWTs, per-resource ownership checks, staff-only routes, server-side recomputation of scores, upload type checks, and a password reset that does not reveal whether an account exists. **However:**

1. **`DEMO_MODE` fails open.** It is on unless `NODE_ENV=production` or `DEMO_MODE=false` is set explicitly. While it is on, authentication can be bypassed in several ways (SEC-01).
2. **The PDF endpoint writes client-supplied data to the database before it checks authorization** (SEC-02).
3. **There is no production staff login at all.** Staff tokens exist only in demo mode (SEC-04).
4. **The browser keeps a parallel credential and data store** with plaintext passwords and full PII, and it **falls back to local authentication** when the API rejects a login (SEC-05, SEC-06).

Until these are fixed, the application should be treated as a **prototype that is not fit to handle real borrower data**.

---

## 2. Identity and access

### 2.1 Authentication methods (Verified)

| Method | Endpoint(s) | Notes |
|---|---|---|
| Phone + SMS OTP | `POST /api/users/request-otp`, `POST /api/users/verify-otp` | 6-digit code from `crypto.randomInt` (`server.js:63`). 5-minute TTL, at most 5 attempts per issued code. Kept in an **in-memory Map** (`server.js:160`). verify-otp **creates the account if none exists** (`server.js:474-481`) |
| Password | `POST /api/users/login` | bcrypt compare. A legacy plaintext password is accepted once and then upgraded to a hash (`server.js:416-420`) |
| Registration | `POST /api/users/register` | Requires the borrower JWT from verify-otp, and its `phone` claim must match the request (`server.js:494`). Minimum password length is 8, enforced on the server |
| "Google" | `POST /api/users/google-demo` | **Mock.** It takes an email and logs that user in with no OAuth. The route returns 404 when DEMO_MODE is off (`server.js:523`). The frontend hard-codes the demo profile (`Step2Auth.tsx:186-189`) |
| Password reset | `POST /api/users/forgot-password`, `POST /api/users/reset-password` | Code stored as SHA-256 (`server.js:563`), 15-minute TTL, single use, 5 attempts. Gives the same response whether or not the account exists (`server.js:555`) |
| Staff | `POST /api/auth/staff-token` | **Demo only.** Anyone can choose any staff role and receive a 12-hour token. Returns 404 when DEMO_MODE is off (`server.js:609-614`) |

### 2.2 Tokens and sessions (Verified)

- JWT claims: borrower `{sub, type:'borrower', phone}` with a 7-day lifetime by default (`JWT_EXPIRES_IN`). Staff `{sub:'staff_<role>', type:'staff', role}` with a 12-hour lifetime (`server.js:79-89`).
- Algorithm: the `jsonwebtoken` default (HS256). `jwt.verify` is called without an `algorithms` allow-list.
- **There is no refresh token, no server-side revocation and no logout endpoint.** Client logout (`apiService.logout`) is **never called**: `App.handleSignOut` clears only `storageService` keys (`App.tsx:283-289`), so the borrower JWT stays in `localStorage` after sign-out (SEC-07).
- Tokens are stored in `localStorage` (`api.ts:50-73`), where any script that runs on the origin (XSS) can read them.
- `JWT_SECRET` must be set in production (the server throws otherwise, `server.js:29-31`). Outside production it falls back to a constant hard-coded in source (`server.js:32`) (SEC-13).

### 2.3 Authorization (Verified)

| Mechanism | Where | Behaviour |
|---|---|---|
| `requireStaff()` with no roles | `GET /api/applications`, `GET /api/config/credit-rules`, `POST /api/notifications` | Any staff role |
| `requireStaff('credit_reviewer','system_admin')` | `GET /api/analytics/summary` | |
| `requireStaff('system_admin','customer_service')` | `POST /api/notifications/send-sms` | |
| `requireStaff('system_admin')` | `PUT /api/config/credit-rules` | |
| `canAccessUser(req, userId)` | application, history, SSE, PDF, notification and file routes | Allowed if the caller is staff, **or** `sub === userId`, **or** the DEMO rule: no Authorization header (or `demo_user`) and `userId === 'demo_user'` |
| Borrower immutability | `PUT /api/applications/:id` (`server.js:981-1007`) | After submission a borrower cannot change the core fields. The only status change a borrower may make is `Additional Document Required → Under Review` |
| Staff writes | `PUT /api/applications/:id` (`server.js:975-977`) | **Any staff role can overwrite any field and set any status.** There is no transition validation, and `statusHistory` comes from the client (SEC-03) |
| Risk-field confidentiality | `server.js:944, 954, 1077`, PDF `includeRisk` | Risk score, level and flags are stripped from borrower responses |

### 2.4 Multi-factor authentication and biometrics
- MFA: **Not implemented.** OTP is an alternative to a password, not a second factor.
- Biometrics: **Not applicable / not implemented.** This is a web app; there is no WebAuthn.

---

## 3. Findings

Severity: Critical / High / Medium / Low. These findings are also listed in [technical-debt.md](technical-debt.md) and [evidence-register.md](evidence-register.md).

### SEC-01: DEMO_MODE is enabled unless explicitly disabled, and it bypasses authentication · **Critical** · Verified
- **Where:** `backend/server.js:25` (`DEMO_MODE = !IS_PRODUCTION && process.env.DEMO_MODE !== 'false'`), `:101-105`, `:112-119`, `:132-138`, `:157`, `:434`, `:437`, `:461-465`, `:570`, `:609-614`.
- **What:** When `NODE_ENV` is not exactly `production`, all of the following hold:
  - (a) verify-otp accepts **any 6-digit code for any phone number**.
  - (b) A JWT whose signature fails verification is **still trusted** through `jwt.decode`, including its `type` and `role` claims.
  - (c) A request with no token is treated as the borrower `demo_user`.
  - (d) Anyone can obtain a staff token for any role.
  - (e) OTP and reset codes are echoed back in API responses.
- **Impact:** Full account takeover and full back-office access for anyone who can reach the API. A staging or production server started without `NODE_ENV=production` is fully open.
- **Recommendation:** Invert the default: demo mode only when `DEMO_MODE=true`. Remove the `jwt.decode` fallback entirely. Log a loud warning at startup when demo mode is on. Add a startup self-check that refuses to start with demo mode on a non-localhost bind.

### SEC-02: The PDF endpoint persists client-supplied application data before checking authorization · **Critical** · Verified (code path)
- **Where:** `backend/server.js:1111-1129` (`app.all('/api/applications/:id/pdf')`).
- **What:** If no application with `:id` exists, the handler parses the request body as an application and **calls `writeApp()` before `canAccessUser`**. None of the controls in `PUT /api/applications/:id` run on this path: borrower immutability, server-set status and `submittedAt`, removal of risk fields, and request-number uniqueness. Any authenticated caller (or any caller at all under DEMO_MODE) can therefore create application records with an arbitrary `userId`, `status`, `requestNumber`, `riskScore`/`riskLevel`/`riskFlags` and `statusHistory`. The 403 is returned only **after** the write. One detail: `parseApp` converts `isSubmitted` with `=== 1` (`server.js:175`). A boolean `true` (what the real client sends, `api.ts:246`) is therefore stored as a **draft**, while the numeric `1` is stored as submitted. So the legitimate client fallback also quietly persists applications as drafts carrying whatever status the client held.
- **Impact:** Integrity of the application queue. For example, records could appear already approved or attributed to other users. It also bypasses audit.
- **Recommendation:** Make the PDF route **read-only** (GET only) and remove the "auto-persist" fallback. The client should call `PUT` first if it needs the server copy.

### SEC-03: Staff authorization is coarse and the status audit trail is client-supplied · **High** · Verified
- **Where:** `server.js:975-977` (staff branch of PUT). Role gating exists only in the UI: `BackOffice.tsx:277, 303, 1032, 1070`.
- **What:** Every staff role, including `customer_service` and `funding_entity`, can approve or reject and overwrite borrower data. There is no state-machine validation. For staff saves, `statusHistory` (who changed what and why) is whatever the browser sends.
- **Impact:** No separation of duties. The audit trail can be forged.
- **Recommendation:** Add a dedicated `POST /api/applications/:id/status` endpoint that checks the role against an allowed transition table and **builds the history entry on the server** from `req.auth`. Forbid staff from editing borrower-supplied sections through the generic PUT.

### SEC-04: No production staff authentication · **High** · Verified
- **Where:** `server.js:609-614`. `BackOffice.tsx:86-88` calls `ensureStaffToken`.
- **What:** With DEMO_MODE off there is no way to obtain a staff token. There are no staff accounts, passwords or SSO. The back office then fails quietly and shows only browser-local data (`BackOffice.tsx:97-99`).
- **Recommendation:** Add real staff identities (an IdP or SSO, or staff accounts with MFA) and issue role claims from the server.

### SEC-05: The client authenticates locally when the API rejects an OTP · **High** · Verified
- **Where:** `Step2Auth.tsx:401-411` falls back to `storageService.verifyOTP` (`storage.ts:690-761`), which accepts `123456` or **any 6-digit code**. The same pattern exists for Google (`Step2Auth.tsx:194-198`) and for password sign-in and registration on network errors.
- **What:** This fallback has no demo flag and runs on **any** API error, not only network failures. The user ends up "signed in" inside the SPA without a valid JWT. If a previous user's JWT is still in `localStorage` (SEC-07), later API calls run as **that previous user**.
- **Impact:** Cross-account data writes on shared devices. A false sense of being authenticated.
- **Recommendation:** Remove client-side authentication. The only way to sign in should be a valid server JWT. If offline drafting is wanted, scope it to an already-authenticated session.

### SEC-06: Plaintext passwords and full PII in browser localStorage · **High** · Verified
- **Where:** `storage.ts:519-560` (`registerUser` stores `password`) and `:578-590` (plaintext compare). Keys `quickloan_users_v1` and `quickloan_applications_v1` hold passport numbers, bank accounts, guarantor IDs and document `dataUrl` images. `quickloan_draft_backup_v1` also exists.
- **Impact:** Anyone with access to the device or browser profile, any XSS, or a malicious extension can read credentials and identity documents. The target users are foreign workers who often share phones.
- **Recommendation:** Never store passwords on the client. Minimise what is cached. Clear everything on logout. Treat localStorage as untrusted and short-lived.

### SEC-07: Sign-out leaves the JWT in place, with no revocation and a 7-day lifetime · **Medium** (High on shared devices) · Verified
- **Where:** `App.tsx:283-289` (only `storageService.logout()`). `api.ts:159-161` (`logout` is never called). `server.js:34`.
- **Recommendation:** Call `apiService.logout()` and clear all `quickloan_*` keys on sign-out. Shorten the token lifetime and add refresh with server-side revocation.

### SEC-08: No rate limiting or abuse controls · **High** · Verified (absence)
- **Where:** All routes. Especially `request-otp` (`server.js:428`): unlimited sends, each one an SMS cost through Twilio, and each new request resets the attempt counter. Also `login` (`:396`, no lockout) and `lookup` (`:389`).
- **Impact:** SMS toll fraud ("SMS pumping"), OTP brute force across re-issued codes, password guessing, upload disk exhaustion.
- **Recommendation:** Per-IP and per-phone rate limits, exponential back-off, CAPTCHA after repeated failures, Twilio geo-permissions and Verify Fraud Guard, and per-user upload quotas.

### SEC-09: Account enumeration · **Medium** · Verified
- **Where:** `POST /api/users/lookup` returns `exists` and `hasPassword` (`server.js:389-394`). Login returns 404 for an unknown account and 401 for a wrong password (`:406-423`). This contradicts the generic forgot-password response.
- **Recommendation:** Return uniform responses. Rate-limit lookup, or remove it and design the flow so it does not need to reveal whether an account exists.

### SEC-10: Upload handling: content-type confusion and the legacy-file access gap · **Medium** · Suspected (requires validation)
- **Where:** `server.js:629-643` (the stored extension comes from the client filename, the MIME filter trusts the client-declared `mimetype`). `:645-677` (the magic-byte check accepts any ISO-BMFF `ftyp` container, not just HEIC). `:715-728` (served with `res.sendFile`). Express delegates to the `send` package, which sets `Content-Type` from the file extension (`mime.contentType(ext)`, verified in the installed `send` source). `:722`: when no `uploaded_files` row exists for a file, **any authenticated user** can fetch it.
- **Impact:** A file that passes the image check could be stored with an extension that the browser renders actively when it is served from the API origin. The `X-Content-Type-Options: nosniff` header does not prevent this when the declared type is itself active. Files uploaded before ownership tracking existed are readable across users.
- **Recommendation:** Derive the extension from the detected type, not the client name. Serve with an explicit safe `Content-Type` and `Content-Disposition: attachment` (or from a separate cookieless domain). Deny access when no ownership row exists. Link uploads to applications.

### SEC-11: Bearer tokens in URL query strings · **Medium** · Verified
- **Where:** `api.ts:206-219` (file URLs and EventSource), `server.js:94-95` (accepted for every GET).
- **Impact:** Tokens end up in server and proxy logs, browser history, and possibly the Referer header. The tokens last 7 days.
- **Recommendation:** Use short-lived, single-purpose signed URLs for files and SSE, or cookie auth with `SameSite` protection for those GETs.

### SEC-12: Transport and headers · **Medium** · Verified (absence) / Unverified (deployment)
- **Where:** `server.js:44` uses `cors()` with no options, so every origin is allowed. There is no `helmet` or security headers (only `nosniff` on file responses), no HTTPS configuration, and no HSTS. The UI claims "Encrypted via TLS 1.3" (`App.tsx:458`).
- **Recommendation:** Allow-list origins, add security headers and a CSP for the SPA, terminate TLS at a reverse proxy, and remove UI claims that cannot be verified.

### SEC-13: Hard-coded development JWT secret · **Medium** · Verified
- **Where:** `server.js:32`. It is used whenever `NODE_ENV !== 'production'`, so any non-production deployment signs tokens with a secret that is public in git.
- **Recommendation:** Require `JWT_SECRET` in every non-local environment. Rotate it.

### SEC-14: SQLite database committed to version control · **High** · Verified (presence) / Unverified (whether the data is real)
- **Where:** `data/database.sqlite` is tracked by git (introduced in `1a45e40` and modified in `7491a8f` and `397b7d9`). It contains 23 users, 34 applications (21 with bank-account fields) and 26 notifications. Row contents were **not** inspected.
- **Impact:** If any row is real, PII has been published to everyone with repository access, and it stays in git history even if the file is deleted.
- **Recommendation:** Confirm the data is synthetic. Add `data/database.sqlite` to `.gitignore`, remove the file from tracking, and if the data is real, purge it from history and treat it as a data incident. Ship a seed script instead.

### SEC-15: OTP kept in plaintext next to its hash · **Low** · Verified
- **Where:** `server.js:435, 456`. The plaintext `code` is stored and compared, which makes the hash pointless. The OTP is also written to the console log when SMS is mocked (`smsService.js:7`).
- **Recommendation:** Store only the hash and compare in constant time. Never log codes outside local development.

### SEC-16: Sensitive data at rest and data lifecycle · **Medium** · Verified
- **What:** Passport numbers, dates of birth, bank account numbers, guarantor IDs and phone numbers are stored as plaintext JSON in SQLite. They are duplicated into `users.profileData` on every save (`server.js:1040-1064`). Uploaded identity documents sit unencrypted on local disk. **There is no deletion, export or retention mechanism** for borrower data, uploads or notifications (Not Implemented).
- **Recommendation:** Encrypt the database and uploads at rest, or use managed storage with encryption. Define retention. Add data-subject access and deletion workflows (see §6).

### SEC-17: Credit-card document type defined · **Low** · Verified (type) / Unverified (reachability)
- **Where:** `types.ts:49` (`'CREDIT_CARD'`), and the OCR simulation branch in `Step8DocumentUpload.tsx:166-171`. It is **not** in `DOCUMENT_TYPE_CONFIG` (`appConfig.ts:113+`), so it may not be selectable in the UI.
- **Note:** Collecting card images would bring the system into PCI DSS scope. Recommend removing the type.

### SEC-18: Error detail leakage outside production · **Low** · Verified
- **Where:** `server.js:1300` returns `err.message` when not in production.

### SEC-19: Consent and signature evidence is client-fabricated · **Medium** · Verified
- **Where:** `Step9ReviewConfirm.tsx:136-165`. `ipAddress` is hard-coded to `'127.0.0.1'`. Consent records, versions and timestamps are built in the browser. The server records no IP, user agent or server timestamp for consent.
- **Impact:** Weak evidence of informed consent to credit checks and terms, which matters for lending regulation and disputes.
- **Recommendation:** Record consent on the server with the server time, client IP from the proxy, user agent, consent text version and hash, and the authenticated user.

### SEC-20: SMS content and PII in logs · **Low** · Verified
- **Where:** The mock SMS log prints the destination number and the message, including OTP and reset codes (`smsService.js:7`). The email mock prints the recipient (`emailService.js:16`).

### SEC-21: Security and data claims shown to borrowers are contradicted by the code · **Medium** (legal/consumer-protection risk) · Verified
- **Where:** The Help/FAQ modal (`borrower-app/frontend/src/components/HelpModal.tsx`, `faqs` array starting at line 15) tells borrowers in five languages that the app "uses bank-grade encryption in transit (TLS 1.3) **and at rest**. Credit card numbers are masked, and **immutable audit logs record every access**." The back office labels its tab "Immutable Audit Logs" (`BackOffice.tsx`, the `audit` tab). The footer claims "Encrypted via TLS 1.3" (`App.tsx:458`).
- **Contradicting evidence:** no encryption at rest (SEC-16); TLS is not configured in the repo (SEC-12); the audit log is a mutable localStorage array in the browser that records no reads (`storage.ts:1169-1184`, FIN-08).
- **Related inaccuracy:** the FAQ's document checklist (passport, visa sticker, 3 pay slips, employment letter, 3 months of bank statements) does not match the documents Step 8 actually requires (`DOCUMENT_TYPE_CONFIG`: passport, pay slip, bank account document, and guarantor ID when applicable).
- **Recommendation:** Remove or correct these statements until they are true. Have legal or compliance review all borrower-facing security and privacy statements.

---

## 4. Mobile and client security (web equivalents)

| Topic | Finding |
|---|---|
| Secure storage (Keychain / Keystore) | **Not applicable.** The web app uses `localStorage` for tokens, users, passwords and applications (SEC-06) |
| Local database protection | None. localStorage is unencrypted |
| Sensitive information in logs | `console.warn` / `console.log` with error objects. Backend SMS mock logs codes (SEC-15, SEC-20) |
| Screenshots / app switcher | Not applicable to the web. No masking of sensitive fields |
| Clipboard | One use: `navigator.clipboard.writeText(application.requestNumber)` in `Step10SubmissionSuccess.tsx:37`. It writes only the request number, which is low sensitivity. No clipboard reads (Verified by grep) |
| Deep links | **Not implemented.** There is no router |
| TLS / pinning | Not configured or implemented. Pinning does not apply to browsers |
| Rooted / jailbroken devices | Not applicable |
| Debug vs release | No build-time flag separates demo behaviour in the **frontend**. Local OTP fallbacks and the seeded demo data ship in the production bundle (Verified: `vite build` includes `storage.ts`) |
| Secrets in bundle | No secrets found in `borrower-app/frontend/src` (grep for keys and tokens). `.env.example` holds placeholders only |
| XSS sinks | No `dangerouslySetInnerHTML`, `innerHTML` or `eval` in `borrower-app/frontend/src` (Verified by grep). React escaping applies |
| Camera | Uses `<input capture="environment">` (`Step8DocumentUpload.tsx:250`). No `getUserMedia` |

## 5. API and data security summary

| Control | Status |
|---|---|
| Input validation | Minimal. Phone length, password length, required fields on a few routes. **No schema validation of application payloads** (Verified) |
| SQL injection | Parameterised queries throughout (`dbGet`/`dbAll`/`dbRun` with `?` placeholders). Column lists are static (Verified) |
| Path traversal on file GET | Mitigated with `path.basename` (`server.js:716`) (Verified) |
| IDOR on applications and notifications | Ownership checks present (`canAccessUser`), but defeated by SEC-01 and SEC-02 |
| Mass assignment | Present: PUT accepts the whole application object. Partially mitigated for borrowers after submission (Verified) |
| Audit logging | **No server-side audit log.** The client audit log lives in localStorage only (`storage.ts:1169`) |
| Dependency vulnerabilities | **Not assessed.** `npm audit` was not run as part of this review (needs network access). Recommend running it in CI |
| Tenant isolation | Not applicable (single tenant) |

## 6. Privacy and regulatory relevance (assessment of relevance, not compliance)

> The laws, amendments and dates named below come from the reviewer's general knowledge. **They are not evidence from the repository and were not independently checked during this review.** Treat them as prompts for legal review.

| Framework | Why it is relevant | Observed gaps (non-exhaustive) |
|---|---|---|
| **Israeli Protection of Privacy Law 5741-1981 and Privacy Protection (Data Security) Regulations 2017** | Databases of personal data about identifiable individuals, including financial and identity data | No access-control logging, no encryption at rest, no retention policy, no documented database owner or security procedures, DB committed to git |
| **Amendment 13 to the Privacy Protection Law** (in force from 2025) | Stronger enforcement and data-subject rights | No access or deletion workflows |
| **GDPR** (if borrowers or processing touch the EU) | Possible, depending on deployment | Lawful-basis records, DSAR, DPIA not evident |
| **Israeli credit regulation** (e.g. the Fair Credit Law, Credit Data Law, and licensing of non-bank lenders by the Capital Market, Insurance and Savings Authority) | The product presents interest rates, fees and repayment estimates and collects credit-check consent | The displayed "APR" excludes fees (see FIN-03). Consent evidence is weak (SEC-19). No credit-bureau integration exists |
| **PCI DSS** | Only if card data were collected | `CREDIT_CARD` document type exists in the types (SEC-17). No card processing found |
| **OWASP ASVS** (web) / **MASVS** (mobile) | ASVS is the applicable standard because this is a web app. MASVS largely does not apply | V2 Authentication (SEC-01, 05, 08), V3 Session (SEC-07, 11), V4 Access Control (SEC-02, 03), V8 Data Protection (SEC-06, 14, 16), V12 Files (SEC-10) |

Legal applicability must be confirmed by counsel. **No compliance is claimed.**
