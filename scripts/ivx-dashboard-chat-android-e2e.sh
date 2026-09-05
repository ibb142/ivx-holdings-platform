#!/usr/bin/env bash
set -euo pipefail

: "${APK_PATH:?APK_PATH is required}"
: "${OWNER_EMAIL:?OWNER_EMAIL is required}"
: "${OWNER_PASSWORD_EFFECTIVE:?OWNER_PASSWORD_EFFECTIVE is required}"

mkdir -p qa/evidence/dashboard-chat

trap 'rc=$?; adb exec-out screencap -p > qa/evidence/dashboard-chat/failure.png 2>/dev/null || true; adb logcat -d -v threadtime > qa/evidence/dashboard-chat/failure-logcat.txt 2>/dev/null || true; exit $rc' EXIT

timeout 120s adb install -r "$APK_PATH"
timeout 30s adb wait-for-device

timeout 90s bash -lc 'curl --fail --show-error --location --max-time 60 https://get.maestro.mobile.dev | bash'
MAESTRO="${HOME}/.maestro/bin/maestro"
test -x "$MAESTRO"
timeout 20s "$MAESTRO" --version

# 1) Real Owner sign-in and Home paint.
timeout 240s "$MAESTRO" test expo/.maestro/ivx-owner-home-certificate.yaml \
  --env OWNER_EMAIL="$OWNER_EMAIL" \
  --env OWNER_PASSWORD="$OWNER_PASSWORD_EFFECTIVE" \
  --format junit \
  --output qa/evidence/dashboard-chat/owner-login-home.xml

# 2) Real authenticated Admin Dashboard navigation/render/scroll.
timeout 180s "$MAESTRO" test expo/.maestro/ivx-owner-dashboard-certificate.yaml \
  --format junit \
  --output qa/evidence/dashboard-chat/dashboard.xml

# 3) IVX IA Chat: live AI reply + durable thread across restart.
timeout 240s "$MAESTRO" test expo/.maestro/ivx-owner-chat-certificate.yaml \
  --format junit \
  --output qa/evidence/dashboard-chat/chat.xml

# 4) Reuse the same authenticated owner session and physically open/scroll every
# Expo Router screen. Any crash, fatal banner, process death, timeout, or route
# that cannot paint fails the entire certificate.
IVX_REUSE_AUTHENTICATED_SESSION=true bash scripts/ivx-all-routes-human-e2e.sh

timeout 10s adb shell pidof com.ivxholdings.app.owner > qa/evidence/dashboard-chat/process.txt
adb exec-out screencap -p > qa/evidence/dashboard-chat/final.png || true
adb logcat -d -v threadtime > qa/evidence/dashboard-chat/logcat.txt || true

test -s qa/evidence/dashboard-chat/process.txt
test "$(jq -r '.passed' qa/evidence/all-routes-human-e2e/certificate.json)" = true
test "$(jq -r '.coveragePercent' qa/evidence/all-routes-human-e2e/certificate.json)" = 100

jq -n \
  --arg sha "${GITHUB_SHA:-unknown}" \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson totalRoutes "$(jq -r '.totalRoutes' qa/evidence/all-routes-human-e2e/certificate.json)" \
  '{certificate:"IVX-DASHBOARD-CHAT-ALL-ROUTES-E2E",passed:true,sourceSha:$sha,realOwnerLogin:true,dashboardRoute:"/admin/dashboard",dashboardRendered:true,dashboardScrolled:true,chatOpened:true,liveAIReply:true,chatPersistenceAfterRestart:true,allExpoRoutesHumanPatrolled:true,totalRoutes:$totalRoutes,routeCoveragePercent:100,processAlive:true,secretValuesReturned:false,verifiedAt:$verifiedAt}' \
  > qa/evidence/dashboard-chat/certificate.json
cat qa/evidence/dashboard-chat/certificate.json

trap - EXIT
