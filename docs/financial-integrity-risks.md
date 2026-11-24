# Financial and Application-Integrity Risks

> Scope note: QuickLoan does **not** move money. There are no wallets, balances, ledgers, disbursements, repayments, payment gateways or currency conversion (all **Not Implemented**, verified by source review). The "financial" integrity risks here concern **the correctness, authenticity and auditability of loan applications, credit decisions, quoted repayment terms and borrower identity data**. These are the records a lender would rely on to decide on and disburse a loan.

Related: [financial-workflows.md](financial-workflows.md) · [transaction-state-models.md](transaction-state-models.md) · [security-and-privacy.md](security-and-privacy.md)

## Control inventory (do these controls exist?)

| Control | Present? | Evidence |
|---|---|---|
| Idempotency keys | **No** | No idempotency header or key anywhere |
| Duplicate submission protection | Partial. Client: `submitApplication` returns early if already submitted (`storage.ts:1052-1054`). Server: a re-PUT of a submitted app keeps the existing fields (`server.js:981-985`) | |
| Duplicate open application rule | **Client-only**, against localStorage (`storage.ts:778-799`) | Server has no check |
| Optimistic concurrency / versioning | **No** | PUT is a full-document upsert (`server.js:279-283`) |
| Atomic DB operations / transactions | **No** | No `BEGIN`/`COMMIT`. Each statement is separate |
| Unique constraint on request number | **No** | Only `id` is a primary key (`database.js:33-58`) |
| Server-side validation of loan terms | **No** | No amount, period, age, visa or document checks on the server |
| Server-side recomputation of repayment quote | **No** | `estimatedMonthlyPaymentNis` comes from the client |
| Server-side scoring | **Yes**: eligibility score (`server.js:256-259`) and risk score (`server.js:1035`). Both use client-supplied inputs |
| State-machine enforcement for status | Borrowers: yes (a single allowed transition). Staff: **no** | `server.js:975-1007` |
| Server-side audit log | **No** | Only `statusHistory` inside the application JSON |
| Decimal / currency policy | None. JS `Number` / SQLite `REAL`. Amounts are whole NIS | |
| Reconciliation with funding partner | **No**. The hand-off is simulated | `storage.ts:1233-1266` |

---

## Findings

### FIN-01: Submission success is decided by the client; server sync is fire-and-forget · **High** · Verified
- **Where:** `App.tsx:249-265`. `storageService.submitApplication()` marks the app submitted locally, shows Step 10 with a request number, and then calls `apiService.saveApplication(submitted).catch(console.warn)`.
- **Failure scenario:** The network drops, the token has expired (401 in production), or the server returns 400 or 500. The borrower still sees "Application submitted" with a request number and an SMS-style notification, which is created **locally** (`storage.ts:1091-1101`). The server has no submitted application. Every later screen reads local state, so the borrower may wait indefinitely for a decision on an application nobody can see.
- **Recommendation:** Treat submission as a server transaction. Show success **only** after a 2xx response that includes the server-assigned request number and status. Show a retryable error state otherwise. Use an idempotency key so retries are safe.

### FIN-02: The client generates request numbers and the server may silently replace them · **Medium** · Verified (mechanism) / Suspected (frequency)
- **Where:** Client: `storage.ts` (`nextSeq = 100 + this.memoryApps.size + 1`, inside `getOrCreateActiveApplication`). This count is per browser and includes the 3 seed applications, so different devices produce the same numbers. Server: `server.js:1026-1032` replaces the number on a clash, and the server's draft path (`server.js:887`) assigns its own number.
- **When it happens:** In the normal online path, the client adopts the server draft (and its server-assigned number) from `GET /applications/active/:userId` (`App.tsx:88-103`). The numbers diverge only when (a) that fetch fails, so the locally numbered draft is used, or (b) two drafts received the same number and the server reassigns one at submission. In both cases Step 10 keeps showing the **local** number, because `handleSubmitApplication` ignores the PUT response (`App.tsx:262-264`).
- **Failure scenario:** Step 10 shows `REQ-2026-000104`. The server stores `REQ-2026-000137`. The borrower quotes the first number to customer service, and it matches another borrower's application or none at all.
- **Recommendation:** Only the server assigns request numbers, at submission time, under a UNIQUE index. The client displays what the server returns.

### FIN-03: Repayment quote is client-only, ignores grace period and processing fee, and is labelled "APR" · **Medium** · Verified
- **Where:** `appConfig.ts:200-241` (`calculateLoanRepayment`). `Step6LoanDetails.tsx:84-87, 122-123, 323`.
- **Details:**
  - Standard annuity at a nominal 8.5% per year (`defaultInterestRatePercent`). The ₪80 management fee is spread evenly across the months. Each monthly figure is rounded to whole NIS separately, so `totalRepaymentNis = monthly × n` drifts from the exact total.
  - `gracePeriodMonths` is collected (`Step6LoanDetails.tsx:120`) but **ignored** in the calculation.
  - `processingFeePercent: 1.0` is defined (`appConfig.ts:16`) but **never used**, yet the UI label reads "Interest & Processing Fee".
  - The rate is shown as "% APR". An APR (or the Israeli "effective cost of credit") would include fees, so the displayed figure understates the cost of credit.
  - The server stores the client's `estimatedMonthlyPaymentNis` and `totalRepaymentNis` as given. Neither the PDF nor the back office recomputes them.
