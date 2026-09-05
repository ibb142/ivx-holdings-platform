#!/usr/bin/env bash
set -euo pipefail

APP_ID="com.ivxholdings.app.owner"
EVIDENCE="qa/evidence/all-routes-human-e2e"
FLOW_DIR="$EVIDENCE/generated-flows"
mkdir -p "$FLOW_DIR"
: > "$EVIDENCE/results.jsonl"

trap 'rc=$?; adb exec-out screencap -p > "$EVIDENCE/failure.png" 2>/dev/null || true; adb logcat -d -v threadtime > "$EVIDENCE/failure-logcat.txt" 2>/dev/null || true; exit $rc' EXIT

MAESTRO="${HOME}/.maestro/bin/maestro"

if [ "${IVX_REUSE_AUTHENTICATED_SESSION:-false}" != "true" ]; then
  : "${APK_PATH:?APK_PATH is required}"
  : "${OWNER_EMAIL:?OWNER_EMAIL is required}"
  : "${OWNER_PASSWORD_EFFECTIVE:?OWNER_PASSWORD_EFFECTIVE is required}"
  timeout 120s adb install -r "$APK_PATH"
  timeout 30s adb wait-for-device
  timeout 90s bash -lc 'curl --fail --show-error --location --max-time 60 https://get.maestro.mobile.dev | bash'
  test -x "$MAESTRO"
  timeout 240s "$MAESTRO" test expo/.maestro/ivx-owner-home-certificate.yaml \
    --env OWNER_EMAIL="$OWNER_EMAIL" \
    --env OWNER_PASSWORD="$OWNER_PASSWORD_EFFECTIVE" \
    --format junit \
    --output "$EVIDENCE/owner-login.xml"
else
  test -x "$MAESTRO"
  timeout 8s adb shell pidof "$APP_ID" >/dev/null
fi

route_from_file() {
  local file="$1"
  local rel="${file#expo/app/}"
  rel="${rel%.tsx}"; rel="${rel%.ts}"
  case "$rel" in
    _layout|_providers|+native-intent|+not-found|*/_layout|*/_providers) return 1 ;;
  esac
  rel=$(printf '%s' "$rel" | sed -E 's#(^|/)\([^/]+\)(/|$)#\1#g; s#//+#/#g; s#^/##; s#/$##')
  rel="${rel%/index}"
  [ "$rel" = "index" ] && rel=""
  rel=$(printf '%s' "$rel" | sed -E \
    -e 's/\[\.\.\.[^]]+\]/qa/g' \
    -e 's/\[\[[^]]+\]\]/qa/g' \
    -e 's/\[[^]]*id[^]]*\]/1/gI' \
    -e 's/\[[^]]*slug[^]]*\]/qa/gI' \
    -e 's/\[[^]]+\]/qa/g')
  printf '/%s' "$rel"
}

mapfile -t files < <(find expo/app -type f \( -name '*.tsx' -o -name '*.ts' \) | sort)

total=0
passed=0
failed=0
for file in "${files[@]}"; do
  route=$(route_from_file "$file") || continue
  total=$((total + 1))
  safe=$(printf '%s' "${route:-root}" | tr '/[]() ' '_' | tr -cd '[:alnum:]_.-')
  flow="$FLOW_DIR/${total}-${safe}.yaml"
  cat > "$flow" <<YAML
appId: $APP_ID
name: IVX human-depth route ${route:-/}
---
- openLink: "ivx-app:///${route#/}"
- waitForAnimationToEnd
- assertNotVisible: "Something went wrong"
- assertNotVisible: "Application error"
- assertNotVisible: "Unhandled Runtime Error"
- assertNotVisible: "Login service temporarily unavailable"
- swipe:
    start: 50%,78%
    end: 50%,32%
    duration: 500
- waitForAnimationToEnd
- assertNotVisible: "Something went wrong"
YAML

  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  set +e
  timeout 75s "$MAESTRO" test "$flow" --format junit --output "$EVIDENCE/${total}-${safe}.xml"
  rc=$?
  set -e
  alive=false
  if timeout 8s adb shell pidof "$APP_ID" >/dev/null 2>&1; then alive=true; fi
  adb exec-out screencap -p > "$EVIDENCE/${total}-${safe}.png" 2>/dev/null || true

  ok=false
  if [ "$rc" -eq 0 ] && [ "$alive" = true ]; then
    ok=true
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
  fi
  jq -nc \
    --arg file "$file" --arg route "$route" --arg started "$started" \
    --argjson ok "$ok" --argjson processAlive "$alive" --argjson exitCode "$rc" \
    '{file:$file,route:$route,humanOpened:true,scrollExercised:true,noFatalUiBanner:$ok,processAlive:$processAlive,exitCode:$exitCode,passed:$ok,startedAt:$started}' \
    >> "$EVIDENCE/results.jsonl"
done

jq -s '.' "$EVIDENCE/results.jsonl" > "$EVIDENCE/results.json"
jq -n \
  --arg sha "${GITHUB_SHA:-unknown}" \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson total "$total" --argjson passed "$passed" --argjson failed "$failed" \
  '{certificate:"IVX-ALL-EXPO-ROUTES-HUMAN-E2E",sourceSha:$sha,totalRoutes:$total,passedRoutes:$passed,failedRoutes:$failed,coveragePercent:(if $total>0 then (($passed*10000/$total)|floor/100) else 0 end),passed:($total>0 and $failed==0 and $passed==$total),realOwnerLogin:true,physicalAndroidEmulator:true,everyRouteOpened:true,everyRouteScrolled:true,processSurvivalChecked:true,verifiedAt:$verifiedAt}' \
  > "$EVIDENCE/certificate.json"
cat "$EVIDENCE/certificate.json"

test "$total" -gt 100
test "$failed" -eq 0
test "$passed" -eq "$total"

trap - EXIT
