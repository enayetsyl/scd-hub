#!/usr/bin/env bash
# Nightly production backup (ADR-011/016): mongodump of the prod DB -> gzip
# archive -> upload to the school Google Drive (SCD-Hub-Backups) -> tiered
# rotation. Driven by cron on the VM. Failures are logged for the weekly check.
#
#   scripts/backup.sh
#
# Reads MONGODB_URI + GOOGLE_OAUTH_* from /opt/scdhub/prod/.env (mode 600).
set -uo pipefail

DIR=/opt/scdhub/prod
ENVF="$DIR/.env"
LOG=/opt/scdhub/backup.log
STAMP="$(date +%Y-%m-%d_%H%M%S)"
ARCHIVE="/tmp/scdhub_prod-${STAMP}.archive.gz"

say(){ echo "$(date '+%F %T %Z') backup: $*" >>"$LOG"; }

fail(){ say "FAILED: $*"; rm -f "$ARCHIVE"; exit 1; }

URI="$(grep -E '^MONGODB_URI=' "$ENVF" | head -1 | cut -d= -f2-)"
[ -n "$URI" ] || fail "no MONGODB_URI in $ENVF"

say "start -> $ARCHIVE"
mongodump --uri="$URI" --archive="$ARCHIVE" --gzip --quiet || fail "mongodump error"
SIZE="$(du -h "$ARCHIVE" | cut -f1)"
say "dumped $SIZE"

node "$DIR/scripts/drive-backup.mjs" "$ARCHIVE" >>"$LOG" 2>&1 || fail "drive upload/rotate error"
rm -f "$ARCHIVE"
say "done ($SIZE uploaded + rotated)"

# GlitchTip (MON-1) Postgres -> gzip -> its OWN Drive subfolder + rotation pool.
# Non-fatal by design: a GlitchTip backup hiccup must never fail the prod Mongo
# backup above. Container name + DB are the GlitchTip compose defaults.
GTAR="/tmp/glitchtip_prod-${STAMP}.sql.gz"
if docker exec glitchtip-postgres-1 pg_dump -U postgres postgres 2>/dev/null | gzip >"$GTAR"; then
  GTSIZE="$(du -h "$GTAR" | cut -f1)"
  if node "$DIR/scripts/drive-backup.mjs" "$GTAR" "SCD-Hub-Backups-GlitchTip" >>"$LOG" 2>&1; then
    say "glitchtip dumped + uploaded ($GTSIZE)"
  else
    say "WARN glitchtip drive upload failed (non-fatal)"
  fi
  rm -f "$GTAR"
else
  say "WARN glitchtip pg_dump failed (non-fatal)"; rm -f "$GTAR"
fi
