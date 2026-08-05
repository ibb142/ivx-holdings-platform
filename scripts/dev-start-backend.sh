#!/usr/bin/env bash
# IVX Holdings — Local Backend Startup Script
# Starts the Hono API server with all 77 routes. No Rork required.
set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env if present (local development only)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"

echo "[IVX] Starting backend on ${HOST}:${PORT}..."
echo "[IVX] Node: $(node --version)"
echo "[IVX] Bun: $(bun --version 2>/dev/null || echo 'not installed')"

# Use tsx for TypeScript execution (matches Render's dockerCommand)
exec npx tsx server.ts
