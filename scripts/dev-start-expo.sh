#!/usr/bin/env bash
# IVX Holdings — Local Expo Mobile App Startup Script
# Starts the Expo dev server. No Rork required.
set -euo pipefail

cd "$(dirname "$0")/../expo"

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Verify SDK version matches package.json
echo "[IVX] Verifying Expo SDK..."
bun run scripts/verify-expo-sdk.mjs 2>/dev/null || echo "[IVX] SDK check skipped"

echo "[IVX] Starting Expo dev server..."
exec bunx expo start --clear
