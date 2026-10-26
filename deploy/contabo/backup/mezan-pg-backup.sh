#!/usr/bin/env bash
# Usage (as root, run by the systemd timers beside this file):
#   mezan-pg-backup.sh dump    one custom-format dump per tenant schema + platform (hourly)
#   mezan-pg-backup.sh base    a base backup for point-in-time recovery, then prune old WAL (daily)
#   mezan-pg-backup.sh drill   restore the newest dumps into a scratch database and prove the books balance (weekly)
# Everything lands under $DATA_DIR/backups, which mezan-backup.sh ships off the box.
# Reads /srv/mezan/pg.env (POSTGRES_USER) and, for heartbeats, /srv/mezan/restic.env.
set -Eeuo pipefail

PG_ENV="${MEZAN_PG_ENV_FILE:-/srv/mezan/pg.env}"
RESTIC_ENV="${MEZAN_RESTIC_ENV_FILE:-/srv/mezan/restic.env}"
DATA_DIR="${MEZAN_DATA_DIR:-/srv/mezan/data}"
DUMP_ROOT="$DATA_DIR/backups/pg-dump"
BASE_ROOT="$DATA_DIR/backups/pg-base"
KEEP_DUMPS=48
KEEP_BASES=2
CONTAINER=mezan-postgres
DATABASE=mezan

log() { printf '[mezan-pg-backup] %s\n' "$*"; }

[ -f "$PG_ENV" ] || { log "missing $PG_ENV"; exit 1; }
POSTGRES_USER="$(sed -n 's/^POSTGRES_USER=//p' "$PG_ENV" | tail -n 1)"
: "${POSTGRES_USER:?POSTGRES_USER missing from $PG_ENV}"
HEARTBEAT=""
[ -f "$RESTIC_ENV" ] && HEARTBEAT="$(sed -n 's/^PG_BACKUP_HEARTBEAT_URL=//p' "$RESTIC_ENV" | tail -n 1)"

ping_heartbeat() {
  [ -n "$HEARTBEAT" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$HEARTBEAT$1" || log "heartbeat ping failed"
}
trap 'log FAILED; ping_heartbeat /fail' ERR

psql_in() { docker exec -i "$CONTAINER" psql -U "$POSTGRES_USER" -d "${2:-$DATABASE}" -v ON_ERROR_STOP=1 -Atc "$1"; }

schemas() { psql_in "SELECT nspname FROM pg_namespace WHERE nspname = 'platform' OR nspname ~ '^t_[a-z0-9_]+$' ORDER BY 1"; }

run_dump() {
  local stamp target schema
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$DUMP_ROOT/$stamp"
  mkdir -p "$target.partial"
  while IFS= read -r schema; do
    docker exec "$CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$DATABASE" -Fc -n "$schema" > "$target.partial/$schema.dump"
  done < <(schemas)
  mv "$target.partial" "$target"
  chmod -R go-rwx "$target"
  find "$DUMP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort | head -n -"$KEEP_DUMPS" | xargs -r rm -rf
  log "dumped $(find "$target" -name '*.dump' | wc -l) schema(s) to $target"
}

run_base() {
  local stamp oldest_kept
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$BASE_ROOT"
  docker exec "$CONTAINER" pg_basebackup -U "$POSTGRES_USER" -D - -Ft -z -X none -c fast > "$BASE_ROOT/$stamp.tar.gz.partial"
  mv "$BASE_ROOT/$stamp.tar.gz.partial" "$BASE_ROOT/$stamp.tar.gz"
  find "$BASE_ROOT" -maxdepth 1 -name '*.tar.gz' | sort | head -n -"$KEEP_BASES" | xargs -r rm -f
  oldest_kept="$(find "$BASE_ROOT" -maxdepth 1 -name '*.tar.gz' | sort | head -n 1)"
  # WAL older than the oldest kept base backup can no longer be replayed onto
  # anything kept here; restic still holds it off the box.
  local first_wal
  first_wal="$(tar -xzOf "$oldest_kept" backup_label 2>/dev/null | sed -n 's/^START WAL LOCATION: .* (file \([0-9A-F]*\))$/\1/p')"
  [ -n "$first_wal" ] && docker exec "$CONTAINER" pg_archivecleanup /wal-archive "$first_wal"
  ping_heartbeat ""
  log "base backup $stamp done"
}

run_drill() {
  local newest scratch dump schema imbalance checked=0
  newest="$(find "$DUMP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort | tail -n 1)"
  [ -n "$newest" ] || { log "no dump to drill"; exit 1; }
  scratch="drill_$(date -u +%Y%m%d%H%M%S)"
  psql_in "CREATE DATABASE $scratch TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'" postgres
  trap 'psql_in "DROP DATABASE IF EXISTS $scratch" postgres >/dev/null || true' EXIT
  for dump in "$newest"/*.dump; do
    schema="$(basename "$dump" .dump)"
    docker exec -i "$CONTAINER" pg_restore -U "$POSTGRES_USER" -d "$scratch" --no-owner --no-privileges < "$dump"
    if [ "$(psql_in "SELECT to_regclass('$schema.journal_line') IS NOT NULL" "$scratch")" = "t" ]; then
      imbalance="$(psql_in "SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) FROM $schema.journal_line l JOIN $schema.journal_entry e ON e.id = l.entry_id WHERE e.status IN ('posted', 'reversed')" "$scratch")"
      [ "$imbalance" = "0" ] || { log "$schema restored out of balance by $imbalance"; false; }
      checked=$((checked + 1))
    fi
  done
  ping_heartbeat ""
  log "drill restored $newest; $checked tenant ledger(s) balance"
}

case "${1:-}" in
  dump) run_dump ;;
  base) run_base ;;
  drill) run_drill ;;
  *) echo "usage: $0 dump | base | drill" >&2; exit 64 ;;
esac
