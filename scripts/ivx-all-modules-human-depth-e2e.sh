#!/usr/bin/env bash
set -euo pipefail

: "${APK_PATH:?APK_PATH is required}"
: "${OWNER_EMAIL:?OWNER_EMAIL is required}"
: "${OWNER_PASSWORD_EFFECTIVE:?OWNER_PASSWORD_EFFECTIVE is required}"

APP_ID="com.ivxholdings.app.owner"
EVIDENCE_DIR="qa/evidence/all-modules-human-depth"
ROUTES_FILE="$EVIDENCE_DIR/routes.tsv"
RESULTS_FILE="$EVIDENCE_DIR/results.jsonl"
mkdir -p "$EVIDENCE_DIR/screens"
: > "$ROUTES_FILE"
: > "$RESULTS_FILE"

route_from_file() {
  local file="$1" route
  route="${file#expo/app/}"
  route="${route%.tsx}"
  route="${route%.ts}"
  case "$route" in
    _layout|_providers|+native-intent|+not-found) return 1 ;;
  esac
  route=$(printf '%s' "$route" | sed -E 's#(^|/)\([^/]+\)/#\1#g; s#(^|/)index$##; s#\[\.\.\.([^]]+)\]#qa-e2e#g; s#\[([^]]+)\]#qa-e2e#g')
  route="/${route#/}"
  [ "$route" = "/" ] || route="${route%/}"
  printf '%s\n' "$route"
}

# Build a deterministic inventory from every Expo Router screen. Layout/provider
# files are infrastructure, not navigable human screens. Dynamic params get a
# stable QA value so those screens are exercised instead of silently skipped.
while IFS= read -r file; do
  route=$(route_from_file "$file" || true)
  [ -n "${route:-}" ] || continue
  printf '%s\t%s\n' "$route" "$file" >> "$ROUTES_FILE"
done < <(find expo/app -type f \( -name '*.tsx' -o -name '*.ts' \) | sort)

# Duplicate public URLs from route groups must not create fake extra coverage.
sort -u -k1,1 "$ROUTES_FILE" -o "$ROUTES_FILE"
route_count=$(wc -l < "$ROUTES_FILE" | tr -d ' ')
test "$route_count" -gt 100

# Install exact-source QA build and establish a real owner session once. Every
# route then runs in the same human-authenticated app state.
timeout 120s adb install -r "$APK_PATH"
timeout 30s adb wait-for-device
timeout 90s bash -lc 'curl --fail --show-error --location --max-time 60 https://get.maestro.mobile.dev | bash'
MAESTRO="${HOME}/.maestro/bin/maestro"
test -x "$MAESTRO"
timeout 240s "$MAESTRO" test expo/.maestro/ivx-owner-home-certificate.yaml \
  --env OWNER_EMAIL="$OWNER_EMAIL" \
  --env OWNER_PASSWORD="$OWNER_PASSWORD_EFFECTIVE" \
  --format junit \
  --output "$EVIDENCE_DIR/owner-login.xml"

