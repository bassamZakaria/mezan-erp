#!/usr/bin/env bash
set -euo pipefail
if [ $# -ne 5 ]; then
  echo "usage: SERVER=https://host/api TENANT=… EMAIL=… PASSWORD=… $0 <simulator-udid> <ar|en> <light|dark> <portrait|landscape> <out-dir>" >&2
  exit 2
fi
UDID=$1 LANG_CODE=$2 THEME=$3 ROTATION=$4 OUT=$5
HERE=$(cd "$(dirname "$0")" && pwd)
: "${SERVER:?}" "${TENANT:?}" "${EMAIL:?}" "${PASSWORD:?}"

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

xcrun simctl spawn "$UDID" defaults write -g AppleLanguages -array "$LANG_CODE"
xcrun simctl spawn "$UDID" defaults write -g AppleLocale "$LOCALE"
# QuickType rewrote what was typed into the URL and PASSWORD fields — the server
# address came out with its path doubled and the PASSWORD never landed at all.
for domain in com.apple.keyboard.preferences com.apple.Preferences; do
  xcrun simctl spawn "$UDID" defaults write "$domain" KeyboardAutocorrection -bool false >/dev/null 2>&1 || true
  xcrun simctl spawn "$UDID" defaults write "$domain" KeyboardPrediction -bool false >/dev/null 2>&1 || true
  xcrun simctl spawn "$UDID" defaults write "$domain" KeyboardShowPredictionBar -bool false >/dev/null 2>&1 || true
  xcrun simctl spawn "$UDID" defaults write "$domain" KeyboardAutocapitalization -bool false >/dev/null 2>&1 || true
  xcrun simctl spawn "$UDID" defaults write "$domain" DidShowContinuousPathIntroduction -bool true >/dev/null 2>&1 || true
done
# Preferences are read at boot, so they only take effect after one.
xcrun simctl shutdown "$UDID"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
osascript -e 'tell application "Simulator" to quit' >/dev/null 2>&1 || true
xcrun simctl ui "$UDID" appearance "$THEME"
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 --dataNetwork wifi || true

# Building and launching the XCUITest runner takes minutes on a loaded machine,
# and maestro's default wait is far shorter than that.
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

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
    -e "SERVER=$SERVER" -e "TENANT=$TENANT" -e "EMAIL=$EMAIL" -e "PASSWORD=$PASSWORD" -e "ORIENTATION=$ORIENTATION" "$flow"
done
