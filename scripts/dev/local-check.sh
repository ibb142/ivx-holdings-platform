#!/usr/bin/env bash
# Local checks for the dashboard contract introduced in d1f6518.
set -euo pipefail

IVX_REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$IVX_REPO_ROOT"
# Expo's full TypeScript graph can exceed Node's default heap. Respect overrides.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

printf '[IVX LOCAL CHECK] HEAD: %s (includes uncommitted working changes)\n' "$(git rev-parse --short HEAD)"
trap 'printf "[FAIL] Local checks stopped at line %s.\n" "$LINENO" >&2' ERR

printf '\n[1/3] Backend TypeScript\n'
npm run backend:typecheck
printf '\n[2/3] Expo TypeScript\n'
npm run mobile:typecheck
printf '\n[3/3] Local dashboard, telemetry and mock contract tests\n'
npm run test:local

printf '\n[PASS] Backend/Expo types and the selected local contract tests passed.\n'
printf 'This result does not certify production telemetry, deployments or live agents.\n'
