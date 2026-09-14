#!/usr/bin/env bash
set -euo pipefail

# Compatibility entry point for recovery inspection. This does not deploy,
# terminate sessions, expire financial reservations, or requeue terminal tasks.
# The JSON diagnostic and exit status describe what was actually observed.
ivx_recovery_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$ivx_recovery_dir/infra-control-tower.sh" "$@"
