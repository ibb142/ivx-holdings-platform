#!/bin/bash
set -euo pipefail

# ============================================================
# IVX Holdings — Master Deploy Orchestrator
# One-command deployment: validates → builds → deploys → verifies
# Usage: ./deploy/scripts/master-deploy.sh [staging|production]
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step()  { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}"; }

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

ENVIRONMENT="${1:-production}"
APP_NAME="${APP_NAME:-ivx-holdings}"
AWS_REGION="${AWS_REGION:-us-east-1}"
DOMAIN_NAME="${DOMAIN_NAME:-api.ivxholding.com}"
SKIP_VALIDATION="${SKIP_VALIDATION:-false}"
SKIP_DNS="${SKIP_DNS:-false}"
DRY_RUN="${DRY_RUN:-false}"

echo ""
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${BLUE}  IVX Holdings — Master Deploy Orchestrator${NC}"
echo -e "${BOLD}${BLUE}  Environment: ${ENVIRONMENT}${NC}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ─── PHASE 1: PRE-FLIGHT CHECKS ──────────────────────────────
step "Phase 1: Pre-flight Checks"

command -v aws    >/dev/null 2>&1 || error "aws CLI not found. Install: https://aws.amazon.com/cli/"
command -v docker >/dev/null 2>&1 || error "docker not found. Install: https://docs.docker.com/get-docker/"
command -v node   >/dev/null 2>&1 || error "node not found. Install: https://nodejs.org/"
ok "Required tools installed (aws, docker, node)"

aws sts get-caller-identity >/dev/null 2>&1 || error "AWS not authenticated. Run: aws configure"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ok "AWS authenticated — Account: $ACCOUNT_ID"

if [ ! -f "$PROJECT_ROOT/Dockerfile" ]; then
  error "Dockerfile not found in $PROJECT_ROOT"
fi
ok "Dockerfile found"

if [ ! -f "$PROJECT_ROOT/server.ts" ]; then
  error "server.ts not found"
fi
ok "Server entry point found"

# ─── PHASE 2: VALIDATION ─────────────────────────────────────
if [ "$SKIP_VALIDATION" != "true" ]; then
  step "Phase 2: Pre-deploy Validation"

  if [ -f "$SCRIPT_DIR/validate-deploy.sh" ]; then
    bash "$SCRIPT_DIR/validate-deploy.sh" "$ENVIRONMENT" || error "Validation failed — fix issues before deploying"
    ok "Pre-deploy validation passed"
  else
    warn "validate-deploy.sh not found — skipping validation"
  fi
else
  warn "Skipping validation (SKIP_VALIDATION=true)"
fi

# ─── PHASE 3: DNS + SSL SETUP ────────────────────────────────
if [ "$SKIP_DNS" != "true" ]; then
  step "Phase 3: DNS + SSL Setup"

  log "Running AWS full setup (Route53 + ACM)..."
  if [ "$DRY_RUN" = "true" ]; then
    warn "DRY_RUN: Would run node $SCRIPT_DIR/aws-full-setup.mjs"
  else
    node "$SCRIPT_DIR/aws-full-setup.mjs"
  fi
  ok "DNS + SSL setup complete"
else
  warn "Skipping DNS setup (SKIP_DNS=true)"
fi

# ─── PHASE 4: CHECK/CREATE INFRASTRUCTURE ─────────────────────
step "Phase 4: Infrastructure"

STACK_NAME="${APP_NAME}-stack"
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$STACK_STATUS" = "NOT_FOUND" ]; then
  log "CloudFormation stack not found — running initial setup..."

  CERT_ARN=$(aws acm list-certificates \
    --region us-east-1 \
    --query "CertificateSummaryList[?contains(DomainName,'ivxholding.com')].CertificateArn" \
    --output text 2>/dev/null | head -1)

  if [ -z "$CERT_ARN" ] || [ "$CERT_ARN" = "None" ]; then
    error "No ACM certificate found for ivxholding.com. Run Phase 3 first and wait for certificate validation."
  fi

  ok "Found certificate: $CERT_ARN"

  if [ "$DRY_RUN" = "true" ]; then
    warn "DRY_RUN: Would run CERTIFICATE_ARN=$CERT_ARN $SCRIPT_DIR/setup-aws.sh"
  else
    CERTIFICATE_ARN="$CERT_ARN" bash "$SCRIPT_DIR/setup-aws.sh"
  fi
  ok "Infrastructure deployed"
