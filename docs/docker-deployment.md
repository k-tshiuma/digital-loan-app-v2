# Docker Deployment

How to run QuickLoan with Docker on one host: three containers (borrower API, admin API, nginx) and one data volume. It replaces the pm2 and host-nginx setup in [deployment-runbook.md](deployment-runbook.md) and uses the same settings files. Read that runbook too: what the settings mean, the go-live checklist and the troubleshooting table all apply. Rehearsed on 2026-11-09 (see [Rehearsal record](#8-rehearsal-record)).

The files are in `deploy/docker/`:

| File | Purpose |
| --- | --- |
| `Dockerfile` | Two images: `api` (both APIs) and `web` (nginx with both built frontends) |
| `compose.yml` | The three containers, the data volume, health checks, restart policy |
| `nginx.conf.template` | The two sites (same as `deploy/nginx/quickloan.conf`, with the container names). Uses `deploy/nginx/quickloan-locations.conf` |
| `deploy.sh <tag>` | Backup, checkout, build, start in order, smoke check |
| `backup.sh` | Online backup into `BACKUP_DIR` on the host |
| `deploy/env/docker.env.example` | Template for `/etc/quickloan/docker.env` (names, ports, folders) |

## 1. What runs where

| Part | Where | Public address |
| --- | --- | --- |
| nginx + both built frontends | container `web`, ports 80 and 443 | `https://app.example.com`, `https://admin.example.com` |
| Borrower API | container `borrower-api`, port 5000 inside the Docker network only | `https://app.example.com/api` |
| Admin API | container `admin-api`, port 5100 inside the Docker network only | `https://admin.example.com/api` |
| Database, uploads | Docker volume `quickloan_data`, mounted at `/var/lib/quickloan` in both APIs | – |
| Settings | `/etc/quickloan/{docker,shared,borrower,admin}.env`, `/etc/quickloan/admin-access.conf` | – |
| Certificates | `/etc/letsencrypt` on the host (certbot), read-only in `web` | – |
| Code | `/opt/quickloan/app` (git checkout; images are built from it) | – |
| Logs | `docker compose logs` (10 MB × 5 files per container) | – |
| Backups, deploy history | `/var/backups/quickloan/` on the host | – |

The rules from the pm2 setup still hold: one host (the volume is local; never NFS), one container per API (never `--scale`), each site calls its own API on `/api`.

## 2. One-time setup

### 2.1 Host

Any Linux host with Docker Engine and the compose plugin (Ubuntu 24.04 recommended; 1 vCPU / 2 GB RAM is enough, the image build needs about 1 GB). The images bring their own Node and nginx. Firewall: only SSH, 80 and 443.

```bash
curl -fsSL https://get.docker.com | sudo sh        # Docker Engine + compose plugin
sudo apt-get install -y git certbot
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

Docker publishes ports through its own firewall rules, past ufw. Only `web` publishes ports (80, 443), so that is fine; don't add `ports:` to the API containers.

### 2.2 User, folders, code

```bash
sudo useradd --create-home --shell /bin/bash --groups docker quickloan
sudo mkdir -p /opt/quickloan /etc/quickloan /var/backups/quickloan
sudo chown quickloan:quickloan /opt/quickloan
sudo chown 1000:1000 /var/backups/quickloan          # the containers run as uid 1000
sudo -iu quickloan git clone git@github.com:k-tshiuma/digital-loan-app-v2.git /opt/quickloan/app
```

Membership of the `docker` group is equivalent to root on this host; only the deploy user gets it.

### 2.3 Settings

```bash
cd /opt/quickloan/app
for f in docker shared borrower admin; do sudo cp deploy/env/$f.env.example /etc/quickloan/$f.env; done
sudo cp deploy/nginx/quickloan-admin-access.conf /etc/quickloan/admin-access.conf
sudo chown root:quickloan /etc/quickloan/* && sudo chmod 640 /etc/quickloan/*
```

- `docker.env`: the two names and public URLs. The rest can stay.
- `borrower.env`, `admin.env`, `shared.env`: as in [deployment-runbook.md 2.5](deployment-runbook.md#25-settings) (two different JWT secrets, Twilio, SMTP). `LISTEN_HOST`, `TRUST_PROXY`, `DB_PATH`, `UPLOAD_DIR` and the ports in those files are ignored: `compose.yml` sets the container values.
- `admin-access.conf`: the office/VPN limit for the admin site, as in [deployment-runbook.md 2.7 step 4](deployment-runbook.md#27-dns-certificates-nginx); `ADMIN_ALLOWED_IPS` goes in `admin.env`. Edit it, then `docker compose ... restart web` (see 4.2 for the command prefix).

### 2.4 DNS and certificates

Point both names at the host, then get one certificate per name. certbot's standalone mode needs port 80, so the hooks stop the `web` container for a few seconds at each renewal:

```bash
for d in app.example.com admin.example.com; do
  sudo certbot certonly --standalone -d $d \
    --pre-hook "docker stop quickloan-web-1 || true" --post-hook "docker start quickloan-web-1 || true"
done
```

(The first time, `web` doesn't exist yet and the hooks do nothing.)

### 2.5 First deploy

```bash
sudo -iu quickloan
cd /opt/quickloan/app && deploy/docker/deploy.sh v1.0.0      # any tag or commit
```

The borrower API creates the schema in the empty volume on first start. Containers restart on their own after a crash or a reboot (`restart: unless-stopped`; Docker itself starts on boot).

### 2.6 Staff accounts

```bash
cd /opt/quickloan/app
read -rs ADMIN_INITIAL_PASSWORD; read -rs REVIEWER_INITIAL_PASSWORD
read -rs SERVICE_INITIAL_PASSWORD; read -rs FUNDING_INITIAL_PASSWORD
export ADMIN_INITIAL_PASSWORD REVIEWER_INITIAL_PASSWORD SERVICE_INITIAL_PASSWORD FUNDING_INITIAL_PASSWORD
docker compose -f deploy/docker/compose.yml --env-file /etc/quickloan/docker.env run --rm --no-deps \
  -e ADMIN_INITIAL_PASSWORD -e REVIEWER_INITIAL_PASSWORD -e SERVICE_INITIAL_PASSWORD -e FUNDING_INITIAL_PASSWORD \
  admin-api node admin-app/backend/scripts/seed_staff.js
```

Without the four passwords it refuses (production mode).

### 2.7 Daily backups

```bash
sudo -iu quickloan crontab -e
# add:
15 2 * * * /opt/quickloan/app/deploy/docker/backup.sh >> /var/backups/quickloan/backup.log 2>&1
```

Copy `/var/backups/quickloan` off the host too.

### 2.8 Check the visitor address

Rate limits, the audit log and `ADMIN_ALLOWED_IPS` use the visitor's address, which nginx passes on. After the first deploy, sign in on the admin site from outside and look at the latest audit entry (or `docker compose ... logs web`): it must show your public address. If it shows a `172.x.x.x` address (Docker's gateway), Docker is forwarding through its user-space proxy, which happens on Docker Desktop and for IPv6 visitors. Fix: in `/etc/docker/daemon.json` set `{"userland-proxy": false}`, then `sudo systemctl restart docker`. Until then, everyone shares one rate-limit counter, and the admin network limit can't tell addresses apart.

## 3. Go-live checklist

The one in [deployment-runbook.md 3](deployment-runbook.md#3-go-live-checklist), with these changes: `docker compose ... logs borrower-api admin-api` instead of `pm2 logs`; reboot the host once and check both sites come back; and 2.8 above (visitor address).

## 4. Day to day

### 4.1 Releasing and rolling back

```bash
# on your machine
git tag v1.0.1 && git push origin v1.0.1
# on the host
sudo -iu quickloan bash -c 'cd /opt/quickloan/app && deploy/docker/deploy.sh v1.0.1'
```

`deploy.sh` backs up (if running), checks out the tag, builds both images (tagged `<tag>-<commit>` and `latest`), starts the borrower API and waits until it is healthy, then the admin API, then nginx, runs `deploy/smoke.js` from the host's network and appends to `/var/backups/quickloan/deployments.log`. Only changed containers are replaced. nginx follows the API containers to their new addresses by itself.

Rollback: `cat /var/backups/quickloan/deployments.log`, then `deploy/docker/deploy.sh <previous tag>`. The previous images are still on the host, so the build is fast. Remove old ones now and then with `docker image prune`.

Smoke check options: `SMOKE_NETWORK=quickloan_default` runs it inside the containers' network, where the two names point at nginx (useful before DNS is set up); `SMOKE_INSECURE_TLS=1` accepts self-signed certificates.

### 4.2 Commands

Every command needs the compose file and the settings:

```bash
cd /opt/quickloan/app
alias qc='docker compose -f deploy/docker/compose.yml --env-file /etc/quickloan/docker.env'
qc ps                       # state and health of the three containers
qc logs -f --tail 100 borrower-api
qc restart admin-api        # e.g. after editing admin.env
qc exec borrower-api sqlite3 /var/lib/quickloan/database.sqlite 'select count(*) from applications;'
```

### 4.3 Restoring a backup

```bash
cd /opt/quickloan/app
qc stop borrower-api admin-api
qc run --rm --no-deps borrower-api sh -c '
  cd /var/lib/quickloan && mv database.sqlite database.sqlite.broken && rm -f database.sqlite-wal database.sqlite-shm &&
  gunzip -c /var/backups/quickloan/database-<stamp>.sqlite.gz > database.sqlite &&
  sqlite3 database.sqlite "PRAGMA integrity_check;"'                     # must print ok
# uploads, if needed:
qc run --rm --no-deps borrower-api sh -c '
  cd /var/lib/quickloan && mv uploads uploads.broken && tar -xzf /var/backups/quickloan/uploads-<stamp>.tar.gz'
qc up -d --wait borrower-api && qc up -d --wait admin-api
```

### 4.4 Moving from the pm2 setup

Stop pm2 and the host nginx (`pm2 stop all && sudo systemctl disable --now nginx`), back up, then copy the data into the volume before the first Docker deploy:

```bash
qc run --rm --no-deps -v /var/lib/quickloan:/old:ro borrower-api sh -c \
  'sqlite3 /old/database.sqlite ".backup /var/lib/quickloan/database.sqlite" && cp -r /old/uploads/. /var/lib/quickloan/uploads/'
```

## 5. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `deploy.sh`: `Missing /etc/quickloan/docker.env` | See 2.3 |
| compose: `set BORROWER_HOST in docker.env` (or another name) | That value is missing in `docker.env` |
| `web` keeps restarting, log says `cannot load certificate` | No certificate for a name in `docker.env`; see 2.4 |
| `pull access denied for quickloan-api` | No image built yet: run `deploy.sh` once (it builds and tags `latest`) |
| 502 on one site's `/api` | That API container is down or unhealthy: `qc ps`, `qc logs <name>` |
| Backup fails with `Permission denied` | `/var/backups/quickloan` must belong to uid 1000; see 2.2 |
| Everyone gets "Too many attempts" together; audit shows `172.x` | Visitor address lost; see 2.8 |

Everything else: [deployment-runbook.md 8](deployment-runbook.md#8-troubleshooting).

## 6. How it differs from the pm2 setup

- Node, nginx and SQLite come in the images (Node 22 on Debian 13, nginx 1.28), so the host needs only Docker.
- The APIs listen on `0.0.0.0` inside their containers, which are not published; only nginx can reach them. `TRUST_PROXY=uniquelocal` trusts private addresses (the Docker network).
- Logs go to Docker (`qc logs`), not `/var/log/quickloan`; nginx logs still leave out query strings.
- A release builds new images instead of updating files in place. The images for each release stay until pruned.

## 7. Keeping it in step

- `nginx.conf.template` and `deploy/nginx/quickloan.conf` describe the same two sites; change both. The location rules (`quickloan-locations.conf`) and the admin access file are shared.
- New settings for the APIs go in `deploy/env/*.env.example` as before; container-only overrides in `compose.yml` (`environment`).

## 8. Rehearsal record

Rehearsed on 2026-11-09 with Docker 29.9 on Docker Desktop (Windows), using `deploy.sh` from the working tree (`SKIP_CHECKOUT=1`), the env templates with generated secrets, self-signed certificates for `app.example.com` / `admin.example.com`, and the smoke check inside the containers' network. Results:

- First deploy on an empty volume: images built, schema created by the borrower API, all 30 smoke checks pass.
- Staff seed refuses without passwords and works with them.
- End to end through nginx over HTTPS, 20 checks pass:
  - HTTP redirects to HTTPS.
  - A borrower registers with the code from the SMS log, uploads documents and submits Step 1.
  - An 11 MB upload gets the API's 400.
  - The demo staff-token route and the default staff passwords are refused.
  - A reviewer sees the application, opens the upload (same volume) and approves. The borrower's status stream gets the update (3.1 s; the poller checks every 5 s).
  - A staff Hebrew PDF is generated.
  - Each site refuses the other's tokens, and no tokens appear in the nginx log.
- Backup while running, then a restore into the volume: integrity `ok`, same row counts, smoke check passes.
- Release, then rollback: both pass the smoke check with no data change.
- Admin API stopped: the borrower site keeps working and the admin site's API answers 502; it is back seconds after starting. The borrower API process killed: Docker restarts it in under 1 s, and the admin site is unaffected.

Found and fixed during the rehearsal: plain `docker compose` commands looked for a `latest` image that didn't exist (`deploy.sh` now tags it).

Not rehearsed: a Linux host, real certificates and DNS, real Twilio/SMTP, a host reboot. On Docker Desktop the audit log showed Docker's gateway address instead of the visitor's (see 2.8): check it on the real host.
