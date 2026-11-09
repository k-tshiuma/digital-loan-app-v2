#!/usr/bin/env bash
# Docker: backs up the database and uploads while running (docs/docker-deployment.md). Runs deploy/backup.sh
# inside the borrower API container; the files land in BACKUP_DIR on the host. Daily from cron:
#   15 2 * * * /opt/quickloan/app/deploy/docker/backup.sh >> /var/backups/quickloan/backup.log 2>&1
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_dir="${QUICKLOAN_ENV_DIR:-/etc/quickloan}"
cd "$root"
QUICKLOAN_ENV_DIR="$env_dir" docker compose -f deploy/docker/compose.yml --env-file "$env_dir/docker.env" \
  exec -T borrower-api deploy/backup.sh
