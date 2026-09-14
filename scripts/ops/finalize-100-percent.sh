#!/usr/bin/env bash
# Compatibility entry point for the owner-requested recovery launcher.
# Completion is measured by the recovery report, not by this historical name.
set -euo pipefail

IVX_FINALIZE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IVX_FINALIZE_ROOT="$(cd -- "$IVX_FINALIZE_DIR/../.." && pwd)"

if [[ "${1:-}" == '--help' && "$#" -eq 1 ]]; then
  exec "$IVX_FINALIZE_DIR/force-live-deployment.sh" --help
fi

# Optional source binding accepts only commit IDs and checks the actual checkout.
# A missing, ambiguous or different commit cannot be announced as released.
if [[ -n "${IVX_EXPECTED_SOURCE_SHA:-}" ]]; then
  if [[ ! "$IVX_EXPECTED_SOURCE_SHA" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
    printf '%s\n' '{"ok":false,"code":"INVALID_SOURCE_SHA"}' >&2
    exit 1
  fi
  if ! IVX_FINALIZE_EXPECTED="$(git -C "$IVX_FINALIZE_ROOT" rev-parse --verify --end-of-options "${IVX_EXPECTED_SOURCE_SHA}^{commit}" 2>/dev/null)"; then
    printf '%s\n' '{"ok":false,"code":"SOURCE_COMMIT_NOT_FOUND"}' >&2
    exit 1
  fi
  IVX_FINALIZE_ACTUAL="$(git -C "$IVX_FINALIZE_ROOT" rev-parse --verify HEAD)"
  if [[ "$IVX_FINALIZE_EXPECTED" != "$IVX_FINALIZE_ACTUAL" ]]; then
    printf '%s\n' '{"ok":false,"code":"SOURCE_CHECKOUT_MISMATCH"}' >&2
    exit 1
  fi
fi

printf '%s\n' '{"scope":"guarded_task_recovery","deploymentPerformed":false,"apkBuildTriggered":false,"completionCertified":false}' >&2
exec "$IVX_FINALIZE_DIR/force-live-deployment.sh" "$@"
