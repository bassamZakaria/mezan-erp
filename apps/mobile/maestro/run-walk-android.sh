#!/usr/bin/env bash
set -euo pipefail
if [ $# -ne 5 ]; then
  echo "usage: SERVER=http://10.0.2.2:PORT/api TENANT=… EMAIL=… PIN=… $0 <emulator-serial> <ar|en> <light|dark> <portrait|landscape> <out-dir>" >&2
  exit 2
fi
SERIAL=$1 LANG_CODE=$2 THEME=$3 ROTATION=$4 OUT=$5
HERE=$(cd "$(dirname "$0")" && pwd)
: "${SERVER:?}" "${TENANT:?}" "${EMAIL:?}" "${PIN:?}"

case "$LANG_CODE" in
  ar) SYSTEM_LOCALE=ar-EG ;;
  en) SYSTEM_LOCALE=en-US ;;
  *) echo "language must be ar or en" >&2; exit 2 ;;
esac

case "$THEME" in
  light) NIGHT=no ;;
  dark) NIGHT=yes ;;
  *) echo "theme must be light or dark" >&2; exit 2 ;;
esac

# user_rotation: 0 is the natural orientation, 1 is 90° counter-clockwise.
case "$ROTATION" in
  portrait) USER_ROTATION=0; ORIENTATION=PORTRAIT ;;
  landscape) USER_ROTATION=1; ORIENTATION=LANDSCAPE_LEFT ;;
  *) echo "orientation must be portrait or landscape" >&2; exit 2 ;;
esac

adb -s "$SERIAL" root >/dev/null 2>&1 || true
current=$(adb -s "$SERIAL" shell getprop persist.sys.locale | tr -d '\r')
if [ "$current" != "$SYSTEM_LOCALE" ]; then
  adb -s "$SERIAL" shell setprop persist.sys.locale "$SYSTEM_LOCALE"
  # The system server reads the locale once, at start.
  adb -s "$SERIAL" shell "stop; start"
  adb -s "$SERIAL" wait-for-device
  until [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done
  sleep 5
fi

adb -s "$SERIAL" shell cmd uimode night "$NIGHT" >/dev/null
adb -s "$SERIAL" shell settings put system accelerometer_rotation 0
adb -s "$SERIAL" shell settings put system user_rotation "$USER_ROTATION"
adb -s "$SERIAL" shell settings put global sysui_demo_allowed 1 >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null 2>&1 || true

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
  maestro --device "$SERIAL" test --test-output-dir "$OUT" "${args[@]}" \
    -e "SERVER=$SERVER" -e "TENANT=$TENANT" -e "EMAIL=$EMAIL" -e "PIN=$PIN" -e "ORIENTATION=$ORIENTATION" "$flow"
done
