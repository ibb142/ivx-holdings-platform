#!/usr/bin/env bash
# IVX Holdings — Unified Bootstrap + Sync Shell
#
# One command to env-check, install, validate, and run the GitHub sync end-to-end.
#
# Usage:
#   bash expo/bootstrap.sh                  # full: env + install + validate + sync
#   bash expo/bootstrap.sh --dry-run        # everything except the actual GitHub push
#   bash expo/bootstrap.sh --skip-install   # skip bun install
#   bash expo/bootstrap.sh --skip-validate  # skip tsc + verify-expo-sdk
#   bash expo/bootstrap.sh --message "msg"  # custom commit message
#   bash expo/bootstrap.sh --no-sync        # bootstrap only, do not call sync-github.mjs

set -euo pipefail

# ---------- colors ----------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

step() { echo -e "${C_BLUE}${C_BOLD}[bootstrap]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}[ok]${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}[warn]${C_RESET} $*"; }
fail() { echo -e "${C_RED}${C_BOLD}[fail]${C_RESET} $*" >&2; }
hdr()  { echo -e "\n${C_CYAN}${C_BOLD}== $* ==${C_RESET}"; }

# ---------- args ----------
DRY_RUN=0
SKIP_INSTALL=0
SKIP_VALIDATE=0
RUN_SYNC=1
COMMIT_MSG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)        DRY_RUN=1; shift ;;
    --skip-install)   SKIP_INSTALL=1; shift ;;
    --skip-validate)  SKIP_VALIDATE=1; shift ;;
    --no-sync)        RUN_SYNC=0; shift ;;
    --message)        COMMIT_MSG="${2:-}"; shift 2 ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
      exit 0
      ;;
    *) fail "unknown flag: $1"; exit 2 ;;
  esac
done

# ---------- locate ----------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR"
ok "working dir: $SCRIPT_DIR"

START_TS=$(date +%s)

# ---------- 0. load .env if present (safe parser, never `source`) ----------
hdr "0/5 load env"
if [[ -f .env ]]; then
  loaded_count=0
  skipped_count=0
  while IFS= read -r raw_line || [[ -n "${raw_line:-}" ]]; do
    line="${raw_line%$'\r'}"
    # skip blank
    if [[ -z "${line// /}" ]]; then continue; fi
    # skip comment
    if [[ "${line:0:1}" == "#" ]]; then continue; fi
    # require '='
    if [[ "$line" != *=* ]]; then continue; fi
    key="${line%%=*}"
    val="${line#*=}"
    # trim whitespace from key
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    # validate name
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      skipped_count=$((skipped_count + 1))
      continue
    fi
    # strip matching surrounding quotes
    if [[ ${#val} -ge 2 ]]; then
      first="${val:0:1}"; last="${val: -1}"
      if [[ "$first" == '"' && "$last" == '"' ]]; then
        val="${val:1:${#val}-2}"
      elif [[ "$first" == "'" && "$last" == "'" ]]; then
        val="${val:1:${#val}-2}"
      fi
    fi
    export "$key=$val"
    loaded_count=$((loaded_count + 1))
  done < .env
  ok "loaded expo/.env vars=${loaded_count} skipped=${skipped_count}"
else
  warn "no expo/.env (continuing - sync-github.mjs will read project env)"
fi

# ---------- 1. tool check ----------
hdr "1/5 tool check"
require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "missing required tool: $1"
    exit 1
  fi
  ok "$1 -> $($1 --version 2>/dev/null | head -n1 || echo present)"
}
require bun
require node

# ---------- 2. env check ----------
hdr "2/5 env check"
ENV_OK=1
check_env() {
  local name="$1" required="${2:-required}"
  local val="${!name:-}"
  if [[ -z "$val" ]]; then
    if [[ "$required" == "required" ]]; then
      fail "$name is missing"
      ENV_OK=0
    else
      warn "$name not set"
    fi
  else
    ok "$name present len=${#val}"
  fi
}

if [[ "$RUN_SYNC" == "1" ]]; then
  check_env GITHUB_TOKEN required
  if [[ -z "${GITHUB_REPO:-}" && -z "${GITHUB_REPO_URL:-}" ]]; then
    fail "GITHUB_REPO or GITHUB_REPO_URL must be set"
    ENV_OK=0
  else
    ok "github repo target present"
  fi
fi
check_env EXPO_PUBLIC_SUPABASE_URL optional
check_env EXPO_PUBLIC_SUPABASE_ANON_KEY optional

if [[ "$ENV_OK" != "1" ]]; then
  fail "env check failed - fix the above and retry"
  exit 1
fi

# ---------- 3. install ----------
hdr "3/5 install"
if [[ "$SKIP_INSTALL" == "1" ]]; then
  warn "skipped (--skip-install)"
else
  if [[ ! -d node_modules ]]; then
    step "running bun install (fresh)"
  else
    step "running bun install (incremental)"
  fi
  bun install
  ok "deps installed"
fi

# ---------- 4. validate ----------
hdr "4/5 validate"
if [[ "$SKIP_VALIDATE" == "1" ]]; then
  warn "skipped (--skip-validate)"
else
  if [[ -f scripts/verify-expo-sdk.mjs ]]; then
    step "verify-expo-sdk.mjs"
    bun scripts/verify-expo-sdk.mjs
    ok "expo SDK guard passed"
  else
    warn "scripts/verify-expo-sdk.mjs not found - skipping SDK guard"
  fi

  step "tsc --noEmit (expo)"
  bunx tsc --noEmit --pretty false
  ok "expo typecheck passed"

  if [[ -f ../tsconfig.json ]]; then
    step "tsc --noEmit (root/backend)"
    if (cd .. && bunx tsc --noEmit --pretty false); then
      ok "root typecheck passed"
    else
      warn "root typecheck failed (non-fatal)"
    fi
  fi
fi

# ---------- 5. sync ----------
hdr "5/5 github sync"
if [[ "$RUN_SYNC" != "1" ]]; then
  warn "skipped (--no-sync)"
else
  SYNC_ARGS=()
  [[ "$DRY_RUN" == "1" ]] && SYNC_ARGS+=("--dry-run")
  [[ -n "$COMMIT_MSG" ]] && SYNC_ARGS+=("--message" "$COMMIT_MSG")

  step "node sync-github.mjs ${SYNC_ARGS[*]:-}"
  node sync-github.mjs "${SYNC_ARGS[@]}"
  ok "sync completed"
fi

# ---------- summary ----------
END_TS=$(date +%s)
DURATION=$((END_TS - START_TS))
hdr "summary"
ok "bootstrap finished in ${DURATION}s"
[[ "$DRY_RUN" == "1" ]] && warn "dry-run mode - no commit was pushed"
echo
echo "next:"
[[ "$DRY_RUN" == "1" ]] && echo "  - re-run without --dry-run to push to GitHub main"
[[ "$RUN_SYNC" != "1" ]] && echo "  - re-run without --no-sync to push to GitHub main"
echo "  - run: bash expo/bootstrap.sh --skip-install --skip-validate    (fast resync)"
echo
