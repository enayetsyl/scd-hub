#!/usr/bin/env bash
# Production backups (ADR-011/016; DB-on-VM plan Phase 2, D-#818). Driven by cron on the VM:
#
#   30 2 * * *  scripts/backup.sh daily         prod Mongo + GlitchTip -> Drive, 7/4/3 rotation
#   5 * * * *   scripts/backup.sh hourly        prod Mongo -> Drive SCD-Hub-Backups-Hourly (newest 48)
#   45 3 * * 0  scripts/backup.sh restorecheck  restore the newest hourly copy into a scratch DB
#
# No argument = daily, so the original cron line keeps working.
#
# Source: BACKUP_MONGODB_URI if set, else MONGODB_URI (from /opt/scdhub/prod/.env, mode 600).
#
# HOURLY IS CAPPED WHILE PROD IS ON ATLAS. Atlas M0 allows 10 GB out per rolling 7 days and
# a full dump moves ~290 MB (M0 negotiates no wire compression; measured 2026-10-22), so 24
# dumps a day would be ~49 GB a week and get the live app throttled. While the source is
# remote, `hourly` runs only at the hours in BACKUP_REMOTE_HOURS (default 14: one midday copy
# beside the nightly one). Once the source is the VM's own mongod it runs every hour; no
# cron change is needed at the cutover.
#
# Every failure is logged to /opt/scdhub/backup.log AND emailed via scripts/send-alert.mjs
# (ALERT_EMAIL + ALERT_SMTP_URL in .env; unset = log only).
set -uo pipefail

MODE="${1:-daily}"
DIR=/opt/scdhub/prod
ENVF="$DIR/.env"
SCRIPTS="${BACKUP_SCRIPTS_DIR:-$DIR/scripts}"   # override only to test an unmerged copy
LOG=/opt/scdhub/backup.log
LOCAL_DIR=/opt/scdhub/backups/hourly
LOCAL_KEEP=3
HOURLY_FOLDER="SCD-Hub-Backups-Hourly"
HOURLY_KEEP=48
STAMP="$(date +%Y-%m-%d_%H%M%S)"
ARCHIVE="/tmp/scdhub_prod-${STAMP}.archive.gz"

