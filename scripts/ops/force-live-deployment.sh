#!/usr/bin/env bash
# Historical filename; this performs preflight/targeted task recovery, not deployment.
set -euo pipefail
IVX_OPS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$IVX_OPS_DIR/force-live-deployment.mjs" "$@"
