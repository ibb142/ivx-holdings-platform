#!/bin/bash
set -euo pipefail

# ============================================================
# IVX Holdings — Self-Hosted Supabase Restore Script
# Restores a pg_dump backup to the target database.
#
# Usage:
#   ./deploy/supabase/restore.sh <backup_file>
#   ./deploy/supabase/restore.sh backups/ivx_supabase_20260330_120000.sql.gz
#
# Env vars:
#   POSTGRES_HOST     (default: localhost)
#   POSTGRES_PORT     (default: 5432)
#   POSTGRES_DB       (default: postgres)
#   POSTGRES_PASSWORD (required)
#   CONFIRM_RESTORE   (set to "yes" to skip prompt)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

BACKUP_FILE="${1:-}"
PG_HOST="${POSTGRES_HOST:-localhost}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_DB="${POSTGRES_DB:-postgres}"
PG_PASS="${POSTGRES_PASSWORD:-}"
CONFIRM="${CONFIRM_RESTORE:-}"

[ -z "$BACKUP_FILE" ] && error "Usage: ./restore.sh <backup_file>"
[ -z "$PG_PASS" ] && error "POSTGRES_PASSWORD is required"
[ ! -f "$BACKUP_FILE" ] && error "Backup file not found: $BACKUP_FILE"
command -v psql >/dev/null 2>&1 || error "psql not found. Install postgresql-client."

FILE_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  IVX Holdings — Supabase Restore"
echo "  File: ${BACKUP_FILE} (${FILE_SIZE})"
echo "  Target: ${PG_HOST}:${PG_PORT}/${PG_DB}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

warn "THIS WILL OVERWRITE the target database: ${PG_DB}"
warn "All existing data will be replaced."
echo ""

if [ "$CONFIRM" != "yes" ]; then
  read -p "Type 'RESTORE' to confirm: " RESPONSE
  [ "$RESPONSE" != "RESTORE" ] && { log "Aborted."; exit 0; }
fi

export PGPASSWORD="$PG_PASS"

log "Creating pre-restore backup..."
PRE_RESTORE_FILE="pre_restore_$(date '+%Y%m%d_%H%M%S').sql.gz"
pg_dump \
  -h "$PG_HOST" \
  -p "$PG_PORT" \
  -U postgres \
  -d "$PG_DB" \
  --no-owner \
  --no-privileges \
  2>/dev/null | gzip > "$PRE_RESTORE_FILE"
ok "Pre-restore backup saved: $PRE_RESTORE_FILE"

log "Starting restore..."
START_TIME=$(date +%s)

if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | psql \
    -h "$PG_HOST" \
    -p "$PG_PORT" \
    -U postgres \
    -d "$PG_DB" \
    --single-transaction \
    --set ON_ERROR_STOP=off \
    2>&1 | tail -5
else
  psql \
    -h "$PG_HOST" \
    -p "$PG_PORT" \
    -U postgres \
    -d "$PG_DB" \
    --single-transaction \
    --set ON_ERROR_STOP=off \
    -f "$BACKUP_FILE" \
    2>&1 | tail -5
fi

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

ok "Restore complete in ${ELAPSED}s"

log "Verifying restore..."
TABLE_COUNT=$(psql \
  -h "$PG_HOST" \
  -p "$PG_PORT" \
  -U postgres \
  -d "$PG_DB" \
  -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
  2>/dev/null | xargs)

PROFILE_COUNT=$(psql \
  -h "$PG_HOST" \
  -p "$PG_PORT" \
  -U postgres \
  -d "$PG_DB" \
  -t -c "SELECT count(*) FROM profiles;" \
  2>/dev/null | xargs || echo "0")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Restore complete"
echo "  Tables: ${TABLE_COUNT}"
echo "  Profiles: ${PROFILE_COUNT}"
echo "  Duration: ${ELAPSED}s"
echo "  Pre-restore backup: ${PRE_RESTORE_FILE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
