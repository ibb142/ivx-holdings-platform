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

home_checkpoint() {
  local label="$1"
  local xml="owner-home-${label}.xml"

  timeout 10s adb wait-for-device || { rc=90; return; }
  timeout 10s adb shell pidof com.ivxholdings.app.owner > "owner-home-${label}-pid.txt" 2>&1 || rc=91
  timeout 20s adb shell uiautomator dump "/sdcard/${xml}" >/dev/null 2>&1 || rc=92
  timeout 20s adb pull "/sdcard/${xml}" "$xml" >/dev/null 2>&1 || true
  timeout 15s adb exec-out screencap -p > "owner-home-${label}.png" 2>/dev/null || true
  timeout 20s adb logcat -d > "owner-home-${label}-logcat.txt" 2>&1 || true

  grep -q 'text="IVXHOLDINGS"' "$xml" 2>/dev/null || rc=93
  grep -q 'resource-id="tab-home"' "$xml" 2>/dev/null || rc=94
  grep -q 'resource-id="home-reels-button"' "$xml" 2>/dev/null || rc=95
}

home_checkpoint immediate
if [ "$rc" -eq 0 ]; then sleep 2; home_checkpoint 2s; fi
if [ "$rc" -eq 0 ]; then sleep 3; home_checkpoint 5s; fi
if [ "$rc" -eq 0 ]; then sleep 5; home_checkpoint 10s; fi
if [ "$rc" -eq 0 ]; then sleep 10; home_checkpoint 20s; fi

capture_profile_diagnostics() {
  local label="$1"
  local xml="owner-profile-${label}.xml"
  timeout 10s adb wait-for-device >/dev/null 2>&1 || true
  timeout 10s adb shell pidof com.ivxholdings.app.owner > "owner-profile-${label}-pid.txt" 2>&1 || true
  timeout 20s adb shell uiautomator dump "/sdcard/${xml}" >/dev/null 2>&1 || true
  timeout 20s adb pull "/sdcard/${xml}" "$xml" >/dev/null 2>&1 || true
  timeout 15s adb exec-out screencap -p > "owner-profile-${label}.png" 2>/dev/null || true
  timeout 20s adb logcat -d -v threadtime > "owner-profile-${label}-logcat.txt" 2>&1 || true
}

profile_checkpoint() {
  local label="$1"
  local xml="owner-profile-${label}.xml"
  capture_profile_diagnostics "$label"
  test -s "owner-profile-${label}-pid.txt" || rc=97
  test -s "$xml" || rc=98
  grep -q 'text="Profile"' "$xml" 2>/dev/null || rc=99
  grep -q 'resource-id="tab-profile"' "$xml" 2>/dev/null || rc=100
}

# Profile regression recorded on a real Android device: Home remained healthy,
# then tapping the Profile tab produced only the dark app background. Clear the
# log immediately before the tap so any React/native exception can be attributed
# to Profile rather than startup noise.
if [ "$rc" -eq 0 ]; then
  adb logcat -c >/dev/null 2>&1 || true
  timeout 90s "$MAESTRO" test expo/.maestro/ivx-owner-profile-certificate.yaml \
    --format junit \
    --output owner-profile-maestro.xml
  profile_maestro_rc=$?

  # Always collect evidence even when the Maestro assertion fails. This is the
  # fail-closed diagnostic path that catches black screens/crashes.
  capture_profile_diagnostics failure-or-pass
  if [ "$profile_maestro_rc" -ne 0 ]; then
    rc=$profile_maestro_rc
  fi
fi

if [ "$rc" -eq 0 ]; then profile_checkpoint immediate; fi
if [ "$rc" -eq 0 ]; then sleep 2; profile_checkpoint 2s; fi
if [ "$rc" -eq 0 ]; then sleep 3; profile_checkpoint 5s; fi
if [ "$rc" -eq 0 ]; then sleep 5; profile_checkpoint 10s; fi

exit "$rc"
