#!/usr/bin/env bash
# Deploys a git tag or commit with Docker (docs/docker-deployment.md). Run from the checkout on the server:
#   deploy/docker/deploy.sh v1.0.0
# Steps: backup (if running), checkout, build the images, start the borrower API (schema owner), then the
# admin API, then nginx, smoke check. Rolling back is the same command with the previous tag.
set -euo pipefail

main() {
  local ref="${1:?usage: deploy/docker/deploy.sh <git tag or commit>}"
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  ENV_DIR="${QUICKLOAN_ENV_DIR:-/etc/quickloan}"
  [ -f "$ENV_DIR/docker.env" ] || { echo "Missing $ENV_DIR/docker.env (copy deploy/env/docker.env.example)" >&2; exit 1; }
  # shellcheck source=/dev/null
  set -a; source "$ENV_DIR/docker.env"; set +a
  export QUICKLOAN_ENV_DIR="$ENV_DIR"
  cd "$root"

  if [ -n "$(compose ps -q borrower-api 2>/dev/null)" ]; then
    step "Backup"
    compose exec -T borrower-api deploy/backup.sh
  fi

  if [ "${SKIP_CHECKOUT:-}" != "1" ]; then
    step "Checkout $ref"
    git fetch --tags --prune origin
    git checkout --detach "$ref"
  fi
  local commit
  commit="$(git rev-parse --short HEAD)"
  # Images are tagged per release, so the previous release's images stay on the host for a quick rollback.
  export QUICKLOAN_TAG="${ref//\//-}-$commit"

  step "Build images ($QUICKLOAN_TAG)"
  compose build
  # :latest is the release running now, so plain `docker compose ...` commands (staff seed, backup) use it.
  docker tag "quickloan-api:$QUICKLOAN_TAG" quickloan-api:latest
  docker tag "quickloan-web:$QUICKLOAN_TAG" quickloan-web:latest

  step "Start containers"
  # The borrower API owns the schema, so it starts (and adds any new columns) before the admin API.
  compose up -d --wait borrower-api
  compose up -d --wait admin-api
  compose up -d --wait web

  step "Smoke check"
  # Default: from the host's network, like a visitor. SMOKE_NETWORK=quickloan_default runs it inside the
  # containers' network instead, where the two public names point at nginx (no DNS needed, e.g. a rehearsal).
  docker run --rm --network "${SMOKE_NETWORK:-host}" \
    -e NODE_TLS_REJECT_UNAUTHORIZED="${SMOKE_INSECURE_TLS:+0}" \
    "quickloan-api:$QUICKLOAN_TAG" node deploy/smoke.js "$PUBLIC_BORROWER_URL" "$PUBLIC_ADMIN_URL"

  echo "$(date -Is) $ref $commit" >> "${BACKUP_DIR:-/var/backups/quickloan}/deployments.log"
  step "Deployed $ref ($commit)"
}

compose() { docker compose -f deploy/docker/compose.yml --env-file "$ENV_DIR/docker.env" "$@"; }
step() { printf '\n== %s\n' "$*"; }

# Run main in one go (and exit right after), so the checkout replacing this file can't affect the run.
main "$@"; exit $?
