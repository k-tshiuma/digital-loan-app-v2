# Environment Configuration

All variables listed here were found in source code. Values shown are defaults or placeholders. **Never commit real values.** `.gitignore` excludes `.env*` except `.env.example`.

## Backend (`backend/`, loaded with `dotenv` from `.env`)

| Variable | Default | Used at | Purpose / notes |
|---|---|---|---|
| `PORT` | `5000` | `server.js:20` | Listen port |
| `NODE_ENV` | (unset) | `server.js:21` | **Must be exactly `production`** to disable DEMO_MODE implicitly, require `JWT_SECRET`, and hide error messages |
| `DEMO_MODE` | (unset = on outside production) | `server.js:25` | Set `false` to disable demo behaviour without `NODE_ENV=production`. ⚠ See SEC-01 |
| `BORROWER_JWT_SECRET`, `ADMIN_JWT_SECRET` | `JWT_SECRET`, then a dev constant (outside production) | `shared/backend/core/config.js` | **Required in production, one per API and different from each other** (Phase 9; the API refuses to start otherwise). Borrower tokens use the first, staff tokens the second |
| `CORS_ORIGIN` | borrower API: `localhost:3000`, admin API: `localhost:3001`; none in production | `shared/backend/core/appBase.js` | Comma-separated browser origins allowed to call the API from another address |
| `COOKIE_SECURE` | (unset = `Secure` only when `NODE_ENV=production`) | `shared/backend/core/sessionCookie.js` | `true`/`false` forces the `Secure` flag on the HttpOnly session cookies (`ql_borrower`, `ql_staff`). Only for testing production mode over plain http |
| `JWT_SECRET` (local fallback) | dev constant (outside production) | `server.js:27-33` | **Required in production** (the server throws on startup otherwise). Use ≥ 32 random bytes |
| `JWT_EXPIRES_IN` | `7d` | `server.js:34` | Borrower token lifetime (`jsonwebtoken` format). Staff tokens are fixed at `12h` |
| `MAX_UPLOAD_BYTES` | `10485760` | `server.js:638` | Upload size limit |
| `TWILIO_SID` | — | `smsService.js:6` | Enables real SMS together with `TWILIO_TOKEN` |
| `TWILIO_TOKEN` | — | `smsService.js:6` | Secret |
| `TWILIO_FROM` | — | `smsService.js:12` | Sender number or ID. Not validated |
| `SMTP_HOST` | `smtp.gmail.com` | `emailService.js:4` | |
| `SMTP_PORT` | `587` | `emailService.js:5` | `secure:false` (STARTTLS) |
| `SMTP_USER` | — | `emailService.js:7, 15` | Enables real email. Also used as the From address |
| `SMTP_PASS` | — | `emailService.js:7` | Secret |

Not configurable today (hard-coded): the SQLite path (`database.js:4`), the uploads directory (`server.js:41`), the CORS policy (`server.js:44`), the JSON body limit (5 MB), OTP TTL and attempts, bcrypt rounds, the trust-proxy setting (not set).

### Example `.env` (placeholders)
```dotenv
NODE_ENV=production
PORT=5000
JWT_SECRET=<generate: openssl rand -base64 48>
JWT_EXPIRES_IN=7d
DEMO_MODE=false
MAX_UPLOAD_BYTES=10485760
TWILIO_SID=<twilio-account-sid>
TWILIO_TOKEN=<twilio-auth-token>
TWILIO_FROM=<twilio-sender>
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_USER=<smtp-user>
SMTP_PASS=<smtp-password>
```
There is **no `.env.example`** in the repo. Adding one is recommended.

## Frontend (`borrower-app/frontend/`, Vite)

| Variable | Default | Used at | Notes |
|---|---|---|---|
| `VITE_API_URL` | `http://localhost:5000/api` | `src/services/api.ts:11-12` | Must include the `/api` suffix. It is inlined into the bundle **at build time** |
| `DISABLE_HMR` | (unset) | `vite.config.ts:14-17` | AI Studio leftover. `true` disables HMR and file watching |
| `GEMINI_API_KEY`, `APP_URL` | placeholders in `.env.example` | **Not used by any source file** | AI Studio template leftovers. `.env.example` should list `VITE_API_URL` instead |

Anything prefixed `VITE_` is public, because it ships in the JS bundle. Never put secrets in it.

## Environments

| Environment | Defined in repo? |
|---|---|
| Local development | Yes, implicitly (defaults above) |
| Staging | **No** |
| Production | **No** (no deployment config, hosting target or domain) |

The backend has no build flavours or profiles, and the frontend has no `.env.production` or `.env.staging` files. Everything depends on the environment variables set when the process starts (backend) or when the bundle is built (frontend).

## Startup safety checklist (recommended)
- [ ] `NODE_ENV=production` **and** `DEMO_MODE=false` (belt and braces until SEC-01 is fixed)
- [ ] `GET /api/health` returns `demoMode: false`
- [ ] Strong `JWT_SECRET` from a secret manager
- [ ] `VITE_API_URL` points at the HTTPS API origin
- [ ] Twilio and SMTP credentials scoped to this environment
- [ ] `database.sqlite` is **not** the committed file (start from an empty DB or a governed copy)
