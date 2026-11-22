#!/usr/bin/env bash
# Idempotent deploy: pull -> install -> build -> restart -> health-check, with
# auto-rollback if the new revision is unhealthy. ONE procedure, two callers:
# run by hand over SSH, and invoked by GitHub Actions (DEP-6).
#
#   scripts/deploy.sh [prod|dev] [sha]   (default: prod, branch tip; CI passes the gated sha)
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
# D-#1651 fast deploy: skip `npm install` and the web export when nothing they depend on changed
# since the LAST SUCCESSFUL one (its commit is kept in .git/, never in the working tree). A failed or
# half-done deploy leaves the marker behind, so the next deploy redoes the step. FORCE_FULL=1 forces
# everything (e.g. after editing the VM-only app/.env, which git can't see).
DEPS_MARK=.git/scd-deploy-deps
WEB_MARK=.git/scd-deploy-web
stale() {   # stale <marker> <pathspec...>: true when HEAD differs from the marker's commit in those paths
  [ "${FORCE_FULL:-0}" = 1 ] && return 0
  local rev; rev="$(cat "$1" 2>/dev/null || true)"
  [ -n "$rev" ] && git cat-file -e "$rev^{commit}" 2>/dev/null || return 0
  shift
  local rc=0; git diff --quiet "$rev" HEAD -- "$@" || rc=$?
  [ "$rc" -ne 0 ]   # 0 = unchanged (fresh); 1 = changed; anything else (a git error) also counts as stale
}
build() {
  # The server's `tsc --build` needs more than Node's default heap on a smaller machine: Node
  # sizes it from RAM, so the 24 GB VM gets ~4 GB but an 8 GB host gets ~2 GB, and the build
  # died there with "JavaScript heap out of memory" (rebuild drill, 2026-10-23, D-#819).
  # Pinning the 4 GB the VM already uses keeps a rebuild on a smaller VM from failing here.
  # 22 Nov 2026: the server build itself outgrew 4 GB (two dev deploys died at the cap, exit 134), so the
  # pin is 6 GB. The VM has 24 GB; the rebuild drill container (8 GB cap) still fits one 6 GB build.
  export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=6144"
  # patches/: the root postinstall runs patch-package, so a patch change needs a reinstall
  if stale "$DEPS_MARK" package.json package-lock.json '*/package.json' patches || [ ! -d node_modules ]; then
    npm install --no-audit --no-fund
    git rev-parse HEAD > "$DEPS_MARK"
  else
    say "dependencies unchanged since $(cut -c1-8 "$DEPS_MARK") — skipping npm install"
  fi
  npm run build --workspace=shared
  npm run build --workspace=server
  # MON-3 (prd-observability.md §4): web bundle + source-map upload to GlitchTip so
  # stack traces are symbolicated. Debug-IDs (injected by the Sentry metro serializer)
  # match the maps to the bundle, so no release coordination is needed. Guarded by
  # SENTRY_AUTH_TOKEN (a VM-only build secret, never committed) so it's INERT until the
  # operator provides it; the upload is NON-FATAL so a Sentry hiccup never blocks a
  # deploy; the .map files are DELETED after upload so they are never served publicly.
  # --clear: Metro's transform cache ignores EXPO_PUBLIC_* values (the VM-only app/.env
  # holds the GlitchTip DSN + EXPO_PUBLIC_ENV) and is likely shared by the prod and dev
  # checkouts — a cached export shipped a bundle with NO DSN on 2026-10-22, and could
  # bake the other env's label. A cold export costs a few minutes; a silent web is worse.
  # The CI deploy's ssh carries no env, so the token also comes from the VM-only
  # app/.env (gitignored, mode 600). Read the one line — never source that file.
  if ! stale "$WEB_MARK" app shared package.json package-lock.json patches && [ -f app/dist/index.html ]; then
    say "app unchanged since $(cut -c1-8 "$WEB_MARK") — keeping the current web bundle"
    return 0
  fi
  if [ -z "${SENTRY_AUTH_TOKEN:-}" ] && [ -f app/.env ]; then
    SENTRY_AUTH_TOKEN="$(sed -n 's/^SENTRY_AUTH_TOKEN=//p' app/.env | tail -1 | tr -d '"\r')"
    export SENTRY_AUTH_TOKEN
  fi
  # D-#1657: the web bundle bakes EXPO_PUBLIC_RELEASE=<sha> (sentry.ts, web only) and the maps are
  # uploaded under that SAME value. The baked value is written next to the export
  # (app/dist/release.txt) and the upload reads it from there, never `git rev-parse HEAD` at upload
  # time: a skipped export leaves an older bundle whose release is older than HEAD.
  # expo export --clear empties dist, so release.txt is written AFTER the export.
  WEB_RELEASE="$(git rev-parse HEAD)"
  if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
    # (as before, a failed export here does not stop the deploy; it now also leaves the marker, so
    # the next deploy retries the export instead of skipping it)
    if ( cd app && EXPO_PUBLIC_RELEASE="$WEB_RELEASE" npx expo export --platform web --clear --source-maps ); then
      git rev-parse HEAD > "$WEB_MARK"
      printf '%s' "$WEB_RELEASE" > app/dist/release.txt
      ( cd app && npx sentry-cli --url https://scdhub-errors.shafayet.me sourcemaps upload \
          --org scd --project scdhub-app --release "$(cat dist/release.txt)" dist ) \
        || say "sentry sourcemap upload failed (non-fatal)"
    else
      say "web export FAILED (non-fatal) — the next deploy will retry it"
    fi
    find app/dist -name '*.map' -delete 2>/dev/null || true
  else
    ( cd app && EXPO_PUBLIC_RELEASE="$WEB_RELEASE" npx expo export --platform web --clear )
    git rev-parse HEAD > "$WEB_MARK"
    printf '%s' "$WEB_RELEASE" > app/dist/release.txt
  fi
}
# AI Workspace job worker (W-4, D-#1251): restart it with the API so it never runs old code.
# Only when its unit is installed on this host (ops/systemd/scdhub-ai-worker-<env>.service);
# NON-FATAL — a worker problem must never fail or roll back a deploy of the API.
restart_worker() {
  local w="scdhub-ai-worker-$ENV"
  if systemctl list-unit-files "$w.service" --no-legend 2>/dev/null | grep -q "^$w.service"; then
    sudo systemctl restart "$w" && say "restarted $w" || say "$w restart failed (non-fatal)"
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
# D-#1651: CI passes the exact commit it gated (scripts/deploy.sh <env> <sha>), so a newer, not-yet-tested
# push to the branch can never ride along. The commit must be on the branch. No sha = branch tip (manual use).
TARGET="${2:-origin/$BRANCH}"
if [ -n "${2:-}" ]; then
  git cat-file -e "$TARGET^{commit}" 2>/dev/null || { say "commit $TARGET not found after fetch"; exit 1; }
  git merge-base --is-ancestor "$TARGET" "origin/$BRANCH" || { say "commit $TARGET is not on origin/$BRANCH — refusing"; exit 1; }
fi
git reset --hard "$TARGET" -q
say "deploying $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
build
sudo systemctl restart "$SVC"
say "restarted; waiting for /readyz ..."
if healthy; then
  say "HEALTHY at $(git rev-parse --short HEAD)"
  restart_worker
else
  say "UNHEALTHY — auto-rolling back to $PREV"
  git reset --hard "$PREV" -q
  build
  sudo systemctl restart "$SVC"
  healthy && say "rolled back, healthy at $PREV" || say "STILL UNHEALTHY after rollback — investigate"
  restart_worker
  exit 1
fi
