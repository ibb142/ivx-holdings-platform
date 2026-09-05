#!/usr/bin/env bash
set -euo pipefail

: "${APK_PATH:?APK_PATH is required}"
: "${OWNER_EMAIL:?OWNER_EMAIL is required}"
: "${OWNER_PASSWORD_EFFECTIVE:?OWNER_PASSWORD_EFFECTIVE is required}"

mkdir -p qa/evidence/dashboard-chat

# Always capture diagnostics on failure so a hung/failed certificate is actionable.
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

# 4) Full app human-depth circulation. This is intentionally fail-closed: every
# navigable Expo route must be opened on the real Android app, visibly render,
# survive scroll/back navigation, keep the process alive and show no fatal/error
# state. Dynamic route parameters receive deterministic QA values and are not skipped.
timeout 3600s bash scripts/ivx-all-modules-human-depth-e2e.sh

# Fail-closed process/UI evidence after all flows.
timeout 10s adb shell pidof com.ivxholdings.app.owner > qa/evidence/dashboard-chat/process.txt
adb exec-out screencap -p > qa/evidence/dashboard-chat/final.png || true
adb logcat -d -v threadtime > qa/evidence/dashboard-chat/logcat.txt || true

test -s qa/evidence/dashboard-chat/process.txt
test "$(jq -r '.passed' qa/evidence/all-modules-human-depth/certificate.json)" = true
test "$(jq -r '.failedRoutes' qa/evidence/all-modules-human-depth/certificate.json)" = 0

jq -n \
  --arg sha "${GITHUB_SHA:-unknown}" \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson moduleRoutes "$(jq -r '.testedRoutes' qa/evidence/all-modules-human-depth/certificate.json)" \
  '{certificate:"IVX-DASHBOARD-CHAT-E2E",passed:true,sourceSha:$sha,realOwnerLogin:true,dashboardRoute:"/admin/dashboard",dashboardRendered:true,dashboardScrolled:true,chatOpened:true,liveAIReply:true,chatPersistenceAfterRestart:true,allModulesHumanDepth:true,testedModuleRoutes:$moduleRoutes,processAlive:true,secretValuesReturned:false,verifiedAt:$verifiedAt}' \
  > qa/evidence/dashboard-chat/certificate.json
cat qa/evidence/dashboard-chat/certificate.json

trap - EXIT
