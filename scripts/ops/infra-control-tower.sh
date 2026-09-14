#!/usr/bin/env bash
set -euo pipefail

# Read-only diagnostics. This entrypoint does not terminate managed connections,
# refund unconfirmed provider charges, or replay terminal tasks.
ivx_ops_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$ivx_ops_dir/infra-control-tower.mjs" "$@"
