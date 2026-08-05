#!/bin/bash
set -euo pipefail

# ============================================================
# IVX Holdings — Self-Hosted Supabase Setup & Deploy
# One-command setup for self-hosted Supabase infrastructure.
#
# Usage:
#   ./deploy/supabase/setup.sh init       Generate keys + env
#   ./deploy/supabase/setup.sh start      Start all services
#   ./deploy/supabase/setup.sh stop       Stop all services
#   ./deploy/supabase/setup.sh status     Show service status
#   ./deploy/supabase/setup.sh logs       Tail all logs
#   ./deploy/supabase/setup.sh schema     Apply master SQL schema
#   ./deploy/supabase/setup.sh migrate    Run full migration from hosted
#   ./deploy/supabase/setup.sh health     Run health checks
#   ./deploy/supabase/setup.sh backup     Create database backup
#   ./deploy/supabase/setup.sh reset      Stop + remove volumes (DANGER)
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.supabase.yml"
FULL_STACK_FILE="$SCRIPT_DIR/docker-compose.full-stack.yml"
ENV_FILE="$SCRIPT_DIR/.env.supabase"

command -v docker >/dev/null 2>&1 || error "docker not found"
command -v docker compose >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 || error "docker compose not found"

COMPOSE_CMD="docker compose"
if ! docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
fi

cmd_init() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  IVX Holdings — Self-Hosted Supabase Init"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if [ -f "$ENV_FILE" ]; then
    warn ".env.supabase already exists. Backup: .env.supabase.bak"
    cp "$ENV_FILE" "${ENV_FILE}.bak"
  fi

  log "Generating JWT secret..."
  JWT_SECRET=$(openssl rand -hex 32)

  log "Generating keys..."
  if command -v node >/dev/null 2>&1; then
    node "$SCRIPT_DIR/generate-keys.mjs" "$JWT_SECRET" | tee /tmp/ivx-keys.txt
    echo ""
    log "Extracting keys..."

    ANON_KEY=$(grep "^ANON_KEY=" /tmp/ivx-keys.txt | cut -d= -f2-)
    SERVICE_ROLE_KEY=$(grep "^SERVICE_ROLE_KEY=" /tmp/ivx-keys.txt | cut -d= -f2-)
    SECRET_KEY_BASE=$(grep "^SECRET_KEY_BASE=" /tmp/ivx-keys.txt | cut -d= -f2-)
    POSTGRES_PASSWORD=$(grep "^POSTGRES_PASSWORD=" /tmp/ivx-keys.txt | cut -d= -f2-)
    rm -f /tmp/ivx-keys.txt
  else
    error "Node.js required to generate keys. Install node first."
  fi

  log "Writing .env.supabase..."
  cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=postgres
POSTGRES_PORT=5432
JWT_SECRET=${JWT_SECRET}
JWT_EXP=3600
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
API_EXTERNAL_URL=https://db.ivxholding.com
SITE_URL=https://ivxholding.com
ADDITIONAL_REDIRECT_URLS=https://app.ivxholding.com,exp://localhost:8081
KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443
STUDIO_PORT=3100
AUTH_PORT=9999
REST_PORT=3200
REALTIME_PORT=4000
STORAGE_PORT=5000
META_PORT=8080
FUNCTIONS_PORT=9000
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_ADMIN_EMAIL=noreply@ivxholding.com
SMTP_SENDER_NAME=IVX Holdings
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
DISABLE_SIGNUP=false
ENABLE_ANONYMOUS_SIGN_INS=false
RATE_LIMIT_EMAIL_SENT=100
SECRET_KEY_BASE=${SECRET_KEY_BASE}
AWS_REGION=us-east-1
EOF

  ok "Environment file created: $ENV_FILE"
  echo ""
  log "Next steps:"
  echo "  1. Edit $ENV_FILE — set SMTP and domain config"
  echo "  2. Run: ./deploy/supabase/setup.sh start"
  echo "  3. Run: ./deploy/supabase/setup.sh schema"
  echo "  4. Run: ./deploy/supabase/setup.sh health"
  echo ""
  log "Update your app .env with:"
  echo "  EXPO_PUBLIC_SUPABASE_URL=https://db.ivxholding.com"
  echo "  EXPO_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}"
  echo "  SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
  echo ""
}

