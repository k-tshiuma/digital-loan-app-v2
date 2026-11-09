# Technical Debt and Findings Register

The master list of findings. Detailed write-ups: SEC-* in [security-and-privacy.md](security-and-privacy.md), FIN-* in [financial-integrity-risks.md](financial-integrity-risks.md). DEF-* (defects) and MNT-* (maintainability) are described here.

Status: **Verified** (confirmed in code or by execution) · **Suspected** (plausible, not exercised) · **Unverified** (depends on things that cannot be seen).
Priority: **P0** fix before any real data or exposed deployment · **P1** next · **P2** planned · **P3** opportunistic.

## A. Security and financial-integrity items (immediate concern)

| ID | Sev. | Status | Summary | Location | Module | Priority |
|---|---|---|---|---|---|---|
| SEC-01 | Critical | Verified | DEMO_MODE is on unless disabled and bypasses auth (any OTP, unverified JWTs, staff tokens) | `server.js:25,101-138,461,609` | Auth | P0 |
| SEC-02 | Critical | Verified | PDF route persists the client body before authorization | `server.js:1111-1129` | PDF | P0 |
| SEC-14 | High | Verified/Unverified | `database.sqlite` with 23 users and bank data committed to git | `data/database.sqlite` | Data | P0 |
| SEC-05 | High | Verified | Client authenticates locally on API rejection | `Step2Auth.tsx:401-411`, `storage.ts:690` | Auth | P0 |
| SEC-06 | High | Verified | Plaintext passwords and PII in localStorage | `storage.ts:519-590` | Client data | P0 |
| SEC-03 | High | Verified | Any staff role can set any status. Client-supplied history | `server.js:975-977` | Back office | P1 |
| SEC-04 | High | Verified | No production staff authentication | `server.js:609-614` | Back office | P1 |
| SEC-08 | High | Verified | No rate limiting (SMS pumping, brute force) | all routes | Auth | P1 |
| FIN-01 | High | Verified | Submission success shown without server confirmation | `App.tsx:249-265` | Wizard | P0 |
| FIN-17 | High | Verified | Borrower can change `bankAccount`, `bankAccountConfirmed` and `documents` after submission or approval, silently | `server.js:983-984` | Wizard | P0 |
| FIN-02 | Medium | Verified/Suspected | Request numbers generated on the client. The server may replace them, but Step 10 keeps the local number (when `/active` fails, or on a clash) | `storage.ts`, `server.js:1026-1032`, `App.tsx:262` | Wizard | P1 |
| FIN-04 | High | Verified | No server-side validation of amount, period, age, visa, documents, consent | `server.js:960-1079` | Wizard | P1 |
| FIN-07 | High | Verified | Funding hand-off and "signed" export are simulated but presented as real | `storage.ts:1233-1279`, `BackOffice.tsx:165` | Back office | P1 |
| SEC-07 | Medium | Verified | Sign-out keeps the JWT. 7-day lifetime, no revocation | `App.tsx:283-289` | Auth | P0 (trivial fix) |
| SEC-09 | Medium | Verified | Account enumeration | `server.js:389-423` | Auth | P2 |
| SEC-10 | Medium | Suspected | Upload extension and Content-Type from client input. Legacy files open to all users | `server.js:629-728` | Documents | P1 |
| SEC-11 | Medium | Verified | JWT in query strings | `api.ts:206-219` | Auth | P2 |
| SEC-12 | Medium | Verified | Open CORS, no security headers, unverifiable TLS claim | `server.js:44`, `App.tsx:458` | Platform | P1 |
| SEC-13 | Medium | Verified | Hard-coded dev JWT secret | `server.js:32` | Auth | P0 |
| SEC-16 | Medium | Verified | PII unencrypted at rest. No deletion or retention | DB, uploads | Data | P2 |
| SEC-19 | Medium | Verified | Consent and signature evidence fabricated on the client | `Step9ReviewConfirm.tsx:136-165` | Wizard | P2 |
| SEC-21 | Medium | Verified | Borrower-facing FAQ, footer and "Immutable Audit Logs" label make security claims the code contradicts. The FAQ document list is wrong | `HelpModal.tsx:15+`, `App.tsx:458` | UI / legal | P0 (text change) |
| FIN-03 | Medium | Verified | Quote ignores grace period and processing fee, "APR" mislabel, client-only | `appConfig.ts:200-241` | Wizard | P1 |
| FIN-05 | Medium | Suspected | Request-number race, no UNIQUE index | `server.js:286-291` | Data | P1 |
| FIN-06 | Medium | Verified/Suspected | Full-document overwrite causes lost updates | `server.js:279-283` | Data | P1 |
| FIN-08 | Medium | Verified | No server audit log | `storage.ts:1169` | All | P1 |
| FIN-09 | Medium | Verified | Simulated quality and OCR. Score uses client-asserted verification fields | `Step8DocumentUpload.tsx:148-171` | Documents | P2 |
| FIN-10 | Medium | Verified | Resubmission without a new document | `server.js:988-1002`, `Step11StatusTimeline.tsx:113-150` | Status | P2 |
| FIN-11 | Medium | Verified | Upload failure falls back to inline base64 or a missing file | `Step8DocumentUpload.tsx:113-140` | Documents | P1 |
| FIN-12 | Medium | Verified | Duplicate open applications not prevented on the server | `storage.ts:778` | Wizard | P2 |
| FIN-16 | Medium | Verified | Offline analytics shows placeholder KPIs (85%, ₪7,500, 2.4 days) | `AnalyticsDashboard.tsx:114-119` | Analytics | P2 |
| SEC-15 | Low | Verified | Plaintext OTP stored and logged | `server.js:435,456`, `smsService.js:7` | Auth | P2 |
| SEC-17 | Low | Verified | `CREDIT_CARD` document type (PCI scope) | `types.ts:49` | Documents | P3 |
| SEC-18 | Low | Verified | `err.message` returned outside production | `server.js:1300` | Platform | P3 |
| SEC-20 | Low | Verified | PII and codes in mock logs | `smsService.js:7` | Notifications | P2 |
| FIN-13 | Low | Verified | Non-atomic rescoring, no rules version | `server.js:1279-1284` | Credit | P3 |
| FIN-14 | Low | Suspected | Client and server drafts can diverge | `App.tsx:71-105` | Wizard | P3 |
| FIN-15 | Low | Verified | No decimal or currency policy | — | Data | P3 |