else
  ok "Stack exists: $STACK_STATUS"

  if [[ "$STACK_STATUS" == *"ROLLBACK"* ]] || [[ "$STACK_STATUS" == *"FAILED"* ]]; then
    error "Stack is in $STACK_STATUS state — manual intervention required"
  fi
fi

# ─── PHASE 5: BUILD + DEPLOY ─────────────────────────────────
step "Phase 5: Build & Deploy"

IMAGE_TAG="${IMAGE_TAG:-$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "latest")}"
log "Image tag: $IMAGE_TAG"

if [ "$DRY_RUN" = "true" ]; then
  warn "DRY_RUN: Would run $SCRIPT_DIR/deploy.sh $IMAGE_TAG"
else
  bash "$SCRIPT_DIR/deploy.sh" "$IMAGE_TAG"
fi
ok "Deployment complete"

# ─── PHASE 6: DNS RECORDS ─────────────────────────────────────
if [ "$SKIP_DNS" != "true" ]; then
  step "Phase 6: Update DNS Records"

  ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ALBDNS'].OutputValue" \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

  if [ -n "$ALB_DNS" ] && [ "$ALB_DNS" != "None" ]; then
    log "ALB DNS: $ALB_DNS"
    log "Re-running DNS setup to point domains to ALB..."
    if [ "$DRY_RUN" != "true" ]; then
      node "$SCRIPT_DIR/aws-full-setup.mjs"
    fi
    ok "DNS records updated"
  else
    warn "ALB DNS not available yet — run this script again after stack completes"
  fi
fi

# ─── PHASE 7: HEALTH CHECK + VERIFICATION ─────────────────────
step "Phase 7: Verification"

API_URL="${API_URL:-https://$DOMAIN_NAME}"
log "Checking health at $API_URL..."

RETRIES=0
MAX_RETRIES=12
while [ "$RETRIES" -lt "$MAX_RETRIES" ]; do
  HEALTH=$(curl -sf --max-time 10 "$API_URL/health" 2>/dev/null || echo "")
  if [ -n "$HEALTH" ]; then
    STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "healthy" ]; then
      ok "API is healthy at $API_URL"
      break
    fi
  fi
  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -lt "$MAX_RETRIES" ]; then
    log "Attempt $RETRIES/$MAX_RETRIES — retrying in 10s..."
    sleep 10
  else
    warn "API not responding after $MAX_RETRIES attempts — check CloudWatch logs"
  fi
done

# ─── PHASE 8: STATUS ──────────────────────────────────────────
step "Phase 8: Final Status"

if [ -f "$SCRIPT_DIR/status.sh" ]; then
  bash "$SCRIPT_DIR/status.sh"
fi

# ─── SUMMARY ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  IVX Holdings — Deployment Complete!${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Environment: ${CYAN}$ENVIRONMENT${NC}"
echo -e "  Image Tag:   ${CYAN}$IMAGE_TAG${NC}"
echo -e "  API URL:     ${CYAN}$API_URL${NC}"
echo -e "  Region:      ${CYAN}$AWS_REGION${NC}"
echo ""
echo -e "  ${YELLOW}Useful commands:${NC}"
echo -e "  ${CYAN}./deploy/scripts/status.sh${NC}                      — Check status"
echo -e "  ${CYAN}./deploy/scripts/health-check.sh $API_URL${NC}       — Run health check"
echo -e "  ${CYAN}./deploy/scripts/rollback.sh${NC}                    — Rollback to previous"
echo -e "  ${CYAN}aws logs tail /ecs/$APP_NAME-api --follow${NC}       — View live logs"
echo ""