- **Recommendation:** Compute quotes on the server from versioned pricing config, including fees and grace period. Present the effective annual cost correctly. Store the pricing version with the application. Have legal or compliance review the disclosure wording.

### FIN-04: No server-side enforcement of lending rules · **High** · Verified
- **What:** These rules live only in the client: loan amount 500–10,000 in steps of 500, periods 3/6/9/12 months, minimum age 21, at least 6 months of visa validity, required documents (passport, pay slip, bank document, and guarantor ID when a guarantor is given), and consents. The amount input does not even clamp to the min and max (`Step6LoanDetails.tsx:94-99`). The server accepts any values (`server.js:960-1079`).
- **Impact:** Applications outside policy can reach the queue through a modified client or any HTTP tool. The advisory risk engine still scores them, but nothing blocks them.
- **Recommendation:** Add server-side schema and business validation at submission time, sharing one rule definition with the client.

### FIN-05: Request-number race and no uniqueness constraint · **Medium** · Suspected (concurrency not exercised)
- **Where:** `nextRequestNumber` (`server.js:286-291`) reads the current maximum and then writes in a separate statement. No UNIQUE index exists.
- **Failure scenario:** Two submissions processed concurrently can receive the same `REQ-YYYY-NNNNNN`. The check at `server.js:1027-1030` is itself racy.
- **Recommendation:** A UNIQUE index plus a sequence table, or allocation inside a transaction with retry.

### FIN-06: Lost updates. Staff and borrower saves overwrite whole records · **Medium** · Verified (design) / Suspected (occurrence)
- **Where:** `writeApp` upsert (`server.js:279-283`). The back office sends its local copy of the application (`BackOffice.tsx:135-146`), which may be stale.
- **Failure scenario:** A borrower uploads a requested document (status moves to Under Review). Shortly after, a reviewer whose screen is stale clicks Approve. The reviewer's PUT overwrites `documents` and `statusHistory` with the older copy, so the uploaded document disappears from the record.
- **Recommendation:** Use a version or `updatedAt` precondition (`If-Match`) and field-scoped endpoints (status change, document add) instead of full-document PUT.

### FIN-07: The funding hand-off is simulated but presented as real · **High** · Fixed for 3-step loans (Nov 2026)
- **Update:** the browser simulation (`simulateFundingHandoff`) is removed. "Push to partner" now runs on the admin API against a partner API (today the partner-bank sandbox), with persisted hand-off records, retries, idempotency and audit entries. See "Funding partner" in [integrations.md](integrations.md). Still open: the `exportSignedJson` "digest" below, and reconciliation with a real partner.
- **Where:** `storage.ts:1233-1266` (`simulateFundingHandoff`) fabricates `providerCode: 'BANK_LEUMI_FINTECH_DIRECT'`, a random external reference, `status: 'success'` and a fake handoff token. `BackOffice.tsx:158-168` shows "Application successfully pushed to Bank Leumi FinTech Gateway!" No network call happens. The resulting status `Forwarded to Funding Entity` is then synced to the server like a real event.
- **Related:** `exportSignedJson` (`storage.ts:1268-1279`) produces a `cryptographicDigest: "SHA256:<Math.random()>"` and an `authorizedSigner` field. **It is neither a hash nor a signature.**
- **Impact:** Staff or auditors may believe an application was transmitted or signed when it was not. The text uses a real bank's name.
- **Recommendation:** Label simulations clearly or remove them. Replace the "digest" with a real hash (or remove it). Implement the real integration on the server with persisted request and response records and reconciliation.

### FIN-08: The audit trail is not authoritative · **Medium** · Verified
- **Where:** The client audit log lives in `localStorage` (`storage.ts:1169-1184`) and is visible only in the browser that produced it. The server keeps no audit table. Staff `statusHistory` entries come from the client (SEC-03). Back-office actor names are synthetic (`"CREDIT REVIEWER_USER"`, `BackOffice.tsx:139`).
- **Recommendation:** An append-only server audit table written by the server from `req.auth` for every state change and sensitive read.

### FIN-09: Identity and document verification are simulated, yet they feed the score · **Medium** · Verified
- **Where:** `Step8DocumentUpload.tsx:148-171`. The quality check is `Math.random() < 0.1 ? 'warning' : 'passed'`, and OCR returns random passport numbers. `Step11StatusTimeline.tsx:133` hard-codes `qualityStatus: 'passed'`. The server eligibility identity factor (`eligibilityScoring.js:158-171`) awards 20 points if a passport number string **or** a PASSPORT document exists, unless the client-supplied `qualityStatus` or `validityStatus` says otherwise.
- **Impact:** The "authoritative" server score is computed from fields the client controls. Identity is never verified.
- **Recommendation:** Treat the eligibility score as indicative only (as the UI says). Base identity verification on real KYC or human review. Exclude client-asserted verification fields from scoring.

