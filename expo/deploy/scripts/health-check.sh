#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

API_URL="${1:-${API_URL:-}}"
MAX_RETRIES="${MAX_RETRIES:-10}"
RETRY_DELAY="${RETRY_DELAY:-5}"

if [ -z "$API_URL" ]; then
  echo "Usage: $0 <api-url>"
  echo "Example: $0 https://api.ivxholding.com"
  exit 1
fi

echo ""
echo "━━━ IVX Holdings — Health Check ━━━"
echo "  Target: $API_URL"
echo ""

check_endpoint() {
  local path="$1"
  local label="$2"
  local url="${API_URL}${path}"

  RESPONSE=$(curl -sf --max-time 10 "$url" 2>/dev/null || echo '{"status":"unreachable"}')
  STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status', d.get('ready', 'unknown')))" 2>/dev/null || echo "parse_error")

  if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "ok" ] || [ "$STATUS" = "True" ]; then
    echo -e "  ${GREEN}[PASS]${NC} $label ($path) — $STATUS"
    return 0
  else
    echo -e "  ${RED}[FAIL]${NC} $label ($path) — $STATUS"
    return 1
  fi
}

ATTEMPT=0
while [ "$ATTEMPT" -lt "$MAX_RETRIES" ]; do
  ATTEMPT=$((ATTEMPT + 1))

  HEALTH=$(curl -sf --max-time 10 "$API_URL/health" 2>/dev/null || echo "")
  if [ -n "$HEALTH" ]; then
    echo -e "  ${GREEN}API is reachable (attempt $ATTEMPT)${NC}"
    echo ""
    break
  fi

  if [ "$ATTEMPT" -lt "$MAX_RETRIES" ]; then
    echo -e "  ${YELLOW}Attempt $ATTEMPT/$MAX_RETRIES — API not reachable, retrying in ${RETRY_DELAY}s...${NC}"
    sleep "$RETRY_DELAY"
  else
    echo -e "  ${RED}API unreachable after $MAX_RETRIES attempts${NC}"
    exit 1
  fi
done

PASS=0
FAIL=0

check_endpoint "/health" "Health" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
check_endpoint "/readiness" "Readiness" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
check_endpoint "/" "Root" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}All $PASS checks passed${NC}"
else
  echo -e "  ${RED}$FAIL failed, $PASS passed${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit "$FAIL"
