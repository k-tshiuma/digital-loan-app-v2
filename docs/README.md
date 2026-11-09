# QuickLoan (LendGlobal): Technical Documentation

Reverse-engineered documentation of the existing codebase, produced on **2026-10-11** from branch `feature/guarantor-enhancements-and-scoring` (HEAD `397b7d9`). The source code is the source of truth. Where this documentation and the code disagree, the code wins, and please update this documentation.

> **Layout changed (2026-11-09, docs/app-separation-plan.md).** The app is now split into borrower-app/ (frontend + backend), admin-app/ (frontend + backend), shared/ (frontend and backend code both use), data/ (database.sqlite, uploads) and tests/. File paths in these docs were updated, but line numbers and mentions of backend/server.js describe the old single backend: its routes now live in borrower-app/backend/routes, admin-app/backend/routes and shared/backend/routes; its helpers in shared/backend/core. See CLAUDE.md for the current layout.

## At a glance

- **What it is:** a mobile-first **web** application (React 19 SPA + Express 5 API + SQLite) where foreign workers in Israel apply for micro-loans (₪500–10,000, 3–12 months) and track their status. Staff review applications in a back office.
- **What it is not:** a native mobile app (no Flutter or React Native), or a money-movement system. There are no disbursements, repayments, balances or ledger, and the funding-partner hand-off is simulated.
- **Maturity:** prototype or demo grade. **It should not process real borrower data** until the Critical and High findings are fixed. The most urgent are SEC-01 (demo mode bypasses authentication unless explicitly disabled), SEC-02 (the PDF endpoint writes unvalidated records), FIN-01 (submission success is shown without server confirmation), FIN-17 (the payout bank account stays editable after approval) and DEF-01 (Steps 7 and 8 likely crash because of a missing import).

## Verification status legend

| Label | Meaning |
|---|---|
| **Verified** | Confirmed by reading source, by search, or by executing a command |
| **Inferred** | A strong conclusion from code, not directly observed (e.g. runtime behaviour that was not executed) |
| **Suspected** | A plausible defect or risk that needs validation |
| **Unverified** | Depends on environment, configuration or data that could not be seen |
| **Not Implemented** | Confirmed absent from the codebase |
| **Not Accessible** | The resource exists outside the repo, or could not be reached |

## Documentation index

### Orientation
- [project-inventory.md](project-inventory.md): stack, versions, repo structure, entry points, available resources, coverage limits
- [developer-handover.md](developer-handover.md): **start here** if you are new
- [glossary.md](glossary.md)

### Architecture
- [architecture.md](architecture.md): system, request pipeline, components, auth flow, persistence (Mermaid diagrams)
- [mobile-application.md](mobile-application.md): the client SPA: startup, navigation, state, offline, platform capabilities

### Modules
- [modules/authentication.md](modules/authentication.md)
- [modules/loan-application-wizard.md](modules/loan-application-wizard.md)
- [modules/documents-and-uploads.md](modules/documents-and-uploads.md)
- [modules/guarantors-and-eligibility.md](modules/guarantors-and-eligibility.md)
- [modules/credit-prescreening.md](modules/credit-prescreening.md)
- [modules/back-office-and-analytics.md](modules/back-office-and-analytics.md)
- [modules/notifications-and-realtime.md](modules/notifications-and-realtime.md)
- [modules/pdf-export.md](modules/pdf-export.md)
- [modules/application-history-and-help.md](modules/application-history-and-help.md) (added by audit)
- [modules/i18n-and-localisation.md](modules/i18n-and-localisation.md) (added by audit)

### API, integrations, data
- [api-reference.md](api-reference.md): all 28 endpoints
- [openapi.yaml](openapi.yaml): OpenAPI 3.0 spec (reverse-engineered)
- [integrations.md](integrations.md): Twilio, SMTP, and the mocked or simulated integrations
- [database.md](database.md): SQLite schema, ER diagram, indexes, ownership, retention
- [data-models.md](data-models.md): TypeScript domain types, serialization, client-side stores

### Financial logic and integrity
- [financial-workflows.md](financial-workflows.md): which workflows exist, and a step-by-step analysis of each
- [transaction-state-models.md](transaction-state-models.md): application status lifecycle, intended vs enforced
- [financial-integrity-risks.md](financial-integrity-risks.md): FIN-01…FIN-17

### Security and privacy
- [security-and-privacy.md](security-and-privacy.md): SEC-01…SEC-21, auth, authorization, privacy and regulatory relevance
- [threat-model.md](threat-model.md): assets, trust boundaries, STRIDE threats
- [security-remediation-roadmap.md](security-remediation-roadmap.md)

### Quality
- [testing-and-qa.md](testing-and-qa.md): existing tests, **execution results**, type-check and build results
- [test-coverage-gaps.md](test-coverage-gaps.md): proposed tests

### Build and operations
- [development-setup.md](development-setup.md)
- [environment-configuration.md](environment-configuration.md): every environment variable found in code
- [build-and-release.md](build-and-release.md)
- [deployment-runbook.md](deployment-runbook.md): production setup, releases, rollback, backups (Phase 8)
- [operations-and-recovery.md](operations-and-recovery.md)

### Maintenance
- [adding-features.md](adding-features.md): project-specific recipes
- [troubleshooting.md](troubleshooting.md)
- [technical-debt.md](technical-debt.md): **master findings register** (SEC, FIN, DEF, MNT)
- [improvement-roadmap.md](improvement-roadmap.md): staged plan and open questions
- [evidence-register.md](evidence-register.md): claim → evidence mapping
- [documentation-audit.md](documentation-audit.md): **accuracy audit of this package** (2026-10-11): findings, corrections, remaining unverified claims

## Scope and limitations
- Backend: inspected in full. Frontend: services, `App.tsx`, config, and the security- and workflow-relevant parts of the components inspected in detail; presentational UI code was skimmed. See [project-inventory.md §8](project-inventory.md#8-initial-coverage-and-limitations).
- No deployed environment, CI, secrets or third-party accounts were available.
- `npm audit` was not run. Dependency vulnerability status is unknown.
- **This is not a penetration test or a compliance assessment.** No claim of security, compliance or production readiness is made.

## Brief-to-file mapping
The documentation brief assumed a Flutter or React Native mobile app. Its structure was adapted as follows: mobile-specific topics (signing, store releases, Keychain/Keystore, deep links, biometrics, push) are covered in [mobile-application.md](mobile-application.md) and [build-and-release.md](build-and-release.md), and marked *Not Applicable* or *Not Implemented* where relevant. `database-relationships.md` was folded into [database.md §5](database.md#5-entity-relationship-diagram).
