#!/usr/bin/env bash
# Usage (as root, run by the systemd timers beside this file):
#   mezan-pg-backup.sh dump    one custom-format dump per tenant schema + platform (hourly)
#   mezan-pg-backup.sh base    a base backup + the roles (no passwords) for point-in-time recovery, then prune old WAL (daily)
#   mezan-pg-backup.sh drill   restore the newest dumps into a scratch database and prove the books balance (weekly)
# Everything lands under $DATA_DIR/backups, which mezan-backup.sh ships off the box.
# Reads /srv/mezan/pg.env (POSTGRES_USER) and, for heartbeats, /srv/mezan/restic.env
# (PG_DUMP_HEARTBEAT_URL, PG_BASE_HEARTBEAT_URL, PG_DRILL_HEARTBEAT_URL: one check per mode).
set -Eeuo pipefail
umask 077

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
MODE="${1:-}"
HEARTBEAT=""
HEARTBEAT_KEY="PG_$(printf '%s' "$MODE" | tr '[:lower:]' '[:upper:]')_HEARTBEAT_URL"
if [ -f "$RESTIC_ENV" ]; then HEARTBEAT="$(sed -n "s/^$HEARTBEAT_KEY=//p" "$RESTIC_ENV" | tail -n 1)"; fi

ping_heartbeat() {
  [ -n "$HEARTBEAT" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$HEARTBEAT$1" || log "heartbeat ping failed"
}
trap 'log FAILED; ping_heartbeat /fail' ERR

psql_in() { docker exec -i "$CONTAINER" psql -U "$POSTGRES_USER" -d "${2:-$DATABASE}" -v ON_ERROR_STOP=1 -Atc "$1"; }

schemas() { psql_in "SELECT nspname FROM pg_namespace WHERE nspname = 'platform' OR nspname ~ '^t_[a-z0-9_]+$' ORDER BY 1"; }

# Same filter as the app's boot: a provisioning tenant may have no schema yet.
missing_schemas() {
  psql_in "SELECT string_agg(s, ' ' ORDER BY s) FROM (SELECT 't_' || replace(id, '-', '_') AS s FROM platform.tenant WHERE status NOT IN ('archived', 'provisioning')) served WHERE s NOT IN (SELECT nspname FROM pg_namespace)"
}

# A failed archive_command retries forever without failing anything else: the dump and base runs report it.
check_archiver() {
  [ "$(psql_in "SELECT COALESCE(last_failed_time > COALESCE(last_archived_time, '-infinity'), false) FROM pg_stat_archiver")" = "f" ] \
    || { log "WAL archiving is failing (pg_stat_archiver.last_failed_wal; 'docker logs $CONTAINER')"; false; }
}

run_dump() {
  local stamp target schema list missing count
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$DUMP_ROOT/$stamp"
  # Assignments, not a process substitution: a failed query must fail the run.
  list="$(schemas)"
  missing="$(missing_schemas)"
  [ -z "$missing" ] || { log "served companies with no schema: $missing"; false; }
  grep -qx platform <<<"$list" || { log "no platform schema"; false; }
  # Left by a run that died; the timer's unit never runs twice at once.
  find "$DUMP_ROOT" -mindepth 1 -maxdepth 1 -name '*.partial' -exec rm -rf {} +
  mkdir -p "$target.partial"
  for schema in $list; do
    docker exec "$CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$DATABASE" -Fc -n "$schema" > "$target.partial/$schema.dump"
  done
  count="$(find "$target.partial" -name '*.dump' -size +0 | wc -l)"
  [ "$count" -eq "$(wc -w <<<"$list")" ] || { log "only $count of $(wc -w <<<"$list") dumps written"; false; }
  mv "$target.partial" "$target"
  find "$DUMP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort | head -n -"$KEEP_DUMPS" | xargs -r rm -rf
  check_archiver
  ping_heartbeat ""
  log "dumped $count schema(s) to $target"
}

run_base() {
  local stamp oldest_kept
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$BASE_ROOT"
  find "$BASE_ROOT" -maxdepth 1 -name '*.partial' -exec rm -f {} +
  docker exec "$CONTAINER" pg_basebackup -U "$POSTGRES_USER" -D - -Ft -z -X none -c fast > "$BASE_ROOT/$stamp.tar.gz.partial"
  # The roles the schemas belong to; a base backup restores them anyway, a dump does not.
  docker exec "$CONTAINER" pg_dumpall -U "$POSTGRES_USER" --globals-only --no-role-passwords > "$BASE_ROOT/$stamp.globals.sql.partial"
  mv "$BASE_ROOT/$stamp.globals.sql.partial" "$BASE_ROOT/$stamp.globals.sql"
  mv "$BASE_ROOT/$stamp.tar.gz.partial" "$BASE_ROOT/$stamp.tar.gz"
  find "$BASE_ROOT" -maxdepth 1 -name '*.tar.gz' | sort | head -n -"$KEEP_BASES" | xargs -r rm -f
  find "$BASE_ROOT" -maxdepth 1 -name '*.globals.sql' | sort | head -n -"$KEEP_BASES" | xargs -r rm -f
  oldest_kept="$(find "$BASE_ROOT" -maxdepth 1 -name '*.tar.gz' | sort | head -n 1)"
  # WAL older than the oldest kept base backup can no longer be replayed onto
  # anything kept here; restic still holds it off the box.
  local first_wal
  first_wal="$(tar -xzOf "$oldest_kept" backup_label 2>/dev/null | sed -n 's/^START WAL LOCATION: .* (file \([0-9A-F]*\))$/\1/p')"
  # The archive holds <segment>.gz (docker-compose.yml archive_command).
  [ -n "$first_wal" ] || { log "no START WAL LOCATION in $oldest_kept; WAL not pruned"; false; }
  docker exec "$CONTAINER" pg_archivecleanup -x .gz /wal-archive "$first_wal"
  check_archiver
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

case "$MODE" in
  dump) run_dump ;;
  base) run_base ;;
  drill) run_drill ;;
  *) echo "usage: $0 dump | base | drill" >&2; exit 64 ;;
esac
