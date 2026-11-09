# QuickLoan: Borrower App / Admin Dashboard Separation Plan

Status: Phases 0–7 done; Phase 8 deployment kit built and rehearsed, production cut-over waiting on a server (see the Phase 8 note). Originally based on the codebase as of 2026-11-08 (branch `feature/step1-employee-info-fields` at `eedc0ca`, plus uncommitted work).

This plan merges two earlier drafts. It keeps the phase order and the "no behaviour change while moving code" rule from the first, and adds the table-access matrix, the cross-folder test couplings, the per-app dependencies, the environment files and the more detailed checklist from the second. Claims from both drafts were checked against the code; corrections are noted where they matter.

> **Before you start**
> - No reference image was attached. The plan follows the folder layout described in the request.
> - There is a lot of uncommitted work (about 15 modified files plus `StaffLoginGate.tsx` and `backOfficeCorrections.test.tsx`), mostly in `server.js`, `routes/flow.js`, `App.tsx` and `BackOffice.tsx`. It has to be committed before the split starts, or every phase will collide with it.
> - Both backends can share the SQLite database file only if they run on the same machine. That is the biggest constraint on deployment.

---

## 1. Executive Summary

**Recommendation:** two Express backends and two Vite frontends, built on two small shared packages (`shared/backend`, `shared/frontend`) and linked with npm workspaces. Both backends open the same `database.sqlite` file and the same uploads folder directly.

Do it in small phases. First reorganise the code inside the current app with no change in behaviour, then split the frontend, then split the backend into two processes, and only then move folders. Every phase can be shipped and rolled back on its own.

This is feasible with little rewriting:

- Admin and borrower routes are already separated by middleware (`requireStaff`, `requireApplicant`, `staffView`).
- Most business logic already lives in standalone modules under `backend/services/`.
- `routes/flow.js` is already a factory that receives its helpers from outside.

The work is mostly moving code. Four couplings need real changes:

1. Live status updates (SSE) are held in memory in one process.
2. Uploaded files live on the backend's local disk.
3. Five handlers serve both borrowers and staff.
4. Several frontend tests and scripts read backend files by relative path.

---

## 2. Existing Architecture Assessment

One backend and one frontend serve both borrowers and staff today; the split lines are already visible in the middleware.

| Area | Finding |
| --- | --- |
| Backend | One Express 5 app (CommonJS). `server.js` holds about 40 routes, the auth logic, the OTP store, SSE, helpers and row parsing. `routes/flow.js` holds the 3-step workflow. Business logic is in `services/*` and `creditEngine.js`. Key packages: `sqlite3`, `jsonwebtoken`, `bcryptjs`, `multer`, `pdfkit`, `bidi-js`, `twilio`, `nodemailer`, `cors`, `dotenv`. |
| Database | `database.js`: one `sqlite3` connection, 13 tables. The schema is created on startup (`CREATE IF NOT EXISTS` plus `ALTER TABLE` statements whose errors are ignored). No WAL mode, no `busy_timeout`, no transactions anywhere. |
| Frontend | One Vite app (React 19, TypeScript, Tailwind v4). `App.tsx` switches to the Back Office when the URL contains `/backoffice`, `/admin`, `#admin` or `?backoffice`, so both portals ship in the same bundle. `recharts` is used only by the admin side, `canvas-confetti` only by the borrower side. |
| Auth | One `JWT_SECRET`. The token's `type` claim (`borrower` or `staff`) tells borrower and staff tokens apart. `optionalAuth` runs globally, then `app.use('/api', authenticate)`. Staff log in with email and password (`staff_users`, `/api/auth/staff-login`, with lockout after failed attempts) or, in demo mode, through the role picker (`/api/auth/staff-token`). |

### Borrower routes

