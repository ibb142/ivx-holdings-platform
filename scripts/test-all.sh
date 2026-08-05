#!/usr/bin/env bash
# IVX Holdings — Full Test Suite Runner
# Runs backend + expo tests. No Rork sandbox required.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=========================================="
echo "  IVX Holdings — Full Test Suite"
echo "=========================================="
echo ""

# ---- Backend Tests ----
echo "[1/4] Backend TypeScript check..."
cd backend
npx tsc --noEmit 2>&1 | tail -5
TSC_EXIT=$?
if [ $TSC_EXIT -ne 0 ]; then
  echo "  ❌ TypeScript errors found"
  exit 1
fi
echo "  ✅ TypeScript clean (0 errors)"
cd ..

echo ""
echo "[2/4] Backend tests..."
bun test backend/ --reporter=dots 2>&1 | tail -5
echo ""

# ---- Expo Tests ----
echo "[3/4] Expo tests..."
cd expo
bun test --reporter=dots 2>&1 | tail -5
cd ..
echo ""

# ---- Independence Audit ----
echo "[4/4] Rork independence audit..."
cd expo
node scripts/ivx-independence-audit.mjs 2>&1
cd ..

echo ""
echo "=========================================="
echo "  Test Suite Complete"
echo "=========================================="
