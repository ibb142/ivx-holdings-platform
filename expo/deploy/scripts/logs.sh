#!/bin/bash
set -euo pipefail

APP_NAME="${APP_NAME:-ivx-holdings}"
AWS_REGION="${AWS_REGION:-us-east-1}"
LOG_GROUP="/ecs/${APP_NAME}-api"
FOLLOW="${1:-}"
SINCE="${SINCE:-1h}"

command -v aws >/dev/null 2>&1 || { echo "aws CLI not found"; exit 1; }

echo "Tailing logs from: $LOG_GROUP (since $SINCE)"
echo "Press Ctrl+C to stop"
echo ""

if [ "$FOLLOW" = "--follow" ] || [ "$FOLLOW" = "-f" ]; then
  aws logs tail "$LOG_GROUP" \
    --follow \
    --since "$SINCE" \
    --region "$AWS_REGION" \
    --format short
else
  aws logs tail "$LOG_GROUP" \
    --since "$SINCE" \
    --region "$AWS_REGION" \
    --format short
fi
