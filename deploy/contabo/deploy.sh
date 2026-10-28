#!/usr/bin/env bash
# Usage (as root, from anywhere):
#   deploy.sh <image tag>       deploy that tag (the commit SHA CI pushed)
#   deploy.sh --rollback        run the tag that ran before the last deploy, on
#                               the current books (README "Update and rollback")
#   deploy.sh --migrate-sqlite <image tag>
#                               the Postgres cutover WITH the SQLite books: the
#                               new tag's migrator copies them into Postgres
#                               before it starts (README "Cutover to Postgres")
#
# Every deploy stops the app first (Postgres keeps running) and takes a
# consistent copy of the books: expect about a minute of downtime. With
# --migrate-sqlite add the migration itself, at least as long as the `check`
# run took (README "Cutover to Postgres"), killed after 30 minutes. A deploy that
# never gets ready restores that copy and goes back to the old tag.
set -Eeuo pipefail

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
MIGRATE_SQLITE=0
MIGRATION_REPORT=""
MIGRATE_TIMEOUT_SECONDS=1800
MIGRATE_CONTAINER=mezan-sqlite-migrate
MIGRATE_SCRATCH="$DATA_DIR/.migrate-scratch"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "REFUSED: $*"; exit 1; }
compose() { docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/docker-compose.yml" "$@"; }
pg_user() { sed -n 's/^POSTGRES_USER=//p' "$PG_ENV" | tail -n 1; }
pg_password() { sed -n 's/^POSTGRES_PASSWORD=//p' "$PG_ENV" | tail -n 1; }
psql_in() { docker exec -i mezan-postgres psql -U "$(pg_user)" -d mezan -v ON_ERROR_STOP=1 -Atc "$1"; }

book_schemas() { psql_in "SELECT nspname FROM pg_namespace WHERE nspname = 'platform' OR nspname ~ '^t_[a-z0-9_]+\$' ORDER BY 1"; }

PHASE=""
on_exit() {
  local code=$?
  [ "$code" -ne 0 ] || return 0
  case "$PHASE" in
    stopped)
      docker rm -f "$MIGRATE_CONTAINER" >/dev/null 2>&1 || true
      log "starting the old version again (nothing was switched)"
      compose start mezan || log "could not start it: run 'docker compose start mezan' in $COMPOSE_DIR" ;;
    tagged) log "the site may be down on tag $(tag_value MEZAN_IMAGE_TAG): see README 'Restore'" ;;
    restoring) log "the restore did not finish: the site is down and the books may be part-restored. Both copies are in $PREDEPLOY_ROOT; see README 'Restore'" ;;
  esac
}
trap 'log "failed at line $LINENO: $BASH_COMMAND"' ERR
trap on_exit EXIT

tag_value() { [ -f "$TAG_FILE" ] || return 0; sed -n "s/^$1=//p" "$TAG_FILE" | tail -n 1; }

write_tags() {
  local current="$1" previous="$2"
  printf 'MEZAN_IMAGE_TAG=%s\nMEZAN_PREVIOUS_IMAGE_TAG=%s\n' "$current" "$previous" > "$TAG_FILE.next"
  mv "$TAG_FILE.next" "$TAG_FILE"
}

