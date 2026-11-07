# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

QuickLoan: a digital micro-loan application for foreign workers in Israel. Two independent npm projects (no root `package.json`):

- `backend/` — Express 5 + SQLite (CommonJS). The main API is in `server.js`; the 3-step workflow routes are in `routes/flow.js`
- `frontend/` — React 19 + Vite + Tailwind v4 (TypeScript, ESM)

The root `README.md` is the stock AI Studio template and is outdated. `implementation_plan.md` is the design for the current work, the 3-step approval workflow (statuses, notification matrix, decisions), and is the best record of intent. `implementation-plan01.md` is the older, finished phased plan (security, file uploads, analytics, SSE, etc.). `design/DESIGN.md` holds the design tokens (colors, typography) that the UI follows.

## Commands

Backend (from `backend/`, port 5000 by default):
- `npm run dev`: nodemon server
- `npm start`: plain node
- Tests are standalone scripts, not a framework. Each one `require('./server')`, listens on its own port (5002/5003/5004), runs assertions over HTTP, and exits non-zero on failure. Run one with:
  - `node test_verification.js`
  - `node test_guarantors_and_scoring.js`
  - `node test_returning_user_prefill.js`
  - `node test_i18n.js` (port 5005; also starts a child server on 5006 with `DEMO_MODE=false`)
  - `node test_workflow.js` (port 5012): the 3-step workflow, including the loan calculation checked against `fixtures/loan-calc-fixtures.json`
  - `npm test` is a placeholder and does nothing.
- Tests use the real `database.sqlite`. There is no separate test DB.
- Seed scripts: `node scripts/seed_staff.js` creates one staff account per role (`admin@quickloan.co.il` etc.; the admin password comes from `ADMIN_INITIAL_PASSWORD`). `node scripts/seed_pending_application.js` creates an applicant waiting for Step 1 approval through the real API (backend must be running in demo mode; `API_URL` overrides the base URL).

Frontend (from `frontend/`, port 3000):
- `npm run dev`: Vite dev server
- `npm run build`
- `npm run lint`: type-check only (`tsc --noEmit`). There is no ESLint.
- `npm test`: Vitest + React Testing Library (jsdom). `npm run test:watch` for watch mode, `npx vitest run <path>` for one file. Tests live in `__tests__/` folders next to the code; setup is `src/test/setup.ts`.

## Backend architecture

- `server.js` holds all routes, middleware, OTP/SSE state and helpers. It exports `app` and only calls `listen` when it runs as the main module, which is how the tests import it.
- `database.js` creates the schema on startup. Schema changes are made by appending `ALTER TABLE ... ADD COLUMN` statements to the list there; errors are ignored when a column already exists. There is no migrations tool. JSON-shaped fields (guarantors, riskFlags, eligibilityBreakdown, profileData, …) are stored as TEXT and parsed or serialized in `server.js`.
- Auth: `optionalAuth` runs globally. Then `app.use('/api', authenticate)` protects every route registered after it, so public auth routes (`/api/users/login`, `request-otp`, `verify-otp`, …) must be declared *before* that line. Staff endpoints use `requireStaff(...roles)`. Roles: `customer_service`, `credit_reviewer`, `system_admin`, `funding_entity` (plus `borrower`).
- **DEMO_MODE** is on unless `NODE_ENV=production` or `DEMO_MODE=false`. It enables a fixed OTP `123456`, `/api/auth/staff-token` role-picker tokens, mock Google login, codes echoed back in responses, and a fallback `demo_user` identity when no or invalid token is sent. Keep this in mind when reasoning about access control. `JWT_SECRET` falls back to a dev constant outside production.
- Two scoring systems, which are different things:
  - `creditEngine.js`: the rule-based risk pre-screen (riskScore/riskLevel/riskFlags). Thresholds can be overridden through `PUT /api/config/credit-rules`, which persists them in the `app_config` table. It is advisory only and never blocks a submission.
  - `services/eligibilityScoring.js`: the indicative eligibility score. **It is mirrored in `frontend/src/services/eligibilityScoring.ts`.** Keep both in sync when you change factors or weights.
