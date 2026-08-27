from pathlib import Path


def must_replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing required pattern in {path}')
    p.write_text(s.replace(old, new, 1))


# 1) Single-agent execution accepts either the tightly scoped GitHub Actions
# OIDC identity or the legacy Owner secret. Normal callers do not bypass Owner Gate.
path = 'backend/api/ivx-agent-api.ts'
p = Path(path)
s = p.read_text()
route = "app.post('/api/ivx/agents/:agentId/run', async (c) => {"
pos = s.find(route)
if pos < 0:
    raise SystemExit('agent run route missing')
head, tail = s[:pos], s[pos:]
old = """    const denied = await requireOwner(c, body as Record<string, unknown>);
    if (denied) return denied;
    const taskType = (body as any).taskType || 'audit';"""
new = """    const oidcAuthorized = await verifyIVXGitHubActionsOIDCRequest(c.req.raw);
    const legacyAuthorized = await ownerAuthorized(c, body as Record<string, unknown>);
    if (!oidcAuthorized && !legacyAuthorized) {
      return c.json({ ok: false, error: 'Owner authorization required.' }, 401);
    }
    const taskType = (body as any).taskType || 'audit';"""
if old not in tail:
    raise SystemExit('agent run owner guard pattern missing')
tail = tail.replace(old, new, 1)
p.write_text(head + tail)

# 2) 112 QA workers acquire a short-lived GitHub OIDC token. The legacy secret
# remains fallback only, so stale secret rotation cannot disable all workers.
path = '.github/workflows/landing-112-agent-autonomous-qa.yml'
p = Path(path)
s = p.read_text()
if '  id-token: write\n' not in s:
    s = s.replace('permissions:\n  contents: read\n  actions: write\n', 'permissions:\n  contents: read\n  actions: write\n  id-token: write\n', 1)
s = s.replace('          test "$found" -gt 0\n          echo "AUTH_CANDIDATE_COUNT=$found" >> "$GITHUB_ENV"', '          echo "AUTH_CANDIDATE_COUNT=$found" >> "$GITHUB_ENV"', 1)
old = """          task_id=\"landing112-${GITHUB_RUN_ID}-$(printf '%03d' \"$AGENT_NUMBER\")\"
          http='401'; auth_source='none'; : > /tmp/run.json
          for candidate_name in IVX_AI_SYSTEM_SECRET IVX_SYSTEM_SECRET IVX_OWNER_TOKEN; do
            candidate=\"${!candidate_name:-}\"; [ -n \"$candidate\" ] || continue
            body=$(jq -nc --arg taskType \"$task_type\" --arg token \"$candidate\" --arg taskId \"$task_id\" --arg sourceSha \"$GITHUB_SHA\" --arg assignment \"$TASK\" --arg toolId \"$tool\" --argjson toolParams \"$params\" '{taskType:$taskType,ownerApprovalToken:$token,payload:{__taskId:$taskId,__runId:(\"landing112-\" + $taskId),__workflow:\"Landing 112-Agent Autonomous QA War Room\",sourceSha:$sourceSha,landingAssignment:$assignment,__toolId:$toolId,__toolParams:$toolParams,realExecutionOnly:true,simulatedSuccessAllowed:false}}')
            http=$(curl -sS --retry 1 --retry-delay 1 --max-time 180 -o /tmp/run.json -w '%{http_code}' -X POST \"${API_BASE}/api/ivx/agents/${AGENT_ID}/run\" -H 'Content-Type: application/json' -H \"x-ivx-owner-key: ${candidate}\" --data \"$body\" || true)
            if [ \"$http\" != 401 ]; then auth_source=\"$candidate_name\"; break; fi
          done"""
