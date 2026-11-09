# API Reference

Source of truth: `backend/server.js`. Every endpoint below was read in source (**Verified**). The client caller is listed where one exists. A machine-readable version is in [openapi.yaml](openapi.yaml).

## Conventions

- **Base URL:** `http://<host>:<PORT>/api`. `PORT` defaults to 5000. The client reads `VITE_API_URL` (`borrower-app/frontend/src/services/api.ts:11-12`).
- **Envelope:** success responses return `{ "success": true, ... }`. Errors return `{ "success": false, "error": "<message>" }` with a 4xx or 5xx status.
- **Auth:** `Authorization: Bearer <JWT>`. For **GET only**, `?token=<JWT>` is also accepted (`server.js:91-97`).
- **DEMO_MODE caveat:** while demo mode is on, "auth required" routes also accept no token (the caller becomes `demo_user`) or an unverifiable token (decoded without verification). See SEC-01 in [security-and-privacy.md](security-and-privacy.md). The authorization column below describes behaviour **with DEMO_MODE off**.
- **Timeouts and retries:** none on the server or in `apiService`. The only retry is the SSE `retry: 5000` hint.
- **Idempotency:** no idempotency keys. `PUT /applications/:id` is an upsert keyed by `id`.
- **Body limit:** JSON 5 MB (`server.js:45`). Uploads 10 MB by default (`MAX_UPLOAD_BYTES`).
- **Unknown `/api/*`:** returns `404 { error: "Not found" }` (`server.js:1291`).

Roles: `borrower` (JWT `type: 'borrower'`) · staff (`type: 'staff'`, `role` ∈ `customer_service`, `credit_reviewer`, `system_admin`, `funding_entity`). "Owner" means `canAccessUser(req, userId)`: the caller is staff, or `req.auth.sub === userId`.

---

## Endpoint index

| # | Method & path | Auth | Client caller |
|---|---|---|---|
| 1 | `GET /health` | Public | — |
| 2 | `POST /users/lookup` | Public | `apiService.lookupPhone` |
| 3 | `POST /users/login` | Public | `apiService.loginWithPassword` |
| 4 | `POST /users/request-otp` | Public | `apiService.requestOtp` |
| 5 | `POST /users/verify-otp` | Public | `apiService.verifyOTP` |
| 6 | `POST /users/register` | Borrower JWT (phone claim must match) | `apiService.register` |
| 7 | `POST /users/google-demo` | Public, **DEMO only** | `apiService.loginWithGoogleDemo` |
| 8 | `POST /users/forgot-password` | Public | `apiService.forgotPassword` |
| 9 | `POST /users/reset-password` | Public | `apiService.resetPassword` |
| 10 | `POST /auth/staff-token` | Public, **DEMO only** | `apiService.ensureStaffToken` |
| 11 | `GET /users/me` | Any JWT | — (no caller) |
| 12 | `POST /upload` | Any JWT | `apiService.uploadFile` |
| 13 | `GET /uploads/:filename` | Owner of the file (see note) | `apiService.resolveFileUrl` |
| 14 | `GET /applications` | Staff (any role) | `apiService.listAllApplications` |
| 15 | `GET /applications/active/:userId` | Owner | `apiService.getActiveApplication` |
| 16 | `GET /applications/history/:userId` | Owner | `apiService.getApplicationHistory` |
| 17 | `GET /applications/:id` | Owner | `apiService.getApplication` |
| 18 | `PUT /applications/:id` | Owner, or staff (any role) | `apiService.saveApplication` |
| 19 | `GET /applications/:id/events` | Owner (SSE) | `apiService.openApplicationEvents` |
| 20 | `ALL /applications/:id/pdf` | Owner (**see SEC-02**) | `apiService.downloadApplicationPdf` |
| 21 | `POST /notifications` | Staff (any role) | — |
| 22 | `GET /notifications/:userId` | Owner | `apiService.getNotifications` |
| 23 | `PATCH /notifications/:id/read` | Owner of the notification | `apiService.markNotificationRead` |
| 24 | `POST /notifications/:userId/read-all` | Owner | `apiService.markAllNotificationsRead` |
| 25 | `POST /notifications/send-sms` | Staff: `system_admin`, `customer_service` | — |
| 26 | `GET /analytics/summary` | Staff: `credit_reviewer`, `system_admin` | `apiService.getAnalyticsSummary` |
| 27 | `GET /config/credit-rules` | Staff (any role) | `apiService.getCreditRules` |
| 28 | `PUT /config/credit-rules` | Staff: `system_admin` | `apiService.updateCreditRules` |

