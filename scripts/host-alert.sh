#!/usr/bin/env bash
# Host disk/RAM alert (MON-5, prd-observability.md §4 / observability-runbook.md MON-5).
#
# Warns BEFORE disk-full / OOM takes down prod AND GlitchTip together — they share
# the one VM disk (GlitchTip's Postgres + 30-day retention + the nightly Mongo/GlitchTip
# dumps all grow on `/`), so a fill-up would take out the app and its own error tracker
# at the same time. GlitchTip can't report its own host dying, so this runs from cron
# on the box and emails the operator.
#
# Install (operator [OP]): a cron line on the VM, e.g.
#   */15 * * * * ALERT_EMAIL=ops@example.com /opt/scdhub/prod/scripts/host-alert.sh
# Needs a working `mail` (or msmtp) — reuse the GlitchTip SMTP. Tunable via env:
#   ALERT_EMAIL              where to send (unset → log to stdout only, never errors)
#   HOST_ALERT_DISK_PCT      disk %-used threshold (default 85)
#   HOST_ALERT_MEM_FREE_PCT  min %-free memory before alerting (default 10)
# Acceptance: temporarily export HOST_ALERT_DISK_PCT below current usage → an email fires.
set -euo pipefail

DISK_THRESHOLD="${HOST_ALERT_DISK_PCT:-85}"
MEM_FREE_THRESHOLD="${HOST_ALERT_MEM_FREE_PCT:-10}"
ALERT_TO="${ALERT_EMAIL:-}"

# % of `/` used (integer) and % of memory available (integer).
disk_pct="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
mem_free_pct="$(free | awk '/^Mem:/ {printf "%d", ($7 / $2) * 100}')"

msg=""
if [ "${disk_pct:-0}" -ge "$DISK_THRESHOLD" ]; then
  msg="${msg}DISK ${disk_pct}% used on $(hostname) (threshold ${DISK_THRESHOLD}%). "
fi
if [ "${mem_free_pct:-100}" -le "$MEM_FREE_THRESHOLD" ]; then
  msg="${msg}MEM only ${mem_free_pct}% free on $(hostname) (threshold ${MEM_FREE_THRESHOLD}%). "
fi

if [ -n "$msg" ]; then
  if [ -n "$ALERT_TO" ] && command -v mail >/dev/null 2>&1; then
    printf '%s\n' "$msg" | mail -s "[scdhub] host alert: $(hostname)" "$ALERT_TO"
  else
    # ALERT_EMAIL unset or no mailer — surface to stdout/journal; never fail the cron.
    echo "[host-alert] $msg(no mailer / ALERT_EMAIL unset — not emailed)"
  fi
fi