- Uploads: multer writes to `backend/uploads/` (gitignored), metadata goes in the `uploaded_files` table, and files are served via `GET /api/uploads/:filename`.
- Real-time: `GET /api/applications/:id/events` is SSE. Status changes in `PUT /api/applications/:id` broadcast to subscribers, and `Step11StatusTimeline` listens with `EventSource`.
- `services/smsService.js` (Twilio) and `services/emailService.js` (SMTP) log mock output to the console when their env vars (`TWILIO_SID`/`TWILIO_TOKEN`, `SMTP_USER`/`SMTP_PASS`) are unset. Borrower-facing backend text (status SMS/notifications, OTP, password reset) lives in `services/messages.js` (en + he, falls back to English); add new texts there, not inline in `server.js`. `pdfService.js` streams an application summary PDF with pdfkit, in English or Hebrew (`?lang=`). PDF labels are in `pdfLabels.js` (stored-value labels must match the frontend; a frontend test checks this). Hebrew text must go through `pdfRtl.js` (bidi reordering for pdfkit), and Heebo fonts are in `backend/assets/fonts/`.
- **3-step approval workflow** (applications with `flowVersion = 2`). This is the default applicant flow:
  - `services/workflow.js` has no I/O. It defines the `flowStatus` values (`LEAD_REGISTERED` → `PENDING_STEP1_APPROVAL` → `STEP1_APPROVED` → … → `PENDING_FINAL_PROCESSING` → `LOAN_APPROVED`/`LOAN_REJECTED`, plus `STEPn_CHANGES_REQUESTED`), the allowed transitions, the Back Office filter groups (`groupOf`) and which staff roles may view, decide or message. Every state change in `routes/flow.js` is checked against these tables, so add new transitions there.
  - `routes/flow.js` exports `createFlowRoutes(deps)`. `server.js` passes its helpers in and calls `registerPublic(app)` before the `authenticate` line (`/api/flow/register`, `/api/flow/google`, `/api/auth/staff-login`) and `registerProtected(app)` after it (applicant step draft/submit, final documents, terms, and the staff list, detail, step decision, final decision, message, delivery retry and audit endpoints under `/api/flow/applications`).
  - The legacy `PUT /api/applications/:id` refuses `flowVersion = 2` applications. Change them only through `/api/flow` endpoints. `GET /api/applications` (staff) includes all flow applications, not only submitted ones, and masks the bank account. Staff reveal it through `GET /api/flow/applications/:id?revealBank=1`, which is audited.
  - `services/flowValidation.js` is the server-side authority for each step's data (`clean*` for drafts, `validate*` returns `{field: errorCode}`; the frontend translates the codes).
  - `services/loanCalculator.js` is a port of `calculateLoanRepayment`/`getServiceFeeForAmount` in `frontend/config/appConfig.ts`. **Keep both identical.** The shared fixture is `backend/fixtures/loan-calc-fixtures.json`.
  - `services/terms.js`: versioned General T&C and Service Fee texts (`terms_versions`). Applicants see the latest version, and each acceptance stores the version and the SHA-256 of the text (`terms_acceptances`). To publish new wording, add a version; don't edit an existing one.
  - Notifications: `services/flowMessages.js` holds the en/he texts and the `FLOW_EVENTS` matrix (in-app/SMS/email per event; `'optional'` email can be switched off with the `notifyEmailOptional` app_config key). `services/flowNotifications.js` sends them and logs each channel in `notification_deliveries`. A failed send never undoes the workflow step.
  - New tables: `application_step_reviews`, `application_step_submissions`, `audit_log`, `terms_versions`, `terms_acceptances`, `staff_users` (real staff accounts with bcrypt passwords, used by `/api/auth/staff-login`), `notification_deliveries`.
  - `services/dbHelpers.js` has promise wrappers (`dbGet`/`dbAll`/`dbRun`), `newId`, `sha256` and `safeJson`. New backend modules use them.

## Frontend architecture

- `App.tsx` has two applicant flows, switched by `flowMode`:
  - **3-step flow** (`'intermediary'`, the default): `Step1LeadGeneration` (registration and Step 1) → `Step2ApplicationCompletion` → `Step3FinalSubmission`, with `FlowStatusHub` between steps (`currentFlowStep` is `1 | 2 | 3 | 'hub'`). The state comes from the backend (`flowApplication`, a `FlowApplicationView` in `types.ts`), and each step needs a Back Office approval before the next one opens. The API methods are the `flow*` / `*FlowStep*` ones in `services/api.ts`.
  - **Classic wizard** (`'classic'`, behind the "classic wizard" link): a numbered `currentStep` (1 Language → 2 Auth → 3–9 form steps → 10 Submission success → 11 Status timeline). Each step is a `components/StepN*.tsx`. The `Step1`/`Step2`/`Step3` names overlap between the two flows. Under Vitest `flowMode` defaults to `'classic'`, so the existing App tests exercise the classic wizard.
