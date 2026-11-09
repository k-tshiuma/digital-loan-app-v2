# Developer Handover Guide

Read this first if you have never seen the project. It is specific to this codebase. Deeper detail is linked from each section.

## 1. What the application does
QuickLoan / LendGlobal lets foreign workers in Israel apply for small loans (₪500–₪10,000, 3–12 months) in five languages. Borrowers sign in by SMS code, fill an 11-step wizard and track their status live. Staff review applications in a back office. **No money moves through this system.** It handles applications and decisions only. See [project-inventory.md](project-inventory.md).

## 2. Repository organisation
Two independent npm projects: `backend/` (Express 5 + SQLite, CommonJS) and `borrower-app/frontend/` (React 19 + Vite + Tailwind, TypeScript). There is no shared package. Layout: [project-inventory.md §4](project-inventory.md#4-repository-structure).

## 3. Files that initialise the application
- Backend: `backend/server.js`. Read it top to bottom: helpers (1-160) → application helpers (165-307) → SSE and notifications (309-380) → **public routes** (382-614) → `app.use('/api', authenticate)` (619) → protected routes (621-1286) → error handlers → `listen`. `shared/backend/database.js` runs the schema on `require`.
- Frontend: `src/main.tsx` → `src/App.tsx`. `src/services/storage.ts` seeds localStorage the moment it is imported.

## 4. How navigation works
There is no router. `App.tsx` holds `currentStep` (1–11) and renders one `StepN*` component at a time. Each step receives `initialData` and calls `onSaveAndNext(data)`. `App` merges the data into `application`, calls `autoSaveDraft(updated, nextStep)` and then `setCurrentStep(nextStep)`. The back office replaces the wizard when `isBackOfficeOpen` is true. See [mobile-application.md §2](mobile-application.md#2-navigation).

## 5. Which data layer?
The most confusing aspect of the codebase is that **two data layers exist side by side**:

| Need | Use today | Should be |
|---|---|---|
| Sign in / register | `apiService` **and** `storageService` mirror (with fallback) | `apiService` only |
| Draft save | `storageService.saveApplication`, then background `apiService.saveApplication` | Server first, with a visible sync state |
| Submit | `storageService.submitApplication`, then background PUT | Server transaction (FIN-01) |
| Status change (staff) | `storageService.updateApplicationStatus`, then PUT | Server endpoint (SEC-03) |
| Notifications | API with local fallback, plus locally generated ones | API |
| Audit log, config, CSV export, funding hand-off | `storageService` only | Server |
| Analytics, credit rules, PDF, uploads, SSE | `apiService` | ✓ |

**Rule for new code:** server-backed features go in `apiService` and a backend route. Do not extend `storageService` except for genuinely local UI conveniences.

## 6. How API requests are made
`apiService` (`src/services/api.ts`) wraps `fetch`. `request(path, {method, body, formData, scope, auth})` attaches `Authorization: Bearer` from localStorage (`scope: 'borrower' | 'staff'`). An error envelope becomes `ApiError(message, status)`. Network failures are plain errors (`isNetworkError`). There are no timeouts or retries. See [api-reference.md](api-reference.md) and [openapi.yaml](openapi.yaml).

## 7. Where models and business logic live
- Types: `shared/frontend/types.ts`. The server has no types and stores JSON blobs ([data-models.md](data-models.md)).
- Limits, fees and the repayment formula: `shared/frontend/config/appConfig.ts`, **client only**.
- Eligibility score: `shared/backend/services/eligibilityScoring.js`, mirrored by hand in `shared/frontend/services/eligibilityScoring.ts`.
- Risk pre-screen: `shared/backend/creditEngine.js`.
- Application rules (immutability, status, request numbers, prefill, document reuse): `backend/server.js` around the `PUT` and `/active` routes.

## 8. How authentication works
OTP or password produces a JWT (borrower 7 days, staff 12 hours, demo only), stored in localStorage. The server middleware is `optionalAuth` (global) → `authenticate` (everything after line 619) → `requireStaff(...)` / `canAccessUser(...)`. **DEMO_MODE changes all of this** and is on by default. Read [modules/authentication.md](modules/authentication.md) and SEC-01 before touching auth.

## 9. How the application workflows are organised
Draft → submit → (risk and eligibility scoring) → staff decision → (simulated) funding hand-off. See [financial-workflows.md](financial-workflows.md) and [transaction-state-models.md](transaction-state-models.md).

## 10. Adding things
See [adding-features.md](adding-features.md) for worked examples: a screen, an API endpoint, a DB column, a translation string, a scoring factor, a test.

## 11. Investigating errors
See [troubleshooting.md](troubleshooting.md). Start with: the browser console (many failures are only `console.warn`), the Network tab (look for failed background PUTs), and backend stdout (`[SERVER ERROR]`, `[NOTIFY]`, `[SMS ERROR]`).

## 12. Building and releasing
See [build-and-release.md](build-and-release.md). No pipeline exists yet.

## 13. Risky changes (handle with care)

| Change | Why it is risky |
|---|---|
| Anything touching `DEMO_MODE`, `authenticate`, `optionalAuth`, `canAccessUser` | Global access control. Easy to open everything up or lock out the tests (which rely on demo mode) |
| Route ordering around `server.js:619` | Routes declared above it are public |
| `writeApp` column list | Fields not in the list are silently dropped on save |
| `parseApp` / `writeApp` guarantor sync | Three copies of the sync logic (server ×2, client) |
| Eligibility factors | Must change JS and TS together, and update the tests |
| `PUT /applications/:id` borrower branch | Immutability after submission is the main integrity control |
| `database.js` ALTER list | Only additive changes are safe. Never edit an existing statement |
| Removing the `storageService` fallbacks | Correct direction, but many components rely on them, including offline behaviour |
| Running backend tests | They mutate the committed DB |

## 14. External systems and teams
Development needs none (SMS and email are mocked). Production would need Twilio, SMTP, a host with a persistent disk, a TLS proxy, an identity provider for staff, and legal/compliance input on disclosures and consent. The funding-partner integration does not exist. Whoever owns the "Bank Leumi" relationship would need to be involved.

## 15. Known state at handover (2026-10-11)
- Frontend type-check fails, and Steps 7 and 8 likely crash at runtime (DEF-01).
- 3 backend tests fail because of a fixture date (DEF-06).
- Critical security items: SEC-01, SEC-02. Full list: [technical-debt.md](technical-debt.md).
