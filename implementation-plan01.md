# Digital Loan App — Enhancement Implementation Plan

> **Status:** All Phases 1 through 8 have been fully implemented, integrated, and verified!

---

## Phase 1 — Security Hardening 🔐 [COMPLETED]
**Goal:** Make the app production-safe. Currently passwords are stored and compared in plaintext.

### Steps
| # | Task | Files Affected | Status |
|---|------|---------------|:------:|
| 1.1 | Install `bcryptjs` and `jsonwebtoken` in the backend | `backend/package.json` | ✅ Complete |
| 1.2 | Hash passwords on registration using `bcrypt.hash()` | `backend/server.js` → `/api/users/register` | ✅ Complete |
| 1.3 | Compare hashed passwords on login using `bcrypt.compare()` | `backend/server.js` → `/api/users/login` | ✅ Complete |
| 1.4 | Issue a signed JWT on successful login/OTP verify | `backend/server.js` | ✅ Complete |
| 1.5 | Add an `Authorization: Bearer <token>` middleware to protect all non-auth routes | `backend/server.js` | ✅ Complete |
| 1.6 | Store the JWT in `localStorage` on the frontend and attach it to all API calls | `frontend/src/services/api.ts` | ✅ Complete |
| 1.7 | Add a "Forgot Password" endpoint + simple reset flow (token via console/mock SMS) | `backend/server.js`, `Step2Auth` sub-screen | ✅ Complete |

---

## Phase 2 — Real File Storage 🗂️ [COMPLETED]
**Goal:** Replace base64 `dataUrl` blobs stored in SQLite with real files on disk.

### Steps
| # | Task | Files Affected | Status |
|---|------|---------------|:------:|
| 2.1 | Install `multer` in the backend | `backend/package.json` | ✅ Complete |
| 2.2 | Create `backend/uploads/` directory and add a `POST /api/upload` multipart endpoint | `backend/server.js` | ✅ Complete |
| 2.3 | Add a `GET /api/uploads/:filename` endpoint to serve files back | `backend/server.js` | ✅ Complete |
| 2.4 | Update the `documents` table column to store file path strings instead of base64 | `backend/database.js` | ✅ Complete |
| 2.5 | Update frontend `Step8DocumentUpload` to `POST` to `/api/upload` and save the returned URL | `frontend/src/components/Step8DocumentUpload.tsx` | ✅ Complete |
| 2.6 | Render document thumbnails in the back-office inspector using the file URL | `frontend/src/components/BackOffice.tsx` | ✅ Complete |

---

## Phase 3 — Analytics Dashboard 📊 [COMPLETED]
**Goal:** Give back-office users a real-time KPI overview instead of a raw table only.

### Steps
| # | Task | Files Affected | Status |
|---|------|---------------|:------:|
| 3.1 | Add a `GET /api/analytics/summary` backend endpoint that aggregates applications by status, loan amount, and date | `backend/server.js` | ✅ Complete |
| 3.2 | Install `recharts` in the frontend | `frontend/package.json` | ✅ Complete |
| 3.3 | Create a new `AnalyticsDashboard.tsx` component with: KPI cards, Bar chart, Line chart, and Pie chart | `frontend/src/components/AnalyticsDashboard.tsx` | ✅ Complete |
| 3.4 | Add an **"Analytics"** tab to the back-office navigation (visible to `credit_reviewer` and `system_admin`) | `frontend/src/components/BackOffice.tsx` | ✅ Complete |

---

## Phase 4 — Real-Time Status Updates (SSE) 🔄 [COMPLETED]
**Goal:** Push status changes to the borrower's Step 11 timeline without manual refresh.

### Steps
| # | Task | Files Affected | Status |
|---|------|---------------|:------:|
| 4.1 | Add a `GET /api/applications/:id/events` Server-Sent Events (SSE) endpoint in the backend | `backend/server.js` | ✅ Complete |
| 4.2 | Create a broadcast helper: when `PUT /api/applications/:id` changes status, emit an SSE event to all subscribers for that app | `backend/server.js` | ✅ Complete |
| 4.3 | In `Step11StatusTimeline`, open an `EventSource` connection on mount and refresh the application when an event arrives | `frontend/src/components/Step11StatusTimeline.tsx` | ✅ Complete |
| 4.4 | Show a live "Listening for updates…" indicator with a pulsing dot | `frontend/src/components/Step11StatusTimeline.tsx` | ✅ Complete |

---

## Phase 5 — Notification System (SMS Simulation) 📲 [COMPLETED]
**Goal:** Activate the already-defined `NotificationItem` type and send borrowers SMS-style alerts when their loan status changes.