## B. Defects

| ID | Sev. | Status | Description | Evidence | Impact | Action | Priority |
|---|---|---|---|---|---|---|---|
| DEF-01 | High | Verified (source + built bundle) | `useEffect` used but not imported in `Step7Guarantor.tsx` (`:85`) and `Step8DocumentUpload.tsx` (`:50, :56`) | `tsc --noEmit` errors. Imports at line 1 of each file. The production bundle contains exactly 3 unbound `useEffect(` references, i.e. it was not renamed as an import would be | `ReferenceError` when Steps 7 and 8 render, which blocks the wizard (not yet observed in a browser) | Add the import. Add `tsc` to CI | P0 |
| DEF-02 | Low | Verified | `GuarantorItem` not imported in `App.tsx:216` | tsc | Type-only (no runtime effect) | Import it | P1 |
| DEF-03 | Medium | Verified | PDF signature method mismatch (`'draw'/'type'` vs `'drawn_touch'/'typed_name'`). The image is in `signatureDataUri` | `pdfService.js:146-166`, `Step9ReviewConfirm.tsx:139-141` | Every PDF shows "Typed Signature / Signed by —". Drawn signatures never render | Map the methods correctly | P1 |
| DEF-04 | Medium | Suspected | Back-office status change throws for applications not in local storage | `BackOffice.tsx:132-146`, `storage.ts:1114-1115` | Staff cannot change status from a fresh browser | Operate on server data | P1 |
| DEF-05 | Low | Verified | `uploadFile(file, missingDocType)` passes the document type as `scope` | `Step11StatusTimeline.tsx:115` | Harmless today (falls through to borrower scope), misleading | Remove the argument | P3 |
| DEF-06 | Low | Verified (executed) | Test date time-bomb: fixture visa `2027-10-08` | `test_guarantors_and_scoring.js:582,624,667` | 3 tests fail since about 2026-10 | Use relative dates | P1 |
| DEF-07 | Low | Verified | Funding hand-off and all actions ignore the current status (e.g. Forward a `Received` or `Rejected` application) | `BackOffice.tsx:1028-1080` | Invalid state changes | Server transition table (SEC-03) | P1 |
| DEF-08 | Low | Verified | `LoanPurpose` casing mismatch (`'Cash flow'` type vs `'Cash Flow'` option) | `types.ts:22`, `appConfig.ts:42` | Analytics split by spelling | Normalise | P3 |
| DEF-09 | Low | Verified | `users.isActive` never checked | `server.js` (no reads) | Cannot disable accounts | Check at login and in `authenticate` | P2 |
| DEF-10 | Low | Inferred | PDF uses Helvetica only, so non-Latin text will not render | `pdfService.js` | Hebrew, Thai and Chinese names garbled | Register a Unicode font | P2 |
| DEF-11 | Low | Verified | Server SMS always English although `language` is stored | `server.js:346-371` | Borrowers may not understand the messages | Localise the templates | P2 |