---

## Public auth endpoints

### 1. `GET /api/health` (`server.js:386`)
Response `200`: `{ success: true, demoMode: boolean }`. ⚠ This tells anyone whether demo mode is on.

### 2. `POST /api/users/lookup` (`server.js:389-394`)
Body: `{ phoneNumber: string }`. The phone is normalised by stripping spaces, parentheses and dashes (`normalizePhone`, `server.js:55`).
- `200`: `{ success, exists: boolean, hasPassword: boolean }`
- `400`: phone missing.
⚠ Account enumeration (SEC-09).

### 3. `POST /api/users/login` (`server.js:396-426`)
Body: `{ identifier: string (phone or email), password: string }`. If the identifier contains `@` it is treated as an email (case-insensitive match).
- `200`: `{ success, user: User, token }`. `user` is `sanitizeUser(row)`: the password is removed and `roles`, `isActive` and `hasPassword` are added.
- `400`: fields missing, or the account has no password.
- `401`: wrong password.
- `404`: no account.
A legacy plaintext password is upgraded to bcrypt on its first successful login.

### 4. `POST /api/users/request-otp` (`server.js:428-438`)
Body: `{ phoneNumber }`. The phone must have at least 7 digits.
- `200`: `{ success, expiresInSeconds: 300, demoCode? }`. `demoCode` is returned only in DEMO_MODE. In DEMO_MODE, numbers ending in `4567` always get `123456`.
- `400`: invalid phone.
Side effect: sends an SMS through `sendSms` (or the console mock). **No rate limit** (SEC-08).

### 5. `POST /api/users/verify-otp` (`server.js:440-487`)
Body: `{ phoneNumber, code, preferredLanguage? }`.
- `200`: `{ success, user, token }`. **Creates the user** (`authProvider: 'phone'`, roles `['borrower']`) if none exists, and sets `phoneVerifiedAt`.
- `400`: expired or incorrect code.
- `429`: more than 5 failed attempts. The record is deleted and a new code must be requested.
⚠ In DEMO_MODE any 6-digit code is accepted (SEC-01).

### 6. `POST /api/users/register` (`server.js:490-519`)
Auth: borrower JWT from verify-otp, and `req.auth.phone` must equal the normalised `phoneNumber`.
Body: `{ fullName?, email?, phoneNumber, password (≥8), preferredLanguage? }`.
- `200`: `{ success, user, token }`. Sets the bcrypt hash and `authProvider: 'password'`.
- `400`: password too short, account already has a password, or email already taken.
- `403`: phone does not match the token.
- `404`: user row missing.

### 7. `POST /api/users/google-demo` (`server.js:522-542`): DEMO only
Body: `{ email, name?, preferredLanguage? }`. Creates or logs in a `google` user whose `phoneNumber` is `google:<email>`. **There is no OAuth verification.** Returns `404` when not in demo mode.

### 8. `POST /api/users/forgot-password` (`server.js:545-571`)
Body: `{ identifier }`. Always returns `200 { success, message: 'If an account exists, a reset code has been sent.', demoCode? }`. If the user exists and has a password, earlier unused codes are invalidated, a new code is stored as SHA-256 with a 15-minute TTL, and it is sent by SMS (unless the phone is `google:`) and by email if the user has one.

### 9. `POST /api/users/reset-password` (`server.js:573-605`)
Body: `{ identifier, code, newPassword (≥8) }`.
- `200`: `{ success, user, token }`.
- `400`: generic "Invalid or expired reset code" (unknown user, no active code, expired, 5 failed attempts reached, or wrong code, which also increments `attempts`).

### 10. `POST /api/auth/staff-token` (`server.js:609-614`): DEMO only
Body: `{ role }`. Returns `{ success, token, role }` (a 12-hour staff JWT) for any of the 4 staff roles. **No credentials are checked.** Returns `404` outside demo mode (SEC-04).

