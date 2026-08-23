#!/usr/bin/env bash
set -uo pipefail

: "${APK_PATH:?APK_PATH is required}"
: "${OWNER_EMAIL:?OWNER_EMAIL is required}"
: "${OWNER_PASSWORD_EFFECTIVE:?OWNER_PASSWORD_EFFECTIVE is required}"

adb install -r "$APK_PATH"
timeout 30s adb wait-for-device

curl -Ls https://get.maestro.mobile.dev | bash
MAESTRO="${HOME}/.maestro/bin/maestro"
test -x "$MAESTRO"
"$MAESTRO" --version

set +e
timeout 240s "$MAESTRO" test expo/.maestro/ivx-owner-home-certificate.yaml \
  --env OWNER_EMAIL="$OWNER_EMAIL" \
  --env OWNER_PASSWORD="$OWNER_PASSWORD_EFFECTIVE" \
  --format junit \
  --output owner-home-maestro.xml
rc=$?

checkpoint() {
  local label="$1"

  timeout 10s adb wait-for-device || { rc=90; return; }
  timeout 10s adb shell pidof com.ivxholdings.app.owner > "owner-home-${label}-pid.txt" 2>&1 || rc=91
  timeout 20s adb shell uiautomator dump "/sdcard/owner-home-${label}.xml" >/dev/null 2>&1 || rc=92
  timeout 20s adb pull "/sdcard/owner-home-${label}.xml" "owner-home-${label}.xml" >/dev/null 2>&1 || true
  timeout 15s adb exec-out screencap -p > "owner-home-${label}.png" 2>/dev/null || true
  timeout 20s adb logcat -d > "owner-home-${label}-logcat.txt" 2>&1 || true
  grep -q 'Home ready' "owner-home-${label}.xml" 2>/dev/null || rc=93
}

checkpoint immediate
if [ "$rc" -eq 0 ]; then sleep 2; checkpoint 2s; fi
if [ "$rc" -eq 0 ]; then sleep 3; checkpoint 5s; fi
if [ "$rc" -eq 0 ]; then sleep 5; checkpoint 10s; fi
if [ "$rc" -eq 0 ]; then sleep 10; checkpoint 20s; fi

exit "$rc"
