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

# Emulator package services can become reachable several seconds after ADB.
# Retry installation after verifying the package manager instead of treating a
# transient binder "Broken pipe" as an application launch failure.
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

install_apk
adb shell am force-stop "$PACKAGE_NAME"
adb logcat -c

COMPONENT="$(adb shell cmd package resolve-activity --brief "$PACKAGE_NAME" | tr -d '\r' | tail -1)"
if [[ -z "$COMPONENT" || "$COMPONENT" != */* ]]; then
  echo "Unable to resolve launcher activity for $PACKAGE_NAME" >&2
  exit 1
fi

adb shell am start -W -n "$COMPONENT" | tee "$LAUNCH_PATH"
sleep 15
adb logcat -d -v threadtime > "$LOGCAT_PATH"
adb exec-out screencap -p > "$SCREENSHOT_PATH"

if [[ -n "$EXPECTED_TEXT" ]]; then
  UI_DUMP_PATH="${LAUNCH_PATH%.txt}-ui.xml"
  adb shell uiautomator dump /sdcard/ivx-window.xml >/dev/null
  adb shell cat /sdcard/ivx-window.xml > "$UI_DUMP_PATH"
  if ! grep -F "$EXPECTED_TEXT" "$UI_DUMP_PATH"; then
    echo "Expected runtime text was not visible: $EXPECTED_TEXT" >&2
    exit 1
  fi
  echo "Verified visible runtime text: $EXPECTED_TEXT" | tee -a "$LAUNCH_PATH"
fi

PID="$(adb shell pidof "$PACKAGE_NAME" | tr -d '\r')"
if [[ -z "$PID" ]]; then
  echo "Production app process exited during cold-launch certification" >&2
  tail -300 "$LOGCAT_PATH"
  exit 1
fi

if grep -E "FATAL EXCEPTION|Fatal signal|Process ${PACKAGE_NAME} .* has died" "$LOGCAT_PATH"; then
  echo "Fatal Android runtime event detected during cold launch" >&2
  exit 1
fi

echo "Cold launch survived for 15 seconds with PID=$PID and component=$COMPONENT"
adb shell dumpsys package "$PACKAGE_NAME" | grep -E 'versionName=|versionCode=' | head -2 | tee "$VERSION_PATH"