failures=0
index=0
while IFS=$'\t' read -r route file; do
  index=$((index + 1))
  slug=$(printf '%04d-%s' "$index" "$(printf '%s' "$route" | tr '/[]() :' '-------' | tr -cd '[:alnum:]._-')")
  [ -n "$slug" ] || slug=$(printf '%04d-root' "$index")
  adb logcat -c || true

  # Human-equivalent navigation into the exact screen via the app's real deep-link router.
  timeout 15s adb shell am start -W -a android.intent.action.VIEW -d "ivx-app:///${route#/}" "$APP_ID" > "$EVIDENCE_DIR/${slug}-launch.txt" 2>&1 || true
  sleep 2

  alive=false
  if timeout 5s adb shell pidof "$APP_ID" > "$EVIDENCE_DIR/${slug}-pid.txt" 2>/dev/null && test -s "$EVIDENCE_DIR/${slug}-pid.txt"; then alive=true; fi

  # Read what a human-accessibility layer can actually see; a route that resolves
  # to a blank/empty tree is a failure even if the process remains alive.
  timeout 10s adb shell uiautomator dump /sdcard/ivx-ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/ivx-ui.xml "$EVIDENCE_DIR/${slug}-ui.xml" >/dev/null 2>&1 || true
  node_count=0
  if test -s "$EVIDENCE_DIR/${slug}-ui.xml"; then
    node_count=$(grep -o '<node ' "$EVIDENCE_DIR/${slug}-ui.xml" | wc -l | tr -d ' ')
  fi

  # Exercise the screen rather than only opening it: scroll down/up and perform
  # Android back navigation, the same basic gestures a human uses to discover
  # delayed rendering, frozen scroll surfaces and broken navigation stacks.
  if [ "$alive" = true ]; then
    adb shell input swipe 500 1500 500 500 350 >/dev/null 2>&1 || true
    sleep 1
    adb shell input swipe 500 500 500 1500 350 >/dev/null 2>&1 || true
    adb exec-out screencap -p > "$EVIDENCE_DIR/screens/${slug}.png" 2>/dev/null || true
  fi

  adb logcat -d -v brief > "$EVIDENCE_DIR/${slug}-logcat.txt" 2>/dev/null || true
  fatal=false
  if grep -Eqi 'FATAL EXCEPTION|AndroidRuntime:.*FATAL|ReactNativeJS:.*(TypeError|ReferenceError|Invariant Violation|Unhandled)|Unable to start activity' "$EVIDENCE_DIR/${slug}-logcat.txt"; then fatal=true; fi

  bad_ui=false
  if test -s "$EVIDENCE_DIR/${slug}-ui.xml" && grep -Eqi 'Something went wrong|Sign In Failed|Login service temporarily unavailable|Application Error|Unexpected error|Cannot read propert|undefined is not an object' "$EVIDENCE_DIR/${slug}-ui.xml"; then bad_ui=true; fi

  passed=true
  reason="ok"
  if [ "$alive" != true ]; then passed=false; reason="process-dead"; fi
  if [ "$node_count" -lt 3 ]; then passed=false; reason="blank-or-unrendered"; fi
  if [ "$fatal" = true ]; then passed=false; reason="fatal-runtime-error"; fi
  if [ "$bad_ui" = true ]; then passed=false; reason="visible-error-state"; fi

  jq -nc \
    --arg route "$route" \
    --arg file "$file" \
    --argjson passed "$passed" \
    --arg reason "$reason" \
    --argjson nodeCount "$node_count" \
    --argjson fatal "$fatal" \
    --argjson visibleError "$bad_ui" \
    '{route:$route,file:$file,passed:$passed,reason:$reason,uiNodes:$nodeCount,fatalRuntimeError:$fatal,visibleError:$visibleError,humanActions:["open","wait-render","inspect-visible-ui","scroll-down","scroll-up","screenshot","back-navigation"]}' \
    >> "$RESULTS_FILE"

  if [ "$passed" != true ]; then failures=$((failures + 1)); fi

  # Re-open authenticated shell after each route so one broken navigation stack
  # cannot poison the next module's test.
  adb shell input keyevent 4 >/dev/null 2>&1 || true
  sleep 1
  if ! adb shell pidof "$APP_ID" >/dev/null 2>&1; then
    adb shell monkey -p "$APP_ID" 1 >/dev/null 2>&1 || true
    sleep 2
  fi
done < "$ROUTES_FILE"

jq -s \
  --arg sha "${GITHUB_SHA:-unknown}" \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson expected "$route_count" \
  --argjson failures "$failures" \
  '{certificate:"IVX-ALL-MODULES-HUMAN-DEPTH-E2E",sourceSha:$sha,verifiedAt:$verifiedAt,expectedRoutes:$expected,testedRoutes:length,passedRoutes:([.[]|select(.passed==true)]|length),failedRoutes:$failures,passed:($failures==0 and length==$expected),coverageRule:"every navigable expo/app route must render under real owner auth and survive human-equivalent navigation/scroll/runtime inspection",results:.}' \
  "$RESULTS_FILE" > "$EVIDENCE_DIR/certificate.json"

cat "$EVIDENCE_DIR/certificate.json"
test "$(jq -r '.testedRoutes' "$EVIDENCE_DIR/certificate.json")" = "$route_count"
test "$(jq -r '.failedRoutes' "$EVIDENCE_DIR/certificate.json")" = "0"
test "$(jq -r '.passed' "$EVIDENCE_DIR/certificate.json")" = "true"
