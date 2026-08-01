#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVIRONMENT="${1:-production}"

echo ""
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${BLUE}  IVX Holdings — Full Production Validation${NC}"
echo -e "${BOLD}${BLUE}  Environment: ${ENVIRONMENT}${NC}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

TOTAL_FAIL=0

run_check() {
  local label="$1"
  local cmd="$2"

  echo ""
  echo -e "${BOLD}${CYAN}▶ ${label}${NC}"
  echo ""

  if eval "$cmd"; then
    echo -e "\n  ${GREEN}✓ ${label} passed${NC}"
  else
    echo -e "\n  ${RED}✗ ${label} failed${NC}"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
}

run_check "AWS Infrastructure" "bash '$SCRIPT_DIR/validate-aws.sh' '$ENVIRONMENT'"
run_check "Supabase Production" "node '$SCRIPT_DIR/validate-supabase.mjs'"

if [ -f "$SCRIPT_DIR/../../app.config.ts" ]; then
  echo ""
  echo -e "${BOLD}${CYAN}▶ TypeScript Check${NC}"
  echo ""
  cd "$SCRIPT_DIR/../.."
  if npx tsc --noEmit --pretty 2>&1 | tail -5; then
    echo -e "\n  ${GREEN}✓ TypeScript passed${NC}"
  else
    echo -e "\n  ${RED}✗ TypeScript errors found${NC}"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
fi

echo ""
echo -e "${BOLD}${CYAN}━━━ Final Result ━━━${NC}"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo -e "  ${BOLD}${GREEN}ALL VALIDATIONS PASSED — ready for production${NC}"
else
  echo -e "  ${BOLD}${RED}${TOTAL_FAIL} validation(s) failed — fix before deploying${NC}"
fi
echo ""

exit $TOTAL_FAIL
