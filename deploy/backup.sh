#!/usr/bin/env bash
# Backs up the database and the uploads folder (docs/deployment-runbook.md). Safe while the APIs run:
# sqlite3's .backup takes a consistent copy in WAL mode. Run daily from cron and before every deploy.
#   deploy/backup.sh
set -euo pipefail

env_dir="${QUICKLOAN_ENV_DIR:-/etc/quickloan}"
# shellcheck source=/dev/null
source "$env_dir/deploy.env"
# The process id keeps two backups started in the same second apart.
stamp="$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP_DIR"

if [ -f "$DB_PATH" ]; then
  out="$BACKUP_DIR/database-$stamp.sqlite"
  sqlite3 "$DB_PATH" ".backup '$out'"
  result="$(sqlite3 "$out" 'PRAGMA integrity_check;')"
  if [ "$result" != "ok" ]; then
    echo "Integrity check of the backup failed: $result" >&2
    exit 1
  fi
  gzip "$out"
  echo "Database -> $out.gz"
else
  echo "No database at $DB_PATH yet; skipped."
fi

if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads-$stamp.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  echo "Uploads  -> $BACKUP_DIR/uploads-$stamp.tar.gz"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'database-*.sqlite.gz' -o -name 'uploads-*.tar.gz' \) \
  -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
