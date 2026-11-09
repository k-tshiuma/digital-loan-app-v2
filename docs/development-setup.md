# Development Setup

## Prerequisites
- Node.js. The version is **not pinned** (no `engines`, no `.nvmrc`). This review used **v20.20.2**, and Node 20 LTS or newer is recommended. `sqlite3` normally installs prebuilt binaries for common platforms (general package behaviour, not verified per platform here). If none matches yours, a C/C++ toolchain is needed.
- npm. Both `package-lock.json` and `borrower-app/frontend/bun.lock` exist. **Use npm**: CLAUDE.md assumes it, and only `package-lock.json` is current. It was last changed in `7491a8f` (2026-10-05) and includes `recharts`. `bun.lock` dates from the initial commit (2026-09-15) and has **no `recharts` entry**, so it is stale. The team should confirm this and delete `bun.lock`.
- Git.

There is **no root `package.json`**. Backend and frontend are separate npm projects.

## First run

```bash
git clone <repo-url> digital-loan-app
cd digital-loan-app

# Backend
cd backend
npm install
npm run dev          # nodemon server.js → http://localhost:5000  (demo mode ON by default)

# Frontend (second terminal)
cd frontend
npm install
npm run dev          # vite on http://localhost:3000 (bound to 0.0.0.0)
```

Optional `borrower-app/frontend/.env.local`:
```dotenv
VITE_API_URL=http://localhost:5000/api
```

Check it works:
```bash
curl http://localhost:5000/api/health      # {"success":true,"demoMode":true}
```

⚠ **The backend opens the committed `data/database.sqlite`.** Your local changes will show up in `git status`. Avoid committing them (see SEC-14). Until the repo stops tracking the file, consider `git update-index --skip-worktree data/database.sqlite` locally (team decision).

## Demo credentials and behaviour (local only)
- OTP: phone numbers ending in `4567` always get `123456`. With demo mode on, **any** 6-digit code is accepted, and the code is also returned in the API response (`demoCode`).
- "Continue with Google" signs in a fixed demo profile.
- Back office: header toggle, then pick a role. The client fetches a role token from `/api/auth/staff-token`.
- The frontend seeds 3 demo applications into localStorage the first time it runs. Clear site data to reset.

## Useful commands

| Where | Command | What it does |
|---|---|---|
| backend | `npm run dev` | nodemon |
| backend | `npm start` | node |
| backend | `node test_verification.js` (etc.) | Test scripts. **Mutate the DB**, see [testing-and-qa.md](testing-and-qa.md) |
| frontend | `npm run dev` | Vite dev server :3000 |
| frontend | `npm run lint` | `tsc --noEmit` (currently fails, DEF-01/02) |
| frontend | `npm run build` | Production bundle in `borrower-app/frontend/dist/` |
| frontend | `npm run preview` | Serve the built bundle |
| frontend | `npm run clean` | `rm -rf dist server.js`. Unix `rm`, so it is expected to fail when npm uses `cmd.exe` on Windows (inferred, not executed). Leftover from the template |

## External systems needed for development
None. SMS and email are mocked to the console when credentials are absent. To test real SMS you need a Twilio account (`TWILIO_SID`/`TWILIO_TOKEN`/`TWILIO_FROM`).

## Editor and tooling
- Path alias `@/*` resolves to `borrower-app/frontend/` (not `src/`), per `vite.config.ts` and `tsconfig.json`.
- No ESLint or Prettier configured. Match the surrounding style.
- The `.py` scripts in `borrower-app/frontend/` are one-off maintenance helpers, not part of the build.
