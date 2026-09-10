#!/usr/bin/env bash
set -euo pipefail

: "${APK_PATH:?APK_PATH is required}"
: "${OWNER_EMAIL:?OWNER_EMAIL is required}"
: "${OWNER_PASSWORD_EFFECTIVE:?OWNER_PASSWORD_EFFECTIVE is required}"
: "${EXPO_PUBLIC_SOURCE_COMMIT_SHA:?EXPO_PUBLIC_SOURCE_COMMIT_SHA is required}"

# Pull-request GITHUB_SHA can name a synthetic merge commit. The APK is built
# from the pinned source head, so use that same identity for its certificate.
SOURCE_SHA="$(git rev-parse HEAD)"
test "$SOURCE_SHA" = "$EXPO_PUBLIC_SOURCE_COMMIT_SHA"
APK_SHA256="$(sha256sum "$APK_PATH" | awk '{print $1}')"

APP_ID="${IVX_APP_ID:-com.ivxholdings.app.owner}"
case "$APP_ID" in com.ivxholdings.app|com.ivxholdings.app.owner) ;; *) echo 'Unsupported IVX package' >&2; exit 1;; esac
FLOW_DIR="qa/evidence/dashboard-chat/flows"
mkdir -p "$FLOW_DIR"
# Reuse identical assertions against the installed release or QA package.
for name in home dashboard chat mission public-handoff reauthenticate; do
  sed "s/^appId: com.ivxholdings.app.owner$/appId: $APP_ID/" \
    "expo/.maestro/ivx-owner-${name}-certificate.yaml" > "$FLOW_DIR/${name}.yaml"
done

trap 'rc=$?; adb exec-out screencap -p > qa/evidence/dashboard-chat/failure.png 2>/dev/null || true; adb logcat -d -v threadtime > qa/evidence/dashboard-chat/failure-logcat.txt 2>/dev/null || true; exit $rc' EXIT

UI_FAILURES=0
record_flow_failure() {
  local name="$1"
  UI_FAILURES=$((UI_FAILURES + 1))
  mkdir -p "qa/evidence/dashboard-chat/failures/$name"
  adb exec-out screencap -p > "qa/evidence/dashboard-chat/failures/$name/screen.png" 2>/dev/null || true
  adb logcat -d -v threadtime > "qa/evidence/dashboard-chat/failures/$name/logcat.txt" 2>/dev/null || true
}

timeout 120s adb install -r "$APK_PATH"
timeout 30s adb wait-for-device

timeout 90s bash -lc 'curl --fail --show-error --location --max-time 60 https://get.maestro.mobile.dev | bash'
MAESTRO="${HOME}/.maestro/bin/maestro"
test -x "$MAESTRO"
timeout 20s "$MAESTRO" --version

# 1) Real Owner sign-in and Home paint.
timeout 240s "$MAESTRO" test "$FLOW_DIR/home.yaml" \
  --env OWNER_EMAIL="$OWNER_EMAIL" \
  --env OWNER_PASSWORD="$OWNER_PASSWORD_EFFECTIVE" \
  --format junit \
  --output qa/evidence/dashboard-chat/owner-login-home.xml

# 2) Real authenticated Admin Dashboard navigation/render/scroll.
timeout 180s "$MAESTRO" test "$FLOW_DIR/dashboard.yaml" \
  --format junit \
  --output qa/evidence/dashboard-chat/dashboard.xml

# 3) IVX IA Chat: live AI reply + durable thread across restart.
# An old reply already in persistent history must never satisfy a new run.
IVX_CHAT_E2E_NONCE="$(node -e 'console.log(require("node:crypto").randomUUID().replace(/-/g,""))')"
CHAT_E2E_SUFFIX="$IVX_CHAT_E2E_NONCE"
if ! timeout 480s "$MAESTRO" test "$FLOW_DIR/chat.yaml" \
  --env OWNER_EMAIL="$OWNER_EMAIL" \
  --env OWNER_PASSWORD="$OWNER_PASSWORD_EFFECTIVE" \
  --env CHAT_E2E_SUFFIX="$CHAT_E2E_SUFFIX" \
  --format junit \
  --output qa/evidence/dashboard-chat/chat.xml; then
  record_flow_failure chat