envval(){ grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }
say(){ echo "$(date '+%F %T %Z') backup[$MODE]: $*" >>"$LOG"; }
alert(){ node "$SCRIPTS/send-alert.mjs" "[scdhub] backup $MODE FAILED on $(hostname)" "$1" >>"$LOG" 2>&1 || true; }
fail(){ say "FAILED: $*"; alert "$*

Log: $LOG"; rm -f "$ARCHIVE"; exit 1; }

URI="$(envval BACKUP_MONGODB_URI)"
[ -n "$URI" ] || URI="$(envval MONGODB_URI)"
[ -n "$URI" ] || fail "no MONGODB_URI in $ENVF"

source_is_local(){
  case "$URI" in
    mongodb://127.0.0.1*|mongodb://localhost*|mongodb://*@127.0.0.1*|mongodb://*@localhost*) return 0 ;;
  esac
  return 1
}

dump(){
  mongodump --uri="$URI" --archive="$ARCHIVE" --gzip --quiet </dev/null || fail "mongodump error"
  SIZE="$(du -h "$ARCHIVE" | cut -f1)"
}

case "$MODE" in
  daily)
    say "start -> $ARCHIVE"
    dump
    say "dumped $SIZE"
    node "$SCRIPTS/drive-backup.mjs" "$ARCHIVE" >>"$LOG" 2>&1 || fail "drive upload/rotate error"
    rm -f "$ARCHIVE"
    say "done ($SIZE uploaded + rotated)"

    # GlitchTip (MON-1) Postgres -> gzip -> its OWN Drive subfolder + rotation pool.
    # Non-fatal by design: a GlitchTip backup hiccup must never fail the prod Mongo
    # backup above. Container name + DB are the GlitchTip compose defaults.
    GTAR="/tmp/glitchtip_prod-${STAMP}.sql.gz"
    if docker exec glitchtip-postgres-1 pg_dump -U postgres postgres 2>/dev/null | gzip >"$GTAR"; then
      GTSIZE="$(du -h "$GTAR" | cut -f1)"
      if node "$SCRIPTS/drive-backup.mjs" "$GTAR" "SCD-Hub-Backups-GlitchTip" >>"$LOG" 2>&1; then
        say "glitchtip dumped + uploaded ($GTSIZE)"
      else
        say "WARN glitchtip drive upload failed (non-fatal)"
      fi
      rm -f "$GTAR"
    else
      say "WARN glitchtip pg_dump failed (non-fatal)"; rm -f "$GTAR"
    fi
    # The book plane (D-#404) is no longer dumped: the pipeline was retired 2026-10-22 and its
    # database is kept untouched as an archive (the last copies are in SCD-Hub-Backups-Books).
    ;;

  hourly)
    if ! source_is_local; then
      HOURS="${BACKUP_REMOTE_HOURS:-$(envval BACKUP_REMOTE_HOURS)}"; HOURS="${HOURS:-14}"
      case ",${HOURS// /}," in
        *",$((10#$(date +%H))),"*) ;;
        *) exit 0 ;;   # not a remote-backup hour: skip silently (no log line every hour)
      esac
    fi
    say "start -> $ARCHIVE ($(source_is_local && echo local || echo remote) source)"
    dump
    node "$SCRIPTS/drive-backup.mjs" "$ARCHIVE" "$HOURLY_FOLDER" "--keep-newest=$HOURLY_KEEP" >>"$LOG" 2>&1 \
      || fail "drive upload/rotate error (hourly)"
    mkdir -p "$LOCAL_DIR"
    mv "$ARCHIVE" "$LOCAL_DIR/"
    ls -1t "$LOCAL_DIR"/scdhub_prod-*.archive.gz 2>/dev/null | tail -n +$((LOCAL_KEEP + 1)) | xargs -r rm -f
    say "done ($SIZE uploaded; newest $LOCAL_KEEP kept locally in $LOCAL_DIR)"
    ;;

  restorecheck)
    # A backup that is never restored is not a backup: restore the newest local hourly copy
    # into a scratch database on the VM mongod, require zero failed documents, then drop it.
    CRED=/opt/scdhub/mongo-credentials.env
    [ -r "$CRED" ] || fail "restorecheck needs $CRED (Phase 1 credentials)"
    ADMINPW="$(grep -E '^MONGO_ADMIN_PASSWORD=' "$CRED" | cut -d= -f2-)"
    ADMIN="mongodb://admin:${ADMINPW}@127.0.0.1:27017/?authSource=admin&replicaSet=rs0"
    NEWEST="$(ls -1t "$LOCAL_DIR"/scdhub_prod-*.archive.gz 2>/dev/null | head -1)"
    [ -n "$NEWEST" ] || fail "no local hourly copy in $LOCAL_DIR to restore"
    SCRATCH=scdhub_restorecheck
    OUT="$(mongorestore --uri="$ADMIN" --archive="$NEWEST" --gzip --drop \
      --nsInclude='scdhub_prod.*' --nsFrom='scdhub_prod.*' --nsTo="$SCRATCH.*" </dev/null 2>&1)" \
      || fail "mongorestore error on $(basename "$NEWEST"): $(echo "$OUT" | tail -3)"
    OKN="$(echo "$OUT" | grep -oE '[0-9]+ document\(s\) restored successfully' | grep -oE '^[0-9]+' | tail -1)"
    BADN="$(echo "$OUT" | grep -oE '[0-9]+ document\(s\) failed to restore' | grep -oE '^[0-9]+' | tail -1)"
    COLLS="$(mongosh --quiet "$ADMIN" --eval "db.getSiblingDB('$SCRATCH').getCollectionNames().length" </dev/null 2>/dev/null)"
    mongosh --quiet "$ADMIN" --eval "db.getSiblingDB('$SCRATCH').dropDatabase()" </dev/null >/dev/null 2>&1
    [ "${BADN:-0}" = "0" ] && [ "${OKN:-0}" -gt 0 ] \
      || fail "restorecheck of $(basename "$NEWEST"): restored=${OKN:-?} failed=${BADN:-?} collections=${COLLS:-?}"
    say "restorecheck OK: $(basename "$NEWEST") -> $OKN documents in $COLLS collections, 0 failed (scratch DB dropped)"
    ;;

  *)
    echo "usage: backup.sh [daily|hourly|restorecheck]" >&2; exit 2 ;;
esac
