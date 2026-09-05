#!/usr/bin/env bash
set -euo pipefail

: "${APK_PATH:?APK_PATH is required}"
: "${OWNER_EMAIL:?OWNER_EMAIL is required}"
: "${OWNER_PASSWORD_EFFECTIVE:?OWNER_PASSWORD_EFFECTIVE is required}"
: "${EXPO_PUBLIC_SUPABASE_URL:?EXPO_PUBLIC_SUPABASE_URL is required}"
: "${EXPO_PUBLIC_SUPABASE_ANON_KEY:?EXPO_PUBLIC_SUPABASE_ANON_KEY is required}"

mkdir -p qa/evidence/dashboard-chat

# Always capture diagnostics on failure so a hung/failed certificate is actionable.
trap 'rc=$?; adb exec-out screencap -p > qa/evidence/dashboard-chat/failure.png 2>/dev/null || true; adb logcat -d -v threadtime > qa/evidence/dashboard-chat/failure-logcat.txt 2>/dev/null || true; exit $rc' EXIT

# Auth preflight: obtain the same real Supabase owner session the app uses and
# prove the production owner-ai guard accepts it. This prevents a missing
# Authorization header from being mistaken for a chat/runtime failure.
auth_payload=$(jq -cn \
  --arg email "$OWNER_EMAIL" \
  --arg password "$OWNER_PASSWORD_EFFECTIVE" \
  '{email:$email,password:$password}')
auth_response=$(curl -fsS --max-time 30 \
  -X POST "${EXPO_PUBLIC_SUPABASE_URL%/}/auth/v1/token?grant_type=password" \
  -H "apikey: ${EXPO_PUBLIC_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${EXPO_PUBLIC_SUPABASE_ANON_KEY}" \
  -H 'Content-Type: application/json' \
  --data "$auth_payload")
owner_access_token=$(printf '%s' "$auth_response" | jq -r '.access_token // empty')
test -n "$owner_access_token"
echo "::add-mask::$owner_access_token"

auth_diagnostic=$(curl -fsS --max-time 30 \
  -X POST https://api.ivxholding.com/api/ivx/owner-ai/auth-diagnostic \
  -H "Authorization: Bearer ${owner_access_token}" \
  -H 'Content-Type: application/json' \
  --data '{}')
printf '%s' "$auth_diagnostic" > qa/evidence/dashboard-chat/owner-auth-diagnostic.json
jq -e '
  .ok == true and
  .checks.issuerMatchesBackendProject == true and
  .checks.tokenExpired == false and
  .checks.supabaseSessionValid == true and
  .checks.ownerEmailAllowlisted == true
' qa/evidence/dashboard-chat/owner-auth-diagnostic.json >/dev/null
echo 'owner_ai_bearer_preflight=PASS'

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

# Fail-closed process/UI evidence after all flows.
timeout 10s adb shell pidof com.ivxholdings.app.owner > qa/evidence/dashboard-chat/process.txt
adb exec-out screencap -p > qa/evidence/dashboard-chat/final.png || true
adb logcat -d -v threadtime > qa/evidence/dashboard-chat/logcat.txt || true

test -s qa/evidence/dashboard-chat/process.txt

jq -n \
  --arg sha "${GITHUB_SHA:-unknown}" \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{certificate:"IVX-DASHBOARD-CHAT-E2E",passed:true,sourceSha:$sha,ownerBearerPreflight:true,realOwnerLogin:true,dashboardRoute:"/admin/dashboard",dashboardRendered:true,dashboardScrolled:true,chatOpened:true,liveAIReply:true,chatPersistenceAfterRestart:true,processAlive:true,secretValuesReturned:false,verifiedAt:$verifiedAt}' \
  > qa/evidence/dashboard-chat/certificate.json
cat qa/evidence/dashboard-chat/certificate.json

trap - EXIT