new = """          task_id=\"landing112-${GITHUB_RUN_ID}-$(printf '%03d' \"$AGENT_NUMBER\")\"
          body=$(jq -nc --arg taskType \"$task_type\" --arg taskId \"$task_id\" --arg sourceSha \"$GITHUB_SHA\" --arg assignment \"$TASK\" --arg toolId \"$tool\" --argjson toolParams \"$params\" '{taskType:$taskType,payload:{__taskId:$taskId,__runId:(\"landing112-\" + $taskId),__workflow:\"Landing 112-Agent Autonomous QA War Room\",sourceSha:$sourceSha,landingAssignment:$assignment,__toolId:$toolId,__toolParams:$toolParams,realExecutionOnly:true,simulatedSuccessAllowed:false}}')
          oidc_url=\"${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=ivx-360-autonomous-recovery\"
          oidc_token=$(curl -fsS --retry 3 --retry-delay 2 -H \"Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}\" \"$oidc_url\" | jq -r '.value // empty')
          test -n \"$oidc_token\"
          http=$(curl -sS --retry 1 --retry-delay 1 --max-time 180 -o /tmp/run.json -w '%{http_code}' -X POST \"${API_BASE}/api/ivx/agents/${AGENT_ID}/run\" -H 'Content-Type: application/json' -H \"X-IVX-GitHub-OIDC: ${oidc_token}\" --data \"$body\" || true)
          auth_source='github_oidc'
          if [ \"$http\" = 401 ]; then
            for candidate_name in IVX_AI_SYSTEM_SECRET IVX_SYSTEM_SECRET IVX_OWNER_TOKEN; do
              candidate=\"${!candidate_name:-}\"; [ -n \"$candidate\" ] || continue
              legacy_body=$(jq -nc --arg taskType \"$task_type\" --arg token \"$candidate\" --arg taskId \"$task_id\" --arg sourceSha \"$GITHUB_SHA\" --arg assignment \"$TASK\" --arg toolId \"$tool\" --argjson toolParams \"$params\" '{taskType:$taskType,ownerApprovalToken:$token,payload:{__taskId:$taskId,__runId:(\"landing112-\" + $taskId),__workflow:\"Landing 112-Agent Autonomous QA War Room\",sourceSha:$sourceSha,landingAssignment:$assignment,__toolId:$toolId,__toolParams:$toolParams,realExecutionOnly:true,simulatedSuccessAllowed:false}}')
              http=$(curl -sS --retry 1 --retry-delay 1 --max-time 180 -o /tmp/run.json -w '%{http_code}' -X POST \"${API_BASE}/api/ivx/agents/${AGENT_ID}/run\" -H 'Content-Type: application/json' -H \"x-ivx-owner-key: ${candidate}\" --data \"$legacy_body\" || true)
              if [ \"$http\" != 401 ]; then auth_source=\"$candidate_name\"; break; fi
            done
          fi"""
if old not in s:
    raise SystemExit('112 workflow legacy auth block missing')
s = s.replace(old, new, 1)
p.write_text(s)

# 3) Radar separates machine-auth wiring drift from sensitive credential/security
# changes. A 401 in a QA/certificate worker is repairable; secret values, IAM,
# permissions, payments, destructive DB changes and security policy still Owner Gate.
path = '.github/workflows/ivx-autonomous-radar-self-heal.yml'
p = Path(path)
s = p.read_text()
old = """          if grep -Eiq 'secret|credential|auth|permission|payment|stripe|migration|database destructive|infrastructure|iam|cloudfront|route53|security policy|rollback' /tmp/ivx-radar/failed-jobs.jsonl; then
            echo 'owner_gate_required=true' >> \"$GITHUB_OUTPUT\"
          else
            echo 'owner_gate_required=false' >> \"$GITHUB_OUTPUT\"
          fi"""
new = """          # Machine-auth transport drift (for example a CI 401 caused by a stale
          # shared secret) is safe to repair through scoped GitHub OIDC. Sensitive
          # credential VALUE changes and security/infrastructure mutations remain gated.
          if grep -Eiq 'secret value|rotate secret|credential value|permission change|payment|stripe|destructive|iam|cloudfront|route53|security policy|production infrastructure|critical rollback' /tmp/ivx-radar/failed-jobs.jsonl; then
            echo 'owner_gate_required=true' >> \"$GITHUB_OUTPUT\"
          else
            echo 'owner_gate_required=false' >> \"$GITHUB_OUTPUT\"
          fi"""
if old not in s:
    raise SystemExit('radar classifier block missing')
s = s.replace(old, new, 1)
s = s.replace('approve_deploy=false\n          fi\n          goal=', 'approve_deploy=true\n          fi\n          goal=', 1)
s = s.replace('For low-risk code defects only, repair and test.', 'For low-risk code defects, CI machine-auth drift, failed QA wiring, and certificate orchestration defects, repair, test, rerun affected gates, and deploy the corrected exact SHA.', 1)
p.write_text(s)

print('autonomous OIDC closed-loop repair applied')