cmd_start() {
  [ ! -f "$ENV_FILE" ] && error ".env.supabase not found. Run: ./setup.sh init"

  log "Starting self-hosted Supabase services..."
  $COMPOSE_CMD --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

  echo ""
  ok "Services started"
  log "Studio: http://localhost:${STUDIO_PORT:-3100}"
  log "Kong:   http://localhost:${KONG_HTTP_PORT:-8000}"
  log "DB:     localhost:${POSTGRES_PORT:-5432}"
  echo ""
  log "Run './setup.sh health' to verify all services"
}

cmd_start_full() {
  [ ! -f "$ENV_FILE" ] && error ".env.supabase not found. Run: ./setup.sh init"

  log "Starting full stack (Supabase + API + Nginx)..."
  $COMPOSE_CMD --env-file "$ENV_FILE" -f "$FULL_STACK_FILE" up -d

  echo ""
  ok "Full stack started"
}

cmd_stop() {
  log "Stopping services..."
  if [ -f "$ENV_FILE" ]; then
    $COMPOSE_CMD --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down 2>/dev/null || true
    $COMPOSE_CMD --env-file "$ENV_FILE" -f "$FULL_STACK_FILE" down 2>/dev/null || true
  else
    $COMPOSE_CMD -f "$COMPOSE_FILE" down 2>/dev/null || true
  fi
  ok "Services stopped"
}

cmd_status() {
  log "Service status:"
  echo ""
  if [ -f "$ENV_FILE" ]; then
    $COMPOSE_CMD --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps 2>/dev/null || \
    $COMPOSE_CMD --env-file "$ENV_FILE" -f "$FULL_STACK_FILE" ps 2>/dev/null || \
    docker ps --filter "name=ivx-supabase" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  else
    docker ps --filter "name=ivx-supabase" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  fi
}

cmd_logs() {
  SERVICE="${2:-}"
  if [ -n "$SERVICE" ]; then
    docker logs -f "ivx-supabase-${SERVICE}" 2>/dev/null || docker logs -f "$SERVICE"
  else
    if [ -f "$ENV_FILE" ]; then
      $COMPOSE_CMD --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs -f --tail 50
    else
      docker logs -f ivx-supabase-db 2>/dev/null &
      docker logs -f ivx-supabase-kong 2>/dev/null &
      docker logs -f ivx-supabase-auth 2>/dev/null &
      wait
    fi
  fi
}

cmd_schema() {
  [ ! -f "$ENV_FILE" ] && error ".env.supabase not found"

  source "$ENV_FILE"
  MASTER_SQL="$PROJECT_ROOT/supabase-master.sql"

  [ ! -f "$MASTER_SQL" ] && error "supabase-master.sql not found at $MASTER_SQL"

  log "Applying master schema to self-hosted Postgres..."
  export PGPASSWORD="$POSTGRES_PASSWORD"

  psql \
    -h "${POSTGRES_HOST:-localhost}" \
    -p "${POSTGRES_PORT:-5432}" \
    -U postgres \
    -d "${POSTGRES_DB:-postgres}" \
    -f "$MASTER_SQL" \
    2>&1 | tail -20

  ok "Schema applied"
}

