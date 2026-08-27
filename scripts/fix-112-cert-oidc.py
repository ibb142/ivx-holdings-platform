from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"required pattern missing in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# 1) Allow only the two exact, protected-main GitHub Actions workflows that
# need IVX machine identity. Repository/ref/audience/signature checks remain
# mandatory in the verifier.
replace(
    'backend/services/ivx-github-actions-oidc.ts',
    "const WORKFLOW_SUFFIX = '/.github/workflows/ivx-360-early-warning.yml@refs/heads/main';",
    "const WORKFLOW_SUFFIXES = [\n  '/.github/workflows/ivx-360-early-warning.yml@refs/heads/main',\n  '/.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml@refs/heads/main',\n] as const;",
)
replace(
    'backend/services/ivx-github-actions-oidc.ts',
    "if (typeof claims.workflow_ref !== 'string' || !claims.workflow_ref.endsWith(WORKFLOW_SUFFIX)) return { ok: false, reason: 'workflow_ref_mismatch', claimShape: shape };",
    "if (typeof claims.workflow_ref !== 'string' || !WORKFLOW_SUFFIXES.some((suffix) => claims.workflow_ref!.endsWith(suffix))) return { ok: false, reason: 'workflow_ref_mismatch', claimShape: shape };",
)
replace(
    'backend/services/ivx-github-actions-oidc.ts',
    "  workflow: '.github/workflows/ivx-360-early-warning.yml',",
    "  workflows: [\n    '.github/workflows/ivx-360-early-warning.yml',\n    '.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml',\n  ],",
)

# 2) Regression test: exact-SHA certificate workflow is accepted while the
# existing unrelated-workflow rejection remains in place.
replace(
    'backend/services/ivx-github-actions-oidc.test.ts',
    "  test('accepts GitHub immutable owner/repository subject identity', () => {",
    "  test('accepts exact-SHA 112 certificate workflow identity', () => {\n    expect(validateIVXGitHubOIDCClaims({\n      ...valid,\n      workflow_ref: 'ibb142/ivx-holdings-platform/.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml@refs/heads/main',\n    }, now)).toBe(true);\n  });\n\n  test('accepts GitHub immutable owner/repository subject identity', () => {",
)

# 3) Scope OIDC to the certificate-run route only. All other local owner agent
# mutations retain their existing owner secret guard.
replace(
    'backend/api/ivx-agent-api.ts',
    "import { resolveActiveIVXSystemSecret } from '../services/ivx-system-secret';",
    "import { resolveActiveIVXSystemSecret } from '../services/ivx-system-secret';\nimport { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';",
)
replace(
    'backend/api/ivx-agent-api.ts',
    """    const provided = (typeof body.ownerApprovalToken === 'string' ? body.ownerApprovalToken : '') || c.req.header('x-ivx-owner-key') || '';
    const envSecret = await resolveActiveIVXSystemSecret();
    const authorized = Boolean(envSecret) && provided === envSecret;
    if (!authorized) {
      return c.json({ ok: false, error: 'Owner approval required to start the IVX 112 Real Execution Certificate run.' }, 401);
    }
""",
    """    const oidcAuthorized = await verifyIVXGitHubActionsOIDCRequest(c.req.raw);
    const legacyAuthorized = await ownerAuthorized(c, body as Record<string, unknown>);
    if (!oidcAuthorized && !legacyAuthorized) {
      return c.json({ ok: false, error: 'Owner approval required to start the IVX 112 Real Execution Certificate run.' }, 401);
    }
""",
)

# 4) Exact-SHA workflow receives a fresh short-lived signed OIDC token directly
# before starting the real execution run. No shared owner/system secret is
# required for this certificate trigger.
p = Path('.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml')
s = p.read_text()
s = s.replace(
    "permissions:\n  contents: read\n",
    "permissions:\n  contents: read\n  id-token: write\n",
    1,
)
s = s.replace("      SYSTEM_KEY: ${{ secrets.IVX_AI_SYSTEM_SECRET }}\n", "", 1)
needle = "      - name: Start real 112/112 execution certificate — HARD GATE\n"
if needle not in s:
    raise SystemExit('start certificate step missing')
oidc_step = """      - name: Acquire signed GitHub OIDC certificate identity
        shell: bash
        run: |
          set -euo pipefail
          test -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}"
          test -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}"
          response=$(curl -fsS --retry 2 --retry-delay 1 \\
            -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \\
            "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=ivx-360-autonomous-recovery")
          token=$(printf '%s' "$response" | jq -r '.value // empty')
          test -n "$token"
          echo "::add-mask::$token"
          echo "IVX_CERT_OIDC_TOKEN=$token" >> "$GITHUB_ENV"

"""
s = s.replace(needle, oidc_step + needle, 1)
s = s.replace(
    """          test -n "${SYSTEM_KEY:-}"
          HTTP=$(curl -sS -m 30 -o /tmp/start.json -w '%{http_code}' \\
            -X POST "${API_BASE}/api/ivx/agents/certificate/run" \\
            -H 'Content-Type: application/json' \\
            -H "x-ivx-owner-key: ${SYSTEM_KEY}" \\
            --data '{}')
""",
    """          test -n "${IVX_CERT_OIDC_TOKEN:-}"
          HTTP=$(curl -sS -m 30 -o /tmp/start.json -w '%{http_code}' \\
            -X POST "${API_BASE}/api/ivx/agents/certificate/run" \\
            -H 'Content-Type: application/json' \\
            -H "X-IVX-GitHub-OIDC: ${IVX_CERT_OIDC_TOKEN}" \\
            --data '{}')
""",
    1,
)
p.write_text(s)

print('IVX 112 certificate OIDC repair applied')
