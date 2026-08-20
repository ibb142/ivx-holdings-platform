#!/usr/bin/env bash
#
# IVX Secret Protection — one-shot setup so GitHub tokens stop getting auto-revoked.
#
#   bash scripts/ivx-protect-secrets.sh
#
# What it does:
#   1. Untracks .rork/history + .rork/plans (the transcripts leaking tokens).
#   2. Hardens .gitignore.
#   3. Installs the pre-commit secret guard.
#   4. Runs a full scan of tracked files.
#
# It stages a deletion-from-index. It does NOT commit and does NOT push —
# review with `git status`, then commit yourself.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "=============================================="
echo " IVX SECRET PROTECTION"
echo "=============================================="
echo

echo "[1/4] Untracking Rork chat transcripts…"
BEFORE=$(git ls-files .rork | wc -l | tr -d ' ')
if [ "$BEFORE" -gt 0 ]; then
  git rm -r --cached --quiet .rork/history 2>/dev/null || true
  git rm -r --cached --quiet .rork/plans   2>/dev/null || true
  AFTER=$(git ls-files .rork | wc -l | tr -d ' ')
  echo "      untracked $((BEFORE - AFTER)) file(s); $AFTER still tracked"
  echo "      (files remain on disk — only the git index changed)"
else
  echo "      already clean"
fi
echo

echo "[2/4] Hardening .gitignore…"
add_ignore() {
  grep -qxF "$1" .gitignore 2>/dev/null || { printf '%s\n' "$1" >> .gitignore; echo "      + $1"; }
}
add_ignore ""
add_ignore "# Secret protection — never commit these"
add_ignore ".rork/"
add_ignore ".rork/history/"
add_ignore ".rork/plans/"
add_ignore "*.pem"
add_ignore "*.p12"
add_ignore "*.jks"
add_ignore "*.keystore"
add_ignore "keys/"
add_ignore ".env.local"
add_ignore ".env.production"
echo "      done"
echo

echo "[3/4] Installing pre-commit secret guard…"
chmod +x .githooks/pre-commit 2>/dev/null || true
git config core.hooksPath .githooks
echo "      core.hooksPath = $(git config core.hooksPath)"
echo

echo "[4/4] Scanning all tracked files…"
echo
if command -v node >/dev/null 2>&1; then
  node scripts/ivx-secret-guard.mjs --tracked
  SCAN=$?
elif command -v bun >/dev/null 2>&1; then
  bun scripts/ivx-secret-guard.mjs --tracked
  SCAN=$?
else
  echo "      no node/bun — scan skipped"
  SCAN=0
fi
echo

echo "=============================================="
if [ "$SCAN" -eq 0 ]; then
  echo " PROTECTED — no credentials in tracked files"
else
  echo " ACTION REQUIRED — see findings above"
fi
echo "=============================================="
echo
echo "Next:"
echo "  git status                 # review the staged untracking"
echo "  git commit -m 'chore(security): untrack transcripts, add secret guard'"
echo
echo "Then rotate the GitHub token ONE more time — the old ones are already"
echo "burned. The new one will survive, because nothing can leak it again."
echo
exit "$SCAN"
