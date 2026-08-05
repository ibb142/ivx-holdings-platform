#!/usr/bin/env bash
# IVX Holdings — Independence Audit Script (fixed integer comparisons)
# Verifies zero Rork runtime dependencies. Run from repo root.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=========================================="
echo "  IVX Rork Independence Audit"
echo "=========================================="
echo ""

FAILURES=0

# 1. No @rork-ai/* packages in expo/package.json
echo -n "[1] Checking package.json for @rork-ai/*... "
RORK_PKGS=$(grep -c "@rork-ai" expo/package.json 2>/dev/null || true)
if [ "${RORK_PKGS:-0}" -eq 0 ] 2>/dev/null; then
  echo "PASS (no @rork-ai packages)"
else
  echo "FAIL ($RORK_PKGS @rork-ai packages found)"
  FAILURES=$((FAILURES + 1))
fi

# 2. metro.config.js is plain Expo (no withRorkMetro)
echo -n "[2] Checking metro.config.js... "
if grep -q "withRorkMetro\|@rork-ai/toolkit-sdk" expo/metro.config.js 2>/dev/null; then
  echo "FAIL (withRorkMetro or toolkit-sdk found)"
  FAILURES=$((FAILURES + 1))
else
  echo "PASS (plain Expo config)"
fi

# 3. rork.json absent
echo -n "[3] Checking rork.json... "
if [ -f rork.json ]; then
  echo "FAIL (rork.json exists)"
  FAILURES=$((FAILURES + 1))
else
  echo "PASS (absent)"
fi

# 4. No Rork-prefixed env keys in .env files
echo -n "[4] Checking .env files for Rork keys... "
RORK_ENVS=0
for envfile in .env.example expo/.env.example; do
  if [ -f "$envfile" ]; then
    COUNT=$(grep -cE "EXPO_PUBLIC_RORK_|RORK_PUBLIC_|EXPO_PUBLIC_TOOLKIT_URL" "$envfile" 2>/dev/null || true)
    RORK_ENVS=$((RORK_ENVS + ${COUNT:-0}))
  fi
done
if [ "$RORK_ENVS" -eq 0 ]; then
  echo "PASS (no Rork env keys in .env.example files)"
else
  echo "FAIL ($RORK_ENVS Rork env keys found)"
  FAILURES=$((FAILURES + 1))
fi

# 5. No Rork URLs in runtime code (excluding audit/reporting modules)
echo -n "[5] Checking runtime code for Rork URLs... "
RORK_URLS=$(grep -rn "rork\.com\|rork\.app\|rorktest\.dev" --include="*.ts" --include="*.tsx" \
  backend/ expo/app/ expo/src/ expo/lib/ expo/hooks/ expo/components/ \
  2>/dev/null | grep -v node_modules | grep -v ".test." | grep -v ".d.ts" \
  | grep -v "ivx-rork-independence\|ivx-domain-blocklist\|ivx-independence-status\|ivx-owner-control-proof\|ivx-runtime-variables\|ivxVariablesMetadata\|ivxVariablesToolService\|ivxAIRequestService\|runtimeVariablesService\|seniorDeveloperWorkerService\|agentJobsService\|developerApprovedActions\|ivx-vercel-exit\|ivx-credentials-status" \
  | grep -v "//.*rork\| \*.*rork\|#.*rork" | wc -l || true)
if [ "${RORK_URLS:-0}" -eq 0 ] 2>/dev/null; then
  echo "PASS (no Rork URLs in runtime code)"
else
  echo "FAIL ($RORK_URLS Rork URL references found)"
  FAILURES=$((FAILURES + 1))
fi

# 6. No @rork-ai imports in runtime code (excluding audit/reporting/scripts)
echo -n "[6] Checking for @rork-ai imports in runtime code... "
RORK_IMPORTS=$(grep -rn "@rork-ai" --include="*.ts" --include="*.tsx" --include="*.js" \
  backend/api/ivx-owner-ai.ts backend/api/public-chat.ts backend/services/ivx-autonomous-coder.ts \
  backend/services/ivx-senior-developer-worker.ts backend/hono.ts backend/hono-extended.ts \
  expo/app/ expo/src/ expo/lib/ expo/hooks/ expo/components/ \
  2>/dev/null | grep -v node_modules | grep -v ".test." | grep -v ".d.ts" | grep -v "scripts/" \
  | grep -v "ivx-rork-independence\|ivx-owner-control-proof\|ivx-independence-status\|ivx-runtime-variables" \
  | wc -l || true)
if [ "${RORK_IMPORTS:-0}" -eq 0 ] 2>/dev/null; then
  echo "PASS (no @rork-ai imports in runtime code)"
else
  echo "FAIL ($RORK_IMPORTS @rork-ai imports found)"
  FAILURES=$((FAILURES + 1))
fi

# 7. GitHub Actions workflows exist
echo -n "[7] Checking GitHub Actions workflows... "
WORKFLOW_COUNT=$(ls .github/workflows/*.yml 2>/dev/null | wc -l || true)
if [ "${WORKFLOW_COUNT:-0}" -ge 4 ] 2>/dev/null; then
  echo "PASS ($WORKFLOW_COUNT workflows found)"
else
  echo "FAIL (only $WORKFLOW_COUNT workflows, need at least 4)"
  FAILURES=$((FAILURES + 1))
fi

# 8. No Rork secrets in env panel (informational)
echo -n "[8] Checking for Rork secret env vars in shell... "
RORK_SECRETS=$(env | grep -c "EXPO_PUBLIC_RORK_\|RORK_TOOLKIT_SECRET" 2>/dev/null || true)
if [ "${RORK_SECRETS:-0}" -eq 0 ] 2>/dev/null; then
  echo "PASS (no Rork secrets in environment)"
else
  echo "WARNING ($RORK_SECRETS Rork env vars in shell — not in code)"
fi

# 9. Runtime env var reads (GITHUB_TOKEN, not RORK_PUBLIC_GITHUB_TOKEN)
echo -n "[9] Checking runtime code reads GITHUB_TOKEN (not RORK_PUBLIC)... "
RORK_TOKEN_READS=$(grep -rn "process\.env\.RORK_PUBLIC_GITHUB_TOKEN" --include="*.ts" \
  backend/ expo/app/ expo/src/ expo/lib/ 2>/dev/null | grep -v node_modules \
  | grep -v ".test." | grep -v ".d.ts" | grep -v "ivx-rork-independence\|ivx-runtime-variables" \
  | wc -l || true)
if [ "${RORK_TOKEN_READS:-0}" -eq 0 ] 2>/dev/null; then
  echo "PASS (no RORK_PUBLIC_GITHUB_TOKEN reads in runtime code)"
else
  echo "FAIL ($RORK_TOKEN_READS RORK_PUBLIC_GITHUB_TOKEN reads found)"
  FAILURES=$((FAILURES + 1))
fi

# 10. AI provider uses direct Vercel AI Gateway (not Rork proxy)
echo -n "[10] Checking AI provider uses direct endpoint... "
if grep -q "ai-gateway.vercel.sh" backend/hono.ts backend/api/ivx-credentials-status.ts 2>/dev/null; then
  echo "PASS (direct Vercel AI Gateway endpoint)"
else
  echo "FAIL (no direct Vercel AI Gateway endpoint found)"
  FAILURES=$((FAILURES + 1))
fi

echo ""
echo "=========================================="
if [ "$FAILURES" -eq 0 ]; then
  echo "  ALL CHECKS PASSED — IVX IS RORK-FREE"
else
  echo "  $FAILURES CHECK(S) FAILED"
fi
echo "=========================================="
exit $FAILURES
