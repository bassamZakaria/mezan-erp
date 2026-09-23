#!/usr/bin/env bash
set -euo pipefail
if [ $# -ne 5 ]; then
  echo "usage: SERVER=https://host/api TENANT=… EMAIL=… PIN=… $0 <simulator-udid> <ar|en> <light|dark> <portrait|landscape> <out-dir>" >&2
  exit 2
fi
UDID=$1 LANG_CODE=$2 THEME=$3 ROTATION=$4 OUT=$5
HERE=$(cd "$(dirname "$0")" && pwd)
: "${SERVER:?}" "${TENANT:?}" "${EMAIL:?}" "${PIN:?}"

case "$LANG_CODE" in
  ar) LOCALE=ar_EG ;;
  en) LOCALE=en_US ;;
  *) echo "language must be ar or en" >&2; exit 2 ;;
esac

case "$ROTATION" in
  portrait) ORIENTATION=PORTRAIT ;;
  landscape) ORIENTATION=LANDSCAPE_LEFT ;;
  *) echo "orientation must be portrait or landscape" >&2; exit 2 ;;
esac

current=$(xcrun simctl spawn "$UDID" defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n()"' | cut -d, -f1)
if [ "$current" != "$LANG_CODE" ]; then
  xcrun simctl spawn "$UDID" defaults write -g AppleLanguages -array "$LANG_CODE"
  xcrun simctl spawn "$UDID" defaults write -g AppleLocale "$LOCALE"
  xcrun simctl shutdown "$UDID"
  xcrun simctl boot "$UDID"
  xcrun simctl bootstatus "$UDID" -b >/dev/null
fi
osascript -e 'tell application "Simulator" to quit' >/dev/null 2>&1 || true
xcrun simctl ui "$UDID" appearance "$THEME"
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 --dataNetwork wifi || true

mkdir -p "$OUT"
args=()
while IFS='=' read -r key value; do
  [ -n "$key" ] && args+=(-e "$key=$value")
done < "$HERE/$LANG_CODE.env"
flows=("$HERE/walk.yaml")
if [ -n "${COLLECT_INVOICE:-}" ]; then
  flows+=("$HERE/collect.yaml")
  args+=(-e "COLLECT_INVOICE=$COLLECT_INVOICE")
fi
for flow in "${flows[@]}"; do
  maestro --device "$UDID" test --test-output-dir "$OUT" "${args[@]}" \
    -e "SERVER=$SERVER" -e "TENANT=$TENANT" -e "EMAIL=$EMAIL" -e "PIN=$PIN" -e "ORIENTATION=$ORIENTATION" "$flow"
done
