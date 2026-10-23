#!/usr/bin/env bash
# Rebuild DRILL without a second VM (docs/runbook-vm-rebuild.md §5, D-#819): rebuild SCD Hub
# from nothing inside a throwaway Ubuntu 24.04 container ON THE CURRENT VM — same OS, same
# CPU architecture — and restore the newest Drive backup into it. Proves the bootstrap
# script, the restore and an app boot on restored data, and times each step.
#
#   bash scripts/vm-drill.sh [git-ref]      (run as deploy on the VM; default ref: main)
#   KEEP=1 bash scripts/vm-drill.sh ...     (leave the container for inspection)
#
# SAFETY — the restored data is the real school:
#   * the container's .env points ONLY at the container's own mongod; alert/book/backup
#     settings are stripped;
#   * its network is DISCONNECTED before the app starts, so the scheduler cannot send a
#     single push, email or Drive call, whatever the code tries;
#   * CPU/RAM are capped so prod keeps its headroom; nothing is published on a host port.
# Not covered (runbook walk-through only): VM provisioning, Caddy/TLS, Cloudflare DNS.
set -euo pipefail
REF="${1:-main}"
NAME=scdhub-drill
REPO_URL=https://github.com/enayetsyl/scd-hub.git
T0=$(date +%s); LAST=$T0
lap(){ local now; now=$(date +%s); printf '[drill] %-44s %4ss  (total %ss)\n' "$1" $((now - LAST)) $((now - T0)); LAST=$now; }
in(){ docker exec "$NAME" bash -lc "$1"; }

docker rm -f "$NAME" >/dev/null 2>&1 || true
cleanup(){ [ "${KEEP:-0}" = 1 ] && echo "[drill] KEEP=1 - container $NAME left running" || docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" --cpus 2 --memory 8g ubuntu:24.04 sleep infinity >/dev/null
lap "container up (ubuntu:24.04, 2 CPU / 8 GB cap)"

in "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ca-certificates curl >/dev/null \
    && git clone -q --depth 1 --branch '$REF' $REPO_URL /opt/scdhub/prod"
lap "clone $REF"

# The secrets kit, as the drill's stand-in: same files the kit holds, taken from this VM.
docker exec "$NAME" mkdir -p /opt/scdhub
docker cp /opt/scdhub/mongo-credentials.env "$NAME":/opt/scdhub/mongo-credentials.env
set -a; . /opt/scdhub/mongo-credentials.env; set +a
LOCAL_URI="mongodb://scdhub_prod:${MONGO_PROD_PASSWORD}@127.0.0.1:27017/scdhub_prod?authSource=admin&replicaSet=rs0"
grep -vE '^(MONGODB_URI|BOOK_MONGODB_URI|BACKUP_MONGODB_URI|ALERT_EMAIL|ALERT_SMTP_URL|PORT)=' /opt/scdhub/prod/.env \
  | { cat; echo "MONGODB_URI=$LOCAL_URI"; echo "PORT=4000"; } > /tmp/drill.env
docker cp /tmp/drill.env "$NAME":/opt/scdhub/prod/.env; rm -f /tmp/drill.env
in "chmod 600 /opt/scdhub/prod/.env"
lap "kit material in place (.env -> container mongod only)"

in "bash /opt/scdhub/prod/scripts/vm-bootstrap.sh --drill" | sed 's/^/    /'
lap "vm-bootstrap.sh --drill (node, mongo, users, rs0)"

in "cd /opt/scdhub/prod && npm install --no-audit --no-fund >/tmp/npm.log 2>&1 && npm run build --workspace=shared >/dev/null && npm run build --workspace=server >/dev/null"
lap "npm install + build shared + server"

in "cd /opt/scdhub/prod/app && npx expo export --platform web --clear >/tmp/export.log 2>&1 && test -f dist/index.html"
lap "web export (expo, --clear)"

in "cd /opt/scdhub/prod && node scripts/restore-fetch.mjs latest /tmp/restore.archive.gz" | sed 's/^/    /'
lap "download newest backup from Drive"

ADMIN="mongodb://admin:${MONGO_ADMIN_PASSWORD}@127.0.0.1:27017/?authSource=admin&replicaSet=rs0"
in "mongorestore --uri='$ADMIN' --archive=/tmp/restore.archive.gz --gzip --drop --nsInclude='scdhub_prod.*' 2>&1 | grep -E 'restored successfully|failed to restore' | tail -1" | sed 's/^/    /'
lap "mongorestore into the container's mongod"

# ---- cut the network BEFORE the app (and its scheduler) starts ----
for net in $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$NAME"); do
  docker network disconnect "$net" "$NAME"
done
if in "curl -s -m 5 -o /dev/null https://www.google.com"; then echo "NETWORK STILL UP - refusing to start the app"; exit 1; fi
lap "network disconnected (verified: no egress)"

in "cd /opt/scdhub/prod && (NODE_ENV=production TZ=Asia/Dhaka nohup node server/dist/index.js >/tmp/app.log 2>&1 &) \
    && for i in \$(seq 1 60); do curl -fsS -m 3 http://127.0.0.1:4000/readyz >/dev/null 2>&1 && exit 0; sleep 2; done; tail -20 /tmp/app.log; exit 1"
lap "app started, /readyz ok"

echo "[drill] smoke checks:"
in "curl -s -m 5 http://127.0.0.1:4000/readyz; echo"
in "curl -s -m 5 -H 'content-type: application/json' -d '{\"query\":\"{ __typename }\"}' http://127.0.0.1:4000/graphql; echo"
in "mongosh --quiet '$LOCAL_URI' --eval 'const d = db; print(\"collections: \" + d.getCollectionNames().length + \", students: \" + d.students.countDocuments() + \", users: \" + d.users.countDocuments() + \", attendance days: \" + d.studentattendancedays.countDocuments())'"
in "test -f /opt/scdhub/prod/app/dist/index.html && echo 'web bundle: app/dist/index.html present'"
in "grep -ciE 'error|fatal' /tmp/app.log | xargs -I{} echo 'app log error/fatal lines: {}'"
lap "smoke checks"
echo "[drill] DONE in $(( $(date +%s) - T0 ))s - add the per-step times to docs/runbook-vm-rebuild.md §6"