cmd_migrate() {
  [ ! -f "$ENV_FILE" ] && error ".env.supabase not found"

  source "$ENV_FILE"
  HOSTED_URL="${SOURCE_SUPABASE_URL:-${EXPO_PUBLIC_SUPABASE_URL:-}}"
  HOSTED_KEY="${SOURCE_SUPABASE_SERVICE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"

  [ -z "$HOSTED_URL" ] && error "SOURCE_SUPABASE_URL not set"
  [ -z "$HOSTED_KEY" ] && error "SOURCE_SUPABASE_SERVICE_KEY not set"

  SELF_URL="http://localhost:${KONG_HTTP_PORT:-8000}"

  log "Migration: $HOSTED_URL → $SELF_URL"
  echo ""

  log "Step 1/3: Export from hosted..."
  SOURCE_SUPABASE_URL="$HOSTED_URL" \
  SOURCE_SUPABASE_SERVICE_KEY="$HOSTED_KEY" \
    node "$SCRIPT_DIR/migrate-data.mjs" export

  log "Step 2/3: Import to self-hosted..."
  TARGET_SUPABASE_URL="$SELF_URL" \
  TARGET_SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY" \
    node "$SCRIPT_DIR/migrate-data.mjs" import

  log "Step 3/3: Verify..."
  SOURCE_SUPABASE_URL="$HOSTED_URL" \
  SOURCE_SUPABASE_SERVICE_KEY="$HOSTED_KEY" \
  TARGET_SUPABASE_URL="$SELF_URL" \
  TARGET_SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY" \
    node "$SCRIPT_DIR/migrate-data.mjs" verify

  echo ""
  ok "Migration complete"
}

cmd_health() {
  [ ! -f "$ENV_FILE" ] && error ".env.supabase not found"

  source "$ENV_FILE"
  SUPABASE_URL="http://localhost:${KONG_HTTP_PORT:-8000}" \
  ANON_KEY="$ANON_KEY" \
  SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  POSTGRES_HOST="${POSTGRES_HOST:-localhost}" \
  POSTGRES_PORT="${POSTGRES_PORT:-5432}" \
  STUDIO_PORT="${STUDIO_PORT:-3100}" \
    node "$SCRIPT_DIR/health-check.mjs"
}

cmd_backup() {
  [ ! -f "$ENV_FILE" ] && error ".env.supabase not found"

  source "$ENV_FILE"
  POSTGRES_HOST="${POSTGRES_HOST:-localhost}" \
  POSTGRES_PORT="${POSTGRES_PORT:-5432}" \
  POSTGRES_DB="${POSTGRES_DB:-postgres}" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  BACKUP_DIR="$SCRIPT_DIR/backups" \
    bash "$SCRIPT_DIR/backup.sh"
}

cmd_reset() {
  warn "This will DESTROY all Supabase data volumes!"
  read -p "Type 'DESTROY' to confirm: " RESPONSE
  [ "$RESPONSE" != "DESTROY" ] && { log "Aborted."; exit 0; }

  cmd_stop
  log "Removing volumes..."
  docker volume rm ivx-supabase-db-data ivx-supabase-storage-data 2>/dev/null || true
  ok "All data removed"
}

case "${1:-help}" in
  init)       cmd_init ;;
  start)      cmd_start ;;
  start-full) cmd_start_full ;;
  stop)       cmd_stop ;;
  status)     cmd_status ;;
  logs)       cmd_logs "$@" ;;
  schema)     cmd_schema ;;
  migrate)    cmd_migrate ;;
  health)     cmd_health ;;
  backup)     cmd_backup ;;
  reset)      cmd_reset ;;
  *)
    echo ""
    echo "IVX Holdings — Self-Hosted Supabase Management"
    echo ""
    echo "Commands:"
    echo "  init         Generate keys and .env.supabase"
    echo "  start        Start Supabase services only"
    echo "  start-full   Start full stack (Supabase + API + Nginx)"
    echo "  stop         Stop all services"
    echo "  status       Show running services"
    echo "  logs [svc]   Tail logs (optional: db, auth, kong, rest, realtime, storage)"
    echo "  schema       Apply supabase-master.sql to self-hosted DB"
    echo "  migrate      Full migration from hosted Supabase"
    echo "  health       Run health checks on all services"
    echo "  backup       Create database backup"
    echo "  reset        DESTROY all data and volumes"
    echo ""
    ;;
esac
