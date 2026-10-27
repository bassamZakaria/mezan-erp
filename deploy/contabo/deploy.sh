#!/usr/bin/env bash
# Usage (as root, from anywhere):
#   deploy.sh <image tag>       deploy that tag (the commit SHA CI pushed)
#   deploy.sh --rollback        run the tag that ran before the last deploy, on
#                               the current books (README "Update and rollback")
#
# Every deploy stops the app first (Postgres keeps running) and takes a
# consistent copy of the books: expect about a minute of downtime. A deploy that
# never gets ready restores that copy and goes back to the old tag.
set -euo pipefail

COMPOSE_DIR="${MEZAN_COMPOSE_DIR:-/opt/mezan}"
DATA_DIR="${MEZAN_DATA_DIR:-/srv/mezan/data}"
PREDEPLOY_ROOT="${MEZAN_PREDEPLOY_DIR:-/srv/mezan-predeploy}"
SHARED_ENV="${MEZAN_SHARED_ENV_FILE:-/srv/mezan/shared.env}"
APP_ENV="${MEZAN_ENV_FILE:-/srv/mezan/env}"
PG_ENV="${MEZAN_PG_ENV_FILE:-/srv/mezan/pg.env}"
PG_DATA_DIR="${MEZAN_PG_DATA_DIR:-/srv/mezan/pg/data}"
PG_WAL_ARCHIVE_DIR="${MEZAN_PG_WAL_ARCHIVE_DIR:-$DATA_DIR/backups/pg-wal}"
PG_UID=999
READY_TIMEOUT_SECONDS=120
KEEP_PREDEPLOY_COPIES=3
RUNNING_MARKER="$DATA_DIR/mezan-running.json"
# The first tag that ran on Postgres. Every tag before it served the SQLite books.
CUTOVER_NAME=postgres-cutover-tag
CUTOVER_FILE="$DATA_DIR/$CUTOVER_NAME"
APP_ROLE_SQL="$COMPOSE_DIR/postgres-init/10-mezan-app.sql"
TAG_FILE="$COMPOSE_DIR/.env"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "REFUSED: $*"; exit 1; }
compose() { docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/docker-compose.yml" "$@"; }
pg_user() { sed -n 's/^POSTGRES_USER=//p' "$PG_ENV" | tail -n 1; }
psql_in() { docker exec -i mezan-postgres psql -U "$(pg_user)" -d mezan -v ON_ERROR_STOP=1 -Atc "$1"; }

tag_value() { [ -f "$TAG_FILE" ] || return 0; sed -n "s/^$1=//p" "$TAG_FILE" | tail -n 1; }

write_tags() {
  local current="$1" previous="$2"
  printf 'MEZAN_IMAGE_TAG=%s\nMEZAN_PREVIOUS_IMAGE_TAG=%s\n' "$current" "$previous" > "$TAG_FILE.next"
  mv "$TAG_FILE.next" "$TAG_FILE"
}

preflight() {
  local tool
  for tool in docker rsync flock; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
  for file in "$APP_ENV" "$SHARED_ENV" "$PG_ENV"; do
    [ -f "$file" ] || die "$file is missing"
    [ "$(stat -c '%a' "$file")" = "600" ] || die "$file must be mode 0600"
  done
  grep -Eq '^MEZAN_ORIGIN_SECRET=[A-Za-z0-9_-]{32,}$' "$SHARED_ENV" || die "MEZAN_ORIGIN_SECRET in $SHARED_ENV must be at least 32 letters, digits, - or _ (it is substituted into the Caddyfile)"
  grep -Eq '^MEZAN_AUDIT_CHAIN_KEY=[0-9a-f]{64}$' "$APP_ENV" || die "MEZAN_AUDIT_CHAIN_KEY in $APP_ENV must be 64 lower-case hex characters (openssl rand -hex 32); the Postgres server refuses to start without it"
  if grep -q '^MEZAN_ORIGIN_SECRET=' "$APP_ENV"; then die "MEZAN_ORIGIN_SECRET belongs in $SHARED_ENV only; remove it from $APP_ENV"; fi
  [ "$(stat -c '%u' "$DATA_DIR")" = "1000" ] || die "$DATA_DIR must be owned by uid 1000 (the image's node user)"
  local key
  for key in POSTGRES_USER POSTGRES_PASSWORD; do
    grep -Eq "^$key=.+" "$PG_ENV" || die "$key is missing from $PG_ENV (see pg.env.example)"
  done
  grep -q '^POSTGRES_DB=mezan$' "$PG_ENV" || die "POSTGRES_DB=mezan is missing from $PG_ENV"
  # SECURITY: pg.env is handed to the postgres container; the app's secrets stay out of it.
  if grep -q '^MEZAN_' "$PG_ENV"; then die "$PG_ENV may hold only POSTGRES_* settings; MEZAN_DATABASE_URL and MEZAN_TENANT_DB_SECRET belong in $APP_ENV"; fi
  grep -Eq '^MEZAN_DATABASE_URL=postgres://mezan_app:[0-9a-f]{64}@postgres:5432/mezan$' "$APP_ENV" || die "MEZAN_DATABASE_URL in $APP_ENV must be postgres://mezan_app:<64 lower-case hex>@postgres:5432/mezan (the superuser is for this script only)"
  grep -Eq '^MEZAN_TENANT_DB_SECRET=[0-9a-f]{64}$' "$APP_ENV" || die "MEZAN_TENANT_DB_SECRET in $APP_ENV must be 64 lower-case hex characters"
  [ -f "$APP_ROLE_SQL" ] || die "$APP_ROLE_SQL is missing (copy deploy/contabo to $COMPOSE_DIR)"
  mkdir -p "$PG_DATA_DIR" "$PG_WAL_ARCHIVE_DIR"
  chown "$PG_UID:$PG_UID" "$PG_DATA_DIR" "$PG_WAL_ARCHIVE_DIR"
  chmod 700 "$PG_DATA_DIR" "$PG_WAL_ARCHIVE_DIR"
}

prune_images() {
  # Keeps the running tag and the rollback tag; every deploy would otherwise leave one more image on disk.
  local image="${MEZAN_IMAGE:-ghcr.io/bassamzakaria/mezan-erp}" keep1="${1%%@*}" keep2="${2%%@*}" tag
  docker image ls "$image" --format '{{.Tag}}' | while read -r tag; do
    [ "$tag" = "$keep1" ] || [ "$tag" = "$keep2" ] || [ "$tag" = "<none>" ] || docker image rm "$image:$tag" >/dev/null || true
  done
  docker image prune -f >/dev/null
}

wait_ready() {
  local container="${1:-mezan}" deadline=$((SECONDS + READY_TIMEOUT_SECONDS)) status
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"
    [ "$status" = "healthy" ] && return 0
    sleep 3
  done
  return 1
}

stop_cleanly() {
  if ! docker inspect mezan >/dev/null 2>&1; then
    log "no mezan container yet (first deploy)"
    return 0
  fi
  log "stopping the app (SIGTERM, up to 90 s)"
  compose stop mezan
  local exit_code
  exit_code="$(docker inspect --format '{{.State.ExitCode}}' mezan)"
  [ "$exit_code" = "0" ] || die "the app exited with code $exit_code, not a clean close; nothing was copied or changed. Read 'docker logs mezan', then 'compose start mezan' to resume the old version"
  [ ! -e "$RUNNING_MARKER" ] || die "$RUNNING_MARKER is still there, so the app did not close its databases; nothing was copied or changed"
}

snapshot_data() {
  local label="$1" target="$PREDEPLOY_ROOT/$1"
  local need_kb free_kb
  need_kb="$(du -sk --exclude=backups --exclude=exports "$DATA_DIR" | cut -f1)"
  mkdir -p "$PREDEPLOY_ROOT"
  free_kb="$(df -Pk "$PREDEPLOY_ROOT" | awk 'NR==2 {print $4}')"
  [ "$free_kb" -gt $((need_kb * 2)) ] || die "not enough free disk for the pre-deploy copy (${need_kb} KB needed twice over, ${free_kb} KB free)"
  log "copying the stopped databases to $target"
  rm -rf "$target"
  mkdir -p "$target"
  # The only moment a raw copy of a WAL database is consistent: the app is
  # stopped. -wal and -shm files travel with their database.
  rsync -a --exclude=/backups/ --exclude=/exports/ "$DATA_DIR/" "$target/"
  if docker inspect mezan-postgres >/dev/null 2>&1; then
    log "dumping the Postgres books to $target/postgres.dump"
    docker exec mezan-postgres pg_dump -U "$(pg_user)" -d mezan -Fc > "$target/postgres.dump"
  fi
  chmod 700 "$target"
  ls -1dt "$PREDEPLOY_ROOT"/*/ 2>/dev/null | tail -n +$((KEEP_PREDEPLOY_COPIES + 1)) | xargs -r rm -rf
}

ensure_app_role() {
  local password user
  password="$(sed -n 's|^MEZAN_DATABASE_URL=postgres://mezan_app:\([0-9a-f]*\)@.*$|\1|p' "$APP_ENV" | tail -n 1)"
  # Password on stdin, never on a command line another process could read.
  { cat "$APP_ROLE_SQL"; printf "ALTER ROLE mezan_app LOGIN PASSWORD '%s';\n" "$password"; } \
    | docker exec -i mezan-postgres psql -U "$(pg_user)" -d mezan -v ON_ERROR_STOP=1 -q >/dev/null
  user="$(sed -n 's|^MEZAN_DATABASE_URL=postgres://\([a-z_]*\):.*$|\1|p' "$APP_ENV" | tail -n 1)"
  [ "$(psql_in "SELECT rolsuper FROM pg_roles WHERE rolname = '$user'")" = "f" ] || die "the app's database user $user is a superuser or does not exist"
}

start_postgres() {
  log "starting Postgres"
  compose up -d postgres
  wait_ready mezan-postgres || die "Postgres did not become healthy; read 'docker logs mezan-postgres'"
  ensure_app_role
}

restore_pg_dump() {
  local dump="$1" toc name
  toc="$(docker exec -i mezan-postgres pg_restore -l < "$dump")"
  # Every schema the dump holds is dropped whole (CASCADE also takes tables a
  # failed version added) and rebuilt, in one transaction. A role the dump
  # names but the cluster lost (a tenant purged since) gets a NOLOGIN
  # placeholder, or the restore stops at its ALTER … OWNER; the app's boot
  # gives a served tenant's role its login and password back.
  {
    awk '!/^;/ && NF {print $NF}' <<<"$toc" | sort -u | while read -r name; do
      [[ "$name" =~ ^[a-z_][a-z0-9_]*$ ]] || continue
      printf "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN CREATE ROLE %s NOLOGIN; END IF; END\$\$;\n" "$name" "$name"
    done
    awk '!/^;/ && $4 == "SCHEMA" && $5 == "-" {print $6}' <<<"$toc" | sort -u | while read -r name; do
      [[ "$name" =~ ^(platform|t_[a-z0-9_]+)$ ]] || continue
      printf 'DROP SCHEMA IF EXISTS %s CASCADE;\n' "$name"
    done
    docker exec -i mezan-postgres pg_restore -f - < "$dump"
  } | docker exec -i mezan-postgres psql -U "$(pg_user)" -d mezan -v ON_ERROR_STOP=1 --single-transaction -q >/dev/null
  ensure_app_role
  local orphans
  [ "$(psql_in "SELECT to_regclass('platform.tenant') IS NOT NULL")" = "t" ] || return 0
  orphans="$(psql_in "SELECT string_agg(nspname, ' ' ORDER BY nspname) FROM pg_namespace WHERE nspname ~ '^t_[a-z0-9_]+\$' AND nspname NOT IN (SELECT 't_' || replace(id, '-', '_') FROM platform.tenant)")"
  [ -z "$orphans" ] || log "WARNING: schemas with no platform tenant, kept (drop by hand once checked): $orphans"
}

restore_snapshot() {
  local label="$1" failed_tag="$2" source="$PREDEPLOY_ROOT/$1"
  [ -d "$source" ] || die "no pre-deploy copy at $source to restore"
  local aside
  aside="$PREDEPLOY_ROOT/failed-$failed_tag-$(date -u +%Y%m%dT%H%M%SZ)"
  log "keeping what $failed_tag wrote at $aside and restoring $source"
  compose stop mezan || true
  mkdir -p "$aside"
  rsync -a --exclude=/backups/ --exclude=/exports/ "$DATA_DIR/" "$aside/"
  chmod 700 "$aside"
  if [ -f "$source/postgres.dump" ]; then
    docker exec mezan-postgres pg_dump -U "$(pg_user)" -d mezan -Fc > "$aside/postgres.dump"
    log "restoring the Postgres books from $source/postgres.dump"
    restore_pg_dump "$source/postgres.dump"
  fi
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name backups ! -name exports ! -name "$CUTOVER_NAME" -exec rm -rf {} +
  rsync -a --exclude=/postgres.dump --exclude="/$CUTOVER_NAME" "$source/" "$DATA_DIR/"
  # Not backups/: pg-wal belongs to the postgres uid, and archiving stops if it changes hands.
  chown 1000:1000 "$DATA_DIR"
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name backups ! -name exports ! -name "$CUTOVER_NAME" -exec chown -R 1000:1000 {} +
}

deploy() {
  local new_tag="$1" old_tag
  old_tag="$(tag_value MEZAN_IMAGE_TAG)"
  [ "$new_tag" != "$old_tag" ] || die "$new_tag is already the running tag"

  if docker image inspect "${MEZAN_IMAGE:-ghcr.io/bassamzakaria/mezan-erp}:$new_tag" >/dev/null 2>&1; then
    log "$new_tag is already on this host"
  else
    log "pulling $new_tag before any downtime"
    MEZAN_IMAGE_TAG="$new_tag" compose pull mezan
  fi
  # An image pulled by digest has no local tag, so prune_images would delete it once it is the rollback image.
  if [[ "$new_tag" == *@* ]]; then
    docker tag "${MEZAN_IMAGE:-ghcr.io/bassamzakaria/mezan-erp}@${new_tag#*@}" "${MEZAN_IMAGE:-ghcr.io/bassamzakaria/mezan-erp}:${new_tag%%@*}"
  fi

  stop_cleanly
  start_postgres
  local label="${old_tag:-initial}"
  if [ -n "$old_tag" ]; then snapshot_data "$label"; fi

  write_tags "$new_tag" "$old_tag"
  log "starting $new_tag"
  compose up -d --remove-orphans
  if wait_ready; then
    log "$new_tag is ready"
    if [ ! -s "$CUTOVER_FILE" ]; then
      printf '%s\n' "$new_tag" > "$CUTOVER_FILE"
      log "recorded $new_tag as the first tag on Postgres in $CUTOVER_FILE; --rollback will not go back past it"
    fi
    prune_images "$new_tag" "$old_tag" || log "image cleanup failed (deploy is fine)"
    return 0
  fi

  log "$new_tag did not become ready within ${READY_TIMEOUT_SECONDS} s; last log lines:"
  docker logs --tail 40 mezan 2>&1 || true
  [ -n "$old_tag" ] || die "first deploy failed and there is no earlier tag to go back to"

  # Always: the failed version may have changed any schema, and only the copy
  # says what the old version expects.
  write_tags "$old_tag" "$new_tag"
  restore_snapshot "$label" "$new_tag"
  log "rolling back to $old_tag"
  compose up -d --remove-orphans
  if wait_ready; then
    log "rolled back to $old_tag on the pre-deploy copy; $new_tag needs fixing"
    exit 2
  fi
  die "$old_tag is not ready either: the site is down. Read 'docker logs mezan' and README 'Restore'"
}

rollback() {
  local current previous cutover=""
  current="$(tag_value MEZAN_IMAGE_TAG)"
  previous="$(tag_value MEZAN_PREVIOUS_IMAGE_TAG)"
  [ -n "$previous" ] || die "no previous tag recorded in $TAG_FILE"
  [ -f "$CUTOVER_FILE" ] && cutover="$(head -n 1 "$CUTOVER_FILE")"
  # $previous ran on the SQLite books, which stopped changing at the cutover.
  [ "$current" != "$cutover" ] || die "$current is the first tag that ran on Postgres; $previous would serve the stale SQLite books. Deploy a fixed tag instead"
  log "rolling back from $current to $previous (the books stay as they are)"
  deploy "$previous"
}

main() {
  [ $# -eq 1 ] || { echo "usage: $0 <image tag> | --rollback" >&2; exit 64; }
  [ "$(id -u)" -eq 0 ] || die "run as root"
  exec 9>/run/mezan-deploy.lock
  flock -n 9 || die "another deploy is running"
  preflight
  case "$1" in
    --rollback) rollback ;;
    -*) echo "usage: $0 <image tag> | --rollback" >&2; exit 64 ;;
    *) [[ "$1" =~ ^[A-Za-z0-9_.-]{1,128}(@sha256:[0-9a-f]{64})?$ ]] || die "not an image tag: $1"; deploy "$1" ;;
  esac
}

main "$@"
