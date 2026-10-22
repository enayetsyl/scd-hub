#!/usr/bin/env bash
# Phase 1 (docs/db-on-vm-plan.md §4): harden the VM mongod — users, auth + keyFile,
# single-node replica set rs0, WiredTiger cache 6 GB — then point the book plane at its
# new user. One-shot: copied to the VM /tmp and run with `bash` (refuses a second run).
# Ran 2026-10-22 22:51 Dhaka. Prints no secret values; passwords go to /opt/scdhub/mongo-credentials.env.
set -euo pipefail
STAMP="$(date +%Y%m%dT%H%M%S)"
B="/opt/scdhub/backups/phase1-$STAMP"
CRED=/opt/scdhub/mongo-credentials.env
CONF=/etc/mongod.conf
KEY=/etc/mongod.keyfile
ENVF=/opt/scdhub/prod/.env
say(){ echo "[phase1] $*"; }

# --- 0. preconditions --------------------------------------------------------
if grep -q 'replSetName' "$CONF"; then say "mongod.conf already has a replica set - refusing"; exit 1; fi
if [ -e "$CRED" ]; then say "$CRED already exists - refusing (Phase 1 already ran?)"; exit 1; fi
EXPECTED='storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 1
  dbPath: /var/lib/mongodb
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log
net:
  port: 27017
  bindIp: 127.0.0.1
processManagement:
  timeZoneInfo: /usr/share/zoneinfo'
if [ "$(grep -v '^#' "$CONF" | grep .)" != "$EXPECTED" ]; then
  say "mongod.conf differs from what was inspected - refusing to rewrite it"; exit 1
fi

# --- 1. backups ---------------------------------------------------------------
mkdir -p "$B"; chmod 700 "$B"
sudo cp -p "$CONF" "$B/mongod.conf.orig"
cp -p "$ENVF" "$B/prod.env.orig"; chmod 600 "$B/prod.env.orig"
mongodump --uri="mongodb://127.0.0.1:27017" --archive="$B/local-mongod.archive.gz" --gzip --quiet
say "backups in $B ($(du -sh "$B" | cut -f1))"

# --- 2. passwords (hex: no characters that need URI escaping) ------------------
umask 077
{
  printf 'MONGO_ADMIN_PASSWORD=%s\n'  "$(openssl rand -hex 24)"
  printf 'MONGO_PROD_PASSWORD=%s\n'   "$(openssl rand -hex 24)"
  printf 'MONGO_DEV_PASSWORD=%s\n'    "$(openssl rand -hex 24)"
  printf 'MONGO_BOOKS_PASSWORD=%s\n'  "$(openssl rand -hex 24)"
  printf 'MONGO_BACKUP_PASSWORD=%s\n' "$(openssl rand -hex 24)"
} > "$CRED"
chmod 600 "$CRED"
set -a; . "$CRED"; set +a
say "credentials written to $CRED (mode 600)"

# --- 3. users (auth is still off, so this needs no login) ----------------------
mongosh --quiet "mongodb://127.0.0.1:27017/admin" --eval '
  const e = process.env;
  db.createUser({ user: "admin",         pwd: e.MONGO_ADMIN_PASSWORD,  roles: ["root"] });
  db.createUser({ user: "scdhub_prod",   pwd: e.MONGO_PROD_PASSWORD,   roles: [{ role: "readWrite", db: "scdhub_prod" }] });
  db.createUser({ user: "scdhub_dev",    pwd: e.MONGO_DEV_PASSWORD,    roles: [{ role: "readWrite", db: "scdhub_dev" }] });
  db.createUser({ user: "scdhub_books",  pwd: e.MONGO_BOOKS_PASSWORD,  roles: [{ role: "readWrite", db: "scdhub_books_prod" }] });
  db.createUser({ user: "scdhub_backup", pwd: e.MONGO_BACKUP_PASSWORD, roles: ["backup", "restore"] });
  print("users: " + db.getUsers().users.map(u => u.user).sort().join(", "));'

# --- 4. keyFile (a replica set with auth requires internal authentication) ----
sudo sh -c "openssl rand -base64 756 > $KEY"
sudo chown mongodb:mongodb "$KEY"; sudo chmod 400 "$KEY"

