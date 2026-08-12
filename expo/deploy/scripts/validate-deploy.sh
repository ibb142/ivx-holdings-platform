#!/bin/bash
set -euo pipefail

# ============================================================
# IVX Holdings — Pre-Deploy Validation
# Checks everything is ready before deploying
# Usage: ./deploy/scripts/validate-deploy.sh [staging|production]
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ENVIRONMENT="${1:-production}"
APP_NAME="${APP_NAME:-ivx-holdings}"
AWS_REGION="${AWS_REGION:-us-east-1}"

PASS=0
WARN=0
FAIL=0

check_pass() { echo -e "  ${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
check_warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; WARN=$((WARN+1)); }
check_fail() { echo -e "  ${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }

echo ""
echo "━━━ IVX Holdings — Pre-Deploy Validation ($ENVIRONMENT) ━━━"
echo ""

# ─── TOOLS ────────────────────────────────────────────────────
echo -e "${BLUE}[Tools]${NC}"
command -v aws    >/dev/null 2>&1 && check_pass "aws CLI installed" || check_fail "aws CLI not installed"
command -v docker >/dev/null 2>&1 && check_pass "docker installed" || check_fail "docker not installed"
command -v node   >/dev/null 2>&1 && check_pass "node installed" || check_fail "node not installed"
command -v bun    >/dev/null 2>&1 && check_pass "bun installed" || check_warn "bun not installed (needed for local dev)"
echo ""

# ─── AWS CREDENTIALS ─────────────────────────────────────────
echo -e "${BLUE}[AWS]${NC}"
if aws sts get-caller-identity >/dev/null 2>&1; then
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  check_pass "AWS authenticated (Account: $ACCOUNT_ID)"
else
  check_fail "AWS not authenticated — run: aws configure"
fi
echo ""

# ─── FILES ────────────────────────────────────────────────────
echo -e "${BLUE}[Required Files]${NC}"
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
PROJECT_ROOT="$(resolve_project_root)" || {
  check_fail "Could not resolve project root"
  exit "$FAIL"
}

[ -f "$PROJECT_ROOT/Dockerfile" ]              && check_pass "Dockerfile" || check_fail "Dockerfile missing"
[ -f "$PROJECT_ROOT/server.ts" ]               && check_pass "server.ts" || check_fail "server.ts missing"
[ -f "$PROJECT_ROOT/backend/hono.ts" ]         && check_pass "backend/hono.ts" || check_fail "backend/hono.ts missing"
[ -f "$PROJECT_ROOT/package.json" ]            && check_pass "package.json" || check_fail "package.json missing"
[ -f "$PROJECT_ROOT/bun.lock" ]                && check_pass "bun.lock" || check_fail "bun.lock missing"
[ -f "$PROJECT_ROOT/expo/deploy/aws/cloudformation.yml" ] && check_pass "cloudformation.yml" || check_fail "cloudformation.yml missing"
[ -f "$SCRIPT_DIR/deploy.sh" ]                 && check_pass "deploy.sh" || check_fail "deploy.sh missing"
[ -f "$SCRIPT_DIR/setup-aws.sh" ]              && check_pass "setup-aws.sh" || check_fail "setup-aws.sh missing"
echo ""

# ─── DOCKER ───────────────────────────────────────────────────
echo -e "${BLUE}[Docker]${NC}"
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    check_pass "Docker daemon running"
    
    if docker build --dry-run "$PROJECT_ROOT" >/dev/null 2>&1; then
      check_pass "Dockerfile syntax valid"
    else
      check_warn "Could not validate Dockerfile (--dry-run not supported in this Docker version)"
    fi
  else
    check_fail "Docker daemon not running — start Docker Desktop"
  fi
fi
echo ""

# ─── ACM CERTIFICATE ─────────────────────────────────────────
echo -e "${BLUE}[SSL Certificate]${NC}"
if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
  CERT_COUNT=$(aws acm list-certificates \
    --region us-east-1 \
    --query "length(CertificateSummaryList[?contains(DomainName,'ivxholding.com')])" \
    --output text 2>/dev/null || echo "0")

  if [ "$CERT_COUNT" != "0" ] && [ "$CERT_COUNT" != "None" ]; then
    CERT_STATUS=$(aws acm list-certificates \
      --region us-east-1 \
      --certificate-statuses ISSUED \
      --query "CertificateSummaryList[?contains(DomainName,'ivxholding.com')].CertificateArn" \
      --output text 2>/dev/null | head -1)

    if [ -n "$CERT_STATUS" ] && [ "$CERT_STATUS" != "None" ]; then
      check_pass "ACM certificate ISSUED for ivxholding.com"
    else
      check_warn "ACM certificate exists but not yet ISSUED — validation may be pending"
    fi
  else
    check_warn "No ACM certificate found — run: node deploy/scripts/aws-full-setup.mjs"
  fi
fi
echo ""

# ─── ECR REPOSITORY ──────────────────────────────────────────
echo -e "${BLUE}[ECR Repository]${NC}"
if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
  if aws ecr describe-repositories --repository-names "${APP_NAME}-api" --region "$AWS_REGION" >/dev/null 2>&1; then
    check_pass "ECR repository exists: ${APP_NAME}-api"
  else
    check_warn "ECR repository not found — will be created during deployment"
  fi
fi
echo ""

# ─── CLOUDFORMATION STACK ────────────────────────────────────
echo -e "${BLUE}[CloudFormation]${NC}"
if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
  STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "${APP_NAME}-stack" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "NOT_FOUND")

  case "$STACK_STATUS" in
    *COMPLETE*)    check_pass "Stack: $STACK_STATUS" ;;
    *IN_PROGRESS*) check_warn "Stack: $STACK_STATUS — deployment in progress" ;;
    *ROLLBACK*)    check_fail "Stack: $STACK_STATUS — needs manual fix" ;;
    *FAILED*)      check_fail "Stack: $STACK_STATUS — needs manual fix" ;;
    NOT_FOUND)     check_warn "Stack not deployed yet — will be created" ;;
    *)             check_warn "Stack: $STACK_STATUS" ;;
  esac
