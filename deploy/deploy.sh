#!/usr/bin/env bash
# Deploys a git tag or commit on the server (docs/deployment-runbook.md). Run as the quickloan user:
#   deploy/deploy.sh v1.0.0
# Steps: backup, checkout, npm ci, build both frontends, publish them, restart the borrower API (schema owner)
# then the admin API, smoke check. Rolling back is the same command with the previous tag.
set -euo pipefail

main() {
  local ref="${1:?usage: deploy/deploy.sh <git tag or commit>}"
  local root env_dir
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  env_dir="${QUICKLOAN_ENV_DIR:-/etc/quickloan}"
  # shellcheck source=/dev/null
  source "$env_dir/deploy.env"
  cd "$root"

  step "Backup"
  "$root/deploy/backup.sh"

  step "Checkout $ref"
  git fetch --tags --prune origin
  git checkout --detach "$ref"
  local commit
  commit="$(git rev-parse --short HEAD)"

  step "Install packages"
  npm ci --no-audit --no-fund

  step "Build frontends"
  # The API is on the same site (/api, proxied by nginx); the links between the two sites are absolute.
  VITE_API_URL=/api VITE_ADMIN_URL="$PUBLIC_ADMIN_URL" npm run build -w @quickloan/borrower-frontend
  VITE_API_URL=/api VITE_BORROWER_URL="$PUBLIC_BORROWER_URL" npm run build -w @quickloan/admin-frontend

  step "Publish frontends to $WEB_ROOT"
  publish borrower "$root/borrower-app/frontend/dist"
  publish admin "$root/admin-app/frontend/dist"

  step "Restart APIs"
  # The borrower API owns the schema, so it starts (and adds any new columns) before the admin API.
  pm2 startOrReload deploy/ecosystem.config.js --only quickloan-borrower --update-env
  wait_healthy "$(env_value "$env_dir/borrower.env" BORROWER_PORT 5000)" borrower
  pm2 startOrReload deploy/ecosystem.config.js --only quickloan-admin --update-env
  wait_healthy "$(env_value "$env_dir/admin.env" ADMIN_PORT 5100)" admin
  pm2 save

  step "Smoke check"
  node deploy/smoke.js "$PUBLIC_BORROWER_URL" "$PUBLIC_ADMIN_URL"

  echo "$(date -Is) $ref $commit" >> "$(dirname "$DB_PATH")/deployments.log"
  step "Deployed $ref ($commit)"
}

step() { printf '\n== %s\n' "$*"; }

# Swaps the new build in with two renames, keeping the previous one as <app>.previous.
publish() {
  local app="$1" src="$2" dst="$WEB_ROOT/$1"
  [ -f "$src/index.html" ] || { echo "No build at $src" >&2; exit 1; }
  rm -rf "$dst.next" "$dst.previous"
  cp -r "$src" "$dst.next"
  if [ -d "$dst" ]; then mv "$dst" "$dst.previous"; fi
  mv "$dst.next" "$dst"
  echo "$app -> $dst"
}

# Value of NAME in an env file, or the default.
env_value() {
  local v
  v="$(grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
  echo "${v:-$3}"
}

wait_healthy() {
  local port="$1" name="$2"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/api/health" 2>/dev/null | grep -q "\"service\":\"$name\""; then
      echo "$name API healthy on port $port"
      return 0
    fi
    sleep 1
  done
  echo "$name API did not become healthy on port $port; check: pm2 logs quickloan-$name" >&2
  exit 1
}

# Run main in one go (and exit right after), so the checkout replacing this file can't affect the run.
main "$@"; exit $?
