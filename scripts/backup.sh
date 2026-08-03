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

# The BOOK plane (D-#404) — a SEPARATE mongod on this host, so `mongodump` above
# does not touch it. Its own Drive subfolder + rotation pool, same as GlitchTip.
#
# NON-FATAL by the same reasoning: a book-production backup problem must never fail
# the school's roster backup, which is the one that matters most. And SKIPPED
# ENTIRELY when BOOK_MONGODB_URI is unset — a school not producing books has no book
# database, and a nightly "FAILED" line for a thing that does not exist trains people
# to ignore the log (D-#285: an unread channel is the same as no channel).
BURI="$(grep -E '^BOOK_MONGODB_URI=' "$ENVF" | head -1 | cut -d= -f2-)"
if [ -n "$BURI" ]; then
  BAR="/tmp/scdhub_books-${STAMP}.archive.gz"
  if mongodump --uri="$BURI" --archive="$BAR" --gzip --quiet; then
    BSIZE="$(du -h "$BAR" | cut -f1)"
    if node "$DIR/scripts/drive-backup.mjs" "$BAR" "SCD-Hub-Backups-Books" >>"$LOG" 2>&1; then
      say "book plane dumped + uploaded ($BSIZE)"
    else
      say "WARN book-plane drive upload failed (non-fatal)"
    fi
  else
    say "WARN book-plane mongodump failed (non-fatal)"
  fi
  rm -f "$BAR"
else
  say "book plane not configured — skipped"
fi
