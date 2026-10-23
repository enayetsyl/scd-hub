#!/usr/bin/env bash
# DB-on-VM Phase 4 — RAN 2026-10-23 (dev 21:54, prod 21:56; D-#817). (docs/db-on-vm-plan.md §7): move one environment's database from Atlas
# to the VM's own mongod. Same steps for dev (the rehearsal) and prod (the cutover):
#   stop app -> dump Atlas -> restore locally -> compare EVERY collection's documents and
#   indexes -> switch .env -> start -> verify. Atlas is never written to or dropped, so
#   rollback is: cp the saved .env back + restart.
#   bash phase4-move-db.sh dev|prod
set -euo pipefail
ENV="${1:?usage: phase4-move-db.sh dev|prod}"
case "$ENV" in
  dev)  DB=scdhub_dev;  SVC=scdhub-dev;  PORT=4001; USERVAR=MONGO_DEV_PASSWORD;  DBUSER=scdhub_dev ;;
  prod) DB=scdhub_prod; SVC=scdhub-prod; PORT=4000; USERVAR=MONGO_PROD_PASSWORD; DBUSER=scdhub_prod ;;
  *) echo "dev|prod"; exit 2 ;;
esac
ENVF="/opt/scdhub/$ENV/.env"
STAMP="$(date +%Y%m%dT%H%M%S)"
OUT="/opt/scdhub/backups/phase4-$ENV-$STAMP"
T0=$(date +%s)
say(){ echo "[phase4:$ENV +$(( $(date +%s) - T0 ))s] $*"; }

set -a; . /opt/scdhub/mongo-credentials.env; set +a
ADMIN="mongodb://admin:${MONGO_ADMIN_PASSWORD}@127.0.0.1:27017/?authSource=admin&replicaSet=rs0"
LOCAL="mongodb://${DBUSER}:${!USERVAR}@127.0.0.1:27017/${DB}?authSource=admin&replicaSet=rs0"
ATLAS="$(grep -E '^MONGODB_URI=' "$ENVF" | head -1 | cut -d= -f2-)"

# ---- preconditions ----------------------------------------------------------------
case "$ATLAS" in *mongodb.net*"/$DB"*) ;; *) say "MONGODB_URI is not Atlas $DB - already moved? refusing"; exit 1 ;; esac
if mongosh --quiet "$ADMIN" --eval "db.getMongo().getDBNames().includes('$DB')" </dev/null | grep -q true; then
  say "local $DB already exists - refusing to overwrite"; exit 1
fi
mkdir -p "$OUT"; chmod 700 "$OUT"
cp -p "$ENVF" "$OUT/$ENV.env.orig"
say "rollback copy of .env: $OUT/$ENV.env.orig"

restart_on_atlas(){ say "ABORT: $1 - restarting $SVC on Atlas (.env unchanged)"; cp -p "$OUT/$ENV.env.orig" "$ENVF"; sudo systemctl start "$SVC"; exit 1; }

# ---- 1. stop the app: no writes during the copy ----------------------------------
sudo systemctl stop "$SVC"
say "stopped $SVC"

# ---- 2. dump Atlas ------------------------------------------------------------------
mongodump --uri="$ATLAS" --archive="$OUT/$DB.archive.gz" --gzip --quiet </dev/null || restart_on_atlas "mongodump failed"
say "dumped Atlas $DB ($(du -h "$OUT/$DB.archive.gz" | cut -f1))"

# ---- 3. restore into the VM mongod -------------------------------------------------------
R="$(mongorestore --uri="$ADMIN" --archive="$OUT/$DB.archive.gz" --gzip --nsInclude="$DB.*" </dev/null 2>&1 | grep -E 'restored successfully|failed to restore' | tail -1)"
say "restore: $R"
echo "$R" | grep -q ' 0 document(s) failed' || restart_on_atlas "restore reported failures"

# ---- 4. compare every collection: documents + indexes --------------------------------------
COUNT='db.getCollectionNames().filter(c => !c.startsWith("system.")).sort().map(c => c + " docs=" + db.getCollection(c).countDocuments() + " idx=" + db.getCollection(c).getIndexes().length).join("\n")'
mongosh --quiet "$ATLAS" --eval "$COUNT" </dev/null > "$OUT/atlas.counts" || restart_on_atlas "could not count Atlas"
mongosh --quiet "$LOCAL" --eval "$COUNT" </dev/null > "$OUT/local.counts" || restart_on_atlas "could not count local (user/permissions?)"
if ! diff "$OUT/atlas.counts" "$OUT/local.counts" > "$OUT/counts.diff"; then
  head -20 "$OUT/counts.diff"; restart_on_atlas "collection counts differ"
fi
say "counts match: $(wc -l < "$OUT/local.counts") collections, $(awk -F'docs=' '{split($2,a," "); s+=a[1]} END {print s}' "$OUT/local.counts") documents, indexes equal"

# ---- 5. switch .env -----------------------------------------------------------------------
setkv(){ awk -v k="$1" -v line="$1=$2" 'BEGIN{d=0} $0 ~ "^" k "=" {print line; d=1; next} {print} END{if(!d) print line}' "$ENVF" > "$ENVF.new" && cat "$ENVF.new" > "$ENVF" && rm -f "$ENVF.new"; }
setkv MONGODB_URI "$LOCAL"
# System Health's DB card compared against Atlas M0's 512 MB; the local budget until Phase 5.
setkv ATLAS_STORAGE_LIMIT_MB 40960
if [ "$ENV" = prod ]; then
  setkv BACKUP_MONGODB_URI "mongodb://scdhub_backup:${MONGO_BACKUP_PASSWORD}@127.0.0.1:27017/${DB}?authSource=admin&replicaSet=rs0"
fi
say ".env switched to the VM mongod"

# ---- 6. start + verify ------------------------------------------------------------------------
SINCE="$(date '+%Y-%m-%d %H:%M:%S')"
sudo systemctl start "$SVC"
ok=0; for _ in $(seq 1 45); do curl -fsS -m 3 "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1 && { ok=1; break; }; sleep 2; done
[ "$ok" = 1 ] || { sudo systemctl stop "$SVC"; restart_on_atlas "/readyz never came up on the VM mongod"; }
say "$SVC ready: $(curl -sS "http://127.0.0.1:$PORT/readyz")"
say "graphql: $(curl -sS -m 5 -H 'content-type: application/json' -d '{"query":"{ __typename }"}' "http://127.0.0.1:$PORT/graphql")"
ERR="$(sudo journalctl -u "$SVC" --since "$SINCE" --no-pager -o cat | grep -ciE 'mongo.*(error|fail)|MongoServerError|Unauthorized|not authorized' || true)"
say "mongo/auth errors in the $SVC log since start: $ERR"
[ "$ERR" = 0 ] || sudo journalctl -u "$SVC" --since "$SINCE" --no-pager -o cat | grep -iE 'mongo.*(error|fail)|MongoServerError|Unauthorized|not authorized' | head -5
say "DONE. Rollback: cp $OUT/$ENV.env.orig $ENVF && sudo systemctl restart $SVC"
