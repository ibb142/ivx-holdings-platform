#!/usr/bin/env bash
set -euo pipefail
: "${MAESTRO:?MAESTRO is required}"
: "${FLOW_DIR:?FLOW_DIR is required}"
: "${IVX_HANDOFF_NONCE:?IVX_HANDOFF_NONCE is required}"
timeout 420s "$MAESTRO" test "$FLOW_DIR/public-handoff.yaml" \
  --env IVX_HANDOFF_NONCE="$IVX_HANDOFF_NONCE" \
  --debug-output qa/evidence/dashboard-chat/native-handoff-debug \
  --format junit --output qa/evidence/dashboard-chat/native-handoff.xml
IVX_HANDOFF_JOB_ID="$(python3 scripts/ivx-native-handoff-identity.py \
  qa/evidence/dashboard-chat/native-handoff-debug "$IVX_HANDOFF_NONCE")"
export IVX_HANDOFF_JOB_ID
node scripts/ivx-autonomous-handoff-live-cert.mjs