---

## Protected endpoints

### 11. `GET /api/users/me` (`server.js:621-626`)
Staff: `{ success, staff: { role } }`. Borrower: `{ success, user }`. `404` if the user is not found.

### 12. `POST /api/upload` (`server.js:679-713`)
Multipart field `file`. Allowed declared MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `application/pdf`. Maximum size `MAX_UPLOAD_BYTES` (10 MB). After saving, the magic bytes are checked (PDF, JPEG, PNG, WebP, or an `ftyp` box). A failing file is deleted and the request returns `400`.
- `200`: `{ success, file: { filename, url: '/api/uploads/<filename>', originalName, mimeType, size } }`
- `400`: no file, wrong type, too large, or content mismatch.
Writes an `uploaded_files` row with `userId = req.auth.sub` (`INSERT OR REPLACE`). The upload is **not linked to an application**. See SEC-10.

### 13. `GET /api/uploads/:filename` (`server.js:715-728`)
`path.basename` prevents traversal. `404` if the file is missing. `403` if a `uploaded_files` row exists and the caller is not the owner or staff. **If no row exists, any authenticated caller is allowed.** Sends the file with `X-Content-Type-Options: nosniff`. The Content-Type comes from the stored extension.

### 14. `GET /api/applications` (`server.js:732-735`)
Staff. Returns `{ success, applications: Application[] }`: all submitted applications, newest submission first, risk fields included. **No pagination or filtering.**

### 15. `GET /api/applications/active/:userId` (`server.js:795-935`)
Owner. Returns the user's latest unsubmitted draft, or creates one.
- **Returning-user prefill:** the source is `users.profileData`, else the latest submitted application, else the latest application that has `borrowerDetails`. Missing sections of the draft are filled from it. Previous documents are reused only if they pass `evaluateReusableDocuments` (`server.js:737-793`): the visa must have at least 6 months left, and pay slips must be under 90 days old.
- New drafts get `requestNumber = nextRequestNumber()`, and `currentStep = 6` for returning users or `3` otherwise.
- `200`: `{ success, application, isReturningUser, previousDocumentsReport? }`.

### 16. `GET /api/applications/history/:userId` (`server.js:938-948`)
Owner. Returns the user's submitted applications. Risk fields are removed for non-staff callers.

### 17. `GET /api/applications/:id` (`server.js:950-956`)
Owner. `:id` may be the application `id` **or** its `requestNumber`. Risk fields are removed for non-staff callers. `404` if not found, `403` if not the owner.

### 18. `PUT /api/applications/:id` (`server.js:960-1079`): create or update
Body: a full `LoanApplication` object (see [data-models.md](data-models.md)).

Server rules, in order:
1. If the record exists and the caller is not its owner: `403`.
2. `riskScore`, `riskLevel`, `riskFlags`, `eligibilityScore` and `eligibilityBreakdown` are **always discarded** from the body. They are recomputed on the server.
3. **Staff:** `userId` is kept from the existing record (or taken from the body if new). Every other field is taken from the body. **Status is not validated** (SEC-03).
4. **Borrower:** `userId = req.auth.sub`.
   - Already submitted: the core fields (`requestNumber, submittedAt, borrowerDetails, residencyDetails, employmentDetails, loanRequest, guarantor, guarantors, consents, digitalSignature, language`) are frozen to their previous values. The only status change allowed is `Additional Document Required → Under Review`, which the server records as a borrower history entry and which clears `missingDocumentNotes`. Any other change keeps the previous status and history. **`documents`, `bankAccount` and `bankAccountConfirmed` remain editable.**
   - First submission (`isSubmitted: true`): status becomes `Received`, `submittedAt` is set to now, and only borrower-authored history entries are kept (or a default one is created).
   - Draft: status `Received`, `isSubmitted: false`, history emptied.
