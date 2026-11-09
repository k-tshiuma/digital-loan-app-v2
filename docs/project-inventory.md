# Project Inventory

> Snapshot taken 2026-10-11 on branch `feature/guarantor-enhancements-and-scoring` (HEAD `397b7d9`). Status labels are defined in [README.md](README.md#verification-status-legend).

## 1. What this application is

QuickLoan (branded **LendGlobal** in the UI, PDFs, SMS text and `borrower-app/frontend/metadata.json`) is a **digital micro-loan application and status-tracking system for foreign workers in Israel**. A borrower picks a language, signs in by phone OTP or password, completes a multi-step loan application (personal, residency, employment, loan, guarantors, documents, consent and signature), submits it, and tracks its status. A back office lets staff review applications, change status, view analytics and tune credit pre-screening rules.

**The application originates, collects and reviews loan *applications*. It does not disburse funds, collect repayments, keep balances or a ledger, or integrate with a real bank or payment provider.** See [financial-workflows.md](financial-workflows.md).

## 2. Platform finding: this is a web app, not a native mobile app

The documentation brief assumed Flutter or React Native. **Neither is present (Verified).**

| Question | Finding | Evidence |
|---|---|---|
| Flutter / Dart | Not present: no `pubspec.yaml`, no `.dart` files | `git ls-files` (68 tracked files) |
| React Native | Not present: no `react-native` dependency, no `android/` or `ios/` directories, no Metro config | `borrower-app/frontend/package.json` |
| Native Android / iOS modules | Not present | — |
| Actual client | Mobile-first **React 19 single-page web app** built with Vite 6 and Tailwind v4 | `borrower-app/frontend/package.json`, `borrower-app/frontend/src/App.tsx:322-323` (`max-w-md` phone-width card) |
| Actual server | **Node.js / Express 5** REST API with a SQLite file database | `backend/package.json`, `backend/server.js`, `shared/backend/database.js` |

`borrower-app/frontend/metadata.json` describes the app as "Mobile-first" and asks for `camera` frame permission. That is an **AI Studio applet manifest**. It is not a native app manifest. "Mobile" concerns therefore come down to responsive layout, the browser `capture="environment"` camera input, and browser storage. [mobile-application.md](mobile-application.md) covers this in detail.

## 3. Technology stack

### Backend: `backend/`
| Item | Declared version (`package.json`) | Notes |
|---|---|---|
| Runtime | Node.js (version not pinned; **v20.20.2** used for verification) | No `engines` field, no `.nvmrc` |
| Module system | CommonJS (`"type": "commonjs"`) | |
| express | ^5.2.1 | Express 5 forwards rejected promises from async handlers to the error handler |
| sqlite3 | ^6.0.1 | Single file `data/database.sqlite` |
| jsonwebtoken | ^9.0.3 | HS256 JWTs (library default) |
| bcryptjs | ^3.0.3 | 10 rounds (`server.js:35`) |
| multer | ^2.4.0 | Disk storage in `data/uploads/` |
| pdfkit | ^0.20.2 | PDF summary streaming |
| twilio | ^6.1.2 | SMS, used only when `TWILIO_SID`/`TWILIO_TOKEN` are set |
| nodemailer | ^10.0.14 | Email, used only when `SMTP_USER` is set |
| cors | ^2.8.6 | Configured with no options, so every origin is allowed |
| dotenv | ^17.4.2 | Loads `.env` if present |
| nodemon (dev) | ^3.1.14 | `npm run dev` |
| Lockfile | `backend/package-lock.json` (npm) | |

Installed versions (read from `node_modules/*/package.json` on 2026-10-11): all backend packages match the declared minimums exactly (express 5.2.1, sqlite3 6.0.1, jsonwebtoken 9.0.3, bcryptjs 3.0.3, multer 2.4.0, pdfkit 0.20.2, twilio 6.1.2, nodemailer 10.0.14, cors 2.8.6, dotenv 17.4.2).

### Frontend: `borrower-app/frontend/`
Installed (2026-10-11): react 19.2.8, vite 6.4.3, tailwindcss 4.3.3, typescript 5.8.3, recharts 3.10.1, @google/genai 2.19.0. Caret ranges mean a fresh install may resolve newer versions. Use `npm ci` with `package-lock.json` for reproducible builds.

| Item | Declared version | Notes |
|---|---|---|
| react / react-dom | ^19.0.1 | |
| vite | ^6.2.3 | Dev server on port 3000, `--host=0.0.0.0` |
| @vitejs/plugin-react | ^5.0.4 | |
| tailwindcss / @tailwindcss/vite | ^4.1.14 | |
| typescript | ~5.8.2 | `npm run lint` = `tsc --noEmit` (**currently fails**, see [testing-and-qa.md](testing-and-qa.md)) |
| recharts | ^3.10.1 | Analytics charts |
| motion | ^12.23.24 | Animations |
| lucide-react | ^0.546.0 | Icons |
| canvas-confetti | ^1.9.4 | Submission celebration |
| @google/genai | ^2.4.0 | **Declared but never imported** (Verified by grep) |
| express | ^4.21.2 | **Declared but never imported by `src/`** (AI Studio template leftover) |
| Lockfiles | `package-lock.json` **and** `borrower-app/frontend/bun.lock` | Two lockfiles, so the package manager of record is ambiguous |
| Package name | `react-example` | Template leftover |

### Tooling not present (Verified absent)
- CI/CD configuration (no `.github/`, no pipeline files)
- Dockerfiles or infrastructure-as-code
- ESLint or Prettier configuration
- Test framework (backend tests are standalone Node scripts; no frontend tests)
- Migration tool
- Crash reporting or monitoring SDK

## 4. Repository structure

```
digital-loan-app/
├── CLAUDE.md                     # Developer guidance (accurate, minor drift; see technical-debt.md)
├── README.md                     # Stock Google AI Studio template, outdated
├── implementation-plan.md        # Phase 1–8 feature plan, all marked complete
├── .gitignore                    # Ignores node_modules, dist, .env*, scratch/, data/uploads/*
├── design/                       # PNG mockups + DESIGN.md (colour and typography tokens)
├── backend/
│   ├── server.js                 # ALL routes, middleware, auth, OTP store, SSE, helpers (1309 lines)
│   ├── database.js               # SQLite connection + schema creation + ALTER TABLE list
│   ├── creditEngine.js           # Rule-based risk pre-screen (advisory)
│   ├── services/
│   │   ├── eligibilityScoring.js # 100-point indicative eligibility score (mirrored in frontend)
│   │   ├── pdfService.js         # pdfkit application summary
│   │   ├── smsService.js         # Twilio or console mock
│   │   └── emailService.js       # SMTP or console mock
│   ├── test_verification.js            # HTTP integration script (port 5002)
│   ├── test_guarantors_and_scoring.js  # Scoring unit + HTTP script (port 5003)
│   ├── test_returning_user_prefill.js  # Returning-user HTTP script (port 5004)
│   ├── database.sqlite           # ⚠ COMMITTED database file (see security-and-privacy.md)
│   └── uploads/.gitkeep          # Upload directory (contents gitignored)
├── borrower-app/frontend/
│   ├── index.html, vite.config.ts, tsconfig.json, metadata.json, .env.example
│   ├── clean.py, fix_case.py, recover.py   # One-off maintenance scripts, not part of the build
│   └── src/
│       ├── main.tsx              # React root
│       ├── App.tsx               # Wizard state machine (currentStep 1–11) + back-office toggle
│       ├── types.ts              # Shared domain types
│       ├── config/appConfig.ts   # Business limits, fees, repayment formula, document types
│       ├── i18n/translations.ts  # en, he, th, zh, tl + t()
│       ├── services/
│       │   ├── api.ts            # Backend client (fetch + JWT in localStorage)
│       │   ├── storage.ts        # localStorage "shadow backend": users, apps, audit, config, seeds
│       │   └── eligibilityScoring.ts  # Mirror of backend scoring
│       └── components/           # Step1–Step11, BackOffice, AnalyticsDashboard, Header, modals…
└── scratch/                      # gitignored working area
```

## 5. Entry points

| Entry point | File | Notes |
|---|---|---|
| API server | `backend/server.js` (`require.main === module`, line 1303) | Listens on `PORT` (default 5000). Exports `app` for the tests |
| DB bootstrap | `shared/backend/database.js` | Runs on first `require`; creates tables and ignores duplicate-column errors |
| Web client | `borrower-app/frontend/index.html` → `src/main.tsx` → `src/App.tsx` | |
| Client data layer singletons | `apiService` (`src/services/api.ts:120`), `storageService` (`src/services/storage.ts:1340`) | `storageService` seeds demo data into localStorage on first load |

## 6. Available resources

| Resource | Status |
|---|---|
| Full backend source | Accessible |
| Full frontend source | Accessible |
| SQLite schema (`database.js`) | Accessible |
| Live SQLite file (`data/database.sqlite`) | Accessible. Only **row counts** were inspected (read-only); no row contents were read or reproduced |
| Design mockups (`design/*.png`, `DESIGN.md`) | Accessible, not analysed in depth |
| Production / staging environment | **Not accessible.** None is defined in the repo |
| Deployment configuration, CI, secrets | **Not implemented** in the repo |
| Twilio / SMTP accounts | **Not accessible.** Code paths are documented from source only |
| Real funding-partner / bank integration | **Not implemented** (simulated in the browser) |
| Engineering team for confirmation | Not available during this review |

## 7. Database row counts at snapshot (read-only)

| Table | Rows |
|---|---|
| users | 23 |
| applications | 34 (33 `Received`, 1 `Under Review`) |
| notifications | 26 |
| uploaded_files | 47 |
| password_resets | 1 |
| app_config | 1 |

21 applications have a non-null `bankAccount` field and 4 users have `profileData`. No plaintext (non-bcrypt) passwords were found. Whether any of this is real personal data **could not be determined**. See SEC-14 in [security-and-privacy.md](security-and-privacy.md).

## 8. Initial coverage and limitations

- **Inspected in full:** `backend/server.js`, `database.js`, `creditEngine.js`, all backend services, `borrower-app/frontend/src/App.tsx`, `services/api.ts`, `services/storage.ts` (lifecycle, auth and export sections), `config/appConfig.ts` (limits and formula).
- **Inspected in targeted sections:** `Step2Auth.tsx` (auth flows), `Step6LoanDetails.tsx` (calculation and submit), `Step8DocumentUpload.tsx` (upload handler), `Step9ReviewConfirm.tsx` (consent and signature), `Step11StatusTimeline.tsx` (SSE and re-upload), `BackOffice.tsx` (data sync, actions, role gating), `Header.tsx` (back-office toggle), `pdfService.js`, backend test scripts (structure and failures).
- **Added during the documentation audit:** `HelpModal.tsx` (FAQ content), `MyApplications.tsx`, `translations.ts` key completeness (script), the production bundle (`borrower-app/frontend/dist`), and installed dependency versions.
- **Inspected only through grep or outline:** `translations.ts`, `types.ts`, the UI-only parts of the remaining components (`Step1`, `Step3`, `Step4`, `Step5`, `Step7`, `Step10`, `AnalyticsDashboard`, `MyApplications`, `Notification*`, `HelpModal`, `EligibilityScoreBar`, `WizardProgress`, `ReturningUserConfirmModal`).
- **Not inspected:** visual design fidelity against `design/*.png`; the `.py` maintenance scripts.

This documentation is therefore **not exhaustive** for presentational UI code. It is thorough for the security, data and workflow paths.
