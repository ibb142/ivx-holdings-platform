#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_NAME="${APP_NAME:-ivx-holdings}"
AWS_REGION="${AWS_REGION:-us-east-1}"
KEEP_IMAGES="${KEEP_IMAGES:-5}"

command -v aws >/dev/null 2>&1 || { echo -e "${RED}aws CLI not found${NC}"; exit 1; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  IVX Holdings — Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo -e "${BLUE}[1/3] Cleaning old ECR images (keeping last $KEEP_IMAGES)...${NC}"
IMAGES=$(aws ecr describe-images \
  --repository-name "$APP_NAME-api" \
  --region "$AWS_REGION" \
  --query "sort_by(imageDetails, &imagePushedAt)[0:-${KEEP_IMAGES}].imageDigest" \
  --output json 2>/dev/null || echo "[]")

IMAGE_COUNT=$(echo "$IMAGES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "$IMAGE_COUNT" -gt 0 ]; then
  echo "  Found $IMAGE_COUNT old images to remove"
  IMAGE_IDS=$(echo "$IMAGES" | python3 -c "
import sys, json
digests = json.load(sys.stdin)
ids = [{'imageDigest': d} for d in digests]
print(json.dumps(ids))
")
  aws ecr batch-delete-image \
    --repository-name "$APP_NAME-api" \
    --image-ids "$IMAGE_IDS" \
    --region "$AWS_REGION" >/dev/null 2>&1
  echo -e "  ${GREEN}Removed $IMAGE_COUNT old images${NC}"
else
  echo -e "  ${GREEN}No old images to clean${NC}"
fi

echo -e "${BLUE}[2/3] Deregistering old task definitions...${NC}"
OLD_TDS=$(aws ecs list-task-definitions \
  --family-prefix "$APP_NAME-api" \
  --status ACTIVE \
  --sort DESC \
  --region "$AWS_REGION" \
  --query "taskDefinitionArns[${KEEP_IMAGES}:]" \
  --output json 2>/dev/null || echo "[]")

TD_COUNT=$(echo "$OLD_TDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "$TD_COUNT" -gt 0 ]; then
  echo "  Found $TD_COUNT old task definitions to deregister"
  echo "$OLD_TDS" | python3 -c "
import sys, json
arns = json.load(sys.stdin)
for arn in arns:
    print(arn)
" | while read -r td_arn; do
    aws ecs deregister-task-definition \
      --task-definition "$td_arn" \
      --region "$AWS_REGION" >/dev/null 2>&1 || true
  done
  echo -e "  ${GREEN}Deregistered $TD_COUNT old task definitions${NC}"
else
  echo -e "  ${GREEN}No old task definitions to clean${NC}"
fi

echo -e "${BLUE}[3/3] Cleaning temp S3 objects...${NC}"
BUCKET="${APP_NAME}-prod"
TEMP_COUNT=$(aws s3 ls "s3://${BUCKET}/temp/" --recursive 2>/dev/null | wc -l || echo "0")
if [ "$TEMP_COUNT" -gt 0 ]; then
  aws s3 rm "s3://${BUCKET}/temp/" --recursive --region "$AWS_REGION" 2>/dev/null || true
  echo -e "  ${GREEN}Cleaned $TEMP_COUNT temp objects${NC}"
else
  echo -e "  ${GREEN}No temp objects to clean${NC}"
fi

echo ""
echo -e "${GREEN}Cleanup complete!${NC}"