## C. Maintainability

| ID | Sev. | Status | Description | Evidence | Action | Priority |
|---|---|---|---|---|---|---|
| MNT-01 | Medium | Verified | Dual data layer (`storageService` shadow backend) duplicates auth, application lifecycle, document reuse, notifications | `storage.ts` (1340 lines) | Reduce it to a draft cache, with the server as the single source of truth | P1 |
| MNT-02 | Medium | Verified | `server.js` is a 1309-line monolith | — | Split into routes, middleware, repositories and services | P2 |
| MNT-03 | Medium | Verified | Hand-mirrored eligibility engine (JS and TS) | both `eligibilityScoring.*` | Shared golden-test fixture, or a shared package, or server-only scoring with an API | P2 |
| MNT-04 | Medium | Verified | No migration tool. Additive ALTERs only | `database.js` | Adopt a migration runner with a version table | P2 |
| MNT-05 | Medium | Verified | No CI, linting or test framework | repo | See [improvement-roadmap.md](improvement-roadmap.md) | P1 |
| MNT-06 | Low | Verified | Documentation drift: README is the AI Studio template; `implementation-plan.md` claims tsc passes; CLAUDE.md lists 4 languages (5 exist); names differ (QuickLoan / LendGlobal / "react-example") | — | Update the docs and names | P2 |
| MNT-07 | Low | Verified | Unused dependencies: `@google/genai`, `express` (frontend). `.env.example` lists unused `GEMINI_API_KEY`/`APP_URL`, but not `VITE_API_URL` | `borrower-app/frontend/package.json` | Remove them. Fix `.env.example` | P3 |
| MNT-08 | Low | Verified | Stale `bun.lock` alongside `package-lock.json` | `borrower-app/frontend/` | Delete `bun.lock` | P3 |
| MNT-09 | Low | Verified | Hard-coded English strings in components | `Step2Auth.tsx:155`, `Step7Guarantor.tsx:288-294`, `Step8DocumentUpload.tsx:93-104` | Move them to `translations.ts` | P2 |
| MNT-10 | Low | Verified | Large components (`Step2Auth` 1608 lines, `BackOffice` 1099) | — | Extract subcomponents and hooks | P3 |
| MNT-11 | Low | Verified | Single JS bundle > 500 kB, including staff UI and seed data | vite build output | Code-split the back office. Strip seeds from production builds | P3 |
| MNT-12 | Low | Verified | No indexes on frequently queried columns | `database.js` | Add indexes (`userId`, `isSubmitted`, `requestNumber` UNIQUE) | P2 |
| MNT-14 | Low | Verified (script parse) | 28 translation keys present in `en` are missing from each of `he`, `th`, `zh` and `tl` (silent English fallback), e.g. `pleaseSpecify`, `docPassportTitle` | `i18n/translations.ts` | Add the keys. Add a completeness check | P2 |
| MNT-15 | Low | Verified | `minBorrowerAge` and `minVisaValidityMonths` in config are ignored by the UI (literals `21` and `6`) | `Step3BorrowerDetails.tsx:99-101`, `Step4ResidencyDetails.tsx:62,73` | Read from config (and from the server once FIN-04 is done) | P2 |
| MNT-13 | Low | Verified | Guarantor single/array sync logic repeated 3 times | `server.js:186-210, 232-254`, `storage.ts` | Drop the legacy `guarantor` after migrating the data | P3 |
