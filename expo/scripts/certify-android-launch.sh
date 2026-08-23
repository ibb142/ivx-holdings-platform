#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path is required}"
PACKAGE_NAME="${2:?Android package name is required}"
SCREENSHOT_PATH="${3:-android-launch.png}"
LOGCAT_PATH="${4:-android-runtime-logcat.txt}"
LAUNCH_PATH="${5:-android-launch.txt}"
VERSION_PATH="${6:-android-package-version.txt}"
EXPECTED_TEXT="${7:-}"

adb wait-for-device

install_apk() {
  local attempt
  for attempt in 1 2 3; do
    if adb shell cmd package list packages >/dev/null 2>&1 && adb install -r "$APK_PATH"; then
      return 0
    fi
    echo "APK install attempt $attempt failed; waiting for Android package services" >&2
    sleep $((attempt * 5))
    adb reconnect >/dev/null 2>&1 || true
    adb wait-for-device
  done
  echo "APK installation failed after 3 attempts" >&2
  return 1
}

resolve_component() {
  local component
  component="$(adb shell cmd package resolve-activity --brief "$PACKAGE_NAME" | tr -d '\r' | tail -1)"
  if [[ -z "$component" || "$component" != */* ]]; then
    echo "Unable to resolve launcher activity for $PACKAGE_NAME" >&2
    return 1
  fi
  printf '%s' "$component"
}

assert_visible_text() {
  local expected="$1"
  local label="$2"
  local dump_path="${LAUNCH_PATH%.txt}-${label}-ui.xml"
  if [[ -z "$expected" ]]; then
    return 0
  fi
  adb shell uiautomator dump /sdcard/ivx-window.xml >/dev/null
  adb shell cat /sdcard/ivx-window.xml > "$dump_path"
  if ! grep -F "$expected" "$dump_path" >/dev/null; then
    echo "Visible UI certification failed at ${label}: expected text not visible: $expected" >&2
    adb exec-out screencap -p > "${SCREENSHOT_PATH%.png}-${label}-FAIL.png" || true
    return 1
  fi
  echo "Verified visible runtime text at ${label}: $expected" | tee -a "$LAUNCH_PATH"
}

assert_process_alive() {
  local label="$1"
  local pid
  pid="$(adb shell pidof "$PACKAGE_NAME" | tr -d '\r')"
  if [[ -z "$pid" ]]; then
    echo "App process exited during ${label}" >&2
    return 1
  fi
  echo "Process alive at ${label}: PID=$pid" | tee -a "$LAUNCH_PATH"
}

install_apk
COMPONENT="$(resolve_component)"
adb shell am force-stop "$PACKAGE_NAME"
adb logcat -c
adb shell am start -W -n "$COMPONENT" | tee "$LAUNCH_PATH"

# The prior gate only waited 15 seconds and checked PID/fatal native events.
# A blank React Navigation frame can keep the process alive, so that gate could
# certify a visually broken app. Assert real visible UI repeatedly across the
# delayed auth sign-out window that caused the physical-device regression.
sleep 6
assert_process_alive "t+6s"
assert_visible_text "$EXPECTED_TEXT" "t6"

sleep 10
assert_process_alive "t+16s"
assert_visible_text "$EXPECTED_TEXT" "t16"

# Restart once without reinstalling. This catches persisted-state/re-entry races
# and proves the same installed package can cold-launch twice to visible UI.
adb shell am force-stop "$PACKAGE_NAME"
adb shell am start -W -n "$COMPONENT" | tee -a "$LAUNCH_PATH"
sleep 8
assert_process_alive "restart+8s"
assert_visible_text "$EXPECTED_TEXT" "restart8"

adb logcat -d -v threadtime > "$LOGCAT_PATH"
adb exec-out screencap -p > "$SCREENSHOT_PATH"

if grep -E "FATAL EXCEPTION|Fatal signal|Process ${PACKAGE_NAME} .* has died" "$LOGCAT_PATH"; then
  echo "Fatal Android runtime event detected during certification" >&2
  exit 1
fi

# Fail on uncaught JS/runtime errors that would leave a live Android process with
# an unusable React surface. Route warnings and ordinary console warnings are not
# treated as fatal here; visible UI assertions above are the primary liveness gate.
if grep -E "ReactNativeJS:.*(TypeError:|ReferenceError:|RangeError:|IVX Runtime Error|IVX Render Error)" "$LOGCAT_PATH"; then
  echo "Fatal-looking React Native runtime error detected" >&2
  grep -E "ReactNativeJS:.*(TypeError:|ReferenceError:|RangeError:|IVX Runtime Error|IVX Render Error)" "$LOGCAT_PATH" | tail -100 >&2
  exit 1
fi

echo "Visible cold-launch certification passed twice with component=$COMPONENT"
adb shell dumpsys package "$PACKAGE_NAME" | grep -E 'versionName=|versionCode=' | head -2 | tee "$VERSION_PATH"
