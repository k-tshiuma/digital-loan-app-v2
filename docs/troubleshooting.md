# Troubleshooting

## Development

| Symptom | Cause | Fix |
|---|---|---|
| `npm run lint` fails with `Cannot find name 'useEffect'` / `'GuarantorItem'` | DEF-01 / DEF-02: missing imports | Add `useEffect` to the React import in `Step7Guarantor.tsx` and `Step8DocumentUpload.tsx`. Import `GuarantorItem` from `./types` in `App.tsx` |
| Step 7 or Step 8 renders blank and the console shows `ReferenceError: useEffect is not defined` | DEF-01 | Same as above |
| `node test_guarantors_and_scoring.js` fails 3 tests (expected 90/100, got 80/90) | DEF-06: fixture `visaExpiryDate: '2027-10-08'` is now less than 12 months away | Use relative dates in the fixtures |
| `git status` shows `data/database.sqlite` modified | The dev server and tests write to the committed DB | `git checkout -- data/database.sqlite`. Long-term: untrack it (SEC-14) |
| Tests fail with `EADDRINUSE` | Port 5002/5003/5004 in use (e.g. a previous run is still alive) | Kill the process, or change `PORT`/`TEST_PORT` in the script |
| `sqlite3` install fails | No prebuilt binary for your Node or platform | Use Node 20 LTS, or install build tools |
| Frontend cannot reach the API | `VITE_API_URL` is wrong or missing `/api`. Backend not running | Set `VITE_API_URL=http://localhost:5000/api` and restart Vite (it is inlined at build time) |
| The UI works but nothing reaches the server | Background sync errors are swallowed | Check the browser console for `[API]` / `Background sync…` warnings and the Network tab |
| Odd applications appear in the back office | Seeded demo data in localStorage (`app_seed_1..3`) | Clear site data for `localhost:3000` |
| Logged-in state persists unexpectedly | Local session in `quickloan_current_user_id`, JWT left behind (SEC-07) | Clear site data |
| OTP rejected after a backend restart | The OTP store is in memory | Request a new code (in demo mode any 6 digits work) |
| `npm run clean` fails on Windows | Uses Unix `rm -rf` | Delete `dist/` manually |

## Runtime and production-like

| Symptom | Cause | Fix |
|---|---|---|
| Server exits with `JWT_SECRET must be set in production` | `NODE_ENV=production` without a secret | Set `JWT_SECRET` |
| Back office empty or stale in production | No staff login exists outside demo mode (SEC-04). The UI falls back to localStorage | Implement staff auth |
| `GET /api/health` reports `demoMode: true` on a server | `NODE_ENV` is not `production` and `DEMO_MODE` is not `false` | Set both. **Treat it as a security incident if the server was exposed** |
| Live status updates never arrive | Proxy buffering SSE, an idle timeout shorter than 25 s, or multiple instances | Disable buffering, raise timeouts, run a single instance |
| Uploads rejected with "File content does not match…" | Magic-byte check (e.g. a renamed file, or an empty or corrupt image) | Upload a genuine PDF, JPEG, PNG, WebP or HEIC |
| "File is too large" | Over `MAX_UPLOAD_BYTES` (10 MB) | Compress the file or raise the limit |
| PDF signature shows "Typed Signature / Signed by —" | DEF-03: signature method mismatch | Map `drawn_touch`/`drawn_signature` → image from `signatureDataUri`, and `typed_name` → `signatureValue` in `pdfService.js` |
| Hebrew, Thai or Chinese text garbled in the PDF | Standard Helvetica font, no Unicode font registered | Register a Unicode TTF in pdfkit |
| Request number differs between the success screen and staff view | FIN-02 | Look the application up by user or phone. Fix server-side numbering |
| Staff status change throws "Application not found" (console) | DEF-04: the application is not in this browser's localStorage | Fix `handleStatusChange` to work from server data |

## Where to look
- **Backend logs (stdout):** `[SERVER ERROR]`, `[NOTIFY]`, `[SMS MOCK]`/`[SMS ERROR]`, `[EMAIL MOCK]`/`[EMAIL ERROR]`, `[UPLOAD]`, `[USER PROFILE UPDATE]`, `[DB ALTER]`.
- **Database:** `sqlite3 data/database.sqlite`. Read-only queries are safe. Remember it contains PII.
- **Browser:** DevTools → Application → Local Storage → `quickloan_*` keys. Console warnings. Network tab for `PUT /api/applications/*`.
