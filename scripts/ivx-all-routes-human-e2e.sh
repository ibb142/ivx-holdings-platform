#!/usr/bin/env bash
set -euo pipefail

APP_ID="com.ivxholdings.app.owner"
EVIDENCE="qa/evidence/all-routes-human-e2e"
FLOW_DIR="$EVIDENCE/generated-flows"
REPORT_DIR="$EVIDENCE/suites"
ARTIFACT_DIR="$EVIDENCE/artifacts"
RETRY_DIR="$EVIDENCE/instrumentation-retries"
BATCH_SIZE="${IVX_ROUTE_BATCH_SIZE:-20}"
case "$BATCH_SIZE" in
  ''|*[!0-9]*) echo 'IVX_ROUTE_BATCH_SIZE must be a positive integer' >&2; exit 2 ;;
esac
test "$BATCH_SIZE" -gt 0
mkdir -p "$FLOW_DIR" "$REPORT_DIR" "$ARTIFACT_DIR" "$RETRY_DIR"
find "$FLOW_DIR" -type f -name '*.yaml' -delete
find "$REPORT_DIR" -type f -name '*.xml' -delete
find "$RETRY_DIR" -type f -delete
: > "$EVIDENCE/manifest.jsonl"
: > "$EVIDENCE/process-loss.txt"
: > "$EVIDENCE/process-samples.txt"
monitor_pid=''

trap 'rc=$?; [ -z "$monitor_pid" ] || kill "$monitor_pid" 2>/dev/null || true; adb exec-out screencap -p > "$EVIDENCE/failure.png" 2>/dev/null || true; adb logcat -d -v threadtime > "$EVIDENCE/failure-logcat.txt" 2>/dev/null || true; exit $rc' EXIT

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
    _layout|_providers|+native-intent|+not-found|*/_layout|*/_providers|*+api) return 1 ;;
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

# Enumerate every route before starting Maestro. Bounded suites renew Android
# instrumentation without weakening any route assertion.
total=0
for file in "${files[@]}"; do
  route=$(route_from_file "$file") || continue
  total=$((total + 1))
  name="IVX automated route $total"
  screenshot="route-$total"
  batch_number=$(( (total - 1) / BATCH_SIZE + 1 ))
  batch_dir="$FLOW_DIR/batch-$(printf '%03d' "$batch_number")"
  mkdir -p "$batch_dir"
  flow="$batch_dir/$(printf '%04d' "$total").yaml"
  cat > "$flow" <<YAML
appId: $APP_ID
name: $name
---
- openLink: "ivx-app:///${route#/}"
- waitForAnimationToEnd:
    timeout: 3000
- assertNotVisible: "Something went wrong"
- assertNotVisible: "IVX Provider Error"
- assertNotVisible: "Application error"
- assertNotVisible: "Unhandled Runtime Error"
- assertNotVisible: "Login service temporarily unavailable"
- swipe:
    start: 50%,78%
    end: 50%,32%
    duration: 500
- waitForAnimationToEnd:
    timeout: 3000
- assertNotVisible: "Something went wrong"
- assertNotVisible: "IVX Provider Error"
YAML
  if [ "$route" = '/chat-hub' ]; then
    cat >> "$flow" <<'YAML'
- assertVisible:
    id: "public-chat-message-input"
- assertNotVisible: "IVX public chat unavailable"
YAML
  fi
  printf '%s\n' "- takeScreenshot: \"$screenshot\"" >> "$flow"
  jq -nc --arg file "$file" --arg route "$route" --arg name "$name" --arg screenshot "$screenshot" \
    '{file:$file,route:$route,name:$name,screenshot:$screenshot}' >> "$EVIDENCE/manifest.jsonl"
done
test "$total" -gt 100
initial_pid=$(timeout 8s adb shell pidof "$APP_ID" | tr -d '\r')
test -n "$initial_pid"
(
  while true; do
    current_pid=$(timeout 8s adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r')
    printf '%s %s\n' "$(date -u +%FT%TZ)" "$current_pid" >> "$EVIDENCE/process-samples.txt"
    if [ "$current_pid" != "$initial_pid" ]; then
      printf 'Process identity changed or disappeared\n' >> "$EVIDENCE/process-loss.txt"
    fi
    sleep 2
  done
) &
monitor_pid=$!

# Long single Maestro sessions can lose Android UiAutomation while the app
# itself remains healthy. Keep every route assertion, but renew Maestro's
# instrumentation between bounded batches and aggregate all JUnit reports.
rc=0
batch_count=$(( (total + BATCH_SIZE - 1) / BATCH_SIZE ))
for batch_number in $(seq 1 "$batch_count"); do
  batch_name="batch-$(printf '%03d' "$batch_number")"
  echo "route_batch=$batch_number/$batch_count size_limit=$BATCH_SIZE"
  batch_rc=1
  for attempt in 1 2; do
    set +e
    timeout 900s "$MAESTRO" test "$FLOW_DIR/$batch_name" \
      --format junit \
      --output "$REPORT_DIR/$batch_name.xml" \
      --test-output-dir "$ARTIFACT_DIR/$batch_name-attempt-$attempt"
    batch_rc=$?
    set -e
    if [ "$batch_rc" -eq 0 ]; then
      break
    fi
    if [ "$attempt" -eq 1 ] && [ -s "$REPORT_DIR/$batch_name.xml" ] \
        && grep -Eq 'DeviceServerDiedException|UiAutomation not connected|StatusRuntimeException: UNAVAILABLE' "$REPORT_DIR/$batch_name.xml"; then
      cp "$REPORT_DIR/$batch_name.xml" "$RETRY_DIR/$batch_name-attempt-1.xml"
      printf '%s infrastructure_retry=1\n' "$batch_name" >> "$RETRY_DIR/events.txt"
      timeout 30s adb wait-for-device
      test "$(timeout 8s adb shell pidof "$APP_ID" | tr -d '\r')" = "$initial_pid"
      sleep 2
      continue
    fi
    break
  done
  if [ "$batch_rc" -ne 0 ]; then
    rc="$batch_rc"
    break
  fi
  if [ -s "$EVIDENCE/process-loss.txt" ]; then
    rc=1
    break
  fi
done

kill "$monitor_pid" 2>/dev/null || true
wait "$monitor_pid" 2>/dev/null || true
monitor_pid=''
alive=false
final_pid=$(timeout 8s adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r') || true
if [ "$final_pid" = "$initial_pid" ] && [ ! -s "$EVIDENCE/process-loss.txt" ] && [ -s "$EVIDENCE/process-samples.txt" ]; then alive=true; fi
python3 scripts/ivx-route-suite-proof.py "$EVIDENCE" "${EXPO_PUBLIC_SOURCE_COMMIT_SHA:-${GITHUB_SHA:-unknown}}" "$rc" "$alive"
trap - EXIT
