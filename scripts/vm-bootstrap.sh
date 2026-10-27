#!/usr/bin/env bash
# Prepare a FRESH Ubuntu 24.04 host (ARM or x86) to run SCD Hub — docs/runbook-vm-rebuild.md
# step 3 (DB-on-VM plan Phase 3, D-#819). Idempotent: safe to re-run after a partial failure.
#
#   sudo bash scripts/vm-bootstrap.sh            # a real VM
#   sudo bash scripts/vm-bootstrap.sh --drill    # inside a container (scripts/vm-drill.sh):
#                                                #   no systemd / ufw / sshd / cron / Caddy / Docker
#
# Run from a clone of this repo (it installs ops/mongod.conf + ops/systemd/*). It needs the
# kit's /opt/scdhub/mongo-credentials.env to recreate the SAME Mongo users (so the .env URIs
# from the kit keep working); without it, it generates new passwords and says so.
# It never writes app .env files, never restores data, never starts the app — those are
# runbook steps, because they need the secrets kit and a decision about which backup.
set -euo pipefail

DRILL=0
[ "${1:-}" = "--drill" ] && DRILL=1
[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash $0"; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CRED=/opt/scdhub/mongo-credentials.env
CONF=/etc/mongod.conf
KEY=/etc/mongod.keyfile
export DEBIAN_FRONTEND=noninteractive
step(){ echo; echo "=== $*"; }

. /etc/os-release
[ "$VERSION_ID" = "24.04" ] || echo "WARN: written for Ubuntu 24.04; this is $PRETTY_NAME"

step "1/8 base packages + Asia/Dhaka timezone"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git openssl tzdata python3 python3-jsonschema rsync poppler-utils >/dev/null
ln -sf /usr/share/zoneinfo/Asia/Dhaka /etc/localtime
echo Asia/Dhaka > /etc/timezone

step "2/8 Node.js 20 (NodeSource)"
if ! node -v 2>/dev/null | grep -q '^v20\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

step "3/8 MongoDB 8.0 (mongod + mongosh + database tools)"
if ! command -v mongod >/dev/null; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --batch --yes --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-8.0.list
  apt-get update -qq
  apt-get install -y -qq mongodb-org >/dev/null
fi
mongod --version | head -1

step "4/8 /opt/scdhub layout + deploy user"
mkdir -p /opt/scdhub/backups/hourly /opt/scdhub/downloads
if [ "$DRILL" = 0 ]; then
  id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
  echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy && chmod 440 /etc/sudoers.d/deploy
  printf 'PasswordAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/99-hardening.conf
  systemctl reload ssh || systemctl reload sshd || true
  chown -R deploy:deploy /opt/scdhub
fi

step "5/8 mongod: users first (auth off), then auth + keyFile + replica set rs0"
if [ ! -f "$CRED" ]; then
  umask 077
  for k in ADMIN PROD DEV BOOKS BACKUP; do printf 'MONGO_%s_PASSWORD=%s\n' "$k" "$(openssl rand -hex 24)"; done > "$CRED"
  echo "NOTE: $CRED was missing - NEW passwords generated. Put this file in the secrets kit"
  echo "      and use these passwords in every .env URI (the kit's old ones will not work)."
fi
chmod 600 "$CRED"
[ "$DRILL" = 0 ] && chown deploy:deploy "$CRED"
set -a; . "$CRED"; set +a
[ -f "$KEY" ] || openssl rand -base64 756 > "$KEY"
chown mongodb:mongodb "$KEY" 2>/dev/null || true
chmod 400 "$KEY"

mongo_stop(){ if [ "$DRILL" = 1 ]; then mongod --shutdown --dbpath /var/lib/mongodb >/dev/null 2>&1 || true; sleep 2; else systemctl stop mongod || true; fi; }
mongo_start(){
  if [ "$DRILL" = 1 ]; then
    mkdir -p /var/lib/mongodb /var/log/mongodb
    mongod --config "$CONF" --fork >/dev/null
  else
    systemctl enable mongod >/dev/null 2>&1; systemctl restart mongod
  fi
  for _ in $(seq 1 30); do mongosh --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1 && return 0; sleep 2; done
  echo "mongod did not start"; tail -20 /var/log/mongodb/mongod.log; exit 1
}
ADMIN_URI="mongodb://admin:${MONGO_ADMIN_PASSWORD}@127.0.0.1:27017/admin?directConnection=true"
if mongosh --quiet "$ADMIN_URI" --eval 'rs.status().ok' 2>/dev/null | grep -q 1; then
  echo "mongod already secured + rs0 initiated - skipping"
else
  # Phase A: the real config MINUS the security block, so users can be created with no login.
  mongo_stop
  sed '/^security:/,/^  keyFile:/d' "$REPO/ops/mongod.conf" > "$CONF"
  mongo_start
  mongosh --quiet --eval 'try { rs.status() } catch (e) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] }) }' >/dev/null
  for _ in $(seq 1 30); do [ "$(mongosh --quiet --eval 'rs.status().myState' 2>/dev/null)" = "1" ] && break; sleep 2; done
  mongosh --quiet "mongodb://127.0.0.1:27017/admin?directConnection=true" --eval '
    const e = process.env;
    const want = [
      ["admin", e.MONGO_ADMIN_PASSWORD, ["root"]],
      ["scdhub_prod", e.MONGO_PROD_PASSWORD, [{ role: "readWrite", db: "scdhub_prod" }]],
      ["scdhub_dev", e.MONGO_DEV_PASSWORD, [{ role: "readWrite", db: "scdhub_dev" }]],
      ["scdhub_books", e.MONGO_BOOKS_PASSWORD, [{ role: "readWrite", db: "scdhub_books_prod" }]],
      ["scdhub_backup", e.MONGO_BACKUP_PASSWORD, ["backup", "restore"]],
    ];
    for (const [user, pwd, roles] of want) {
      if (!db.getUser(user)) db.createUser({ user, pwd, roles });
    }
    print("users: " + db.getUsers().users.map(u => u.user).sort().join(", "));'
  # Phase B: the full config (auth + keyFile).
  mongo_stop
  install -m 644 "$REPO/ops/mongod.conf" "$CONF"
  mongo_start
fi
mongosh --quiet "$ADMIN_URI" --eval 'print("rs0 " + rs.status().members[0].stateStr + ", auth ok")'
if mongosh --quiet "mongodb://127.0.0.1:27017/admin?directConnection=true" --eval 'db.getSiblingDB("scdhub_prod").getCollectionNames()' >/dev/null 2>&1; then
  echo "ANONYMOUS ACCESS WORKS - auth is not on"; exit 1
fi

if [ "$DRILL" = 1 ]; then
  echo; echo "=== drill mode: steps 6-8 (Caddy, firewall, systemd units, cron) skipped"
  exit 0
fi

step "6/8 Caddy + Docker (GlitchTip)"
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq; apt-get install -y -qq caddy >/dev/null
fi
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq; apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
usermod -aG docker deploy
mkdir -p /etc/caddy/certs

step "7/8 firewall: SSH from anywhere, 80/443 from Cloudflare ONLY (origin lockdown, D-#767)"
apt-get install -y -qq ufw >/dev/null
V4="$(curl -fsS https://www.cloudflare.com/ips-v4)"; V6="$(curl -fsS https://www.cloudflare.com/ips-v6)"
[ -n "$V4" ] && [ -n "$V6" ] || { echo "could not fetch Cloudflare ranges - firewall NOT changed"; exit 1; }
ufw allow 22/tcp >/dev/null
for r in $V4 $V6; do ufw allow proto tcp from "$r" to any port 80,443 comment cloudflare >/dev/null; done
ufw --force enable >/dev/null
ufw status | head -5

step "8/8 systemd units + deploy crontab"
install -m 644 "$REPO"/ops/systemd/scdhub-*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable scdhub-prod scdhub-dev >/dev/null 2>&1
crontab -u deploy -l >/dev/null 2>&1 || crontab -u deploy "$REPO/ops/crontab"
echo
echo "Bootstrap done. Next (runbook): secrets from the kit, clone prod+dev, restore the data, deploy.sh, Caddy, Cloudflare."