# --- 5. new mongod.conf ---------------------------------------------------------
printf '%s\n' \
  '# SCD Hub (docs/db-on-vm-plan.md Phase 1): auth + keyFile, replica set rs0, 6 GB cache.' \
  'storage:' \
  '  wiredTiger:' \
  '    engineConfig:' \
  '      cacheSizeGB: 6' \
  '  dbPath: /var/lib/mongodb' \
  'systemLog:' \
  '  destination: file' \
  '  logAppend: true' \
  '  path: /var/log/mongodb/mongod.log' \
  'net:' \
  '  port: 27017' \
  '  bindIp: 127.0.0.1' \
  'processManagement:' \
  '  timeZoneInfo: /usr/share/zoneinfo' \
  'security:' \
  '  authorization: enabled' \
  "  keyFile: $KEY" \
  'replication:' \
  '  replSetName: rs0' | sudo tee "$CONF" > /dev/null

# --- 6. restart mongod; roll back the config if it does not come up -------------
sudo systemctl restart mongod
up=0
for i in $(seq 1 30); do
  if mongosh --quiet "mongodb://127.0.0.1:27017/admin" --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; then up=1; break; fi
  sleep 2
done
if [ "$up" != 1 ]; then
  say "mongod did not come up - restoring the old config"
  sudo cp -p "$B/mongod.conf.orig" "$CONF"; sudo systemctl restart mongod
  sudo tail -20 /var/log/mongodb/mongod.log | cut -c1-300
  exit 1
fi
say "mongod up with the new config"

ADMIN_URI="mongodb://admin:${MONGO_ADMIN_PASSWORD}@127.0.0.1:27017/admin?directConnection=true"
mongosh --quiet "$ADMIN_URI" --eval '
  const r = rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] });
  print("rs.initiate ok=" + r.ok);'
for i in $(seq 1 30); do
  st="$(mongosh --quiet "$ADMIN_URI" --eval 'rs.status().myState' 2>/dev/null || true)"
  [ "$st" = "1" ] && break; sleep 2
done
[ "$st" = "1" ] || { say "replica set did not reach PRIMARY (state=$st)"; exit 1; }
say "replica set rs0 PRIMARY"

# --- 7. verify: anonymous access refused, each user scoped -------------------------
if mongosh --quiet "mongodb://127.0.0.1:27017/scdhub_books_prod?directConnection=true" --eval 'db.getCollectionNames().length' >/dev/null 2>&1; then
  say "ANONYMOUS ACCESS STILL WORKS - auth is not enforced"; exit 1
fi
say "anonymous access refused (good)"
BOOK_URI="mongodb://scdhub_books:${MONGO_BOOKS_PASSWORD}@127.0.0.1:27017/scdhub_books_prod?authSource=admin&replicaSet=rs0"
mongosh --quiet "$BOOK_URI" --eval 'print("books collections: " + db.getCollectionNames().length + ", docs in largest: " + Math.max(0, ...db.getCollectionNames().map(c => db.getCollection(c).estimatedDocumentCount())))'
if mongosh --quiet "$BOOK_URI" --eval 'db.getSiblingDB("scdhub_prod").getCollectionNames()' >/dev/null 2>&1; then
  say "books user can read scdhub_prod - scope is wrong"; exit 1
fi
say "books user cannot read other databases (good)"

# --- 8. point the prod app's book plane at its user, restart prod ---------------------
awk -v line="BOOK_MONGODB_URI=$BOOK_URI" '
  /^BOOK_MONGODB_URI=/ { print line; done = 1; next } { print } END { if (!done) print line }' "$ENVF" > "$ENVF.new"
cat "$ENVF.new" > "$ENVF"; rm -f "$ENVF.new"
grep -c '^BOOK_MONGODB_URI=mongodb://scdhub_books:' "$ENVF" >/dev/null || { say "BOOK_MONGODB_URI not updated"; exit 1; }
SINCE="$(date '+%Y-%m-%d %H:%M:%S')"
sudo systemctl restart scdhub-prod
ok=0
for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:4000/readyz >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { say "prod did not become ready - roll back with: cp $B/prod.env.orig $ENVF && sudo systemctl restart scdhub-prod"; exit 1; }
say "prod ready: $(curl -sS http://127.0.0.1:4000/readyz)"
sudo journalctl -u scdhub-prod --since "$SINCE" --no-pager -o cat | grep -E '\[book\]' | tail -3
say "DONE. Rollback material: $B"