fi
echo ""

# ─── SECRETS MANAGER ─────────────────────────────────────────
echo -e "${BLUE}[Secrets Manager]${NC}"
if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
  REQUIRED_SECRETS=("jwt-secret" "aws-access-key-id" "aws-secret-access-key" "aws-region" "aws-s3-bucket")
  OPTIONAL_SECRETS=("stripe-secret-key" "stripe-publishable-key" "stripe-webhook-secret" "sendgrid-api-key" "sendgrid-from-email" "plaid-client-id" "plaid-secret" "plaid-env" "onfido-api-key" "sentry-dsn")

  for secret in "${REQUIRED_SECRETS[@]}"; do
    SECRET_ID="${APP_NAME}/${secret}"
    if aws secretsmanager describe-secret --secret-id "$SECRET_ID" --region "$AWS_REGION" >/dev/null 2>&1; then
      VALUE=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --region "$AWS_REGION" --query 'SecretString' --output text 2>/dev/null || echo "")
      if [ -n "$VALUE" ] && [ "$VALUE" != "PLACEHOLDER_REPLACE_ME" ]; then
        check_pass "Secret: $SECRET_ID"
      else
        check_fail "Secret: $SECRET_ID has placeholder value — update it"
      fi
    else
      check_warn "Secret: $SECRET_ID not found — will be created during setup"
    fi
  done

  for secret in "${OPTIONAL_SECRETS[@]}"; do
    SECRET_ID="${APP_NAME}/${secret}"
    if aws secretsmanager describe-secret --secret-id "$SECRET_ID" --region "$AWS_REGION" >/dev/null 2>&1; then
      VALUE=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --region "$AWS_REGION" --query 'SecretString' --output text 2>/dev/null || echo "")
      if [ -n "$VALUE" ] && [ "$VALUE" != "PLACEHOLDER_REPLACE_ME" ]; then
        check_pass "Secret: $SECRET_ID"
      else
        check_warn "Secret: $SECRET_ID has placeholder — update for full functionality"
      fi
    else
      check_warn "Secret: $SECRET_ID not found (optional)"
    fi
  done
fi
echo ""

# ─── SUMMARY ─────────────────────────────────────────────────
TOTAL=$((PASS + WARN + FAIL))
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}Pass: $PASS${NC}  |  ${YELLOW}Warn: $WARN${NC}  |  ${RED}Fail: $FAIL${NC}  |  Total: $TOTAL"

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}Status: READY TO DEPLOY${NC}"
  if [ "$WARN" -gt 0 ]; then
    echo -e "  ${YELLOW}(Some warnings — review above)${NC}"
  fi
else
  echo -e "  ${RED}Status: NOT READY — fix $FAIL failure(s) above${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit "$FAIL"
