#!/usr/bin/env bash
# Manual rollback: reset to a previous revision and redeploy.
#
#   scripts/rollback.sh [prod|dev] [git-ref]
#     env default: prod
#     ref default: HEAD~1  (the commit before the current one)
#
# For the production lane the canonical rollback is "revert the merge commit on
# main and push" (Actions redeploys via deploy.sh). This script is the direct
# over-SSH equivalent for when you need it immediately.
set -euo pipefail

ENV="${1:-prod}"
REF="${2:-HEAD~1}"
case "$ENV" in
  prod) DIR=/opt/scdhub/prod; SVC=scdhub-prod; PORT=4000 ;;
  dev)  DIR=/opt/scdhub/dev;  SVC=scdhub-dev;  PORT=4001 ;;
  *) echo "usage: $0 [prod|dev] [git-ref]"; exit 2 ;;
esac

cd "$DIR"
TARGET="$(git rev-parse "$REF")"
echo "[rollback:$ENV] resetting to $TARGET ($(git log -1 --format=%s "$TARGET"))"
git reset --hard "$TARGET" -q
npm install --no-audit --no-fund
npm run build --workspace=shared
npm run build --workspace=server
( cd app && npx expo export --platform web )
sudo systemctl restart "$SVC"
for _ in $(seq 1 15); do
  curl -fsS -m 5 "http://localhost:$PORT/readyz" >/dev/null 2>&1 && { echo "[rollback:$ENV] HEALTHY at $(git rev-parse --short HEAD)"; exit 0; }
  sleep 2
done
echo "[rollback:$ENV] UNHEALTHY after rollback — investigate"; exit 1