5. If submitted: a missing or clashing `requestNumber` is replaced with `nextRequestNumber()`, and `applyRiskScore` runs.
6. `writeApp` re-synchronises `guarantors[0]` with the legacy `guarantor`, recomputes the eligibility score, strips `dataUrl` from documents that have a `fileUrl`, and upserts.
7. The user's `profileData` and `fullName` are updated from the application (skipped for `demo_user`).
8. Notifications: on first submission or a status change, `notifyStatusChange` runs (notification row, SMS, SSE `status` event). Any other save of a submitted app broadcasts an SSE `updated` event.
- `200`: `{ success, application }` (risk fields removed for non-staff callers).
- `400` (staff without `userId`), `403`.

### 19. `GET /api/applications/:id/events` (`server.js:1082-1108`): Server-Sent Events
Owner. Headers: `text/event-stream`, `no-cache`, `X-Accel-Buffering: no`. Frames:
- `retry: 5000` and `event: connected` with `data: { applicationId, status }`
- `event: status` with `data: { applicationId, previousStatus, status, updatedAt, notification }`
- `event: updated` with `data: { applicationId, status, updatedAt }`
- `: ping` every 25 s.
The client map lives **in memory** (`sseClients`), so this works only with a single process.

### 20. `GET|POST /api/applications/:id/pdf` (`server.js:1111-1139`)
Owner. Streams `application/pdf` as an attachment named `<requestNumber>.pdf`. Risk data is included only for staff.
⚠ **SEC-02:** when the id is not found, a POST body is parsed and **written to the DB before authorization runs.** The client always tries POST first with the full application, then GET (`api.ts:235-268`).

### 21. `POST /api/notifications` (`server.js:1143-1155`)
Staff. Body: `{ userId, title, message, applicationId?, notificationType? = 'MANUAL', channel? ('push'|'sms') }`. Creates the notification and sends an SMS if the channel is sms and the user has a phone. `400` if a required field is missing.

### 22. `GET /api/notifications/:userId` (`server.js:1157-1163`)
Owner. Returns `{ success, notifications (latest 100), unreadCount }`.

### 23. `PATCH /api/notifications/:id/read` (`server.js:1165-1171`)
Owner of the notification. `404` if not found.

### 24. `POST /api/notifications/:userId/read-all` (`server.js:1173-1178`)
Owner.

### 25. `POST /api/notifications/send-sms` (`server.js:1181-1186`)
Staff `system_admin` or `customer_service`. Body: `{ to, message }` sends a free-form SMS to any number. Responds `200` or `502` with the result of `sendSms`. ⚠ An arbitrary-SMS relay for those roles, so consider abuse controls.

### 26. `GET /api/analytics/summary` (`server.js:1190-1256`)
Staff `credit_reviewer` or `system_admin`. Computed in memory over **all** submitted applications:
`{ totalApplications, openApplications, approvalRate (% to 1 dp, or null), avgLoanAmountNis, totalRequestedNis, avgProcessingDays, byStatus[], byPurpose[], byRisk[], dailySubmissions[30], generatedAt }`.
Processing days are measured from `submittedAt` to the first history entry whose `toStatus` is Approved, Rejected or Forwarded.

### 27. `GET /api/config/credit-rules` (`server.js:1260-1262`)
Staff. Returns `{ success, rules, defaults }`. See [modules/credit-prescreening.md](modules/credit-prescreening.md).

### 28. `PUT /api/config/credit-rules` (`server.js:1264-1286`)
Staff `system_admin`. Body: `{ rules: Partial<CreditRules> }`. Values are merged with the current rules and coerced to finite numbers. Validation: `mediumRiskMinScore ≤ lowRiskMinScore` and `hardMinTenureMonths ≤ minTenureMonths`. Persists to `app_config` and then **re-scores every submitted application** (not atomic, FIN-13). Returns `{ success, rules, rescored }`.

---

## Error handling (`server.js:1291-1301`)

- Multer errors return `400` with `"File is too large"` or the error message.
- Any other thrown or rejected error returns `500`. The body contains `err.message` outside production and `"Internal server error"` in production.
- Express 5 forwards rejected promises from async handlers to this handler.

## Gaps and unverifiable behaviour
- No API versioning, pagination, filtering, rate-limit headers or idempotency.
- No request-schema validation. Response shapes are those of the source objects, with no DTO layer.
- Behaviour behind a reverse proxy (trust proxy, TLS, timeouts for SSE) is **Not Accessible**. No deployment config exists.
