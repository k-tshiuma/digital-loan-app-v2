# System Architecture

Status labels: see [README.md](README.md#verification-status-legend). Every diagram below reflects **Verified** source unless a node is marked *(inferred)* or *(simulated)*.

## 1. Summary

QuickLoan is a **two-tier web application**:

1. A **React SPA** (`borrower-app/frontend/`) that runs entirely in the browser. It holds **two data layers**:
   - `apiService` (`src/services/api.ts`): a thin `fetch` client for the Express API.
   - `storageService` (`src/services/storage.ts`): a full **local "shadow backend"** in `localStorage`. It holds users (including passwords), applications, audit events, notifications, config, seeded demo data, local OTP generation and verification, a simulated funding hand-off, and exports.
2. An **Express 5 API** (`backend/server.js`) backed by **SQLite** (`data/database.sqlite`), with local disk file storage (`data/uploads/`) and optional Twilio and SMTP.

The most important architectural fact is that **the client is offline-first and optimistic, and in several flows it is authoritative.** The UI writes to `localStorage` first and syncs to the API in the background, usually swallowing errors. When the API rejects a request, several flows fall back to the local store. For a lending system this blurs the "system of record" (see [financial-integrity-risks.md](financial-integrity-risks.md)).

## 2. High-level system architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (mobile-first SPA)"]
    UI["React components<br/>App.tsx wizard + BackOffice"]
    API["apiService<br/>services/api.ts"]
    LS["storageService<br/>services/storage.ts"]
    LSTORE[("localStorage<br/>quickloan_* keys<br/>JWTs, users+passwords,<br/>apps, audit, config")]
    UI --> API
    UI --> LS
    LS --> LSTORE
    API -->|"JWT read/write"| LSTORE
  end

  subgraph Server["Node.js / Express 5 — backend/server.js"]
    MW["optionalAuth → public routes →<br/>authenticate → protected routes"]
    CE["creditEngine.js"]
    ES["services/eligibilityScoring.js"]
    PDF["services/pdfService.js"]
    SSE["In-memory SSE client map"]
    OTP["In-memory OTP Map"]
  end

  DB[("SQLite<br/>data/database.sqlite")]
  FS[("Local disk<br/>data/uploads/")]
  TW["Twilio SMS<br/>(only if TWILIO_SID/TOKEN)"]
  SMTP["SMTP email<br/>(only if SMTP_USER)"]
  FUND["Funding partner<br/>(simulated in browser only)"]

  API -->|"HTTPS? (not configured)<br/>REST JSON + multipart"| MW
  API -. "EventSource ?token=" .-> SSE
  MW --> DB
  MW --> FS
  MW --> CE
  MW --> ES
  MW --> PDF
  MW --> OTP
  MW --> TW
  MW --> SMTP
  LS -. "simulateFundingHandoff()<br/>no network call" .-> FUND
```

Notes:
- TLS is **not configured** anywhere in the repo. The UI footer text "Encrypted via TLS 1.3" (`App.tsx:458`) is not backed by any configuration (Unverified claim).
- The funding partner is **not integrated**. `storageService.simulateFundingHandoff` (`storage.ts:1233`) fabricates a success record locally.

## 3. Backend request pipeline

```mermaid
flowchart TD
  R["Incoming request"] --> C["cors() — all origins"]
  C --> J["express.json limit 5mb"]
  J --> O["optionalAuth (global)<br/>DEMO_MODE: no token ⇒ demo_user;<br/>bad signature ⇒ jwt.decode()"]
  O --> P{"Route declared<br/>before line 619?"}
  P -->|yes| PUB["Public routes:<br/>health, users/lookup, login, request-otp,<br/>verify-otp, register*, google-demo,<br/>forgot/reset-password, auth/staff-token"]
  P -->|no| A["app.use('/api', authenticate)<br/>DEMO_MODE: never rejects"]
  A --> RS{"requireStaff(...roles)?"}
  RS -->|"staff routes"| ST["applications list, notifications POST,<br/>send-sms, analytics, credit-rules"]
  RS -->|"owner routes"| OW["canAccessUser(req, userId)<br/>staff OR sub===userId OR demo rule"]
  ST --> H["Handler → SQLite / disk / services"]
  OW --> H
  H --> E["404 JSON for unknown /api<br/>error handler (multer → 400, else 500)"]
```

`*` `/api/users/register` is declared in the public section but attaches `authenticate` inline (`server.js:490`).

Key symbols: `optionalAuth` (`server.js:126`), `authenticate` (`server.js:99`), `requireStaff` (`server.js:147`), `canAccessUser` (`server.js:157`), `DEMO_MODE` (`server.js:25`).

## 4. Frontend component relationships

```mermaid
flowchart TD
  main["main.tsx"] --> App["App.tsx<br/>state: currentStep, currentUser,<br/>application, isBackOfficeOpen, currentRole"]
  App --> Header["Header<br/>language, sign-out,<br/>back-office toggle (always visible)"]
  App -->|"isBackOfficeOpen"| BO["BackOffice"]
  BO --> AD["AnalyticsDashboard"]
  App -->|"else"| Wiz["Wizard card"]
  Wiz --> S1["Step1Language"]
  Wiz --> S2["Step2Auth"]
  Wiz --> S3["Step3BorrowerDetails"]
  Wiz --> S4["Step4ResidencyDetails"]
  Wiz --> S5["Step5EmploymentDetails"]
  Wiz --> S6["Step6LoanDetails"]
  Wiz --> S7["Step7Guarantor"]
  Wiz --> S8["Step8DocumentUpload"]
  Wiz --> S9["Step9ReviewConfirm"]
  Wiz --> S10["Step10SubmissionSuccess"]
  Wiz --> S11["Step11StatusTimeline"]
  Wiz --> WP["WizardProgress (steps 3–9)"]
  App --> HM["HelpModal"]
  App --> ND["NotificationDrawer"]
  App --> MA["MyApplications"]
  App --> RU["ReturningUserConfirmModal"]
  S7 & S8 & S9 & S10 & S11 & BO --> ESB["EligibilityScoreBar"]

  subgraph Services
    api["apiService"]
    st["storageService"]
    el["eligibilityScoring.ts"]
    cfg["config/appConfig.ts"]
    i18n["i18n/translations.ts"]
  end
  App --> api & st
  S2 --> api & st
  BO --> api & st
  S11 --> api & st
  st --> el
  S6 --> cfg
```

There is no router. Navigation is the integer `currentStep` in `App.tsx:42`. There is no global state library: state lives in `App` and is passed down as props, and `storageService` is a module singleton. See [mobile-application.md](mobile-application.md).

## 5. Startup and authentication flow

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant App as App.tsx
  participant St as storageService
  participant Api as apiService
  participant S as Express API

  B->>App: load
  App->>St: new StorageService() — seeds localStorage if empty
  App->>St: getCurrentUser() (quickloan_current_user_id)
  alt no local user
    App-->>B: currentStep = 2 (Step2Auth)
    B->>Api: lookupPhone(phone)
    Api->>S: POST /api/users/lookup
    alt has password
      B->>Api: loginWithPassword
      Api->>S: POST /api/users/login → {user, token}
    else OTP
      Api->>S: POST /api/users/request-otp → {expiresInSeconds, demoCode?}
      B->>Api: verifyOTP(code)
      Api->>S: POST /api/users/verify-otp → {user, token}
    end
    Api->>B: localStorage quickloan_auth_token = JWT (7d)
    Note over App,St: Step2Auth ALSO mirrors the login into storageService.<br/>If the API call fails for ANY reason, OTP verification<br/>falls back to storageService.verifyOTP (accepts any 6 digits).
  end
  App->>St: getOrCreateActiveApplication(user) — local draft
  App->>Api: getActiveApplication(user.id)
  Api->>S: GET /api/applications/active/:userId
  S-->>Api: server draft (prefilled for returning users)
  Api-->>App: replace local draft with server draft
  App-->>B: step 3 / 6 (returning) / 11 (submitted)
```

## 6. Frontend-to-backend communication

| Concern | Implementation | Evidence |
|---|---|---|
| Transport | `fetch` to `${VITE_API_URL || 'http://localhost:5000/api'}` | `api.ts:11-12, 90` |
| Auth header | `Authorization: Bearer <jwt>`. Borrower and staff tokens are kept under separate keys | `api.ts:15-16, 85-88` |
| Token where headers are impossible | `?token=` query string for `EventSource` and `<img>`/`<a>` file URLs | `api.ts:206-219`, `server.js:94-95` |
| Error model | `{ success:false, error }` → `ApiError(message, status)`. A rejection that is not an `ApiError` counts as a network error | `api.ts:21-30, 96-98` |
| Timeouts / retries | **None** on fetch. SSE uses `retry: 5000` sent by the server | `server.js:1094` |
| Serialization | Whole `LoanApplication` objects are PUT as JSON. The server stores nested objects as TEXT JSON | `server.js:231-284` |
| Real-time | SSE `status` / `updated` events trigger a re-fetch | `Step11StatusTimeline.tsx:53-104` |

## 7. Core business workflow (borrower)

```mermaid
flowchart LR
  L["1 Language"] --> A["2 Auth"]
  A --> P["3 Borrower"] --> R["4 Residency/Visa"] --> E["5 Employment"] --> LN["6 Loan + Bank"]
  A -. "returning user<br/>(prefilled)" .-> LN
  LN --> G["7 Guarantors"] --> D["8 Documents"] --> RV["9 Review, consent,<br/>signature"]
  RV -->|"storageService.submitApplication<br/>(local, immediate)"| OK["10 Success +<br/>request number"]
  RV -. "apiService.saveApplication<br/>(background, errors only logged)" .-> SRV[("Server: status Received,<br/>risk score, SMS")]
  OK --> T["11 Status timeline<br/>(SSE)"]
```

Every step's "Save & Next" calls `autoSaveDraft` (`App.tsx:108-117`). It writes to `localStorage` and then fires `PUT /api/applications/:id` with `.catch(() => {})`.

## 8. Data persistence and external integrations

```mermaid
flowchart LR
  subgraph Client
    K1["quickloan_auth_token / quickloan_staff_token_v1"]
    K2["quickloan_users_v1 (incl. plaintext passwords)"]
    K3["quickloan_applications_v1 (full apps, PII, bank, dataUrls)"]
    K4["quickloan_audit_events_v1 / notifications_v1 / config_v1"]
    K5["quickloan_draft_backup_v1 / active_app_id / current_user_id"]
  end
  subgraph Server
    T1[("users")]
    T2[("applications")]
    T3[("notifications")]
    T4[("uploaded_files")]
    T5[("password_resets")]
    T6[("app_config")]
    M1["Memory: otpStore, sseClients"]
    F1[("uploads/ files")]
  end
  Client -->|"PUT /applications/:id"| T2
  T2 -->|"profileData copy"| T1
  Client -->|"POST /upload"| F1 --> T4
  T2 -->|"status change"| T3 -->|"sendSms"| Twilio["Twilio (optional)"]
  T5 -->|"sendEmail"| SMTP["SMTP (optional)"]
```

Details: [database.md](database.md), [data-models.md](data-models.md), [integrations.md](integrations.md).

## 9. Architectural characteristics and constraints

| Characteristic | Assessment |
|---|---|
| Deployment topology | Single Node process with in-process state (OTP map, SSE clients). **It cannot be horizontally scaled** without moving that state out (Verified, `server.js:160, 312`) |
| Persistence | Single SQLite file, no transactions, no WAL configuration, no backups defined |
| System of record | Ambiguous. The server is the intended record (the code comments say "authoritative"), but the client decides submission success, generates the first request number, keeps its own audit log and runs the funding hand-off |
| Coupling | `server.js` is one 1300-line module containing routes, auth, persistence helpers and notification logic |
| Dual implementations | Eligibility scoring (backend JS and frontend TS, kept in sync by hand), document-reuse rules (`server.js:737` and `storage.ts:802`), OTP and auth (server and `storageService`) |
| Security boundary | Server-side checks exist (ownership, staff role on some routes, server-computed scores), but `DEMO_MODE`, which fails open, defeats most of them. See [security-and-privacy.md](security-and-privacy.md) |