### FIN-10: Resubmission allowed without a new document · **Medium** · Verified
- **Where:** Server: `server.js:988-1002` allows `Additional Document Required → Under Review` without checking that `documents` changed. Client: `Step11StatusTimeline.tsx:113-150` adds a document entry and changes the status **even if the upload failed** (`fileUrl` is undefined).
- **Recommendation:** Require a new document whose server-side upload record belongs to the user before allowing the transition.

### FIN-11: Upload failure falls back to inline base64 or to no file at all · **Medium** · Verified
- **Where:** `Step8DocumentUpload.tsx:113-140`. On a non-security upload error, an image is kept as a `dataUrl` inside the application (stored in localStorage, sent in the PUT, and stored in SQLite because `stripInlineFiles` only strips when `fileUrl` exists, `server.js:216-224`). A PDF keeps **only metadata**, so the application can be submitted listing a document that exists nowhere.
- **Recommendation:** Block progress until the server confirms the upload. Validate on the server that every required document resolves to an `uploaded_files` row owned by the applicant.

### FIN-12: Duplicate open applications are not prevented on the server · **Medium** · Verified
- **Where:** `storage.ts:778-799` checks only local data. `GET /applications/active/:userId` returns only the most recent draft, but nothing stops several *submitted* open applications per phone or passport.

### FIN-13: Credit-rule rescoring is not atomic · **Low** · Verified
- **Where:** `server.js:1272-1285`. The config is saved and then each application is updated in a loop. A failure part-way leaves mixed scoring. There is no record of which rules version scored an application.
- **Recommendation:** Run inside a transaction. Store `rulesVersion` with each score.

### FIN-14: Two drafts can diverge (client draft vs server draft) · **Low** · Suspected
- **Where:** `App.tsx:71-105`. A local draft (with a client-generated `id`) is created and may be PUT before `GET /applications/active` returns a different server-created draft id. The client then adopts the server draft, which can orphan the first one on the server.

### FIN-15: Money representation · **Low** · Verified
- Amounts are JS `Number`. Requested amounts are whole NIS and repayment values are rounded to whole NIS, so floating-point error is unlikely to matter today. There is no currency field: NIS is implied by field names (`*Nis`). Define a decimal policy (integer agorot) before adding fees, interest accrual or repayments.

### FIN-16: The offline analytics fallback shows placeholder KPIs as if they were real · **Medium** · Verified
- **Where:** `AnalyticsDashboard.tsx:60-135` (`computeLocalSummary`, used when `GET /analytics/summary` fails). With no decided applications it reports `approvalRate: 85.0`. With no amounts it reports `avgLoanAmountNis: 7500`. With no decisions it reports `avgProcessingDays: 2.4`. It also computes over **browser-local** data (including seed applications), not the server.
- **Impact:** Management KPIs can show made-up numbers with no visual sign that they are placeholders or local-only.
- **Recommendation:** Show "no data" (null) instead of placeholder numbers, and label the local fallback clearly as offline or local data, or remove it.

### FIN-17: Borrowers can change the disbursement bank account and documents after submission, including after approval · **High** · Verified (code path)
- **Where:** The borrower "immutable after submission" list in `PUT /applications/:id` (`server.js:983-984`) freezes `requestNumber, submittedAt, borrowerDetails, residencyDetails, employmentDetails, loanRequest, guarantor, guarantors, consents, digitalSignature, language`. It does **not** include `bankAccount`, `bankAccountConfirmed` or `documents`, so for those fields the borrower's body wins.
- **Failure scenario:** An application is approved with bank account A. Someone with the borrower's session (the borrower, or an attacker after SEC-01, SEC-05 or SEC-07) saves the application again with bank account B. The server accepts it with **no status change, no history entry and no staff notification**. Only an SSE `updated` event is sent (`server.js:1073-1075`). A disbursement based on the stored record would go to account B. Documents that staff relied on can be removed or replaced in the same way.
- **Recommendation:** Freeze `bankAccount` and `bankAccountConfirmed` at submission. Allow documents to be added only (never removed), and only in the `Additional Document Required` state. Changing the payout account after submission should need a separate, audited flow with re-verification.

---

## Recommended tests (proposed, not existing)

| Test | Targets |
|---|---|
| Submit while the API returns 500 or times out: the UI must not show success | FIN-01 |
| Two concurrent submissions must get distinct request numbers | FIN-05 |
| PUT a submitted app with amount 50,000 or period 7: expect 400 | FIN-04 |
| Stale staff PUT must be rejected (version precondition) | FIN-06 |
| A `customer_service` token cannot approve | SEC-03 |
| Resubmission without a new upload: expect 400 | FIN-10 |
| Repayment quote golden values (incl. grace period and fees) shared by server and client | FIN-03 |
| PDF route must not create records | SEC-02 |
| Borrower PUT with a changed `bankAccount` on a submitted or approved app → field unchanged | FIN-17 |

See [test-coverage-gaps.md](test-coverage-gaps.md).