- `BackOffice.tsx` (staff console, including `AnalyticsDashboard`) replaces the applicant UI when it is toggled on. For flow applications it loads `GET /api/flow/applications/:id`, normalizes it with `services/flowDetail.ts` (`normalizeFlowDetail`), and shows it in `FlowApplicationInspector` (step decisions, final decision, messages, delivery retry, audit). Staff and backoffice text is in `i18n/messages/backoffice.ts`; applicant flow text is in `leadFlow.ts`.
- Two data layers:
  - `services/api.ts`: the backend client. Base URL is `VITE_API_URL` or `http://localhost:5000/api`. It stores separate borrower and staff JWTs in localStorage and exports `ApiError` and `isNetworkError`.
  - `services/storage.ts`: a large `StorageService` that keeps a localStorage/in-memory model of users, applications, notifications, audit events and config, with seeded demo applications. It handles draft persistence and offline backup. Components often call both layers, so check which one a change belongs in.
  - Session user: after any backend login, `App.handleAuthenticated` passes the user through `storageService.adoptUser()`, so the session keeps the backend id (the `sub` in the JWT) and the local copy made by the `storageService` login helpers is merged into it. On start-up the user comes from `storageService.restoreSession(authTokens.subject())`. Never put a locally generated user id into the session while a backend token exists, or API calls for the user return 403.
- Shared types: `types.ts`. Business limits (loan amounts, repayment periods, fees, min age, visa validity): `config/appConfig.ts`.
- i18n: `i18n/translations.ts` holds the dictionaries and a `t(lang, key)` helper. `i18n/LanguageContext.tsx` (`LanguageProvider` in `main.tsx`, `useI18n()` hook) owns the current language, saves it in localStorage (`quickloan_language`), and sets `<html lang dir>`. Hebrew is RTL.
  - Only English and Hebrew are enabled (`enabled` flag in `SUPPORTED_LANGUAGES`, `ENABLED_LANGUAGES`). Thai, Chinese and Filipino are on hold: hidden from pickers, dictionaries kept. New UI strings need `en` and `he` entries only. `translations.test.ts` enforces en/he key parity.
  - New UI strings go in `i18n/messages/*.ts` (grouped by area, en + he), not in the base dictionary. Never hard-code visible text: tests scan components for English JSX text and check every `t()` key exists. Use `{/* i18n-ignore */}` only for brand names or demo data.
  - Stored values (dropdown options, statuses, roles, risk flags, document codes) stay English. Show them with the helpers in `i18n/options.ts` (`optionLabel`, `statusLabel`, …). Show errors with `localizeError()` from `i18n/apiErrors.ts`.
  - Date fields use `<DateInput>` (`components/DateInput.tsx`, value is an ISO date), never `<input type="date">`, which shows the browser's format instead of the app's. `dateInput.test.tsx` enforces this.
  - Request numbers and phone numbers inside free text (notification messages) go through `<LtrText>` (`i18n/LtrText.tsx`) so they stay left-to-right in Hebrew.
  - The Hebrew review sheet for the native speaker is `docs/hebrew-review.csv` (generated from the dictionaries; regenerate it after big text changes).
  - Numbers, amounts and dates: use `formatCurrency`/`formatNumber`/`formatDate`/`formatDateTime`/`formatTime` from `i18n/format.ts` (or the bound versions on `useI18n()`). Never use bare `toLocale*()` or hand-write `₪{…}`; `no-bare-tolocale.test.ts` enforces this. Translation strings take the already-formatted amount (`{amount}`) without their own `₪`.
  - Eligibility factor descriptions carry `descriptionKey`/`descriptionParams` in both scoring mirrors; keep the keys in sync too.
  - RTL: use logical Tailwind classes (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/e/rounded-s/e`), never `ml-/pr-/left-/text-right` etc. Directional icons need `rtl:rotate-180`. Phone numbers, codes, IDs and emails get `dir="ltr"` (inputs) or `<bdi dir="ltr">` (display). `no-physical-direction.test.ts` enforces the class and icon rules.
  - Language changes go through `handleLanguageSelect` in `App.tsx`, which also saves the choice to the user's account (`PUT /api/users/me/language`, accepts `en`/`he`).
  - Ongoing Hebrew work is tracked in `hebrew-localization-plan.md`.
- The `@` import alias resolves to `frontend/` (not `src/`).
- The `.py` scripts in `frontend/` (`clean.py`, `fix_case.py`, `recover.py`) are one-off maintenance helpers, not part of the build. `scratch/` is gitignored.
