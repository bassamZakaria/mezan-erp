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

case "$ROTATION" in
  portrait) ORIENTATION=PORTRAIT ;;
  landscape) ORIENTATION=LANDSCAPE_LEFT ;;
  *) echo "orientation must be portrait or landscape" >&2; exit 2 ;;
esac

adb -s "$SERIAL" root >/dev/null 2>&1 || true
# adb root restarts adbd; the shell that follows can land before the system
# server is reachable again, and `cmd uimode` then reports no such service.
adb -s "$SERIAL" wait-for-device
for _ in $(seq 1 30); do
  [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed | tr -d '\r')" = "1" ] && break
  sleep 2
done
current=$(adb -s "$SERIAL" shell getprop persist.sys.locale | tr -d '\r')
if [ "$current" != "$SYSTEM_LOCALE" ]; then
  adb -s "$SERIAL" shell setprop persist.sys.locale "$SYSTEM_LOCALE"
  # The system server reads the locale once, at start.
  adb -s "$SERIAL" shell "stop; start"
  adb -s "$SERIAL" wait-for-device
  until [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done
  sleep 5
fi

for _ in $(seq 1 30); do
  adb -s "$SERIAL" shell cmd uimode night "$NIGHT" >/dev/null 2>&1 && break
  sleep 2
done

# user_rotation 0 is the panel's NATURAL orientation, and a tablet's natural
# orientation is landscape — so 0 is not "portrait" on every device. Which
# rotation is portrait has to be read off the panel.
panel=$(adb -s "$SERIAL" shell wm size | tr -d '\r' | sed -n 's/.*: *\([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -1)
panel_w=${panel% *}
panel_h=${panel#* }
# The device starts UPRIGHT whatever is under test: the flow signs in in
# portrait and turns the device itself, and a phone that boots into landscape
# has its sign-in button below the fold before the flow can rotate it.
if [ "$panel_w" -gt "$panel_h" ]; then USER_ROTATION=1; else USER_ROTATION=0; fi

adb -s "$SERIAL" shell settings put system accelerometer_rotation 0
adb -s "$SERIAL" shell settings put system user_rotation "$USER_ROTATION"
adb -s "$SERIAL" shell settings put global sysui_demo_allowed 1 >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null 2>&1 || true

# An emulator reaches the host's loopback through adb reverse, and a framework
# restart or `adb root` drops every forward it had — which shows up in the app
# as "the server could not be reached", not as a broken test.
SERVER_PORT=$(printf '%s' "$SERVER" | sed -n 's|.*://[^:/]*:\([0-9]*\).*|\1|p')
[ -n "$SERVER_PORT" ] && adb -s "$SERIAL" reverse "tcp:$SERVER_PORT" "tcp:$SERVER_PORT" >/dev/null
adb -s "$SERIAL" reverse tcp:8081 tcp:8081 >/dev/null

# Installing and launching maestro's instrumentation driver takes minutes on a
# headless emulator sharing a loaded machine, and the default wait is shorter.
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
  maestro --device "$SERIAL" test --test-output-dir "$OUT" "${args[@]}" \
    -e "SERVER=$SERVER" -e "TENANT=$TENANT" -e "EMAIL=$EMAIL" -e "PIN=$PIN" -e "ORIENTATION=$ORIENTATION" "$flow"
done