### Steps
| # | Task | Files Affected | Status |
|---|------|---------------|:------:|
| 5.1 | Create a `notifications` table in SQLite | `backend/database.js` | ✅ Complete |
| 5.2 | Add `POST /api/notifications` and `GET /api/notifications/:userId` endpoints | `backend/server.js` | ✅ Complete |
| 5.3 | Trigger a notification record whenever application status changes (status-change hook in `PUT /api/applications/:id`) | `backend/server.js` | ✅ Complete |
| 5.4 | Create a `NotificationBell` component in the header showing unread count badge | `frontend/src/components/NotificationBell.tsx` | ✅ Complete |
| 5.5 | Create a `NotificationDrawer` component listing all notifications with read/unread state | `frontend/src/components/NotificationDrawer.tsx` | ✅ Complete |
| 5.6 | Add SMS delivery service + fallback mock logging | `backend/services/smsService.js`, `backend/server.js` | ✅ Complete |

---

## Phase 6 — Application History & Multiple Applications 📁 [COMPLETED]
**Goal:** Allow a borrower to view all their past applications, not just the active one.

### Steps
| # | Task | Files Affected | Status |
|---|------|---------------|:------:|
| 6.1 | Add `GET /api/applications/history/:userId` endpoint returning all submitted applications for a user | `backend/server.js` | ✅ Complete |
| 6.2 | Create a `MyApplications.tsx` component showing a timeline/list of all past applications with status chips | `frontend/src/components/MyApplications.tsx` | ✅ Complete |
| 6.3 | Add a **"My Applications"** button in the header (visible when logged in) | `frontend/src/components/Header.tsx`, `frontend/src/App.tsx` | ✅ Complete |
| 6.4 | Clicking a past application opens a read-only detail view (reuse Step 11 component in read-only mode) | `frontend/src/App.tsx`, `frontend/src/components/MyApplications.tsx` | ✅ Complete |

---

## Phase 7 — PDF Export 📄 [COMPLETED]
**Goal:** Let borrowers and officers download a clean formatted PDF of any submitted application.

### Steps
| # | Task | Files Affected | Status |
|---|------|---------------|:------:|
| 7.1 | Install `pdfkit` in the backend | `backend/package.json` | ✅ Complete |
| 7.2 | Add `GET /api/applications/:id/pdf` endpoint that generates and streams a formatted PDF | `backend/services/pdfService.js`, `backend/server.js` | ✅ Complete |
| 7.3 | Add a **"Download PDF"** button to Step 10 (submission success) and Step 11 (status timeline) for borrowers | `Step10SubmissionSuccess.tsx`, `Step11StatusTimeline.tsx` | ✅ Complete |
| 7.4 | Add a **"Download PDF"** button to the back-office application inspector modal (alongside existing JSON download) | `frontend/src/components/BackOffice.tsx` | ✅ Complete |

---

## Phase 8 — Auto Credit Pre-Screening 🤖 [COMPLETED]
**Goal:** Automatically flag applications with a risk score before they reach the credit reviewer queue.

### Steps
| # | Task | Files Affected | Status |
|---|------|---------------|:------:|
| 8.1 | Create a `backend/creditEngine.js` module with configurable rule checks (salary ratio, visa buffer, tenure, guarantor bonus) | `backend/creditEngine.js` | ✅ Complete |
| 8.2 | Run the engine on every `PUT /api/applications/:id` where `isSubmitted = true` and store a `riskScore` + `riskFlags[]` | `backend/server.js`, `backend/database.js` | ✅ Complete |
| 8.3 | Display the risk score badge (`Low / Medium / High`) in the back-office applications table and inspector | `frontend/src/components/BackOffice.tsx` | ✅ Complete |
| 8.4 | Allow `system_admin` to edit the rule thresholds via the Credit Policy config tab with automated rescoring | `frontend/src/components/BackOffice.tsx`, `backend/server.js` | ✅ Complete |

---

## Hebrew / English localization [COMPLETED, native review pending]
The app, back office, backend messages (SMS, notifications, OTP, password reset) and the PDF summary are available in English and Hebrew, with right-to-left layout and Israeli formatting. Thai, Chinese and Filipino are on hold. Details, decisions and QA results: `hebrew-localization-plan.md`. The Hebrew text still needs sign-off from a native speaker (`docs/hebrew-review.csv`).

---

## Summary & Verification Status

All 8 phases have passed automated backend verification (`scratch/smoke.js` with 31/31 assertions passed) and frontend type-checking (`tsc --noEmit`) and production bundling (`vite build` succeeded).
