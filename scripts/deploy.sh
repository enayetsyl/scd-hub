#!/usr/bin/env bash
# Idempotent deploy: pull -> install -> build -> restart -> health-check, with
# auto-rollback if the new revision is unhealthy. ONE procedure, two callers:
# run by hand over SSH, and invoked by GitHub Actions (DEP-6).
#
#   scripts/deploy.sh [prod|dev]      (default: prod)
#
# Assumes: repo cloned at /opt/scdhub/<env>, systemd unit scdhub-<env>, the
# deploy user has NOPASSWD sudo for systemctl. The server reads its own .env
# (mode 600) from the working dir — never touched here.
set -euo pipefail

ENV="${1:-prod}"
case "$ENV" in
  prod) DIR=/opt/scdhub/prod; BRANCH=main; SVC=scdhub-prod; PORT=4000 ;;
  dev)  DIR=/opt/scdhub/dev;  BRANCH=dev;  SVC=scdhub-dev;  PORT=4001 ;;
  *) echo "usage: $0 [prod|dev]"; exit 2 ;;
esac

say() { echo "[deploy:$ENV] $*"; }
build() {
  npm install --no-audit --no-fund
  npm run build --workspace=shared
  npm run build --workspace=server
  # MON-3 (prd-observability.md §4): web bundle + source-map upload to GlitchTip so
  # stack traces are symbolicated. Debug-IDs (injected by the Sentry metro serializer)
  # match the maps to the bundle, so no release coordination is needed. Guarded by
  # SENTRY_AUTH_TOKEN (a VM-only build secret, never committed) so it's INERT until the
  # operator provides it; the upload is NON-FATAL so a Sentry hiccup never blocks a
  # deploy; the .map files are DELETED after upload so they are never served publicly.
  if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
    ( cd app \
        && npx expo export --platform web --source-maps \
        && { npx sentry-cli sourcemaps upload \
               --url https://errors.scdhub.shafayet.me --org scd --project scdhub-app \
               --release "$(git rev-parse HEAD)" dist \
             || say "sentry sourcemap upload failed (non-fatal)"; } \
        ; find dist -name '*.map' -delete )
  else
    ( cd app && npx expo export --platform web )
  fi
}
healthy() {
  for _ in $(seq 1 15); do
    curl -fsS -m 5 "http://localhost:$PORT/readyz" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

cd "$DIR"
PREV="$(git rev-parse HEAD)"
say "previous=$PREV"
git fetch origin -q
git reset --hard "origin/$BRANCH" -q
say "deploying $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
build
sudo systemctl restart "$SVC"
say "restarted; waiting for /readyz ..."
if healthy; then
  say "HEALTHY at $(git rev-parse --short HEAD)"
else
  say "UNHEALTHY — auto-rolling back to $PREV"
  git reset --hard "$PREV" -q
  build
  sudo systemctl restart "$SVC"
  healthy && say "rolled back, healthy at $PREV" || say "STILL UNHEALTHY after rollback — investigate"
  exit 1
fi
