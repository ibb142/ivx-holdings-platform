#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path is required}"
PACKAGE_NAME="${2:?Android package name is required}"
SCREENSHOT_PATH="${3:-android-launch.png}"
LOGCAT_PATH="${4:-android-runtime-logcat.txt}"
LAUNCH_PATH="${5:-android-launch.txt}"
VERSION_PATH="${6:-android-package-version.txt}"

adb install -r "$APK_PATH"
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