preflight() {
  local tool
  for tool in docker rsync flock python3 timeout; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
  for file in "$APP_ENV" "$SHARED_ENV" "$PG_ENV"; do
    [ -f "$file" ] || die "$file is missing"
    [ "$(stat -c '%a' "$file")" = "600" ] || die "$file must be mode 0600"
  done
  grep -Eq '^MEZAN_ORIGIN_SECRET=[A-Za-z0-9_-]{32,}$' "$SHARED_ENV" || die "MEZAN_ORIGIN_SECRET in $SHARED_ENV must be at least 32 letters, digits, - or _ (it is substituted into the Caddyfile)"
  grep -Eq '^MEZAN_AUDIT_CHAIN_KEY=[0-9a-f]{64}$' "$APP_ENV" || die "MEZAN_AUDIT_CHAIN_KEY in $APP_ENV must be 64 lower-case hex characters (openssl rand -hex 32); the Postgres server refuses to start without it"
  if grep -q '^MEZAN_ORIGIN_SECRET=' "$APP_ENV"; then die "MEZAN_ORIGIN_SECRET belongs in $SHARED_ENV only; remove it from $APP_ENV"; fi
  if grep -q '^MEZAN_MIGRATE_OWNER_URL=' "$APP_ENV" "$SHARED_ENV"; then die "MEZAN_MIGRATE_OWNER_URL is the Postgres superuser and only deploy.sh --migrate-sqlite builds it; remove it from $APP_ENV and $SHARED_ENV"; fi
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
  [ ! -e "$RUNNING_MARKER" ] || die "the app exited with code $exit_code and left $RUNNING_MARKER, so it did not close its databases; nothing was copied or changed. Read 'docker logs mezan', then 'compose start mezan' to resume the old version"
  # The app writes the marker once it has booted and removes it only on a clean close, so a
  # failure with no marker is a version that died while booting and never served: a fix may replace it.
  [ "$exit_code" = "0" ] || log "the app exited with code $exit_code without ever finishing its boot (no $RUNNING_MARKER); going on"
}

check_disk() {
  local files_kb pg_kb=0 free_kb
  files_kb="$(du -sk --exclude=backups --exclude=exports "$DATA_DIR" | cut -f1)"
  if [ "$(docker inspect --format '{{.State.Running}}' mezan-postgres 2>/dev/null || true)" = "true" ]; then
    pg_kb=$(( $(psql_in "SELECT pg_database_size('mezan')") / 1024 ))
  fi
  mkdir -p "$PREDEPLOY_ROOT"
  free_kb="$(df -Pk "$PREDEPLOY_ROOT" | awk 'NR==2 {print $4}')"
  # Twice: the pre-deploy copy, and on a failed deploy the copy of what the failed version wrote.
  [ "$free_kb" -gt $(( (files_kb + pg_kb) * 2 )) ] || die "not enough free disk for the pre-deploy copy ($((files_kb + pg_kb)) KB of files and books needed twice over, ${free_kb} KB free); the app was not stopped"
  [ "$MIGRATE_SQLITE" = 1 ] || return 0
  # The pre-deploy copy, the migrator's scratch copy, the Postgres books and their WAL, and a failed-… copy.
  local dir
  for dir in "$PREDEPLOY_ROOT" "$DATA_DIR"; do
    free_kb="$(df -Pk "$dir" | awk 'NR==2 {print $4}')"
    [ "$free_kb" -gt $(( files_kb * 5 )) ] || die "not enough free disk on $dir to migrate: $files_kb KB of SQLite books needed five times over, ${free_kb} KB free (old $PREDEPLOY_ROOT/failed-* copies can go once read); the app was not stopped"
  done
}

# One file, and one transaction, per schema (as mezan-pg-backup.sh): a single
# dump of the database locks every table at once and runs out of the lock table
# with enough companies. Consistent across schemas only because the app is stopped.
dump_books() {
  local dir="$1" list schema
  list="$(book_schemas)"
  mkdir -p "$dir"
  for schema in $list; do
    docker exec mezan-postgres pg_dump -U "$(pg_user)" -d mezan -Fc -n "$schema" > "$dir/$schema.dump"
  done
}