- Login and accounts: `/api/users/lookup`, `login`, `request-otp`, `verify-otp`, `register`, `google-demo`, `forgot-password`, `reset-password`, `/api/users/me`, `/api/users/me/language`
- Uploads: `POST /api/upload`
- Classic wizard: `/api/applications/active/:userId`, `/api/applications/history/:userId`, `/api/applications/:id/events` (SSE)
- Notifications: `GET /api/notifications/:userId`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/:userId/read-all`
- 3-step flow: `/api/flow/register`, `/api/flow/google`, `/api/flow/terms/current`, `/api/flow/application` and its sub-routes (registration consent, step draft and submit, final documents)

### Admin routes

- Login: `/api/auth/staff-login`, `/api/auth/staff-token`
- Applications: `GET /api/applications` (list)
- Notifications: `POST /api/notifications`, `/api/notifications/send-sms`
- Analytics and config: `/api/analytics/summary`, `/api/config/credit-rules` (GET and PUT)
- 3-step flow: `/api/flow/applications` and `:id`, `/api/flow/summary`, step decision, final decision, message, delivery retry, audit

### Routes both sides use

These handlers branch on `isStaff(req)`:

- `GET` and `PUT /api/applications/:id`: staff see risk data, and staff change legacy application statuses through the PUT
- `/api/applications/:id/pdf`: staff get a copy with risk data and a masked bank account
- `GET /api/uploads/:filename`: staff open documents that borrowers uploaded
- `GET /api/users/me`: returns `{ staff: { role } }` for a staff token (`server.js:724`)
- `PUT /api/users/me/language`: refuses staff tokens (`server.js:734`)

### Frontend split

- **Admin:** `BackOffice.tsx`, `AnalyticsDashboard.tsx`, `FlowApplicationInspector.tsx`, `StaffLoginGate.tsx`, `services/flowDetail.ts`, `i18n/messages/backoffice.ts`
- **Borrower:** every `Step*`, `FlowStatusHub`, `WizardProgress`, `Header`, `HelpModal`, `MyApplications`, `NotificationBell`, `NotificationDrawer`, `ReturningUserConfirmModal`, `utils/linking.ts`, `i18n/messages/{auth,wizard,leadFlow}.ts`
- **Both:** `types.ts`, `config/appConfig.ts`, `services/eligibilityScoring.ts`, the `i18n/` core (`translations`, `LanguageContext`, `LtrText`, `format`, `options`, `apiErrors`, `messages/{common,status,types,index}`), `DateInput`, `EligibilityScoreBar`, `ErrorBoundary`, the `api.ts` request core, and `storage.ts`

### Database access by table

Every table stays exactly as it is. This matrix shows which backend will read or write each one after the split, which drives the shared-module boundary and the concurrency checks.

| Table | Borrower backend | Admin backend | Note |
| --- | --- | --- | --- |
| `users` | read/write (OTP, register, login, language) | read (contact info in queue, detail, notifications) | Admin never changes borrower credentials |
| `staff_users` | read (`adoptGuestUploads` checks a file isn't staff-owned) | read/write (login, failed attempts, lockout, `seed_staff.js`) | |
| `applications` | read/write (lead, step drafts and submits, classic drafts) | read/write (decisions, classic status changes, re-scoring) | Main source of write conflicts (section 6) |
| `password_resets` | read/write/delete | – | Borrower only |
| `app_config` | read (`creditRules`, `notifyEmailOptional`) | read/write (`PUT /api/config/credit-rules`) | Not cached in memory, so changes are seen on the next request |
| `uploaded_files` | read/write (guest and borrower uploads, adoption) | read (metadata for `GET /api/uploads/:filename`) | Needs the shared `UPLOAD_DIR` |
| `notifications` | read/write (submission notice; list, mark read) | write (decision notices, manual `POST /api/notifications`) | Admin writes, borrower reads |
| `application_step_submissions` | write (snapshot on each step submit) | read (revision history) | |
| `application_step_reviews` | read (changes-requested and rejection notes) | read/write (Step 1 and 2 decisions) | |
| `audit_log` | write (`APPLICANT_REGISTERED`, `STEP_SUBMITTED`, `TERMS_ACCEPTED`, …) | read/write (`STAFF_LOGIN_*`, `BANK_DETAILS_VIEWED`, decisions, audit view) | Append-only from both |
| `terms_versions` | read; seeded on first read | read | Seeding is check-then-insert with no unique key (C5) |
| `terms_acceptances` | write (Step 3) | read (inspector Step 3 tab) | |
| `notification_deliveries` | write (submission sends) | read/write (decision sends, retries) | Shared through `flowNotifications.js` |

### Dependencies that make separation hard

| # | Coupling | Why it matters |
| --- | --- | --- |
| C1 | **SSE in memory**: `sseClients` Map in `server.js` | A staff status change (admin process) calls `broadcastAppEvent`, which only reaches borrowers connected to the same process. After the split, the classic wizard's `Step11StatusTimeline` would stop getting live updates. The classic flow is still reachable through a button in `App.tsx`. |
| C2 | **Uploads on local disk**: `UPLOAD_DIR` is fixed to `backend/uploads` | The admin backend must read files the borrower backend wrote. |
| C3 | **Routes serving both sides** (above) | A route can't be cleanly assigned to one app. |
| C4 | **Two processes writing one SQLite file** | Without WAL and `busy_timeout`, concurrent writes fail with `SQLITE_BUSY`. The schema setup ignores all errors, so a busy error during startup could silently skip a column. |
| C5 | **Terms seeding**: `seedTerms` in `terms.js` runs on the first terms read in each process (not at startup), checks, then inserts, and `terms_versions` has no unique key on `(type, version)` | Two processes reading terms for the first time together could insert duplicate terms rows. |
| C6 | **Mirrored logic**: `eligibilityScoring`, `loanCalculator`, PDF labels (each exists in backend and frontend) | Copying code between apps would add a third or fourth copy. These must be shared, never duplicated. |
| C7 | **`storage.ts` and localStorage**: `BackOffice` reads `storageService` (demo applications, audit events, config, exports, simulated funding handoff) | Once the apps live on different origins, the admin app can't see local data saved by the borrower app. Only demo or offline fallback data is affected; backend data is not. |
| C8 | **Demo-mode identity**: `authenticate` falls back to `demo_user` | Fine for the borrower backend. The admin backend must never fall back to it. |
| C9 | **`StaffLoginGate` "client blocked" check** reads the borrower token | Across origins it can't see that token. The check becomes a no-op, which is the desired outcome but a visible change in behaviour. |
| C10 | **Frontend tests and scripts read backend files by path** | `i18n/__tests__/pdfLabels.test.ts` imports `backend/services/pdfLabels.js` and `messages.js`; `statusMessages.test.ts` reads `backend/server.js`; `coverage.test.ts` reads `backend/creditEngine.js` and `services/eligibilityScoring.js` and expects more than 500 `t()` calls across all components; `i18n/options.ts` references backend paths; `scripts/generate-hebrew-review.ts` loads four backend modules. All break when folders move, and the `coverage` threshold no longer holds per app. |
| C11 | **Request numbers**: `nextRequestNumber` (`server.js:384`) reads all `REQ-<year>-%` rows and takes the max in JS; `requestNumber` has no unique key | Two registrations at the same moment, now possibly in different processes, can get the same number. The race exists today within one process too. |

---

## 3. Proposed Architecture

Option B wins: two backends and two frontends on shared core packages, with each backend accepting only its own token type.

| Option | Verdict |
| --- | --- |
| A. Split only the frontends; keep one backend | Lowest risk, but doesn't meet "independent backends". Useful as a midpoint (Phase 5). |
| **B. Two backends and two frontends on shared core packages** | **Recommended.** Meets every constraint, and mirrored logic stays in one place. |
| C. Copy the whole app twice and delete what each side doesn't need | Fast at first, but it duplicates the backend and all the mirrored logic (C6), including the bilingual PDF, SMS/email texts and loan maths, and the copies drift apart. Rejected. |
| D. Admin backend has no database access and calls the borrower API | Violates "both use the same database" and makes the admin depend on the borrower app being up. Rejected. |

### Responsibilities

- **Borrower backend.** Borrower authentication (OTP, password, Google demo, reset), uploads, the classic wizard, the 3-step applicant routes, notification reads, SSE, and the borrower's own PDF. It rejects tokens with `type: 'staff'`.
- **Admin backend.** Staff login and demo staff tokens, application lists and details, legacy status changes, 3-step decisions, messages, audit, analytics, credit rules, the staff PDF, and read-only document access. It accepts only `type: 'staff'` tokens with a known staff role, and never falls back to `demo_user`.
- **Routes both sides use (C3).** The handler code stays exactly as it is, in `shared/backend`. Each backend mounts it with a guard that lets in only its own token type, so each branch runs only in its own app and no logic is rewritten. Removing the unused branch later is optional cleanup (Phase 9).
- **SSE across processes (C1).** The borrower backend checks every 5 seconds for status changes on the applications it is streaming (`SELECT id, status, flowStatus, updatedAt … WHERE id IN (…)`, run only while at least one client is connected) and sends the same `status`/`updated` events it sends today. The apps stay fully independent and nothing in the database changes.
  - Alternative: the admin backend also posts to an internal borrower endpoint (`POST /internal/events/broadcast`, protected by a shared secret, non-blocking with a short timeout), with polling kept as the fallback. That makes updates instant but ties the admin app to the borrower app's address. Start with polling only; add the webhook later if 5 seconds proves too slow.
- **Authentication.** Keep the token format, the `type` claim, bcrypt, the staff lockout and the role checks exactly as they are.
  - **Required:** each backend accepts only its own token type, and the demo-only routes live only where they belong (`staff-token` in admin; the `demo_user` fallback in borrower).
  - **Optional, later:** separate signing secrets (`BORROWER_JWT_SECRET`, `ADMIN_JWT_SECRET`) plus an `aud` claim, with a production startup check that they differ. Everyone with an old token would have to log in again once, so do it after cut-over.
- **Preventing unwanted dependencies between apps.** Each app depends only on `shared/*`, never on the other app. The shared packages never import from either app. A small boundary test (`tests/architecture-boundaries.test.mjs`) scans `import`/`require` specifiers and fails if `borrower-app/` imports from `admin-app/` or the reverse.

---

## 4. Detailed Folder Structure

Three top-level units (`borrower-app`, `admin-app`, `shared`) linked by a tiny root `package.json` that declares npm workspaces and convenience scripts.

```
digital-loan-app-v2/
├── package.json                 # NEW, tiny: "workspaces" + dev:borrower, dev:admin, test:all
├── shared/
│   ├── backend/                 # package "@quickloan/backend-core"
│   │   ├── package.json         # sqlite3, jsonwebtoken, bcryptjs, pdfkit, bidi-js, twilio, nodemailer
│   │   ├── config.js            # DEMO_MODE, JWT_SECRET, DB_PATH, UPLOAD_DIR (current defaults)
│   │   ├── db/database.js       # moved from backend/database.js; schema text unchanged
│   │   ├── db/dbHelpers.js      # from services/dbHelpers.js (server.js copy removed)
│   │   ├── db/init.js           # schema + terms seed; run by ONE owner
│   │   ├── auth/                # signUserToken, signStaffToken, readToken, authenticate,
│   │   │                        # optionalAuth, requireStaff, canAccessUser (+ audience guard)
│   │   ├── applications/        # parseApp, writeApp, getAppById, nextRequestNumber,
│   │   │                        # applyRiskScore, getCreditRules, shared handlers (C3)
│   │   ├── notifications/       # createNotification, notifyStatusChange, messages.js,
│   │   │                        # flowMessages.js, flowNotifications.js, sms/emailService.js
│   │   ├── workflow/            # workflow.js, flowValidation.js, loanCalculator.js, terms.js,
│   │   │                        # flow helpers (audit, mirrorLegacy, maskBank, getFlowAppById,
│   │   │                        # updateFlowApp)
│   │   ├── scoring/             # creditEngine.js, eligibilityScoring.js
│   │   ├── pdf/                 # pdfService.js, pdfLabels.js, pdfRtl.js, assets/fonts/
│   │   └── fixtures/loan-calc-fixtures.json
│   └── frontend/                # package "@quickloan/ui-core" (TS source, no build step)
│       ├── i18n/                # translations.ts, LanguageContext, LtrText, format, options,
│       │                        # apiErrors, messages/{common,status,types,index}.ts
│       ├── types.ts  config/appConfig.ts  services/eligibilityScoring.ts
│       ├── services/apiCore.ts  # request(), ApiError, isNetworkError, resolveFileUrl, token helpers
│       ├── services/storage.ts  # unchanged at first (split later is optional)
│       ├── components/          # DateInput, EligibilityScoreBar, ErrorBoundary
│       ├── styles/tokens.css    # design tokens from index.css
│       └── test-utils/          # hardcodedText.ts scanner etc. for per-app i18n tests
├── borrower-app/
│   ├── backend/   server.js · routes/{auth,applications,flowApplicant,notifications,uploads}.js
│   │              · sse.js (poller) · .env.example · test_*.js (borrower)
│   └── frontend/  package.json (no recharts) · src/App.tsx (wizard, no Back Office branch)
│                  · Step*, FlowStatusHub, Header, HelpModal, MyApplications, Notification*,
│                  ReturningUserConfirmModal, WizardProgress · services/api.ts (borrower methods)
│                  · utils/linking.ts · i18n/messages/{auth,wizard,leadFlow}.ts · public/ guides
├── admin-app/
│   ├── backend/   server.js · routes/{staffAuth,applications,flowStaff,analytics,config,
│   │              notifications}.js · scripts/seed_staff.js · .env.example · test_*.js (admin)
│   └── frontend/  package.json (recharts, no canvas-confetti) · index.html ("QuickLoan Admin")
│                  · src/App.tsx (StaffLoginGate → BackOffice at "/") · BackOffice,
│                  AnalyticsDashboard, FlowApplicationInspector, StaffLoginGate
│                  · services/{api,flowDetail}.ts · i18n/messages/backoffice.ts
├── tests/
│   ├── integration/             # test_workflow.js, test_i18n.js (need BOTH backends)
│   ├── contracts/               # pdfLabels, statusMessages, mirrored-logic checks (C6, C10)
│   └── architecture-boundaries.test.mjs
├── scripts/generate-hebrew-review.ts   # moved from frontend/scripts (C10)
├── data/                        # optional final home of database.sqlite + uploads/
└── docs/
```

**Why npm workspaces:** shared backend code that does `require('sqlite3')` has to resolve from one place, and Vite and TypeScript need to see the shared frontend source. Workspaces handle both with nothing beyond npm. In each Vite app, Tailwind v4 needs `@source "../../shared/frontend"` so classes used in shared components are generated.

**Why `data/` is optional:** the database file can stay at `backend/database.sqlite` and be referenced through `DB_PATH` until cut-over. Moving it is a one-line config change once both backends read the path from the environment, and moving it earlier risks two copies drifting apart.

---

## 5. Step-by-Step Migration Plan

Ten phases; each ends with every test green and the app runnable, so the work can stop after any phase. **Rule: no phase both moves files and changes behaviour.**

### Phase 0: Baseline (required)

- **Do:** commit or merge the in-progress work; tag `pre-split-baseline`; stop the dev servers and back up `database.sqlite` and `uploads/`; record row counts for `users`, `staff_users`, `applications` and `uploaded_files`; run `node scripts/seed_staff.js`, all five `test_*.js`, and `npm test` plus `npm run lint` in the frontend, and record the results.
- **Risk:** starting on a moving codebase. **Mitigation:** freeze feature work during Phases 2, 3 and 7.
- **Verify:** clean `git status`; recorded green baseline.

### Phase 1: Safety-net tests (required)

- **Do:**
  - Add one characterisation test that hits every route with no token, a borrower token, and each staff role, and records the status code.
  - Add an SSE test: a staff status change produces an event on the borrower stream.
  - Add a PDF smoke test that generates the borrower and staff copies in English and Hebrew.
- **Files:** new `backend/test_route_matrix.js`.
- **Verify:** green against the current app. This test becomes the contract for every later phase.

### Phase 2: Extract the shared backend core, in place (required)

- **Do:**
  - Move helpers out of `server.js` into modules, with no logic edits: auth, `parseApp`/`writeApp`, notifications, request numbers.
  - Delete the duplicate `dbGet`/`dbAll`/`dbRun` in `server.js` and use `services/dbHelpers.js`.
  - Make `DB_PATH` and `UPLOAD_DIR` configurable, resolved with `path.resolve()` and defaulting to today's paths.
  - Add `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` in `database.js`, run before the schema statements. These are connection and journal settings, not schema changes. Do **not** turn on `foreign_keys`: that would start rejecting writes that work today.
- **Files:** `server.js`, `database.js`, `services/*`.
- **Risk:** a missed variable from the closure; a broken font path in `pdfService.js` after a move. **Mitigation:** the Phase 1 matrix and PDF smoke test plus `node --check`; small commits.
- **Verify:** every test identical to the baseline.

### Phase 3: Split the routes into borrower and admin modules, in place (required)

- **Do:**
  - Split `server.js` routes into `routes/borrower/*` and `routes/admin/*`.
  - Split `flow.js` into `registerPublic`, `registerApplicant` and `registerStaff`, keeping shared helpers in the factory.
  - Move the five shared handlers into the shared applications module.
  - `server.js` still mounts everything in the same order. **The order matters:** public routes before `app.use('/api', authenticate)`.
- **Verify:** the route matrix is unchanged, and so is the list of registered routes.

### Phase 4: Shared frontend code, in place (required)

- **Do:**
  - Add the root `package.json` with workspaces.
  - `git mv` the shared files (i18n core, `types.ts`, `appConfig.ts`, `eligibilityScoring.ts`, `DateInput`, `EligibilityScoreBar`, `ErrorBoundary`, `storage.ts`) into `shared/frontend`.
  - Split `api.ts` into a shared core plus app methods.
  - Update imports. The `@` alias currently points at `frontend/`.
  - Move the tests that read backend files (C10) into `tests/contracts/`, so they no longer depend on where either app lives.
- **Risk:** the i18n scanner tests (`no-hardcoded-text`, `no-physical-direction`, `no-bare-tolocale`, `coverage`) only scan `src/`. **Mitigation:** point them at `shared/frontend` too.
- **Verify:** `npm test`, `npm run lint` and `npm run build` are green, and the UI looks the same.
- **Done (2026-11-09), with two changes from the steps above:**
  - The translation core built its dictionary from every message group, including the app-only ones (`auth`, `wizard`, `leadFlow`, `backoffice`), so moving it as-is would have made shared code import app code. `translations.ts` now has `registerMessages()`; the shared list holds `common` and `status`, and `frontend/src/i18n/appMessages.ts` registers the rest at start-up. The resulting dictionary was checked to be identical (no key appears in two groups).
  - Moving the backend-reading tests to `tests/contracts/` is deferred to Phase 5, when the tests are split by app anyway. The backend paths they read do not change until Phase 7.

### Phase 5: Two frontends, still on one backend (required; a safe midpoint)

- **Do:**
  - Create `admin-app/frontend` (its `App.tsx` is the current Back Office branch: `StaffLoginGate` → `BackOffice`, served at `/`) and the borrower frontend (current `App.tsx` without that branch).
  - Give each its own `package.json`: `recharts` only in admin, `canvas-confetti` only in borrower.
  - Old `/backoffice` and `/admin` links redirect to `VITE_ADMIN_URL`.
  - Split the tests by owner (admin: `backOffice*`, `flowApplicationInspector`, `flowDetail`; the rest go to borrower; translation parity and `dateInput` go to shared). Replace the single `coverage` threshold (more than 500 `t()` calls) with one per app.
  - Pass `isClientBlocked={false}` to the gate (C9).
  - Make document links in the admin app use the admin API base (`resolveFileUrl`), ready for Phase 6.
- **Both apps still use the current backend,** so the frontend split is proven before the backend is touched. Dev ports: borrower 3000, admin 3001.
- **Verify:** each app builds and tests on its own; the borrower `dist/` contains no `BackOffice`, `StaffLoginGate` or `quickloan_staff_token_v1`; both portals work through manual walk-throughs.

- **Done (2026-11-09).** Additions and gaps compared with the steps above:
  - Shared code used text from app-only groups (`elig.*` and `visa.err.*` from `wizard`; role, risk and quality labels from `backoffice`). Those 53 keys moved to new shared groups (`eligibility`, `validation`, `labels`); the dictionary was checked identical before the split, and after it each app was checked to contain every key its files and the shared files name.
  - The i18n/RTL guard tests became shared functions (`shared/frontend/test-utils/i18nGuards.ts`) that each suite runs on its own files and dictionary; shared code has its own suite (`npm test` in `shared/frontend`), and the backend-reading tests moved to `tests/contracts/` (`npm run test:contracts`), which Phase 4 had deferred.
  - The shared global styles moved to `shared/frontend/styles/base.css`; the Hebrew review script moved to the root `scripts/` because it reads both apps.
  - Still open: the borrower bundle contains the staff-token storage key, because the shared `authTokens` helper serves both apps. Splitting it goes with removing the dead staff branches (Phase 9).
  - The walk-through was HTTP-level only (both dev servers and the backend running, staff login from the admin origin); a click-through in a browser is still to be done.
### Phase 6: Two backend processes (required)

- **Do:**
  - Add `borrower-server.js` and `admin-server.js`, each mounting its routes on the shared core, on ports 5000 and 5100.
  - Add the token-type guards (C8).
  - Add the SSE poller to the borrower backend (C1).
  - Point both at the same `DB_PATH` and `UPLOAD_DIR`.
  - Run schema setup and terms seeding in one owner only: a `db:init` step before start, or `DB_INIT=true` on one process (C4, C5).
  - Point each frontend's `VITE_API_URL` at its own backend.
  - Leave the old `server.js` in place for rollback.
- **Risk:** `SQLITE_BUSY` under concurrent writes. **Mitigation:** WAL plus `busy_timeout`, and a concurrency test (borrower submits while staff decide, run in a loop).
- **Verify:**
  - The route matrix, split per backend: a borrower route on admin returns 404 and the reverse.
  - `test_workflow.js` runs with both servers up: borrower registers and submits Step 1 on 5000, staff approve on 5100, the borrower stream gets the update, then Steps 2 and 3 and the final decision.
  - The SSE test passes across processes.
  - Stopping either backend leaves the other fully working.

- **Done (2026-11-09).** Notes against the steps above:
  - The old `server.js` stays runnable and still passes every test; it now shares `core/appBase.js` with the two new entry points instead of keeping its own copy of the middleware and error handling.
  - Guards: the borrower backend refuses valid staff tokens (401); the admin backend refuses every non-staff or invalid token (401) and has no demo identity. Each backend checks the token before the route, so a request without a valid token gets 401 even on a route that only exists on the other backend; with a valid token it gets 404.
  - The SSE poller sets its baseline when a stream opens, so a staff change in the first seconds is not missed, and drops it when the last stream closes.
  - Ports: `BORROWER_PORT` (falls back to `PORT`) and `ADMIN_PORT` (default 5100), because both processes read the same `backend/.env` locally and `PORT` there is 5000. The admin backend defaults to `DB_INIT=false`.
  - Verified by the route matrix on both backends (owned routes answer exactly as on `server.js` except for the intended guard 401s), `WORKFLOW_SPLIT=1 node test_workflow.js`, and `test_split_backends.js` (shared uploads, concurrent writes, each backend surviving the other's stop). The concurrency check is a moderate load (150 requests in parallel batches), not a stress test.
### Phase 7: Physical move (required, mechanical only)

- **Do:** `git mv` into the final tree (section 4) so history follows, with no edits beyond require and import paths. Move `generate-hebrew-review.ts` to the root `scripts/` and update its paths. Update `CLAUDE.md`, the `docs/` files that name paths, and the backend test ports. `database.sqlite` can stay where it is, referenced through `DB_PATH`; moving it to `data/` is optional.
- **Verify:** fresh clone, `npm install` at the root, all tests green, and `generate-hebrew-review.ts` produces the same `docs/hebrew-review.csv`.

- **Done (2026-11-09).** Notes against the steps above:
  - Final tree as in section 4, with one simplification: `shared/backend` keeps the existing folders (`core/`, `services/`, `routes/`, `database.js`, `creditEngine.js`) instead of the finer `db/`, `auth/`, `pdf/`… split, so the shared files needed no edits at all. App code requires it as `@quickloan/backend-core/...`.
  - The old single `server.js` became `tests/integration/combinedServer.js`, a test harness that mounts both apps' routes; the older backend tests (now in `tests/integration/`) still run against it. Rollback is the `pre-split-baseline` tag, not this file. Splitting those tests per app is still open.
  - Data moved to `data/` (`database.sqlite` with git history, `uploads/`), and the backend `.env` to the repo root; `shared/backend/loadEnv.js` reads an app's own `.env`, then the root one. Backup taken first; WAL checkpointed before the move.
  - The backend joined the npm workspaces. Every direct backend dependency was pinned to its exact old version (package.json ranges unchanged); 12 indirect packages resolved to newer patch/minor versions within their ranges (e.g. `body-parser` 2.3.0 → 2.4.0). All tests pass with them.
  - Two copies of `multer` ended up installed (one per workspace), which broke the `instanceof MulterError` check in the error handler (uploads errors became 500s). The handler now also matches by error name.
  - Living docs had 98 paths updated; their line numbers and mentions of the old `backend/server.js` still describe the single backend (noted at the top of `docs/README.md`). Historical documents were left as written.
### Phase 8: Deployment and cut-over (required)

- **Do:** see section 7. Run the old app and the new apps side by side on staging against a copy of the database, then switch. Remove the old `backend/` and `frontend/` folders only after the new apps have run in production for an agreed period.
- **Rollback:** redeploy the `pre-split-baseline` tag. The database is untouched, so rollback is instant.

- **Deployment kit done (2026-11-09); cut-over waits on a server.** Notes against the steps above:
  - Hosting chosen: one Ubuntu 24.04 VPS, nginx plus pm2, one origin per app (`app.` / `admin.`, placeholders `example.com` for now). Files in `deploy/`; procedures in `docs/deployment-runbook.md`.
  - Code changes, all opt-in by setting and unchanged without them: `TRUST_PROXY` (visitor IPs behind nginx; without it every visitor shares one rate-limit bucket and the audit log records 127.0.0.1), `LISTEN_HOST` (APIs on localhost only), a start-up warning in production when Twilio or SMTP are missing, and the staff seed refusing its public default passwords in production.
  - Rehearsed end to end in a fresh Ubuntu 24.04 container, results in the runbook's rehearsal record. Found: the prebuilt SQLite module needs Ubuntu 24.04 or newer (glibc 2.38), Node 20 is end of life so the server runs Node 22 LTS, and a backup name clash (fixed).
  - "Old and new side by side" doesn't apply: there was no production deployment before, so the first deploy is the cut-over. Production starts with an empty database; `data/database.sqlite` is test data. Rollback is redeploying the previous release tag (`pre-split-baseline` predates the new layout and the scripts).
  - Still to do on the real server: DNS and certificates, Twilio/SMTP credentials, staff passwords, a staging run, and the go-live checklist (runbook section 3). The old `backend/` and `frontend/` folders are already gone from git (Phase 7).

### Phase 9: Optional improvements, after cut-over

- **Done (2026-11-09): separate JWT secrets with an `aud` claim, and CORS per app.**
  - Borrower tokens: `BORROWER_JWT_SECRET`, audience `quickloan-borrower`. Staff tokens: `ADMIN_JWT_SECRET`, audience `quickloan-admin`. HS256 only. Each is checked against the secret and audience of the kind it claims, so a borrower-signed token can't pass as staff.
  - In production each API needs its own secret and the two must differ, or it refuses to start. Locally both fall back to `JWT_SECRET`.
  - The borrower API still refuses staff tokens it can't verify, so the route matrix is unchanged.
  - Existing tokens have no audience, so everyone signs in once more after this deploys. The frontends now return to sign-in when a request with a token gets a 401; before, an expired session left the borrower app stuck on "could not load".
  - CORS: each API allows only its own Vite dev site locally and nothing in production (same origin behind nginx); `CORS_ORIGIN` overrides.
  - Tested by `tests/integration/test_tokens_and_cors.js` (27 checks) and `shared/frontend/services/__tests__/apiCore.test.ts`.

- Separate JWT secrets and an `aud` claim (section 3).
- CORS limited to each app's own origin (currently `cors()` allows everyone).
- Remove the dead staff branches from borrower-side handlers, and the borrower branches from admin-side ones.
- Split `storage.ts` into borrower and admin parts.
- Pass the expected status to the two `updateFlowApp` calls that skip it (section 6).
- Make request numbers safe across processes (C11).
- Instant SSE through the internal webhook (section 3).
- Limit admin access by IP or VPN.
- HttpOnly cookies instead of tokens in localStorage.

---

## 6. Database and Backend Strategy

Both backends open the same SQLite file through one shared module; WAL mode and a busy timeout are the only database-level additions, and neither touches tables or data.

- **Connections.** One `sqlite3.Database` per process, as today, opened by `shared/backend/db/database.js` from `DB_PATH`. WAL mode lets reads run while a write is in progress (it creates `-wal` and `-shm` files next to the database); the busy timeout is 5 seconds.
- **Shared models and database access.** One copy of `parseApp`, `writeApp`, `updateFlowApp`, the `FLOW_JSON` columns, `safeJson` and so on, in `shared/backend`. Neither app writes its own SQL for shared tables.
- **Transactions.** The code uses none today, and this plan keeps it that way. Multi-step writes keep their current order and behaviour.
  - Don't add `BEGIN … COMMIT` around handlers on the shared connection. `sqlite3` uses one connection per process, so while one request holds a transaction, statements from other requests run inside it, and a rollback would undo their writes too. Real transactions need a dedicated connection per transaction; treat that as a separate project.
- **Consistency and concurrent access.** SQLite serialises writes across processes, so the file itself is safe. The remaining risk is a lost update: one side reads a whole row, changes it in memory and writes it back over the other side's change.
  - For 3-step applications this is already mostly handled. `updateFlowApp(a, expectedFlowStatus)` (`flow.js:217`) adds `AND flowStatus = ?`, and the step and decision handlers return `409 CONFLICT` when the row has changed. Keep this exactly as it is in the shared module.
  - Two calls skip the check: registration consent (`flow.js:465`) and the staff message (`flow.js:849`). These write fields that the other side rarely changes at the same moment, but the gap exists. Passing the expected status is a logic change, so it's listed as optional.
  - The legacy `writeApp` path (classic wizard and `PUT /api/applications/:id`) has no check. This race already exists in the single process because async handlers interleave. The split doesn't create it.
  - Request numbers (C11) can collide under simultaneous registrations. A fix (retry on a duplicate, or a unique index) is optional and needs its own review.
- **Migrations and future maintenance.**
  - `database.js` stays the single source of truth for the schema, run by one owner. Neither app backend runs its own `CREATE` or `ALTER` statements.
  - Future changes must be additive only, matching the current `ALTER TABLE ADD COLUMN` pattern.
  - Order: change the schema first, then deploy the backend that reads the new column, then the other. A column must never be removed while either app still reads it.
- **Uploads.** One directory, `UPLOAD_DIR`, shared by both. The borrower backend writes; the admin backend only reads. Ownership checks stay in the `uploaded_files` table as now, including `adoptGuestUploads` for files uploaded before registration.
- **Backups.** Back up while the apps run with `sqlite3 database.sqlite ".backup …"`, which is safe in WAL mode, plus a copy of `uploads/`.

---

## 7. Deployment Strategy

Run both backends on one host while the data stays in SQLite, and give each app its own origin that proxies its own `/api`.

- **Required while on SQLite:** both backends run on one host and see the same disk (two services on one VM, or two containers mounting the same local volume). Never put SQLite on a network file share (NFS, SMB, EFS): WAL locking doesn't work reliably there.
- **Processes.** Two Node processes, `borrower-app/backend` and `admin-app/backend`, managed by whatever process manager the host already uses (for example two `pm2` apps). `docs/build-and-release.md` confirms there is no hosting config today.
- **Frontends.** Two static builds (`dist/`), served by a reverse proxy, a static host, or a CDN, with SPA fallback to `index.html`.
- **Routing (recommended): one origin per app.**
  - `app.<domain>`: borrower `dist/`, with `/api` going to `localhost:5000`
  - `admin.<domain>`: admin `dist/`, with `/api` going to `localhost:5100`
  - With this setup `VITE_API_URL=/api`, CORS isn't needed, and SSE works as long as proxy buffering is off (the server already sends `X-Accel-Buffering: no`). The whole `admin.` site can be IP-restricted at the proxy.
  - Alternative: separate API subdomains (`api.<domain>`, `admin-api.<domain>`). This needs `CORS_ORIGIN` set on each backend and adds two more hostnames; use it only if the frontends must be hosted somewhere that can't proxy.

| Service | Local dev | Production (recommended) | Exposure |
| --- | --- | --- | --- |
| Borrower frontend | `localhost:3000` | `app.<domain>` | Public |
| Borrower backend | `localhost:5000` | `app.<domain>/api` | Public, rate-limited |
| Admin frontend | `localhost:3001` | `admin.<domain>` | Internal; IP or VPN restriction optional |
| Admin backend | `localhost:5100` | `admin.<domain>/api` | Internal |

### Environment variables

| Variable | Borrower BE | Admin BE | Notes |
| --- | --- | --- | --- |
| `PORT` | 5000 | 5100 |  |
| `NODE_ENV`, `DEMO_MODE` | ✓ | ✓ | `DEMO_MODE` must be `false` in production for both |
| `JWT_SECRET` | ✓ | ✓ | same value for now; separate secrets optional later |
| `DB_PATH`, `UPLOAD_DIR` | ✓ | ✓ | must be the same absolute path |
| `DB_INIT` | `true` | `false` | only one process sets up the schema |
| `TWILIO_*`, `SMTP_*` | ✓ | ✓ | admin sends decision notifications too |
| `FLOW_REGISTER_RATE_LIMIT` | ✓ | – |  |
| `STAFF_LOGIN_RATE_LIMIT` | – | ✓ |  |
| `CORS_ORIGIN` | ✓ | ✓ | only needed without same-origin proxying |
| `VITE_API_URL` | borrower FE | admin FE | build time |
| `VITE_ADMIN_URL` | borrower FE | – | redirects old `/backoffice` links |

Example `borrower-app/backend/.env.example`:

```ini
NODE_ENV=production
PORT=5000
DEMO_MODE=false
JWT_SECRET=<strong-secret>
DB_PATH=/var/data/quickloan/database.sqlite
UPLOAD_DIR=/var/data/quickloan/uploads
DB_INIT=true
TWILIO_SID=...
TWILIO_TOKEN=...
TWILIO_FROM=...
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
```

`admin-app/backend/.env.example` is the same with `PORT=5100` and `DB_INIT=false`.

- **Logging and monitoring.** Prefix every log line with the app name (`[borrower]` / `[admin]`) and keep separate log files. Watch each app's `/api/health` separately. Track open SSE connections and how often `SQLITE_BUSY` errors occur.
- **Production notes.** Deploy the two apps independently, but schema changes first (section 6). Keep the baseline build ready to redeploy. Admin downtime never affects borrowers, because neither app calls the other.

---

## 8. Testing and Validation Checklist

The Phase 1 route matrix is the backbone; everything else checks a specific coupling or workflow.

### Contract and isolation

- [ ] Phase 1 route matrix is green after every phase, split per backend from Phase 6 on
- [ ] A borrower token gets 401/403 on every admin route; a staff token gets 401/403 on borrower-only routes; no token on admin gets 401 even in demo mode
- [ ] The borrower backend returns 404 on `/api/auth/staff-*` and `/api/flow/applications*`; the admin backend returns 404 on `/api/users/*` login routes and `/api/flow/application*`
- [ ] Each role (`customer_service`, `credit_reviewer`, `system_admin`, `funding_entity`) has the same access as in the baseline matrix
- [ ] Stopping the admin app leaves the borrower app fully working, and the reverse
- [ ] The architecture boundary test passes; the borrower bundle contains no admin code, and the reverse
- [ ] Contract tests (`pdfLabels`, `statusMessages`, loan-calculation fixtures, eligibility mirror) pass from `tests/contracts/`

### Borrower app

- [ ] Backend tests: `test_guarantors_and_scoring.js`, `test_returning_user_prefill.js`, and the borrower parts of `test_verification.js`
- [ ] Step 1 registration: OTP, email and password, Step 1 fields, and guest uploads before registration are saved and adopted
- [ ] Returning user: password login, Google demo login, forgot/reset password, returning-user prefill modal, language switch (English ↔ Hebrew, RTL)
- [ ] Steps 2 and 3: locked steps can't be edited early; changes-requested banner and staff note show on `FlowStatusHub`; Step 3 bank details and terms acceptance succeed
- [ ] Notifications, My Applications, and the borrower PDF (full bank account) in both languages
- [ ] `/backoffice` and `/admin` on the borrower site redirect to the admin URL and show no admin UI

### Admin app

- [ ] Backend tests: the staff parts of `test_verification.js`, plus credit rules, analytics and audit
- [ ] `StaffLoginGate` shows at `/`; seeded staff accounts log in; repeated wrong passwords trigger the lockout; the demo role picker appears only when `DEMO_MODE` is on
- [ ] Role limits: `customer_service` can view, request changes and message but not approve, reject or edit credit rules; `credit_reviewer` can decide; `system_admin` can edit credit rules; `funding_entity` sees what it sees today
- [ ] Step 1–3 data shows correctly for existing records and new submissions; staff can open a document a borrower just uploaded (shared `UPLOAD_DIR`)
- [ ] The bank account is masked by default, the reveal is logged as `BANK_DETAILS_VIEWED`, and the staff PDF masks it and includes risk data
- [ ] Analytics charts render; decisions send in-app, SMS and email notifications; failed deliveries can be retried

### Both apps together

- [ ] `tests/integration/`: `test_workflow.js` (register → Step 1 → staff approve → … → final decision, plus the loan-calculation fixtures) and `test_i18n.js`
- [ ] SSE: a staff status change on the admin backend reaches the borrower's `Step11StatusTimeline` within about 5 seconds
- [ ] Concurrency: parallel borrower submits and staff decisions in a loop produce no `SQLITE_BUSY` errors and no corrupted rows; conflicting updates return 409 as they do today
- [ ] Frontend: both apps pass `npm test`, `lint` and `build`; the i18n and RTL scanner tests also cover `shared/frontend`; en/he key parity holds
- [ ] `generate-hebrew-review.ts` produces the same `docs/hebrew-review.csv` as before the move
- [ ] Manual walk-through in English and Hebrew: borrower 3-step flow, classic wizard, notifications, My Applications; admin login, filters, inspector, decisions, messages, analytics, credit rules, exports
- [ ] Row counts and checksums of `database.sqlite` match before and after a migration-only deploy

---

## 9. Risks and Mitigation

Every risk has a matching test or a one-owner rule; the untouched database keeps rollback instant.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Uncommitted work collides with the refactor | High | Phase 0: commit it first and freeze features |
| Route ordering breaks auth (public routes registered after `authenticate`) | High | Keep the mount order explicit in each `server.js`; the route matrix tests no-token access |
| `SQLITE_BUSY` / schema setup skips a column (C4) | High | WAL, `busy_timeout`, one schema owner, concurrency test |
| Staff can't open documents after the split (C2) | High | Same absolute `UPLOAD_DIR` in both backends; tested in Phase 6 |
| Demo identity leaks into admin (C8) | High | Admin guard rejects anything without `type: 'staff'`; tested |
| SSE silently stops working (C1) | Medium | Poller plus an automated test across processes |
| Duplicate terms seed rows (C5) | Medium | Seed only in the schema owner |
| Mirrored logic drifts (C6) | Medium | Kept in `shared/`; contract tests run once against the shared code |
| Frontend tests and the Hebrew review script break on the move (C10) | Medium | Move them to `tests/contracts/` and root `scripts/` in Phase 4 and 7; compare the regenerated CSV |
| Duplicate request numbers (C11) | Low (exists today) | Documented; optional fix after cut-over |
| Admin loses localStorage demo and fallback data (C7) | Low | Confirm whether anyone needs it (open questions); if so, back those views with the API |
| Tailwind classes missing for shared components | Low | `@source` in each app's CSS; visual check |
| Accidental cross-app imports later | Low | Architecture boundary test in `test:all` |
| Hosts split later and break shared SQLite | Low | Document the one-host rule; moving to a database server would be a separate project |
| Rollback needed | – | Database untouched, so redeploy `pre-split-baseline` |

---

## 10. Final Recommendations

The safest order: **0 baseline → 1 contract tests → 2–3 backend reorganised in place → 4–5 frontend split (shippable, still one backend) → 6 two backend processes → 7 folder move → 8 cut-over → 9 optional hardening.**

Two rules make it low-risk: no phase changes behaviour and moves files at the same time, and the database is never touched.

| Classification | Scope |
| --- | --- |
| **Required** | npm workspaces; configurable `DB_PATH` and `UPLOAD_DIR`; WAL and `busy_timeout`; token-type guards; one schema owner; the SSE poller; the admin `App.tsx`; contract tests moved out of the frontend; the boundary test |
| **Optional, after cut-over** | Separate JWT secrets; strict CORS; removing dead branches; splitting `storage.ts`; full optimistic-lock coverage; safe request numbers; SSE webhook; IP/VPN restriction on admin; HttpOnly cookies; PostgreSQL and object storage only if the apps ever need to run on separate hosts |
| **Rejected** | `PRAGMA foreign_keys = ON` (changes behaviour); `BEGIN … COMMIT` on the shared connection (unsafe with one connection per process); moving `database.sqlite` before cut-over; copying code between apps |

### Open questions

1. Can the reference image be shared? This plan follows the layout described in the request.
2. Should the in-progress work be committed as it stands, or finished first?
3. Is there a production deployment today? The repo has no hosting config. Where will this run, and is staying on SQLite on one host acceptable?
4. Is the classic wizard still needed? If it's being retired, SSE and the poller can go entirely.
5. Does anyone rely on the Back Office's localStorage demo data, local audit events or simulated funding handoff?
6. Which domains or subdomains are wanted? Should demo mode ever run on the admin deployment?
7. Folder names: lowercase `borrower-app/`, `admin-app/`, `shared/` (recommended, works the same on every OS and in npm workspaces) or something else?
8. Separate item: `FlowApplicationInspector.tsx:340` builds a `/documents/:id` URL, but no backend route serves it. Is that part of the work in progress?
