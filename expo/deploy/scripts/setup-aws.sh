#!/bin/bash
set -euo pipefail

# ============================================================
# IVX Holdings — AWS Initial Setup Script
# Run this ONCE to create the full AWS infrastructure
# Usage: ./deploy/scripts/setup-aws.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── CONFIG ────────────────────────────────────────────────
APP_NAME="${APP_NAME:-ivx-holdings}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
STACK_NAME="${APP_NAME}-stack"

# ─── REQUIRED PARAMS (set these before running) ────────────
CERTIFICATE_ARN="${CERTIFICATE_ARN:-}"
DOMAIN_NAME="${DOMAIN_NAME:-api.ivxholding.com}"

# ─── CHECK PREREQUISITES ───────────────────────────────────
log "Checking prerequisites..."
command -v aws    >/dev/null 2>&1 || error "aws CLI not found. Install from https://aws.amazon.com/cli/"
command -v docker >/dev/null 2>&1 || error "docker not found."
aws sts get-caller-identity --query Account --output text >/dev/null 2>&1 || error "AWS credentials not configured. Run: aws configure"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ok "AWS Account: $ACCOUNT_ID | Region: $AWS_REGION"

# ─── VALIDATE INPUTS ───────────────────────────────────────
if [ -z "$CERTIFICATE_ARN" ]; then
  warn "CERTIFICATE_ARN is not set."
  echo ""
  echo "  To create an ACM certificate for $DOMAIN_NAME run:"
  echo "  aws acm request-certificate \\"
  echo "    --domain-name $DOMAIN_NAME \\"
  echo "    --subject-alternative-names \"*.$DOMAIN_NAME\" \\"
  echo "    --validation-method DNS \\"
  echo "    --region $AWS_REGION"
  echo ""
  read -p "Enter your ACM Certificate ARN: " CERTIFICATE_ARN
  [ -z "$CERTIFICATE_ARN" ] && error "Certificate ARN is required."
fi

ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$APP_NAME-api"

# ─── STEP 1: Store AWS Account ID in SSM ───────────────────
log "Storing account ID in SSM Parameter Store..."
aws ssm put-parameter \
  --name "/${APP_NAME}/account-id" \
  --value "$ACCOUNT_ID" \
  --type String \
  --overwrite \
  --region "$AWS_REGION" >/dev/null
ok "SSM parameter stored"

# ─── STEP 2: Store secrets in Secrets Manager ──────────────
log "Creating secrets in AWS Secrets Manager..."

create_secret() {
  local name="$1"
  local description="$2"
  local value="$3"

  local secret_id="${APP_NAME}/${name}"

  if aws secretsmanager describe-secret --secret-id "$secret_id" --region "$AWS_REGION" >/dev/null 2>&1; then
    warn "Secret ${secret_id} already exists — skipping"
  else
    if [ -n "$value" ]; then
      aws secretsmanager create-secret \
        --name "$secret_id" \
        --description "$description" \
        --secret-string "$value" \
        --region "$AWS_REGION" >/dev/null
    else
      aws secretsmanager create-secret \
        --name "$secret_id" \
        --description "$description" \
        --secret-string "PLACEHOLDER_REPLACE_ME" \
        --region "$AWS_REGION" >/dev/null
      warn "Secret ${secret_id} created with placeholder — update it in the AWS console"
    fi
    ok "Created secret: $secret_id"
  fi
}

JWT_SECRET=$(openssl rand -hex 32)
create_secret "jwt-secret"              "JWT signing secret"            "$JWT_SECRET"
create_secret "aws-access-key-id"       "AWS access key ID"             "${AWS_ACCESS_KEY_ID:-}"
create_secret "aws-secret-access-key"   "AWS secret access key"         "${AWS_SECRET_ACCESS_KEY:-}"
create_secret "aws-region"              "AWS region"                    "$AWS_REGION"
create_secret "aws-s3-bucket"           "S3 bucket name"                "${APP_NAME}-prod"
create_secret "stripe-secret-key"       "Stripe secret key"             ""
create_secret "stripe-publishable-key" "Stripe publishable key"        ""
create_secret "stripe-webhook-secret"   "Stripe webhook signing secret" ""
create_secret "sendgrid-api-key"        "SendGrid API key"              ""
create_secret "sendgrid-from-email"     "SendGrid sender email"         "noreply@ivxholding.com"
create_secret "plaid-client-id"         "Plaid client ID"               ""
create_secret "plaid-secret"            "Plaid secret key"              ""
create_secret "plaid-env"               "Plaid environment"             "production"
create_secret "onfido-api-key"          "Onfido KYC API key"            ""
create_secret "sentry-dsn"              "Sentry DSN for error tracking" ""

ok "All secrets created"

# ─── STEP 3: Build & push Docker image ─────────────────────
log "Building Docker image..."
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

docker build -t "$APP_NAME-api:latest" "$PROJECT_ROOT"
ok "Docker image built"

log "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# ECR repo will be created by CloudFormation, but we need it for tagging
# If CloudFormation hasn't run yet, pre-create it
aws ecr describe-repositories --repository-names "$APP_NAME-api" --region "$AWS_REGION" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name "$APP_NAME-api" --region "$AWS_REGION" >/dev/null

docker tag "$APP_NAME-api:latest" "$ECR_URI:latest"
docker push "$ECR_URI:latest"
ok "Image pushed to ECR: $ECR_URI:latest"

# ─── STEP 4: Deploy CloudFormation stack ───────────────────
log "Deploying CloudFormation stack: $STACK_NAME..."

TEMPLATE_PATH="$SCRIPT_DIR/../aws/cloudformation.yml"

aws cloudformation deploy \
  --template-file "$TEMPLATE_PATH" \
  --stack-name "$STACK_NAME" \
  --parameter-overrides \
    "Environment=$ENVIRONMENT" \
    "AppName=$APP_NAME" \
    "DomainName=$DOMAIN_NAME" \
    "CertificateArn=$CERTIFICATE_ARN" \
    "ContainerImage=$ECR_URI:latest" \
    "DesiredCount=2" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION" \
  --no-fail-on-empty-changeset

ok "CloudFormation stack deployed"

# ─── STEP 5: Print outputs ─────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  IVX Holdings — Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ALBDNS'].OutputValue" \
  --output text \
  --region "$AWS_REGION")

ECR_REPO=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ECRRepositoryURI'].OutputValue" \
  --output text \
  --region "$AWS_REGION")

ALB_HOSTED_ZONE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ALBCanonicalHostedZoneID'].OutputValue" \
  --output text \
  --region "$AWS_REGION")

echo ""
echo "  ALB DNS:    $ALB_DNS"
echo "  ALB Zone:   $ALB_HOSTED_ZONE_ID"
echo "  ECR Repo:   $ECR_REPO"
echo "  Region:     $AWS_REGION"
echo "  Account:    $ACCOUNT_ID"
echo ""
echo "  NEXT STEPS:"
echo "  1. Create or UPSERT Route53 A (Alias) $DOMAIN_NAME → $ALB_DNS"
echo "     Hosted zone ID for the alias target: $ALB_HOSTED_ZONE_ID"
echo "  2. Update placeholder secrets in AWS Secrets Manager console"
echo "  3. Run health check: curl https://$DOMAIN_NAME/health"
echo ""
echo "  Generated JWT_SECRET has been stored in Secrets Manager."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
