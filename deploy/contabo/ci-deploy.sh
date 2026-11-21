#!/usr/bin/env bash
# Install as /usr/local/bin/mezan-ci-deploy (root:root 0755). It is the forced
# command of the `deploy` user's CI key, so the key can run nothing else:
#   restrict,command="/usr/local/bin/mezan-ci-deploy" ssh-ed25519 AAAA... github-actions
# and sudoers allows exactly: deploy ALL=(root) NOPASSWD: /usr/local/bin/mezan-ci-deploy
# Input: "<commit sha>@sha256:<digest>" as the SSH command, the workflow's short-lived GITHUB_TOKEN on stdin.
set -euo pipefail

# Installed as /usr/local/bin/<instance>-ci-deploy, it deploys /opt/<instance> (deploy.sh).
self="/usr/local/bin/$(basename "$0")"
instance="$(basename "$0" -ci-deploy)"
[[ "$instance" =~ ^mezan(-[a-z0-9]+)?$ ]] || { echo "refused: install as /usr/local/bin/<instance>-ci-deploy" >&2; exit 2; }

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -n "$self" "${SSH_ORIGINAL_COMMAND:-}"
fi

tag="${1:-}"
[[ "$tag" =~ ^[0-9a-f]{40}@sha256:[0-9a-f]{64}$ ]] || { echo "refused: expected <commit sha>@sha256:<digest>" >&2; exit 2; }

if [ "$(sed -n 's/^MEZAN_IMAGE_TAG=//p' "/opt/$instance/.env" 2>/dev/null | tail -n 1)" = "$tag" ]; then
  echo "$tag is already running"
  exit 0
fi

# SECURITY: the registry login lives only in a throwaway folder, removed when the deploy ends.
DOCKER_CONFIG="$(mktemp -d)"
export DOCKER_CONFIG
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
docker login ghcr.io -u github-actions --password-stdin >/dev/null

# Detached from the SSH session: a cancelled job or dropped connection must not
# kill deploy.sh between stopping the app and starting (or rolling back) the new one.
log="/var/log/$instance-deploy.log"
touch "$log" && chmod 600 "$log"
start=$(($(stat -c %s "$log") + 1))
setsid bash -c 'trap "rm -rf \"$DOCKER_CONFIG\"" EXIT; "/opt/$2/deploy.sh" "$1"' _ "$tag" "$instance" >>"$log" 2>&1 </dev/null &
pid=$!
trap - EXIT
tail -c "+$start" -f --pid="$pid" "$log" || true
wait "$pid"
