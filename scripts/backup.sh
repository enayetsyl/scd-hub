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
