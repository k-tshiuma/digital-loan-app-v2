# Testing and QA

## 1. Inventory of existing tests (Verified)

| Suite | File | Kind | Port | Assertions |
|---|---|---|---|---|
| Verification | `tests/integration/test_verification.js` | HTTP integration script (requires `./server`, real SQLite) | 5002 | 32 |
| Guarantors and scoring | `tests/integration/test_guarantors_and_scoring.js` | Unit (scoring functions with `referenceDate`) + HTTP | 5003 | 45 |
| Returning-user prefill | `tests/integration/test_returning_user_prefill.js` | HTTP integration | 5004 | 8 |

Not present (Verified absent): any test framework (Jest, Mocha, Vitest), frontend unit or component tests, end-to-end tests (Playwright, Cypress), contract tests, load tests, CI execution, coverage tooling, ESLint. `npm test` in `backend/` is a placeholder that exits 1.

### What each suite covers
- **test_verification.js:** (1) registration and first application; (2) valid uploads and magic bytes; (3) disguised and malicious files rejected; (4) document ownership between two users; (5) submission with bank account and guarantor; (6) returning-user detection and prefill; (7) expired or outdated document detection; (8) returning-user employer and salary update; (9) PDF generation.
- **test_guarantors_and_scoring.js:** salary, employment-duration, visa-validity, guarantor and identity factor boundaries; 10-segment conversion; total-score clamping; HTTP: score tampering ignored, 1→2→3 guarantors, submission, PDF content.
- **test_returning_user_prefill.js:** new user A details and uploads; A returns and gets prefill; editing prefilled fields and replacing documents; user B cannot access A's data or documents.

### Mechanics
- Each script uses Node's `http` to call its own `app.listen(port)`, prints `✓ PASS` / `✗ FAIL`, and exits non-zero on failure.
- They depend on **DEMO_MODE** behaviour (fixed OTP, staff-token).
- They **write to `data/database.sqlite`**, the same file the dev server uses and the one committed to git.

## 2. Execution results (2026-10-11)

The suites were run against a **scratch copy** of `backend/` (including a copy of `database.sqlite`) so that the tracked database was not modified. Node v20.20.2.

| Suite | Result |
|---|---|
| test_verification.js | **32/32 passed** (exit 0) |
| test_guarantors_and_scoring.js | **42/45 passed, 3 failed** (exit 1) |
| test_returning_user_prefill.js | **8/8 passed** (exit 0) |

**Failure analysis (DEF-06):** the 3 failures are in §8, the HTTP endpoint tests that start at line 518 (`Save application with 1 Guarantor…`, `Update application to 2 Guarantors…`, `Update application to 3 Guarantors…`). Expected 90/100, got 80/90. The HTTP fixtures hard-code `visaExpiryDate: '2027-10-08'` (`test_guarantors_and_scoring.js:582, 624, 667`). On 2026-10-11 that is about 11.9 months away, so the visa-validity factor scores 10 instead of 20. **The engine is behaving to spec. The test has a date time-bomb.** Fix: compute fixture dates relative to `new Date()`.

## 3. Static analysis and build

| Check | Command | Result (2026-10-11) |
|---|---|---|
| Type-check | `cd frontend && npm run lint` (`tsc --noEmit`) | **Fails, 4 errors** |
| Production build | `cd frontend && npx vite build` | **Succeeds** (warning: chunk > 500 kB) |

Type errors:
```
src/App.tsx(216,21): error TS2304: Cannot find name 'GuarantorItem'.
src/components/Step7Guarantor.tsx(85,3): error TS2304: Cannot find name 'useEffect'.
src/components/Step8DocumentUpload.tsx(50,3): error TS2304: Cannot find name 'useEffect'.
src/components/Step8DocumentUpload.tsx(56,3): error TS2304: Cannot find name 'useEffect'.
```
The build succeeds because Vite and esbuild strip types without checking them. **The two missing `useEffect` imports are runtime errors, not just type errors.** Rendering Step 7 or Step 8 should throw `ReferenceError: useEffect is not defined` (DEF-01). Verified in source by `tsc`, and in the built bundle, where `borrower-app/frontend/dist/assets/index-*.js` contains exactly 3 unbound `useEffect(` calls. A real React import would have been renamed and qualified. The crash itself was not observed in a browser during this review. `implementation-plan.md` states that `tsc --noEmit` passes. That is no longer true.

## 4. How to run the tests safely

Option A, a copied directory (what this review did):
```bash
mkdir -p /tmp/ql && cp -r backend/*.js shared/backend/services backend/package.json data/database.sqlite node_modules /tmp/ql/
mkdir -p /tmp/ql/uploads && cd /tmp/ql
node test_verification.js && node test_guarantors_and_scoring.js && node test_returning_user_prefill.js
```

Option B, run in place and then restore the tracked DB:
```bash
cd backend
node test_verification.js
node test_guarantors_and_scoring.js
node test_returning_user_prefill.js
git checkout -- database.sqlite   # discard test rows; test uploads remain in uploads/ (gitignored)
```

Better (proposed): make the DB path configurable (e.g. `SQLITE_PATH`, **which does not exist today**) and point the tests at a temp file.

## 5. Mocking and test data
- SMS and email are mocked automatically when credentials are unset (console output).
- Test data is created over HTTP at runtime. There are no fixtures or factories and no teardown, so test users and applications accumulate in the DB.
- The frontend has seed data in `storage.ts` (`SEED_APPLICATIONS`, seed users) that ships in production bundles.

## 6. QA guidance for manual testing
- Start the backend (`npm run dev`) and the frontend (`npm run dev`). Demo OTP: any number ending in `4567` returns `123456`, and in DEMO_MODE any 6-digit code is accepted.
- The back office is opened with the header toggle. Pick a role from the dropdown.
- **Steps 7 and 8 are expected to crash until DEF-01 is fixed.**

See [test-coverage-gaps.md](test-coverage-gaps.md) for the proposed tests.
