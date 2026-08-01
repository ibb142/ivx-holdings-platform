#!/bin/bash
set -euo pipefail

# ============================================================
# IVX Holdings — Deploy Script
# Builds, pushes, and deploys a new version to ECS Fargate
# Usage: ./deploy/scripts/deploy.sh [tag]
# Example: ./deploy/scripts/deploy.sh v1.2.3
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── CONFIG ────────────────────────────────────────────────
APP_NAME="${APP_NAME:-ivx-holdings}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${ECS_CLUSTER:-ivx-holdings-cluster}"
ECS_SERVICE="${ECS_SERVICE:-ivx-holdings-api-service}"
CONTAINER_NAME="${CONTAINER_NAME:-ivx-holdings-api}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
resolve_project_root() {
  local current="$SCRIPT_DIR"
  while [ "$current" != "/" ]; do
    if [ -f "$current/package.json" ] || [ -d "$current/.git" ]; then
      printf '%s\n' "$current"
      return 0
    fi
    current="$(dirname "$current")"
  done
  return 1
}
PROJECT_ROOT="$(resolve_project_root)" || error "Could not resolve project root"
IMAGE_TAG="${1:-$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "latest")}"

# ─── PREREQUISITES ─────────────────────────────────────────
command -v aws    >/dev/null 2>&1 || error "aws CLI not found"
command -v docker >/dev/null 2>&1 || error "docker not found"
aws sts get-caller-identity >/dev/null 2>&1 || error "AWS not authenticated. Run: aws configure"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$APP_NAME-api"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  IVX Holdings — Deploying $APP_NAME-api:$IMAGE_TAG"
echo "  Cluster: $ECS_CLUSTER  |  Service: $ECS_SERVICE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── STEP 1: ECR LOGIN ─────────────────────────────────────
log "Authenticating with ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
ok "ECR authenticated"

# ─── STEP 2: BUILD ─────────────────────────────────────────
log "Building Docker image..."
docker build \
  --platform linux/amd64 \
  -t "$ECR_URI:$IMAGE_TAG" \
  -t "$ECR_URI:latest" \
  "$PROJECT_ROOT"
ok "Image built: $ECR_URI:$IMAGE_TAG"

# ─── STEP 3: PUSH ──────────────────────────────────────────
log "Pushing to ECR..."
docker push "$ECR_URI:$IMAGE_TAG"
docker push "$ECR_URI:latest"
ok "Image pushed"

# ─── STEP 4: UPDATE TASK DEFINITION ───────────────────────
log "Registering new task definition..."
CURRENT_TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition "$APP_NAME-api" \
  --region "$AWS_REGION" \
  --query 'taskDefinition' \
  --output json)

NEW_TASK_DEF=$(echo "$CURRENT_TASK_DEF" | python3 -c "
import sys, json
td = json.load(sys.stdin)
for cd in td['containerDefinitions']:
    if cd['name'] == '$CONTAINER_NAME':
        cd['image'] = '$ECR_URI:$IMAGE_TAG'
for key in ['taskDefinitionArn','revision','status','requiresAttributes','compatibilities','registeredAt','registeredBy']:
    td.pop(key, None)
print(json.dumps(td))
")

NEW_TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "$NEW_TASK_DEF" \
  --region "$AWS_REGION" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)
ok "New task definition: $NEW_TASK_DEF_ARN"

# ─── STEP 5: UPDATE SERVICE ────────────────────────────────
log "Updating ECS service..."
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --task-definition "$NEW_TASK_DEF_ARN" \
  --force-new-deployment \
  --region "$AWS_REGION" \
  --output text >/dev/null
ok "Service update triggered"

# ─── STEP 6: WAIT FOR STABILITY ───────────────────────────
log "Waiting for deployment to stabilize (this can take 2-3 min)..."
aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$AWS_REGION"
ok "Service is stable"

# ─── STEP 7: HEALTH CHECK ──────────────────────────────────
API_URL="${API_URL:-}"
if [ -n "$API_URL" ]; then
  log "Running health check against $API_URL..."
  sleep 5
  STATUS=$(curl -sf "$API_URL/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unreachable")
  if [ "$STATUS" = "healthy" ]; then
    ok "Health check passed: $STATUS"
  else
    warn "Health check returned: $STATUS — check CloudWatch logs"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deployment complete!"
echo "  Image:   $ECR_URI:$IMAGE_TAG"
echo "  Task:    $NEW_TASK_DEF_ARN"
echo ""
echo "  View logs:"
echo "  aws logs tail /ecs/$APP_NAME-api --follow --region $AWS_REGION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
