#!/usr/bin/env bash
set -euo pipefail

IVX_REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
IVX_TEST_BUN="${IVX_BUN_BIN:-bun}"
cd "$IVX_REPO_ROOT"
if ! command -v "$IVX_TEST_BUN" >/dev/null 2>&1; then
  printf 'Bun is required. Install the repository Bun runtime or set IVX_BUN_BIN.\n' >&2
  exit 1
fi

# Each file runs in its own process; Bun module mocks must not leak across suites.
"$IVX_TEST_BUN" test ./backend/__tests__/ivx-dashboard-transport.test.ts
"$IVX_TEST_BUN" test ./backend/services/ivx-fleet-dashboard-signals.test.ts
(
  cd expo
  "$IVX_TEST_BUN" test ./__tests__/autonomous-dashboard-health.test.ts
  "$IVX_TEST_BUN" test ./__tests__/autonomous-telemetry-fail-closed.test.ts
  "$IVX_TEST_BUN" test ../scripts/dev/mock-telemetry-server.test.ts
)
