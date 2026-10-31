#!/usr/bin/env bash
set -euo pipefail
UDID=$1 LANG_CODE=$2 OUT=$3
HERE=$(cd "$(dirname "$0")" && pwd)
args=()
while IFS='=' read -r key value; do
  [ -n "$key" ] && args+=(-e "$key=$value")
done < "$HERE/$LANG_CODE.env"
maestro --device "$UDID" test --test-output-dir "$OUT" "${args[@]}" -e "COLLECT_INVOICE=${COLLECT_INVOICE:?}" "$HERE/collect.yaml"