fi

# 4) Aviation mission dashboard: complete live roster and restart navigation.
if ! timeout 300s "$MAESTRO" test "$FLOW_DIR/mission.yaml" \
  --env OWNER_EMAIL="$OWNER_EMAIL" \
  --env OWNER_PASSWORD="$OWNER_PASSWORD_EFFECTIVE" \
  --format junit --output qa/evidence/dashboard-chat/mission.xml; then
  record_flow_failure mission
fi

# 5) The installed APK creates one real read-only task over authenticated SSE.
export IVX_HANDOFF_NONCE="native-${IVX_CHAT_E2E_NONCE}"
# Android injects individual key events; include typing time as well as the
# bounded live handoff wait before terminating the instrumentation process.
timeout 420s "$MAESTRO" test "$FLOW_DIR/public-handoff.yaml" \
  --env IVX_HANDOFF_NONCE="$IVX_HANDOFF_NONCE" \
  --debug-output qa/evidence/dashboard-chat/native-handoff-debug \
  --format junit --output qa/evidence/dashboard-chat/native-handoff.xml
# Maestro copies the rendered response through the same accessibility driver
# that passed the assertions. Android's separate uiautomator dump requires an
# idle window and fails on the chat's continuous decorative animation.
IVX_HANDOFF_JOB_ID="$(python3 scripts/ivx-native-handoff-identity.py \
  qa/evidence/dashboard-chat/native-handoff-debug "$IVX_HANDOFF_NONCE")"
export IVX_HANDOFF_JOB_ID
node scripts/ivx-autonomous-handoff-live-cert.mjs

# Collect independent chat/mission evidence in one build, but every original
# assertion remains mandatory before the full route suite or PASS certificate.
test "$UI_FAILURES" -eq 0

# 6) Reuse the same authenticated owner session and physically open/scroll every
# Expo Router screen. Any crash, fatal banner, process death, timeout, or route
# that cannot paint fails the entire certificate.
IVX_REUSE_AUTHENTICATED_SESSION=true bash scripts/ivx-all-routes-human-e2e.sh

timeout 10s adb shell pidof "$APP_ID" > qa/evidence/dashboard-chat/process.txt
adb exec-out screencap -p > qa/evidence/dashboard-chat/final.png || true
adb logcat -d -v threadtime > qa/evidence/dashboard-chat/logcat.txt || true

test -s qa/evidence/dashboard-chat/process.txt
jq -e '.passed == true and .coveragePercent == 100' \
  qa/evidence/all-routes-human-e2e/certificate.json >/dev/null

jq -n \
  --arg sha "$SOURCE_SHA" \
  --arg apkSha256 "$APK_SHA256" \
  --arg appId "$APP_ID" \
  --arg chatProbeNonce "$IVX_CHAT_E2E_NONCE" \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson totalRoutes "$(jq -r '.totalRoutes' qa/evidence/all-routes-human-e2e/certificate.json)" \
  '{certificate:"IVX-DASHBOARD-CHAT-ALL-ROUTES-E2E",passed:true,sourceSha:$sha,apkSha256:$apkSha256,appId:$appId,missionControlRendered:true,missionLiveTelemetry:true,missionRoster112:true,nativeAutonomousHandoffCompleted:true,chatProbeNonce:$chatProbeNonce,realOwnerLogin:true,dashboardRoute:"/admin/dashboard",dashboardRendered:true,dashboardScrolled:true,chatOpened:true,liveAIReply:true,chatPersistenceAfterRestart:true,manualReauthenticationAfterRestart:true,allExpoRoutesAndroidSmokePassed:true,totalRoutes:$totalRoutes,routeCoveragePercent:100,processAlive:true,secretValuesReturned:false,verifiedAt:$verifiedAt}' \
  > qa/evidence/dashboard-chat/certificate.json
cat qa/evidence/dashboard-chat/certificate.json

trap - EXIT
