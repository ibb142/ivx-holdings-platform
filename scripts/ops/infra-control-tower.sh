#!/usr/bin/env bash
set -euo pipefail

# Read-only infrastructure inspection. Exit status is propagated from the runner.
ivx_ops_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v bun >/dev/null 2>&1; then
  echo 'INFRA_DIAGNOSTIC_UNAVAILABLE: Bun is required.' >&2
  exit 127
fi
exec bun "$ivx_ops_dir/infra-control-tower.ts" "$@"