snapshot_data() {
  local label="$1" target="$PREDEPLOY_ROOT/$1"
  log "copying the stopped databases to $target"
  rm -rf "$target"
  mkdir -p "$target"
  # The only moment a raw copy of a WAL database is consistent: the app is
  # stopped. -wal and -shm files travel with their database.
  rsync -a --exclude=/backups/ --exclude=/exports/ "$DATA_DIR/" "$target/"
  log "dumping the Postgres books to $target/pg-dump/"
  dump_books "$target/pg-dump"
  chmod 700 "$target"
  # A failed-… copy holds the only record of writes made while a failed tag ran; it is never counted or pruned here.
  # shellcheck disable=SC2010,SC2012
  ls -1dt "$PREDEPLOY_ROOT"/*/ 2>/dev/null | { grep -v '/failed-' || true; } | tail -n +$((KEEP_PREDEPLOY_COPIES + 1)) | xargs -r rm -rf
}

# RFC 7677 / Postgres format: SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>, password on stdin.
scram_verifier() {
  python3 -I -c '
import base64, hashlib, hmac, os, sys
password, salt, rounds = sys.stdin.buffer.read(), os.urandom(16), 4096
salted = hashlib.pbkdf2_hmac("sha256", password, salt, rounds, 32)
stored = hashlib.sha256(hmac.new(salted, b"Client Key", "sha256").digest()).digest()
server = hmac.new(salted, b"Server Key", "sha256").digest()
b64 = lambda raw: base64.b64encode(raw).decode()
print("SCRAM-SHA-256$%d:%s$%s:%s" % (rounds, b64(salt), b64(stored), b64(server)))
'
}

ensure_app_role() {
  local password user verifier
  password="$(sed -n 's|^MEZAN_DATABASE_URL=postgres://mezan_app:\([0-9a-f]*\)@.*$|\1|p' "$APP_ENV" | tail -n 1)"
  # SECURITY: Postgres stores a SCRAM verifier as given, so the plain password never reaches the server's statement log. Both travel on stdin, never on a command line.
  verifier="$(printf '%s' "$password" | scram_verifier)"
  { cat "$APP_ROLE_SQL"; printf "ALTER ROLE mezan_app LOGIN PASSWORD '%s';\n" "$verifier"; } \
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

restore_schema() {
  local schema="$1" dump="$2"
  [[ "$schema" =~ ^(platform|t_[a-z0-9_]+)$ ]] || die "$dump is not a schema dump"
  # Dropped and rebuilt in one transaction: a restore that fails leaves the schema as it was.
  # A role the cluster lost since (a company purged) gets a NOLOGIN placeholder, or the
  # restore stops at its ALTER … OWNER; the app's boot gives a served company its login back.
  {
    printf "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN CREATE ROLE %s NOLOGIN; END IF; END\$\$;\n" "$schema" "$schema"
    printf 'SET client_min_messages = warning;\nDROP SCHEMA IF EXISTS %s CASCADE;\n' "$schema"
    docker exec -i mezan-postgres pg_restore -f - < "$dump"
  } | docker exec -i mezan-postgres psql -U "$(pg_user)" -d mezan -v ON_ERROR_STOP=1 --single-transaction -q >/dev/null
}

restore_pg_dumps() {
  local dir="$1" live schema dump
  live="$(book_schemas)"
  # A schema the copy does not hold was created by the failed version (on the
  # cutover: every one, platform too, so the retry seeds the owner afresh). Its
  # data is in the failed-… copy. Its role goes too, after its grants.
  for schema in $live; do
    [ ! -f "$dir/$schema.dump" ] || continue
    log "dropping $schema, which the failed version created"
    psql_in "DROP SCHEMA $schema CASCADE" >/dev/null
    if [ "$(psql_in "SELECT count(*) FROM pg_roles WHERE rolname = '$schema'")" = "1" ]; then
      # The app granted it CONNECT; only the grantor can revoke that, and DROP ROLE refuses while it stands.
      printf 'DROP OWNED BY %s CASCADE;\nSET ROLE mezan_app;\nREVOKE ALL ON DATABASE mezan FROM %s;\nRESET ROLE;\nDROP ROLE %s;\n' "$schema" "$schema" "$schema" \
        | docker exec -i mezan-postgres psql -U "$(pg_user)" -d mezan -v ON_ERROR_STOP=1 --single-transaction -q >/dev/null
    fi
  done
  # Platform last: it is the directory of the companies the boot opens.
  for dump in "$dir"/*.dump; do
    [ -e "$dump" ] || continue
    schema="$(basename "$dump" .dump)"
    [ "$schema" = platform ] || restore_schema "$schema" "$dump"
  done
  [ ! -f "$dir/platform.dump" ] || restore_schema platform "$dir/platform.dump"
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
  PHASE=restoring
  compose stop mezan || true
  mkdir -p "$aside"
  rsync -a --exclude=/backups/ --exclude=/exports/ "$DATA_DIR/" "$aside/"
  chmod 700 "$aside"
  if [ -d "$source/pg-dump" ]; then
    dump_books "$aside/pg-dump"
    log "restoring the Postgres books from $source/pg-dump/"
    restore_pg_dumps "$source/pg-dump"
  fi
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name backups ! -name exports ! -name "$CUTOVER_NAME" -exec rm -rf {} +
  rsync -a --exclude=/pg-dump/ --exclude="/$CUTOVER_NAME" "$source/" "$DATA_DIR/"
  # Not backups/: pg-wal belongs to the postgres uid, and archiving stops if it changes hands.
  chown 1000:1000 "$DATA_DIR"
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name backups ! -name exports ! -name "$CUTOVER_NAME" -exec chown -R 1000:1000 {} +
  PHASE=tagged
}

# Runs the new tag's migrator in a one-off container, Postgres already up and the app stopped.
# It refuses unless Postgres holds no books, and drops what it created when anything differs.
# The report lands beside the pre-deploy copies, which fall_back never touches and the prune never counts (it removes directories only).
migrate_sqlite_books() {
  local tag="$1" owner_url code=0
  # SECURITY: the superuser's URL reaches the container through the environment, never a command line.
  owner_url="$(pg_user | python3 -I -c 'import sys, urllib.parse; user = sys.stdin.read().strip(); password = open(sys.argv[1]).read().strip(); print("postgres://%s:%s@postgres:5432/mezan" % (urllib.parse.quote(user, safe=""), urllib.parse.quote(password, safe="")))' <(pg_password))"
  MIGRATION_REPORT="$PREDEPLOY_ROOT/sqlite-to-postgres-report-$(date -u +%Y%m%dT%H%M%SZ).json"
  install -m 600 /dev/null "$MIGRATION_REPORT"
  # The scratch copies go on the data disk: the container's /tmp is a 1 GB tmpfs.
  rm -rf "$MIGRATE_SCRATCH"
  install -d -o 1000 -g 1000 -m 700 "$MIGRATE_SCRATCH"
  docker rm -f "$MIGRATE_CONTAINER" >/dev/null 2>&1 || true
  log "migrating the SQLite books into Postgres with $tag (progress below, report: $MIGRATION_REPORT, stopped after $MIGRATE_TIMEOUT_SECONDS s)"
  MEZAN_MIGRATE_OWNER_URL="$owner_url" MEZAN_IMAGE_TAG="$tag" timeout -k 30 "$MIGRATE_TIMEOUT_SECONDS" \
    docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/docker-compose.yml" run --rm --no-deps -T --name "$MIGRATE_CONTAINER" \
    -e MEZAN_MIGRATE_OWNER_URL -e TMPDIR=/data/.migrate-scratch -e MEZAN_LOG_STDERR=1 mezan \
    node --import tsx apps/server/src/sqlite-to-postgres-cli.ts migrate --data /data > "$MIGRATION_REPORT" || code=$?
  # timeout stops the compose client, not the container.
  docker rm -f "$MIGRATE_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$MIGRATE_SCRATCH"
  [ "$code" -ne 124 ] || log "the migration ran past $MIGRATE_TIMEOUT_SECONDS s and was stopped"
  return "$code"
}

# Puts the pre-deploy copy and the old tag back after the new one failed.
fall_back() {
  local label="$1" new_tag="$2" old_tag="$3" old_previous="$4"
  [ -n "$old_tag" ] || die "first deploy failed and there is no earlier tag to go back to"
  # Always: the failed version may have changed any schema, and only the copy
  # says what the old version expects.
  # Not $new_tag: --rollback would then deploy the tag that just failed.
  write_tags "$old_tag" "$old_previous"
  restore_snapshot "$label" "$new_tag"
  log "rolling back to $old_tag"
  compose up -d --remove-orphans
  if wait_ready; then
    PHASE=served
    log "rolled back to $old_tag on the pre-deploy copy; $new_tag needs fixing"
    exit 2
  fi
  die "$old_tag is not ready either: the site is down. Read 'docker logs mezan' and README 'Restore'"
}

deploy() {
  local new_tag="$1" old_tag old_previous
  old_tag="$(tag_value MEZAN_IMAGE_TAG)"
  old_previous="$(tag_value MEZAN_PREVIOUS_IMAGE_TAG)"
  [ "$new_tag" != "$old_tag" ] || die "$new_tag is already the running tag"
  if [ "$MIGRATE_SQLITE" = 1 ]; then
    [ ! -s "$CUTOVER_FILE" ] || die "$CUTOVER_FILE exists: the books are already on Postgres, so there is nothing to migrate"
    [ -f "$DATA_DIR/platform.db" ] || die "$DATA_DIR/platform.db does not exist: there are no SQLite books to migrate"
    [ -n "$old_tag" ] || die "--migrate-sqlite needs the SQLite tag running, to fall back to if the migration fails"
  fi

  if docker image inspect "${MEZAN_IMAGE:-ghcr.io/bassamzakaria/mezan-erp}:$new_tag" >/dev/null 2>&1; then
    log "$new_tag is already on this host"
  else
    log "pulling $new_tag before any downtime"
    MEZAN_IMAGE_TAG="$new_tag" compose pull mezan
  fi
  # Postgres and Caddy too, before any downtime: on the cutover postgres is not on the host yet.
  MEZAN_IMAGE_TAG="$new_tag" compose pull --policy missing postgres caddy
  # An image pulled by digest has no local tag, so prune_images would delete it once it is the rollback image.
  if [[ "$new_tag" == *@* ]]; then
    docker tag "${MEZAN_IMAGE:-ghcr.io/bassamzakaria/mezan-erp}@${new_tag#*@}" "${MEZAN_IMAGE:-ghcr.io/bassamzakaria/mezan-erp}:${new_tag%%@*}"
  fi

  # A scratch folder left by an interrupted check must not be measured, snapshotted or restored.
  if [ "$MIGRATE_SQLITE" = 1 ]; then rm -rf "$MIGRATE_SCRATCH"; fi
  if [ -n "$old_tag" ]; then check_disk; fi
  stop_cleanly
  PHASE=stopped
  start_postgres
  local label="${old_tag:-initial}"
  if [ -n "$old_tag" ]; then snapshot_data "$label"; fi
  if [ "$MIGRATE_SQLITE" = 1 ] && ! migrate_sqlite_books "$new_tag"; then
    log "the migration failed or found a difference; read $MIGRATION_REPORT"
    fall_back "$label" "$new_tag" "$old_tag" "$old_previous"
  fi

  PHASE=tagged
  write_tags "$new_tag" "$old_tag"
  log "starting $new_tag"
  compose up -d --remove-orphans
  if wait_ready; then
    PHASE=served
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
  fall_back "$label" "$new_tag" "$old_tag" "$old_previous"
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
  if [ "${1:-}" = "--migrate-sqlite" ]; then
    MIGRATE_SQLITE=1
    shift
  fi
  [ $# -eq 1 ] || { echo "usage: $0 <image tag> | --rollback | --migrate-sqlite <image tag>" >&2; exit 64; }
  [ "$(id -u)" -eq 0 ] || die "run as root"
  exec 9>/run/mezan-deploy.lock
  flock -n 9 || die "another deploy is running"
  preflight
  case "$1" in
    --rollback) [ "$MIGRATE_SQLITE" = 0 ] || { echo "usage: $0 <image tag> | --rollback | --migrate-sqlite <image tag>" >&2; exit 64; }; rollback ;;
    -*) echo "usage: $0 <image tag> | --rollback | --migrate-sqlite <image tag>" >&2; exit 64 ;;
    *) [[ "$1" =~ ^[A-Za-z0-9_.-]{1,128}(@sha256:[0-9a-f]{64})?$ ]] || die "not an image tag: $1"; deploy "$1" ;;
  esac
}

main "$@"
