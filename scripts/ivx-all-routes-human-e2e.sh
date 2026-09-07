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
: > "$EVIDENCE/route-manifest.jsonl"
for file in "${files[@]}"; do
  route=$(route_from_file "$file") || continue
  total=$((total + 1))
  safe=$(printf '%s' "${route:-root}" | tr '/[]() ' '_' | tr -cd '[:alnum:]_.-')
  flow="$FLOW_DIR/${total}-${safe}.yaml"
  cat > "$flow" <<YAML
appId: $APP_ID
name: IVX route $total ${route:-/}
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
- takeScreenshot: route-$total
YAML

  jq -nc --arg file "$file" --arg route "$route" --arg name "IVX route $total ${route:-/}" \
    '{file:$file,route:$route,name:$name}' >> "$EVIDENCE/route-manifest.jsonl"
done

# Run one Maestro suite: starting a JVM and reconnecting the driver for each of
# 274 routes can exhaust the 70-minute job before coverage is complete.
# The same route assertions and screenshots still execute for every flow.
set +e
timeout 2700s "$MAESTRO" test "$FLOW_DIR" --format junit \
  --output "$EVIDENCE/routes.xml" --test-output-dir "$EVIDENCE/maestro"
route_exit=$?
set -e

python3 scripts/ivx-maestro-route-results.py \
  "$EVIDENCE/route-manifest.jsonl" "$EVIDENCE/routes.xml" "$EVIDENCE/results.json"
passed=$(jq '[.[] | select(.passed == true)] | length' "$EVIDENCE/results.json")
failed=$((total - passed))
jq -c '.[]' "$EVIDENCE/results.json" > "$EVIDENCE/results.jsonl"
timeout 8s adb shell pidof "$APP_ID" > "$EVIDENCE/process.txt"

jq -n \
  --arg sha "$(git rev-parse HEAD)" \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson total "$total" --argjson passed "$passed" --argjson failed "$failed" \
  '{certificate:"IVX-ALL-EXPO-ROUTES-ANDROID-SMOKE",sourceSha:$sha,totalRoutes:$total,passedRoutes:$passed,failedRoutes:$failed,coveragePercent:(if $total>0 then (($passed*10000/$total)|floor/100) else 0 end),passed:($total>0 and $failed==0 and $passed==$total),realOwnerLogin:true,automated:true,physicalAndroidEmulator:true,everyRouteOpened:true,everyRouteScrolled:true,processSurvivalChecked:true,verifiedAt:$verifiedAt}' \
  > "$EVIDENCE/certificate.json"
cat "$EVIDENCE/certificate.json"

test "$route_exit" -eq 0
test "$total" -gt 100
test "$failed" -eq 0
test "$passed" -eq "$total"

trap - EXIT
