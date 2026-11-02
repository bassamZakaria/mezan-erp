#!/usr/bin/env bash
# Usage (as root, run by the systemd timers beside this file):
#   mezan-backup.sh backup   copy the app's own snapshots off the box, then forget those older than 7 days (hourly)
#   mezan-backup.sh prune    delete the data of forgotten snapshots (weekly)
#   mezan-backup.sh check    verify a slice of the repository's data (weekly)
# Reads /srv/mezan/restic.env (RESTIC_REPOSITORY, RESTIC_PASSWORD, AWS_* or
# RCLONE_CONFIG, BACKUP_HEARTBEAT_URL, PRUNE_HEARTBEAT_URL).
set -Eeuo pipefail

ENV_FILE="${MEZAN_RESTIC_ENV_FILE:-/srv/mezan/restic.env}"
DATA_DIR="${MEZAN_DATA_DIR:-/srv/mezan/data}"
DISK_LIMIT_PERCENT=80
HOST_TAG="mezan-vps"

log() { printf '[mezan-backup] %s\n' "$*"; }

[ -f "$ENV_FILE" ] || { log "missing $ENV_FILE"; exit 1; }
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}"

HEARTBEAT="${BACKUP_HEARTBEAT_URL:-}"
[ "${1:-}" = prune ] && HEARTBEAT="${PRUNE_HEARTBEAT_URL:-}"

ping_heartbeat() {
  [ -n "$HEARTBEAT" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$HEARTBEAT$1" || log "heartbeat ping failed"
}

on_failure() {
  log "FAILED"
  ping_heartbeat /fail
}
trap on_failure ERR

check_disk() {
  local used
  used="$(df -P "$DATA_DIR" | awk 'NR==2 {gsub("%", "", $5); print $5}')"
  if [ "$used" -gt "$DISK_LIMIT_PERCENT" ]; then
    log "disk holding $DATA_DIR is ${used}% full (limit ${DISK_LIMIT_PERCENT}%)"
    return 1
  fi
}

run_backup() {
  check_disk
  local sources=("$DATA_DIR/backups")
  [ -d "$DATA_DIR/audit-anchors" ] && sources+=("$DATA_DIR/audit-anchors")
  local key
  while IFS= read -r key; do sources+=("$key"); done < <(find "$DATA_DIR" -maxdepth 2 -path "$DATA_DIR/backups" -prune -o -name audit-chain.key -type f -print)
  # SECURITY / consistency: only the app's own snapshots, the Postgres dumps,
  # base backups and archived WAL (all under backups/, written by
  # mezan-pg-backup.sh), the local anchor fallback and the audit chain keys
  # (without them a restored database's chain cannot be verified). Never the
  # live Postgres data directory: a raw copy of a running cluster can be torn.
  restic backup --host "$HOST_TAG" --tag mezan --exclude '*.tmp' --exclude '*.partial' --one-file-system "${sources[@]}"
  restic forget --host "$HOST_TAG" --tag mezan --group-by host,tags --keep-within 7d
  ping_heartbeat ""
  log "backup done"
}

run_prune() {
  restic forget --host "$HOST_TAG" --tag mezan --group-by host,tags --keep-within 7d
  restic prune --max-unused 0
  ping_heartbeat ""
  log "prune done"
}

run_check() {
  restic check --read-data-subset=5%
  log "check done"
}

case "${1:-}" in
  backup | prune | check) ;;
  *) echo "usage: $0 backup | prune | check" >&2; exit 64 ;;
esac

# prune takes restic's exclusive lock and restic fails at once on a held lock: the modes wait for each other instead.
exec 9>/run/lock/mezan-restic.lock
flock -w 7200 9 || { log "another backup job held the lock for 2 hours"; false; }

case "${1:-}" in
  backup) run_backup ;;
  prune) run_prune ;;
  check) run_check ;;
esac
