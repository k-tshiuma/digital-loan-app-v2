# Adding Features: Project-Specific Recipes

These recipes match the current structure. They do not fix existing debt, but they avoid adding more.

## 1. Add a field to the application (e.g. `employmentDetails.contractType`)

Nested inside an existing JSON section, this needs **no DB change**:
1. `shared/frontend/types.ts`: add `contractType?: string` to `EmploymentDetails`.
2. `borrower-app/frontend/src/components/Step5EmploymentDetails.tsx`: add the input to the form state and pass it out in `onSaveAndNext`.
3. `shared/frontend/i18n/translations.ts`: add a label key to **en, he, th, zh and tl**.
4. If it affects scoring: update **both** `shared/backend/services/eligibilityScoring.js` and `shared/frontend/services/eligibilityScoring.ts`, plus `test_guarantors_and_scoring.js`.
5. If it must be validated: add the check on the **server** in `PUT /applications/:id` (submission branch), not only in the step component.
6. Optionally show it in the PDF (`shared/backend/services/pdfService.js`) and the back-office inspector.

A **new top-level** field (e.g. `application.referralCode`) also needs:
- `shared/backend/database.js`: append `'ALTER TABLE applications ADD COLUMN referralCode TEXT'` to `addedCols`. Never edit existing entries.
- `backend/server.js` `writeApp`: add it to **both** `cols` and `values` (`:261-277`). Otherwise it is silently dropped.
- If it is JSON-shaped: add it to `APP_JSON_FIELDS` or `APP_JSON_ARRAY_FIELDS` (`:167-168`).
- If borrowers must not change it after submission: add it to the frozen list (`:983-984`).

## 2. Add a protected API endpoint

```js
// backend/server.js — place AFTER app.use('/api', authenticate) (line 619)
app.get('/api/applications/:id/summary', async (req, res) => {
  const a = await getAppById(req.params.id);
  if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
  if (!canAccessUser(req, a.userId)) return res.status(403).json({ success: false, error: 'Forbidden' });
  if (!isStaff(req)) { delete a.riskScore; delete a.riskLevel; delete a.riskFlags; }
  res.json({ success: true, summary: { status: a.status, requestNumber: a.requestNumber } });
});
```
For staff-only routes add `requireStaff('credit_reviewer', 'system_admin')` as middleware.

Client side, in `borrower-app/frontend/src/services/api.ts` inside `apiService`:
```ts
async getApplicationSummary(id: string, scope: ApiScope = 'borrower') {
  const res = await request<{ summary: { status: CanonicalStatus; requestNumber: string } }>(`/applications/${id}/summary`, { scope });
  return res.summary;
},
```
Do not add a `storageService` fallback for server data. Handle `ApiError` in the component and show the error.

Public endpoints (no token) must be declared **before** line 619 and must be safe to call anonymously, with rate limiting.

## 3. Add a wizard screen
1. Create `borrower-app/frontend/src/components/StepXNewThing.tsx` with props `{ language, initialData, onSaveAndNext, onBack }`, following `Step5EmploymentDetails` as the pattern.
2. In `App.tsx`: add `handleSaveNewThing` (merge, `autoSaveDraft(updated, next)`, `setCurrentStep(next)`) and a render block `{currentStep === N && (...)}`.
3. Renumber: the step numbers are literals throughout `App.tsx` (including `onBack` targets, the returning-user jump to 6, and the `>= 3 && <= 9` progress range) and `WizardProgress.tsx`. Search for `setCurrentStep(` and `currentStep ===`.
4. Server: `currentStep` defaults (`server.js:269, 902`) assume the current numbering.
5. Translations in all 5 languages.

## 4. Add or change an external integration
Follow the `services/smsService.js` pattern: one module per provider, credentials from env, a console mock when they are unset, and `{ success, error }` results. Call it from `server.js`, **not** from the browser. Record outbound calls in a table if they matter for audit, as the `FundingIntegrationRecord` shape intends. Document new env vars in [environment-configuration.md](environment-configuration.md).

## 5. Change the schema safely
- Additive columns only, through `addedCols`.
- For anything else (renames, constraints, indexes such as a UNIQUE index on `requestNumber`), write an explicit migration step that runs once and is idempotent. A version table is recommended. Back up the DB first.
- Remember the committed `database.sqlite`. Do not commit schema changes as a binary DB diff.

## 6. Add a backend test
Follow the existing script pattern (`require('./server')`, `app.listen(<unique port>)`, `makeRequest`). Then:
- Use a **unique port** (5002–5004 are taken).
- Compute dates relative to `new Date()`, or pass `referenceDate` to scoring functions. Do not hard-code calendar dates (DEF-06).
- Clean up, or run against a copied DB ([testing-and-qa.md §4](testing-and-qa.md#4-how-to-run-the-tests-safely)).

## 7. Add a translation string
Add the key to all five dictionaries in `translations.ts` (`en` at line 56, `he` 368, `th` 644, `zh` 920, `tl` 1196), then use `t(language, 'key', { param })`. A missing key falls back to English, then to the raw key, so a missing translation does not fail visibly.

## 8. Add a staff action
UI: add a button in `BackOffice.tsx` behind a role check. **Server: enforce the role** with `requireStaff(...)` on a dedicated endpoint. Do not rely on the generic PUT (SEC-03). Build history and audit entries on the server.
