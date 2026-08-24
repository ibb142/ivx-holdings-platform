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

# Profile black-screen certification only applies to builds containing the
# fail-safe Profile screen (IVX_PROFILE_FULL_FAILSAFE_MARKER in the JS bundle).
# The fast-retest workflow reuses the pinned pre-repair APK, which cannot
# contain that marker; for that APK the Profile section below is skipped and
# this script certifies exactly what that workflow exists to prove: Owner Home
# stays visible on the exact shipped APK. Profile certification for the current
# source SHA runs in the fresh-APK "IVX Owner Sign In + Home/Profile Android
# Certificate" workflow, which builds the APK from the same commit.
PROFILE_CERT_CAPABLE=0
command -v unzip >/dev/null 2>&1 || {
  echo "::error::unzip is required for Profile certification capability detection"
  exit 120
}
# NOTE: do NOT pipe `unzip -p` into `grep -q` here. Under `set -o pipefail` the
# early-exiting grep gets unzip killed by SIGPIPE (exit 141), which flips the
# guard to 0 even when the fail-safe marker IS present — that false skip once
# produced a green Android certificate run without certifying Profile. Dump to
# a temp file and grep the file instead. Any bundle read failure fails closed.
# IVX IA (owner AI) chat certification applies only to builds that carry the
# chat certificate composer marker (accessibilityLabel on the composer dock).
# The pinned pre-repair APK of the fast-retest workflow predates that marker,
# so chat is skipped there exactly like Profile; fresh-APK certificate runs
# (pull_request + post-merge push on main) always carry it.
CHAT_CERT_CAPABLE=0
PROFILE_BUNDLE_DUMP="$(mktemp)"
if unzip -p "$APK_PATH" assets/index.android.bundle > "$PROFILE_BUNDLE_DUMP" 2>/dev/null; then
  if grep -q "IVX_PROFILE_FULL_FAILSAFE_MARKER" "$PROFILE_BUNDLE_DUMP"; then
    PROFILE_CERT_CAPABLE=1
  fi
  if grep -q "IVX owner chat certificate v1" "$PROFILE_BUNDLE_DUMP"; then
    CHAT_CERT_CAPABLE=1
  fi
else
  rm -f "$PROFILE_BUNDLE_DUMP"
  echo "::error::cannot read assets/index.android.bundle from $APK_PATH — Profile certification capability is undecidable"
  exit 121
fi
rm -f "$PROFILE_BUNDLE_DUMP"
echo "profile_certification_capable=$PROFILE_CERT_CAPABLE"
echo "chat_certification_capable=$CHAT_CERT_CAPABLE"

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
  grep -q 'resource-id="profile-screen-root"' "$xml" 2>/dev/null || rc=99
  grep -q 'text="Profile"' "$xml" 2>/dev/null || rc=100
  grep -q 'resource-id="tab-profile"' "$xml" 2>/dev/null || rc=101
}

# Profile regression recorded on a real Android device: Home remained healthy,
# then tapping the Profile tab produced only the dark app background. Clear the
# log immediately before the tap so any React/native exception can be attributed
# to Profile rather than startup noise.
if [ "$rc" -eq 0 ] && [ "$PROFILE_CERT_CAPABLE" -eq 1 ]; then
  adb logcat -c >/dev/null 2>&1 || true
  timeout 150s "$MAESTRO" test expo/.maestro/ivx-owner-profile-certificate.yaml \
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

if [ "$rc" -eq 0 ] && [ "$PROFILE_CERT_CAPABLE" -eq 1 ]; then profile_checkpoint immediate; fi
if [ "$rc" -eq 0 ] && [ "$PROFILE_CERT_CAPABLE" -eq 1 ]; then sleep 2; profile_checkpoint 2s; fi
if [ "$rc" -eq 0 ] && [ "$PROFILE_CERT_CAPABLE" -eq 1 ]; then sleep 3; profile_checkpoint 5s; fi
if [ "$rc" -eq 0 ] && [ "$PROFILE_CERT_CAPABLE" -eq 1 ]; then sleep 5; profile_checkpoint 10s; fi

capture_chat_diagnostics() {
  local label="$1"
  local xml="owner-chat-${label}.xml"
  timeout 10s adb wait-for-device >/dev/null 2>&1 || true
  timeout 10s adb shell pidof com.ivxholdings.app.owner > "owner-chat-${label}-pid.txt" 2>&1 || true
  timeout 20s adb shell uiautomator dump "/sdcard/${xml}" >/dev/null 2>&1 || true
  timeout 20s adb pull "/sdcard/${xml}" "$xml" >/dev/null 2>&1 || true
  timeout 15s adb exec-out screencap -p > "owner-chat-${label}.png" 2>/dev/null || true
  timeout 20s adb logcat -d -v threadtime > "owner-chat-${label}-logcat.txt" 2>&1 || true
}

chat_checkpoint() {
  local label="$1"
  local xml="owner-chat-${label}.xml"
  capture_chat_diagnostics "$label"
  test -s "owner-chat-${label}-pid.txt" || rc=110
  test -s "$xml" || rc=111
  grep -q 'resource-id="ivx-owner-chat-composer-dock"' "$xml" 2>/dev/null || rc=112
  grep -q 'resource-id="ivx-owner-chat-input"' "$xml" 2>/dev/null || rc=113
  grep -q 'text="QA cert probe chat check"' "$xml" 2>/dev/null || rc=114
  grep -q 'resource-id="tab-chat"' "$xml" 2>/dev/null || rc=115
}

# IVX IA chat certificate — third Maestro flow on the same real owner session.
# The composer and thread render locally; the sent message must land in the
# thread exactly once (owner's 20-step contract, steps 3-8). Fail closed.
if [ "$rc" -eq 0 ] && [ "$CHAT_CERT_CAPABLE" -eq 1 ]; then
  adb logcat -c >/dev/null 2>&1 || true
  timeout 150s "$MAESTRO" test expo/.maestro/ivx-owner-chat-certificate.yaml \
    --format junit \
    --output owner-chat-maestro.xml
  chat_maestro_rc=$?

  # Always collect evidence even when the Maestro assertion fails.
  capture_chat_diagnostics failure-or-pass
  if [ "$chat_maestro_rc" -ne 0 ]; then
    rc=$chat_maestro_rc
  fi
fi

if [ "$rc" -eq 0 ] && [ "$CHAT_CERT_CAPABLE" -eq 1 ]; then chat_checkpoint immediate; fi
if [ "$rc" -eq 0 ] && [ "$CHAT_CERT_CAPABLE" -eq 1 ]; then sleep 2; chat_checkpoint 2s; fi
if [ "$rc" -eq 0 ] && [ "$CHAT_CERT_CAPABLE" -eq 1 ]; then sleep 3; chat_checkpoint 5s; fi
if [ "$rc" -eq 0 ] && [ "$CHAT_CERT_CAPABLE" -eq 1 ]; then sleep 5; chat_checkpoint 10s; fi

# NOTE: no in-run second cold launch. A fourth consecutive Maestro flow on the
# software-rendered emulator hangs the device (evidence: run 32737607402 — the
# cold2 profile flow produced no output for its entire 150s timeout). Each
# workflow run IS a full cold launch (fresh emulator, fresh install, real owner
# sign-in), so the second-cold-launch requirement is certified by executing
# this certificate workflow a second time on the merge SHA.

exit "$rc"
