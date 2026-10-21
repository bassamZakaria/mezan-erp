#!/usr/bin/env bash
# Usage (as root, from anywhere):
#   deploy.sh <image tag>       deploy that tag (the commit SHA CI pushed)
#   deploy.sh --rollback        go back to the tag that ran before the last deploy
#
# One writer (MEZAN_SQLITE_EXCLUSIVE=1), so every deploy stops the app first:
# expect about a minute of downtime.
set -euo pipefail

COMPOSE_DIR="${MEZAN_COMPOSE_DIR:-/opt/mezan}"
DATA_DIR="${MEZAN_DATA_DIR:-/srv/mezan/data}"
PREDEPLOY_ROOT="${MEZAN_PREDEPLOY_DIR:-/srv/mezan-predeploy}"
SHARED_ENV="${MEZAN_SHARED_ENV_FILE:-/srv/mezan/shared.env}"
APP_ENV="${MEZAN_ENV_FILE:-/srv/mezan/env}"
READY_TIMEOUT_SECONDS=120
KEEP_PREDEPLOY_COPIES=3
RUNNING_MARKER="$DATA_DIR/mezan-running.json"
TAG_FILE="$COMPOSE_DIR/.env"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "REFUSED: $*"; exit 1; }
compose() { docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/docker-compose.yml" "$@"; }

tag_value() { sed -n "s/^$1=//p" "$TAG_FILE" 2>/dev/null | tail -n 1; }

write_tags() {
  local current="$1" previous="$2"
  printf 'MEZAN_IMAGE_TAG=%s\nMEZAN_PREVIOUS_IMAGE_TAG=%s\n' "$current" "$previous" > "$TAG_FILE.next"
  mv "$TAG_FILE.next" "$TAG_FILE"
}

preflight() {
  local tool
  for tool in docker rsync od flock; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
  for file in "$APP_ENV" "$SHARED_ENV"; do
    [ -f "$file" ] || die "$file is missing"
    [ "$(stat -c '%a' "$file")" = "600" ] || die "$file must be mode 0600"
  done
  grep -Eq '^MEZAN_ORIGIN_SECRET=[A-Za-z0-9_-]{32,}$' "$SHARED_ENV" || die "MEZAN_ORIGIN_SECRET in $SHARED_ENV must be at least 32 letters, digits, - or _ (it is substituted into the Caddyfile)"
  if grep -q '^MEZAN_AUDIT_CHAIN_KEY=' "$APP_ENV" && ! grep -Eq '^MEZAN_AUDIT_CHAIN_KEY=[0-9a-f]{64}$' "$APP_ENV"; then
    die "MEZAN_AUDIT_CHAIN_KEY in $APP_ENV must be 64 lower-case hex characters, or absent"
  fi
  if grep -q '^MEZAN_ORIGIN_SECRET=' "$APP_ENV"; then die "MEZAN_ORIGIN_SECRET belongs in $SHARED_ENV only; remove it from $APP_ENV"; fi
  [ "$(stat -c '%u' "$DATA_DIR")" = "1000" ] || die "$DATA_DIR must be owned by uid 1000 (the image's node user)"
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
  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS)) status
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' mezan 2>/dev/null || echo missing)"
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
  chmod 700 "$target"
  ls -1dt "$PREDEPLOY_ROOT"/*/ 2>/dev/null | tail -n +$((KEEP_PREDEPLOY_COPIES + 1)) | xargs -r rm -rf
}

schema_versions() {
  local dir="$1"
  find "$dir" -path "$dir/backups" -prune -o -path "$dir/exports" -prune -o -type f \( -name '*.db' -o -name '*.sqlite' \) -print 2>/dev/null \
    | sort | while read -r file; do
        # PRAGMA user_version is bytes 60-63 of the header, big-endian. Read
        # directly: opening a WAL database with sqlite3 as root would leave
        # root-owned -wal/-shm files the app cannot open.
        printf '%s %s\n' "${file#"$dir"/}" "$(od -An -tu4 -j60 -N4 --endian=big "$file" 2>/dev/null | tr -d ' ' || echo '?')"
      done
}

restore_snapshot() {
  local label="$1" failed_tag="$2" source="$PREDEPLOY_ROOT/$1"
  [ -d "$source" ] || die "no pre-deploy copy at $source to restore"
  local aside
  aside="$PREDEPLOY_ROOT/failed-$failed_tag-$(date -u +%Y%m%dT%H%M%SZ)"
  log "the data was written by a newer schema; keeping it at $aside and restoring $source"
  compose stop mezan || true
  mkdir -p "$aside"
  rsync -a --exclude=/backups/ --exclude=/exports/ "$DATA_DIR/" "$aside/"
  chmod 700 "$aside"
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name backups ! -name exports -exec rm -rf {} +
  rsync -a "$source/" "$DATA_DIR/"
  chown -R 1000:1000 "$DATA_DIR"
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
  local label="${old_tag:-initial}"
  if [ -n "$old_tag" ]; then snapshot_data "$label"; fi
  local before
  before="$(schema_versions "$DATA_DIR")"

  write_tags "$new_tag" "$old_tag"
  log "starting $new_tag"
  compose up -d --remove-orphans
  if wait_ready; then
    log "$new_tag is ready"
    prune_images "$new_tag" "$old_tag" || log "image cleanup failed (deploy is fine)"
    return 0
  fi

  log "$new_tag did not become ready within ${READY_TIMEOUT_SECONDS} s; last log lines:"
  docker logs --tail 40 mezan 2>&1 || true
  [ -n "$old_tag" ] || die "first deploy failed and there is no earlier tag to go back to"

  compose stop mezan || true
  local after
  after="$(schema_versions "$DATA_DIR")"
  write_tags "$old_tag" "$new_tag"
  if [ "$before" != "$after" ]; then
    restore_snapshot "$label" "$new_tag"
  fi
  log "rolling back to $old_tag"
  compose up -d --remove-orphans
  if wait_ready; then
    log "rolled back to $old_tag; $new_tag needs fixing"
    exit 2
  fi
  if docker logs --tail 200 mezan 2>&1 | grep -q 'SchemaTooNewError'; then
    restore_snapshot "$label" "$new_tag"
    compose up -d --remove-orphans
    wait_ready && { log "rolled back to $old_tag on the pre-deploy copy"; exit 2; }
  fi
  die "$old_tag is not ready either: the site is down. Read 'docker logs mezan' and README 'Restore'"
}

rollback() {
  local current previous
  current="$(tag_value MEZAN_IMAGE_TAG)"
  previous="$(tag_value MEZAN_PREVIOUS_IMAGE_TAG)"
  [ -n "$previous" ] || die "no previous tag recorded in $TAG_FILE"
  log "rolling back from $current to $previous"
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
