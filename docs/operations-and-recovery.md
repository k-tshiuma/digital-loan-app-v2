# Operations and Recovery

> No operational runbooks, monitoring, backup or incident procedures exist in the repository (Verified absent). This document records what the code implies for operations and gives **recommended** procedures, marked **[Needs team confirmation]**.

## 1. Runtime facts that matter for operations

| Fact | Consequence | Evidence |
|---|---|---|
| Single Node process with in-memory OTP and SSE state | A restart invalidates pending OTPs and disconnects live viewers (they reconnect after 5 s). Cannot scale horizontally | `server.js:160, 312, 1094` |
| SQLite file DB, no WAL pragma, no transactions | Writes are serialised. A crash mid-request can leave partial multi-statement updates (e.g. rescoring) | `database.js`, `server.js:1279-1284` |
| Notifications sent after the response, errors only logged | Lost SMS is visible only in logs and in `notifications.deliveryStatus` | `server.js:1072, 337-342` |
| Logs to stdout only, unstructured | Need log shipping. **Mock mode logs OTP and reset codes** | `smsService.js:7` |
| `GET /api/health` | Liveness, and also exposes `demoMode` | `server.js:386` |
| Upload dir grows without bound | Disk monitoring needed. Nothing cleans up orphaned files | `server.js:630-643` |

## 2. Health checks [Needs team confirmation]
- Liveness: `GET /api/health` → 200.
- **Alert if `demoMode` is `true` in any shared environment.**
- Readiness (proposed): add a check that runs `SELECT 1` against SQLite and confirms the uploads dir is writable.

## 3. Backups [Needs team confirmation]
- Back up `data/database.sqlite` with SQLite (this needs the `sqlite3` command-line tool, which is **not** a project dependency; the npm `sqlite3` package does not provide it)'s online backup API (`sqlite3 database.sqlite ".backup 'backup.sqlite'"`) rather than a raw file copy while the server is running.
- Back up `data/uploads/` together with the DB, because documents reference upload filenames.
- Encrypt backups, because they contain passport and bank data.
- Test restores regularly.

## 4. Common incidents and responses

| Symptom | Likely cause | Action |
|---|---|---|
| Users report "Incorrect verification code" after a deploy | Server restarted, so the in-memory OTP was lost | Ask them to request a new code. Long-term: persistent OTP store |
| Borrower saw "submitted" but staff cannot find the application | FIN-01: background PUT failed | Check server logs around that time, then the user's `GET /applications/active/:userId` (a draft may exist). Long-term: fix FIN-01 |
| Borrower quotes a request number that does not exist | FIN-02: client-generated number replaced on the server | Search by phone or user id instead. Long-term: server-only numbering |
| SMS not arriving | Twilio credentials missing (mock mode), Twilio error, wrong `TWILIO_FROM` | Check `[SMS MOCK]` / `[SMS ERROR]` logs and `notifications.deliveryStatus` |
| SMS bill spike | OTP flooding (SEC-08) | Block at the edge or WAF, enable Twilio geo-permissions, add rate limits |
| Back office shows old or fake data | API unreachable or staff token unavailable (production, SEC-04), so it falls back to localStorage | Check the API, and in production remember there is no staff login |
| Staff status change "succeeds" but the borrower sees no change | Background PUT failed, or DEF-04 | Check the network tab and server logs |
| Steps 7 and 8 show a blank screen or error | DEF-01: missing `useEffect` import | Deploy the fix |
| Live status not updating | Proxy buffering SSE, or a second server instance | Disable buffering, run a single instance |
| `SQLITE_BUSY` errors | Concurrent long writes | Enable WAL. Move to a server DB at scale |

## 5. Data incidents [Needs team confirmation]
Triggers: the committed `database.sqlite` turns out to contain real data (SEC-14), a credential leak, or unauthorised access through demo mode (SEC-01).
1. Contain: rotate `JWT_SECRET` (this invalidates every token), rotate Twilio and SMTP secrets, set `DEMO_MODE=false`.
2. Assess: which records were exposed. There is no access audit log, which limits forensics (FIN-08).
3. Notify according to Israeli privacy regulation and counsel's advice.
4. Purge exposed data from git history if applicable.

## 6. Routine maintenance [Recommended]
- Purge expired `password_resets` rows. Archive old notifications.
- Reconcile `uploaded_files` against application documents, and delete orphans after the retention period.
- Review `app_config.creditRules` changes. There is no history of rule changes today.
