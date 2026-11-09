# Deployment Runbook

How to run QuickLoan in production: one Ubuntu server, nginx in front, pm2 running the two APIs, one SQLite database. Phase 8 of [app-separation-plan.md](app-separation-plan.md). Everything here was rehearsed on 2026-11-09 (see [Rehearsal record](#9-rehearsal-record)).

The files are in `deploy/`:

| File | Purpose |
| --- | --- |
| `deploy/deploy.sh <tag>` | Backup, checkout, install, build both frontends, publish them, restart the APIs, smoke check |
| `deploy/backup.sh` | Online backup of the database and the uploads folder |
| `deploy/smoke.js <app URL> <admin URL>` | Read-only checks of a running deployment |
| `deploy/ecosystem.config.js` | pm2 definition of the two APIs |
| `deploy/nginx/quickloan.conf`, `quickloan-locations.conf` | The two sites |
| `deploy/env/*.env.example` | Templates for the settings in `/etc/quickloan/` |

## 1. What runs where

| Part | On the server | Public address |
| --- | --- | --- |
| Borrower app (static files) | `/var/www/quickloan/borrower`, served by nginx | `https://app.example.com` |
| Borrower API | pm2 `quickloan-borrower`, `127.0.0.1:5000` | `https://app.example.com/api` |
| Admin dashboard (static files) | `/var/www/quickloan/admin`, served by nginx | `https://admin.example.com` |
| Admin API | pm2 `quickloan-admin`, `127.0.0.1:5100` | `https://admin.example.com/api` |
| Database, uploads | `/var/lib/quickloan/database.sqlite`, `/var/lib/quickloan/uploads/` | – |
| Settings | `/etc/quickloan/{shared,borrower,admin,deploy}.env` | – |
| Code | `/opt/quickloan/app` (git checkout) | – |
| Logs | `/var/log/quickloan/` (APIs), `/var/log/nginx/quickloan-*` | – |
| Backups | `/var/backups/quickloan/` | – |

Rules that follow from the code:
- **One server.** Both APIs open the same SQLite file, which only works on one machine's local disk (never NFS/SMB/EFS).
- **One process per API, never pm2 cluster mode.** Login codes, rate limits and live-status streams are kept in memory.
- **Each site calls its own API on the same address** (`/api`), so no CORS setup is needed.
- `app.example.com` / `admin.example.com` are placeholders: replace them in `deploy/nginx/quickloan.conf` and `/etc/quickloan/deploy.env`.

## 2. One-time server setup

### 2.1 Server

- **Ubuntu 24.04 LTS**, 1 vCPU / 2 GB RAM is enough (the frontend builds need about 1 GB). Older systems (Ubuntu 22.04, Debian 12) fail at start-up with `GLIBC_2.38 not found`, because the prebuilt SQLite module needs a newer system library; there, install `build-essential python3` and run `npm rebuild sqlite3 --build-from-source` after every `npm ci`.
- Firewall: only SSH, 80 and 443.

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

### 2.2 Packages

**Node 22 LTS** (Node 20 reached end of life in April 2026; some packages already ask for 22), nginx, sqlite3 (backups), git, certbot, pm2:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx sqlite3 git certbot
sudo npm install -g pm2
```

### 2.3 User and folders

```bash
sudo useradd --create-home --shell /bin/bash quickloan
sudo mkdir -p /opt/quickloan /etc/quickloan /var/lib/quickloan/uploads /var/www/quickloan \
  /var/log/quickloan /var/backups/quickloan
sudo chown quickloan:quickloan /opt/quickloan /var/lib/quickloan /var/lib/quickloan/uploads \
  /var/www/quickloan /var/log/quickloan /var/backups/quickloan
```

### 2.4 Code

Give the server read access to the repository (a GitHub deploy key for the `quickloan` user), then:

```bash
sudo -iu quickloan git clone git@github.com:k-tshiuma/digital-loan-app-v2.git /opt/quickloan/app
```

### 2.5 Settings

```bash
cd /opt/quickloan/app
for f in shared borrower admin deploy; do sudo cp deploy/env/$f.env.example /etc/quickloan/$f.env; done
sudo chown root:quickloan /etc/quickloan/*.env && sudo chmod 640 /etc/quickloan/*.env
```

Then edit them:
- `borrower.env` and `admin.env`: `BORROWER_JWT_SECRET` and `ADMIN_JWT_SECRET`, two different values (`openssl rand -hex 32` each). Each API only gets its own; they refuse to start in production without it, or if the two are the same.
- `shared.env`: Twilio (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`) and SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`). **Without Twilio, borrowers never receive their login codes**: the API only writes them to its log and prints a `WARNING` at start-up.
- `deploy.env`: the two public URLs.
- `borrower.env`, `admin.env`: apart from the secrets, the defaults are fine.

Settings are read by `deploy/ecosystem.config.js` when pm2 starts the APIs. Don't put `.env` files in the checkout on the server.

### 2.6 Database

**Start with an empty database** (recommended): the borrower API creates the schema on first start. `data/database.sqlite` in the repository is development test data. To keep it anyway, copy it to `/var/lib/quickloan/database.sqlite` (owner `quickloan`) before the first deploy.

### 2.7 DNS, certificates, nginx

1. Point both names (A/AAAA records) at the server.
2. Certificates, one per name. certbot stops nginx for a few seconds each time it renews (every ~60 days), using the hooks saved here:

   ```bash
   for d in app.example.com admin.example.com; do
     sudo certbot certonly --standalone -d $d \
       --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
   done
   ```
3. Install the sites (after replacing the placeholder names in `quickloan.conf`):

   ```bash
   cd /opt/quickloan/app
   sudo cp deploy/nginx/quickloan.conf /etc/nginx/sites-available/
   sudo cp deploy/nginx/quickloan-locations.conf /etc/nginx/snippets/
   sudo ln -sf /etc/nginx/sites-available/quickloan.conf /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. Optional: limit the admin site to the office or VPN (the `allow`/`deny` lines in `quickloan.conf`).

### 2.8 First deploy

```bash
sudo -iu quickloan
cd /opt/quickloan/app && deploy/deploy.sh v1.0.0      # any tag or commit
pm2 startup systemd     # prints one sudo command: run it, so pm2 starts on boot
pm2 install pm2-logrotate
```

### 2.9 Staff accounts

The seed creates one account per role. In production it refuses to run unless all four passwords are given (the defaults in the script are public):

```bash
sudo -iu quickloan
cd /opt/quickloan/app
read -rs ADMIN_INITIAL_PASSWORD; read -rs REVIEWER_INITIAL_PASSWORD
read -rs SERVICE_INITIAL_PASSWORD; read -rs FUNDING_INITIAL_PASSWORD
export ADMIN_INITIAL_PASSWORD REVIEWER_INITIAL_PASSWORD SERVICE_INITIAL_PASSWORD FUNDING_INITIAL_PASSWORD
node -r dotenv/config admin-app/backend/scripts/seed_staff.js dotenv_config_path=/etc/quickloan/shared.env
```

Hand the passwords to each person through a password manager, not email or chat.

### 2.10 Daily backups

```bash
sudo -iu quickloan crontab -e
# add:
15 2 * * * /opt/quickloan/app/deploy/backup.sh >> /var/log/quickloan/backup.log 2>&1
```

Backups stay on the same disk. Copy `/var/backups/quickloan` to another place too (another server, object storage), or a lost disk loses the backups with the data.

## 3. Go-live checklist

Do a full rehearsal on a staging server first (same steps, staging names such as `staging-app.example.com`), then:

- [ ] `node deploy/smoke.js https://app.example.com https://admin.example.com` passes (deploy.sh runs it too)
- [ ] `pm2 logs --lines 50` shows no `WARNING` lines (Twilio and SMTP set)
- [ ] A real phone receives the login code; a test registration reaches the admin queue
- [ ] Each staff role logs in on the admin site; a reviewer decision shows on the borrower's status screen within a few seconds
- [ ] Walk-through in English and Hebrew on a phone (borrower) and a desktop (admin)
- [ ] `deploy/backup.sh` runs; the cron job is in place; backups are copied off the server
- [ ] `pm2 startup` done (reboot the server once and check both sites come back)
- [ ] Test data from staging is not in the production database

## 4. Releasing a new version

```bash
# on your machine, after merging to main and the tests passing
git tag v1.0.1 && git push origin v1.0.1
# on the server
sudo -iu quickloan bash -c 'cd /opt/quickloan/app && deploy/deploy.sh v1.0.1'
```

`deploy.sh` backs up, checks out the tag, runs `npm ci`, builds both frontends with `VITE_API_URL=/api` and the public URLs, swaps each build in (the previous one stays as `<app>.previous`), restarts the borrower API, waits for it, then the admin API, runs the smoke check and appends to `/var/lib/quickloan/deployments.log`. It takes about a minute. During the restart:
- open status screens reconnect on their own;
- login codes requested in the last minutes are lost (kept in memory), so a borrower may have to ask for a new one.

Changing `BORROWER_JWT_SECRET` or `ADMIN_JWT_SECRET` signs everyone of that app out: the next request returns 401 and the app goes back to its sign-in screen. Do that to cut off all sessions (for example after a leak).

Database changes stay additive (`ALTER TABLE ... ADD COLUMN` in `shared/backend/database.js`). The borrower API applies them at start-up, which is why it restarts first.

## 5. Rollback

```bash
cat /var/lib/quickloan/deployments.log          # previous tag
sudo -iu quickloan bash -c 'cd /opt/quickloan/app && deploy/deploy.sh v1.0.0'
```

Deploys never change existing data, so redeploying the previous tag is enough. Columns a newer release added stay in place, and older code ignores them. Only if a release damaged data, restore a backup (next section). The `pre-split-baseline` tag is the old single-backend layout and can't be deployed with these scripts.

## 6. Restoring a backup

```bash
sudo -iu quickloan
pm2 stop quickloan-borrower quickloan-admin
cd /var/lib/quickloan
mv database.sqlite database.sqlite.broken; rm -f database.sqlite-wal database.sqlite-shm
gunzip -c /var/backups/quickloan/database-<stamp>.sqlite.gz > database.sqlite
sqlite3 database.sqlite 'PRAGMA integrity_check;'          # must print ok
# uploads, if needed:
mv uploads uploads.broken && tar -xzf /var/backups/quickloan/uploads-<stamp>.tar.gz -C /var/lib/quickloan
pm2 start quickloan-borrower && sleep 3 && pm2 start quickloan-admin
node /opt/quickloan/app/deploy/smoke.js https://app.example.com https://admin.example.com
```

## 7. Monitoring and logs

- `pm2 ls`, `pm2 logs quickloan-borrower`, or the files in `/var/log/quickloan/` (`*.error.log` holds warnings and errors). `pm2-logrotate` keeps them from filling the disk.
- Health: `https://app.example.com/api/health` and `https://admin.example.com/api/health` (`service`, `demoMode: false`). Point an uptime monitor at both.
- The nginx access logs leave out query strings, because document and status-stream URLs carry the login token.
- If one API stops, the other keeps working; its site shows the page but its API calls get 502 until pm2 restarts it.

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| API exits at start-up with `GLIBC_2.38 not found` | OS older than Ubuntu 24.04; see 2.1 |
| `Missing /etc/quickloan/...env` from pm2 | A settings file is missing; see 2.5 |
| API exits: `BORROWER_JWT_SECRET must be set` / `ADMIN_JWT_SECRET must be set` / `must be different` | Give each API its own secret in `borrower.env` / `admin.env`, and no `JWT_SECRET` in `shared.env`; see 2.5 |
| 502 on `/api/...` | That API is down: `pm2 ls`, `pm2 logs <name>` |
| Status screen doesn't update | Proxy buffering: the `events` location in `quickloan-locations.conf` must be installed |
| Everyone gets "Too many attempts" together, audit log shows 127.0.0.1 | `TRUST_PROXY=loopback` missing in `shared.env` |
| Borrowers get no login code | Twilio settings missing (`WARNING` in `borrower.error.log`) |
| Staff seed: "Refusing to create staff accounts with default passwords" | Expected in production; give the four passwords (2.9) |
| Upload over 10 MB fails | By design (`MAX_UPLOAD_BYTES`); nginx allows 12 MB |

## 9. Rehearsal record

Rehearsed on 2026-11-09 in a fresh Ubuntu 24.04 container (Node 22.23, nginx 1.24, pm2 5.4), following sections 2.2–2.10 with self-signed certificates and the two names pointing at the container's network address. Results:

- First deploy on an empty database: schema created by the borrower API; 30 smoke checks pass.
- Staff seed refuses without passwords and works with them. The default passwords don't work, and the demo staff-token route is refused.
- End to end through nginx over HTTPS, 29 checks pass:
  - The APIs are not reachable from outside, and HTTP redirects to HTTPS.
  - A borrower registers with the code from the SMS log, uploads documents and submits Step 1.
  - A reviewer opens the uploads and approves on the admin site. The borrower's status stream gets the update in 0.5–1.7 s.
  - A staff Hebrew PDF is generated.
  - Each site refuses the other's tokens.
  - The audit log has the visitor's address, and no tokens appear in the nginx logs.
  - An 11 MB upload gets the API's 400.
- Backup while running, then a restore check: same row counts, integrity `ok`.
- Release, then rollback: both pass the smoke check with no data change.
- Admin API stopped: the borrower site keeps working. Borrower API killed: pm2 restarts it in about 1 s, and the admin site is unaffected.

The rehearsal found and fixed:
- an old-OS incompatibility (Debian 12; Ubuntu 24.04 is now required);
- pm2 log file names;
- dotenv start-up noise;
- a backup name clash when two backups start in the same second.

Not rehearsed: real certificates and DNS, real Twilio/SMTP delivery, a server reboot, and a manual browser walk-through. These are on the go-live checklist.
