#!/usr/bin/env bash
set -euo pipefail

APP_ID="com.ivxholdings.app.owner"
EVIDENCE="qa/evidence/all-routes-human-e2e"
FLOW_DIR="$EVIDENCE/generated-flows"
mkdir -p "$FLOW_DIR"
: > "$EVIDENCE/manifest.jsonl"
: > "$EVIDENCE/process-loss.txt"
: > "$EVIDENCE/process-samples.txt"
suite_pid=''
monitor_pid=''

trap 'rc=$?; [ -z "$monitor_pid" ] || kill "$monitor_pid" 2>/dev/null || true; [ -z "$suite_pid" ] || kill "$suite_pid" 2>/dev/null || true; adb exec-out screencap -p > "$EVIDENCE/failure.png" 2>/dev/null || true; adb logcat -d -v threadtime > "$EVIDENCE/failure-logcat.txt" 2>/dev/null || true; exit $rc' EXIT

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

mapfile -t files < <(find expo/app -type f \( -name '*.tsx' -o -name '*.ts' \) -print | sort)

# Enumerate every route before starting Maestro. A single suite avoids starting
# a new JVM/ADB session hundreds of times; all route assertions remain required.
total=0
for file in "${files[@]}"; do
  route=$(route_from_file "$file") || continue
  total=$((total + 1))
  name="IVX automated route $total"
  screenshot="route-$total"
  flow="$FLOW_DIR/$(printf '%04d' "$total").yaml"
  cat > "$flow" <<YAML
appId: $APP_ID
name: $name
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
- takeScreenshot: "$screenshot"
YAML
  jq -nc --arg file "$file" --arg route "$route" --arg name "$name" --arg screenshot "$screenshot" \
    '{file:$file,route:$route,name:$name,screenshot:$screenshot}' >> "$EVIDENCE/manifest.jsonl"
done
test "$total" -gt 100
initial_pid=$(timeout 8s adb shell pidof "$APP_ID" | tr -d '\r')
test -n "$initial_pid"
set +e
timeout 2700s "$MAESTRO" test "$FLOW_DIR" --format junit --output "$EVIDENCE/suite.xml" \
  --test-output-dir "$EVIDENCE/artifacts" &
suite_pid=$!
(
  while kill -0 "$suite_pid" 2>/dev/null; do
    current_pid=$(timeout 8s adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r')
    printf '%s %s\n' "$(date -u +%FT%TZ)" "$current_pid" >> "$EVIDENCE/process-samples.txt"
    if [ "$current_pid" != "$initial_pid" ]; then
      printf 'Process identity changed or disappeared\n' >> "$EVIDENCE/process-loss.txt"
    fi
    sleep 2
  done
) &
monitor_pid=$!
wait "$suite_pid"
rc=$?
suite_pid=''
kill "$monitor_pid" 2>/dev/null || true
wait "$monitor_pid" 2>/dev/null || true
monitor_pid=''
set -e
alive=false
final_pid=$(timeout 8s adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r') || true
if [ "$final_pid" = "$initial_pid" ] && [ ! -s "$EVIDENCE/process-loss.txt" ] && [ -s "$EVIDENCE/process-samples.txt" ]; then alive=true; fi
python3 scripts/ivx-route-suite-proof.py "$EVIDENCE" "${EXPO_PUBLIC_SOURCE_COMMIT_SHA:-${GITHUB_SHA:-unknown}}" "$rc" "$alive"
trap - EXIT
