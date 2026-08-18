/**
 * IVX 112 Real Execution Certificate — the ONLY workflow that certifies real
 * agent work.
 *
 * The legacy "Landing 112-Agent Autonomous QA War Room" workflow is advisory/QA
 * ONLY and is never used as proof of real work. This workflow replaces it for
 * certification:
 *
 *   - Executes ALL 112 agents with real permitted tools
 *   - Requires realToolUsed=true, sourceReference, and evidence for EVERY agent
 *   - Produces 112 individual evidence artifacts (durable Supabase rows)
 *   - Verifies persistence, dedup, retry/timeout/cost policies, tool
 *     permissions, prohibited-tool blocking, and memory/company isolation
 *   - Runs 4 end-to-end tests (buyer acquisition, investor research,
 *     tokenized research, CRM persistence)
 *   - Final certificate PASSES only at 112/112 — one failed agent fails it all
 *   - simulatedRuns must be 0 for certified runs
 *
 * State lives in Supabase (not RAM): pending tasks survive restart/redeploy and
 * resume automatically at boot via resumePendingCertificateRuns().
 */
import { ALL_AGENT_CONTRACTS } from './ivx-agent-contracts';
import {
  executeAgentRun,
  writeMemory,
  readMemory,
  buildAgentStateRows,
  enforceRegistryIntegrity,
  IVX_AGENT_RUNTIME_VERSION,
} from './ivx-agent-runtime';
import {
  ensureRealExecutionTables,
  insertExecutions,
  updateExecution,
  fetchExecutionsByRun,
  fetchPendingExecutions,
  fetchAgentStates,
  insertCertificate,
  fetchLatestCertificate,
  insertProspects,
  fetchProspects,
  fetchRecentAlerts,
  insertAlert,
  countProspects,
  computeEvidenceSha,
  persistenceConfigured,
  HEARTBEAT_STALE_MS,
  type ExecutionRow,
  type CertificateRow,
  type ProspectRow,
} from './ivx-agent-persistence';
import { executeRealTool, makeDedupKey } from './ivx-agent-real-tools';

export const REAL_EXECUTION_WORKFLOW_ID = 'ivx-112-real-execution-certificate';
export const REAL_EXECUTION_WORKFLOW_NAME = 'IVX 112 Real Execution Certificate';
export const TOTAL_AGENTS_REQUIRED = 112;

export const WAR_ROOM_POLICY = {
  workflow: 'Landing 112-Agent Autonomous QA War Room',
  role: 'advisory_qa_only',
  usedAsProofOfRealWork: false,
  replacedForCertificationBy: REAL_EXECUTION_WORKFLOW_NAME,
} as const;

function commitSha(): string | null {
  return (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || process.env.SOURCE_VERSION || '').trim() || null;
}

// ── Run progress (in-memory mirror; durable state is in Supabase) ────────────

export type CertRunProgress = {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  processed: number;
  total: number;
  failed: number;
  currentAgent: string | null;
  phase: 'agents' | 'policies' | 'e2e' | 'certificate' | 'done';
  note: string;
};

let activeRun: CertRunProgress | null = null;

export function getActiveRunProgress(): CertRunProgress | null {
  return activeRun;
}

// ── Start / resume ───────────────────────────────────────────────────────────

export async function startRealExecutionCertificateRun(): Promise<{ ok: boolean; runId: string | null; error: string | null }> {
  if (activeRun && activeRun.status === 'running') {
    return { ok: true, runId: activeRun.runId, error: null };
  }

  const ensure = await ensureRealExecutionTables();
  if (!ensure.ok) {
    return { ok: false, runId: null, error: `Persistence unavailable — certificate cannot run (state must live in Supabase, not RAM): ${ensure.detail}` };
  }

  const registry = enforceRegistryIntegrity();
  if (!registry.ok) {
    return { ok: false, runId: null, error: `Registry integrity FAILED: ${registry.issues.join('; ')}` };
  }

  const runId = `rec-${Date.now()}`;
  const rows = ALL_AGENT_CONTRACTS.map((c) => ({
    task_id: `${runId}-a${String(c.agentNumber).padStart(3, '0')}`,
    run_id: runId,
    agent_id: c.agentId,
    agent_number: c.agentNumber,
    workflow: REAL_EXECUTION_WORKFLOW_ID,
    task_type: 'real_execution_certification',
    final_status: 'pending' as const,
    dedup_key: `${runId}-a${String(c.agentNumber).padStart(3, '0')}`,
  }));
  const inserted = await insertExecutions(rows);
  if (!inserted.ok) {
    return { ok: false, runId: null, error: `Failed to enqueue 112 durable tasks: ${inserted.error}` };
  }

  activeRun = {
    runId,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    processed: 0,
    total: TOTAL_AGENTS_REQUIRED,
    failed: 0,
    currentAgent: null,
    phase: 'agents',
    note: 'executing 112 agents with real tools',
  };

  void processCertificateRun(runId).catch((err) => {
    if (activeRun?.runId === runId) {
      activeRun.status = 'failed';
      activeRun.note = err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
    }
  });

  return { ok: true, runId, error: null };
}

/**
 * Resume pending certificate tasks after a restart/redeploy. Pending tasks
 * survive restarts because they live in Supabase.
 */
export async function resumePendingCertificateRuns(): Promise<{ resumed: number; runIds: string[] }> {
  if (!persistenceConfigured()) return { resumed: 0, runIds: [] };
  const ensure = await ensureRealExecutionTables();
  if (!ensure.ok) return { resumed: 0, runIds: [] };
  const pending = await fetchPendingExecutions(300);
  const rows = (pending.data ?? []).filter((r) => r.workflow === REAL_EXECUTION_WORKFLOW_ID);
  const runIds = [...new Set(rows.map((r) => r.run_id))];
  for (const runId of runIds) {
    console.log('[IVXRealExecutionCert] resuming pending run after restart', { runId, pendingTasks: rows.filter((r) => r.run_id === runId).length });
    activeRun = {
      runId,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      processed: 0,
      total: TOTAL_AGENTS_REQUIRED,
      failed: 0,
      currentAgent: null,
      phase: 'agents',
      note: 'resumed after restart — pending tasks survived redeploy',
    };
    void processCertificateRun(runId).catch(() => undefined);
  }
  return { resumed: rows.length, runIds };
}

// ── Core processing ──────────────────────────────────────────────────────────

async function processCertificateRun(runId: string): Promise<void> {
  const CONCURRENCY = 3;

  // Process every pending/running task for this run (running = interrupted by restart)
  for (;;) {
    const res = await fetchExecutionsByRun(runId);
    if (!res.ok) throw new Error(`cannot read durable run state: ${res.error}`);
    const remaining = (res.data ?? []).filter((r) => r.final_status === 'pending' || r.final_status === 'running');
    const done = (res.data ?? []).filter((r) => r.final_status !== 'pending' && r.final_status !== 'running');
    if (activeRun?.runId === runId) {
      activeRun.processed = done.length;
      activeRun.failed = done.filter((r) => r.final_status !== 'completed').length;
    }
    if (remaining.length === 0) break;

    const batch = remaining.slice(0, CONCURRENCY);
    await Promise.all(batch.map(async (row, i) => {
      await new Promise((r) => setTimeout(r, i * 350)); // stagger for external API politeness
      if (activeRun?.runId === runId) activeRun.currentAgent = row.agent_id;
      await executeAgentRun(row.agent_id, 'audit', {
        __taskId: row.task_id,
        __runId: runId,
        __workflow: REAL_EXECUTION_WORKFLOW_ID,
        certificateRun: true,
      }, `owner-cert-${runId}`);
    }));
  }

  // Policy verifications + e2e + certificate
  if (activeRun?.runId === runId) { activeRun.phase = 'policies'; activeRun.note = 'verifying runtime policies'; }
  const policyChecks = await runPolicyVerifications(runId);

  if (activeRun?.runId === runId) { activeRun.phase = 'e2e'; activeRun.note = 'running end-to-end tests'; }
  const e2eTests = await runEndToEndTests(runId);

  if (activeRun?.runId === runId) { activeRun.phase = 'certificate'; activeRun.note = 'computing final certificate'; }
  await computeAndPersistCertificate(runId, policyChecks, e2eTests);

  if (activeRun?.runId === runId) {
    activeRun.phase = 'done';
    activeRun.status = 'completed';
    activeRun.finishedAt = new Date().toISOString();
    activeRun.currentAgent = null;
    activeRun.note = 'certificate computed';
  }
}

// ── Policy verifications (real tests — no hardcoded passes) ──────────────────

export type PolicyCheck = { name: string; passed: boolean; detail: string };

export async function runPolicyVerifications(runId: string): Promise<PolicyCheck[]> {
  const checks: PolicyCheck[] = [];
  const probeAgent = ALL_AGENT_CONTRACTS[0];
  const probeAgentB = ALL_AGENT_CONTRACTS[1];

  // 1) Execution state persists in Supabase, not RAM — durable round-trip
  const probeTaskId = `${runId}-policy-persist`;
  const ins = await insertExecutions([{ task_id: probeTaskId, run_id: `${runId}-policy`, agent_id: probeAgent.agentId, agent_number: probeAgent.agentNumber, task_type: 'persistence_probe', final_status: 'completed', dedup_key: probeTaskId }]);
  const back = await fetchExecutionsByRun(`${runId}-policy`);
  const persisted = ins.ok && back.ok && (back.data ?? []).some((r) => r.task_id === probeTaskId);
  checks.push({ name: 'persistence_supabase_not_ram', passed: persisted, detail: persisted ? 'execution row round-tripped through Supabase' : `write=${ins.error ?? 'ok'} read=${back.error ?? 'ok'}` });

  // 2) Retries do not duplicate tasks — same task_id inserted twice stays one row
  await insertExecutions([{ task_id: probeTaskId, run_id: `${runId}-policy`, agent_id: probeAgent.agentId, agent_number: probeAgent.agentNumber, task_type: 'persistence_probe', final_status: 'completed', dedup_key: probeTaskId }]);
  const dupCheck = await fetchExecutionsByRun(`${runId}-policy`);
  const dupCount = (dupCheck.data ?? []).filter((r) => r.task_id === probeTaskId).length;
  checks.push({ name: 'retries_do_not_duplicate_tasks', passed: dupCount === 1, detail: `duplicate insert of same task_id resulted in ${dupCount} row(s)` });

  // 3) Prospect deduplication — same dedup key inserted twice stays one record
  const dedupKey = makeDedupKey('buyer', `policy-dedup-probe-${runId}`);
  const probeProspect: ProspectRow = {
    prospect_type: 'buyer', dedup_key: dedupKey, name: `Policy Dedup Probe ${runId}`,
    source_url: 'https://www.sec.gov/cgi-bin/browse-edgar', source_tool: 'crm_write', jurisdiction: 'US',
    score: 10, score_breakdown: { probe: 10 }, qualified: false, status: 'new',
    compliance_gate: 'blocked_pending_approval', agent_id: probeAgent.agentId, task_id: probeTaskId,
    company_scope: 'ivx_holdings', data: { probe: true },
  };
  await insertProspects([probeProspect]);
  await insertProspects([probeProspect]);
  const prospectCount = await countProspects('buyer', dedupKey);
  checks.push({ name: 'prospect_deduplication', passed: prospectCount === 1, detail: `duplicate prospect insert resulted in ${prospectCount} record(s)` });

  // 4) Per-agent timeout policy — 1ms budget must fail, never fake success
  const timeoutProbe = await executeRealTool(probeAgent.agentId, probeAgent.agentNumber, 'wikipedia_search', { query: 'timeout probe' }, { timeoutMs: 1 });
  checks.push({ name: 'per_agent_timeout_policy', passed: !timeoutProbe.ok, detail: timeoutProbe.ok ? 'UNEXPECTED success under 1ms budget' : `timeout enforced: ${String(timeoutProbe.error).slice(0, 80)}` });

  // 5) Per-agent retry policy — every contract defines bounded retries
  const retryOk = ALL_AGENT_CONTRACTS.every((c) => c.retryPolicy && c.retryPolicy.maxRetries >= 1 && c.retryPolicy.maxRetries <= 10);
  checks.push({ name: 'per_agent_retry_policy', passed: retryOk, detail: retryOk ? 'all 112 contracts define bounded retry policies (honored by runtime with stable task ids)' : 'missing/unbounded retry policy found' });

  // 6) Per-agent cost limits — contracts bounded + runtime blocks on exhausted budget
  const costContractsOk = ALL_AGENT_CONTRACTS.every((c) => c.costLimit && c.costLimit.maxCostPerRun > 0);
  const costBlocked = await executeAgentRun(probeAgentB.agentId, 'audit', { __taskId: `${runId}-policy-cost`, __runId: `${runId}-policy`, __workflow: REAL_EXECUTION_WORKFLOW_ID, __testCostLimitUsd: 0 });
  checks.push({ name: 'per_agent_cost_limits', passed: costContractsOk && !costBlocked.ok, detail: `contracts bounded=${costContractsOk}; zero-budget run blocked=${!costBlocked.ok}` });

  // 7) Per-agent tool permissions — agent #1 has no crm_write permission
  const permProbe = await executeRealTool(probeAgent.agentId, probeAgent.agentNumber, 'crm_write', { prospectRow: probeProspect } as never, {});
  checks.push({ name: 'per_agent_tool_permissions', passed: permProbe.blocked, detail: permProbe.blocked ? 'non-permitted tool blocked + alert persisted' : 'UNEXPECTED: non-permitted tool executed' });

  // 8) Prohibited tools blocked — money movement / trade execution / legal execution
  const prohibited = await executeRealTool(probeAgent.agentId, probeAgent.agentNumber, 'money_movement', {}, {});
  const prohibited2 = await executeRealTool(probeAgent.agentId, probeAgent.agentNumber, 'trade_execution', {}, {});
  const prohibited3 = await executeRealTool(probeAgent.agentId, probeAgent.agentNumber, 'legal_execution', {}, {});
  const allBlocked = prohibited.blocked && prohibited2.blocked && prohibited3.blocked;
  checks.push({ name: 'prohibited_tools_blocked', passed: allBlocked, detail: allBlocked ? 'money_movement, trade_execution, legal_execution all blocked with alerts' : 'PROHIBITED TOOL EXECUTED — critical failure' });

  // 9) Production deploy stays behind approval
  const deployProbe = await executeRealTool(probeAgent.agentId, probeAgent.agentNumber, 'production_deploy', {}, {});
  checks.push({ name: 'production_deploy_approval_gated', passed: deployProbe.blocked, detail: deployProbe.blocked ? 'deploy blocked without owner approval' : 'UNEXPECTED: deploy executed without approval' });

  // 10) Cross-agent memory isolation
  writeMemory(`${probeAgent.agentId}_memory`, 'agent', 'isolation_probe', 'secret-a', 'policy-test', probeAgent.agentId);
  const crossRead = readMemory(`${probeAgent.agentId}_memory`, 'isolation_probe', probeAgentB.agentId);
  checks.push({ name: 'cross_agent_memory_isolation', passed: !crossRead.ok, detail: !crossRead.ok ? `agent B denied reading agent A memory: ${String(crossRead.error).slice(0, 80)}` : 'UNEXPECTED: cross-agent memory read succeeded' });

  // 11) Cross-company/division data isolation
  const crossCompany = readMemory('company_saas_builder_shared', 'any_key', probeAgent.agentId);
  checks.push({ name: 'cross_company_isolation', passed: !crossCompany.ok, detail: !crossCompany.ok ? `cross-company memory read denied: ${String(crossCompany.error).slice(0, 80)}` : 'UNEXPECTED: cross-company read succeeded' });

  // 12) Pending tasks survive restart — durable queue + boot resume wiring.
  // Bounded read retry distinguishes a transient fetch failure from a genuinely
  // missing row: a durable row must be discoverable once a read succeeds. The
  // check still fails hard if the row is truly absent after all attempts — it
  // never passes on error and never fakes discovery.
  const pendingProbeId = `${runId}-policy-pending`;
  await insertExecutions([{ task_id: pendingProbeId, run_id: `${runId}-policy`, agent_id: probeAgent.agentId, agent_number: probeAgent.agentNumber, task_type: 'pending_probe', final_status: 'pending', dedup_key: pendingProbeId }]);
  let pendingFound = false;
  let pendingReadError = '';
  let pendingAttempts = 0;
  for (let attempt = 1; attempt <= 3 && !pendingFound; attempt++) {
    pendingAttempts = attempt;
    const pendingBack = await fetchPendingExecutions(300);
    pendingReadError = pendingBack.ok ? '' : String(pendingBack.error ?? `status ${pendingBack.status}`).slice(0, 120);
    pendingFound = (pendingBack.data ?? []).some((r) => r.task_id === pendingProbeId);
    if (!pendingFound && attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, 400 * attempt));
  }
  await updateExecution(pendingProbeId, { final_status: 'completed', finished_at: new Date().toISOString() });
  checks.push({
    name: 'pending_tasks_survive_restart',
    passed: pendingFound,
    detail: pendingFound
      ? `pending task durable in Supabase and discoverable by boot resume scanner (read attempt ${pendingAttempts}/3)`
      : `pending task not found in durable queue after ${pendingAttempts} read attempts${pendingReadError ? `; last read error: ${pendingReadError}` : ''}`,
  });

  return checks;
}

// ── End-to-end tests (items: buyer acquisition, investor research, tokenized research, CRM persistence) ──

export type E2ETest = { name: string; passed: boolean; detail: string };

export async function runEndToEndTests(runId: string): Promise<E2ETest[]> {
  const tests: E2ETest[] = [];
  const e2eRunId = `${runId}-e2e`;
  const byNumber = (n: number) => ALL_AGENT_CONTRACTS.find((c) => c.agentNumber === n);

  // E2E 1: buyer acquisition — IA-19 real source → CRM
  const ia19 = byNumber(19);
  if (ia19) {
    const res = await executeAgentRun(ia19.agentId, 'audit', { __taskId: `${e2eRunId}-a019`, __runId: e2eRunId, __workflow: REAL_EXECUTION_WORKFLOW_ID });
    const buyers = await fetchProspects('buyer', 20);
    const realBuyer = (buyers.data ?? []).find((b) => b.source_url.includes('sec.gov') && typeof b.score === 'number');
    const passed = res.ok && Boolean(res.runRecord?.realToolUsed) && Boolean(realBuyer);
    tests.push({ name: 'buyer_acquisition_e2e', passed, detail: passed ? `buyer "${realBuyer?.name}" in CRM with SEC source + score ${realBuyer?.score}` : `run ok=${res.ok} realTool=${res.runRecord?.realToolUsed ?? false} buyerWithSource=${Boolean(realBuyer)}` });
  } else {
    tests.push({ name: 'buyer_acquisition_e2e', passed: false, detail: 'IA-19 missing from registry' });
  }

  // E2E 2: investor research — IA-17 real source → CRM with compliance gate
  const ia17 = byNumber(17);
  if (ia17) {
    const res = await executeAgentRun(ia17.agentId, 'audit', { __taskId: `${e2eRunId}-a017`, __runId: e2eRunId, __workflow: REAL_EXECUTION_WORKFLOW_ID });
    const investors = await fetchProspects('investor', 20);
    const realInvestor = (investors.data ?? []).find((b) => b.source_url.includes('sec.gov') && b.compliance_gate === 'blocked_pending_approval');
    const passed = res.ok && Boolean(res.runRecord?.realToolUsed) && Boolean(realInvestor);
    tests.push({ name: 'investor_research_e2e', passed, detail: passed ? `investor "${realInvestor?.name}" with verifiable SEC source, outreach gated` : `run ok=${res.ok} investorWithGate=${Boolean(realInvestor)}` });
  } else {
    tests.push({ name: 'investor_research_e2e', passed: false, detail: 'IA-17 missing from registry' });
  }

  // E2E 3: tokenized research — IA-31 jurisdiction + source + independent legal review
  const ia31 = byNumber(31);
  if (ia31) {
    const res = await executeAgentRun(ia31.agentId, 'audit', { __taskId: `${e2eRunId}-a031`, __runId: e2eRunId, __workflow: REAL_EXECUTION_WORKFLOW_ID });
    const tokenized = await fetchProspects('tokenized_asset', 20);
    const realTokenized = (tokenized.data ?? []).find((b) => Boolean(b.jurisdiction) && b.source_url.includes('sec.gov') && ((b.data ?? {}) as Record<string, unknown>).legalReviewStatus === 'requires_independent_review');
    const passed = res.ok && Boolean(realTokenized);
    tests.push({ name: 'tokenized_research_e2e', passed, detail: passed ? `tokenized opportunity "${realTokenized?.name}" jurisdiction=${realTokenized?.jurisdiction}, legal review independent` : `run ok=${res.ok} tokenizedWithJurisdiction=${Boolean(realTokenized)}` });
  } else {
    tests.push({ name: 'tokenized_research_e2e', passed: false, detail: 'IA-31 missing from registry' });
  }

  // E2E 4: CRM persistence — write → durable read-back → dedup verified
  const crmKey = makeDedupKey('partner', `e2e-crm-persistence-${runId}`);
  const crmRow: ProspectRow = {
    prospect_type: 'partner', dedup_key: crmKey, name: `E2E CRM Persistence Probe ${runId}`,
    source_url: 'https://en.wikipedia.org/wiki/Customer_relationship_management', source_tool: 'crm_write',
    jurisdiction: null, score: 20, score_breakdown: { probe: 20 }, qualified: false, status: 'new',
    compliance_gate: 'blocked_pending_approval', agent_id: 'ivx_holdings_21', task_id: `${e2eRunId}-crm`,
    company_scope: 'ivx_holdings', data: { e2e: true },
  };
  await insertProspects([crmRow]);
  const readBack = await countProspects('partner', crmKey);
  tests.push({ name: 'crm_persistence_e2e', passed: readBack === 1, detail: `CRM write + durable read-back returned ${readBack} record(s)` });

  return tests;
}

// ── Certificate computation ──────────────────────────────────────────────────

async function computeAndPersistCertificate(runId: string, policyChecks: PolicyCheck[], e2eTests: E2ETest[]): Promise<CertificateRow | null> {
  const execRes = await fetchExecutionsByRun(runId);
  const rows = (execRes.data ?? []).filter((r) => r.task_id.startsWith(`${runId}-a`));

  const total = rows.length;
  const completed = rows.filter((r) => r.final_status === 'completed');
  const realExecutionVerified = rows.filter((r) => r.final_status === 'completed' && r.real_tool_used && Boolean(r.source_reference) && r.verified_output).length;
  const evidenceVerified = rows.filter((r) => r.evidence !== null && Boolean(r.evidence_sha256)).length;
  const simulatedRuns = rows.filter((r) => r.simulated).length;
  const uniqueAgentIds = new Set(rows.map((r) => r.agent_id)).size;
  const uniqueAgentNumbers = new Set(rows.map((r) => r.agent_number)).size;

  const statesRes = await fetchAgentStates();
  const states = statesRes.data ?? [];
  const now = Date.now();
  const healthy = states.filter((s) =>
    s.status === 'active'
    && s.health === 'healthy'
    && s.availability !== 'paused' && s.availability !== 'disabled' && s.availability !== 'offline'
    && s.last_heartbeat !== null && (now - new Date(s.last_heartbeat).getTime()) < HEARTBEAT_STALE_MS,
  ).length;

  const registry = enforceRegistryIntegrity();
  const persistenceVerified = execRes.ok && statesRes.ok && policyChecks.find((c) => c.name === 'persistence_supabase_not_ram')?.passed === true;
  const policiesPassed = policyChecks.every((c) => c.passed);
  const e2ePassed = e2eTests.every((t) => t.passed);

  // FINAL GATE: one failed agent fails the entire certificate
  const passed =
    total === TOTAL_AGENTS_REQUIRED
    && completed.length === TOTAL_AGENTS_REQUIRED
    && realExecutionVerified === TOTAL_AGENTS_REQUIRED
    && evidenceVerified === TOTAL_AGENTS_REQUIRED
    && simulatedRuns === 0
    && uniqueAgentIds === TOTAL_AGENTS_REQUIRED
    && uniqueAgentNumbers === TOTAL_AGENTS_REQUIRED
    && healthy === TOTAL_AGENTS_REQUIRED
    && registry.ok
    && persistenceVerified
    && policiesPassed
    && e2ePassed;

  const failedAgents = rows
    .filter((r) => !(r.final_status === 'completed' && r.real_tool_used && Boolean(r.source_reference) && r.verified_output))
    .map((r) => ({ agentId: r.agent_id, agentNumber: r.agent_number, status: r.final_status, error: r.error }));

  const summary = {
    workflow: REAL_EXECUTION_WORKFLOW_NAME,
    completedAgents: completed.length,
    failedAgents,
    registry,
    warRoom: WAR_ROOM_POLICY,
    prohibitions: { moneyMovement: 'prohibited', tradeExecution: 'prohibited', legalExecution: 'prohibited', productionDeploy: 'owner_approval_required', externalOutreach: 'compliance_gated' },
    runtimeEnv: {
      SUPABASE_URL: Boolean((process.env.SUPABASE_URL ?? '').trim() || (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim()),
      SUPABASE_SERVICE_ROLE_KEY: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()),
      RENDER_GIT_COMMIT: Boolean(commitSha()),
    },
  };

  const certificate: CertificateRow = {
    certificate_id: `IVX-112-REAL-EXEC-${computeEvidenceSha({ runId, rows: rows.map((r) => r.evidence_sha256) }).slice(0, 16)}`,
    run_id: runId,
    workflow: REAL_EXECUTION_WORKFLOW_ID,
    total_agents: total,
    healthy,
    real_execution_verified: realExecutionVerified,
    evidence_verified: evidenceVerified,
    persistence_verified: persistenceVerified,
    simulated_runs: simulatedRuns,
    unique_agents: Math.min(uniqueAgentIds, uniqueAgentNumbers),
    passed,
    commit_sha: commitSha(),
    runtime_version: IVX_AGENT_RUNTIME_VERSION,
    policy_checks: { checks: policyChecks },
    e2e_tests: { tests: e2eTests },
    summary,
  };

  const saved = await insertCertificate(certificate);
  if (!saved.ok) {
    console.error('[IVXRealExecutionCert] certificate persist failed', { error: saved.error });
  }
  if (!passed) {
    await insertAlert({ alert_type: 'agent_unhealthy', agent_id: null, severity: 'critical', detail: `Certificate FAILED: real=${realExecutionVerified}/112 evidence=${evidenceVerified}/112 healthy=${healthy}/112 simulated=${simulatedRuns} policies=${policiesPassed} e2e=${e2ePassed}` }).catch(() => undefined);
  }
  return certificate;
}

// ── API shapes ───────────────────────────────────────────────────────────────

export async function getCertificateForApi(): Promise<Record<string, unknown>> {
  const latest = await fetchLatestCertificate();
  const cert = latest.data?.[0] ?? null;
  const registry = enforceRegistryIntegrity();
  const runtimeCommit = commitSha();
  return {
    ok: Boolean(cert),
    marker: REAL_EXECUTION_WORKFLOW_ID,
    workflow: REAL_EXECUTION_WORKFLOW_NAME,
    certified: cert?.passed ?? false,
    certificateId: cert?.certificate_id ?? null,
    runId: cert?.run_id ?? null,
    total: cert?.total_agents ?? 0,
    healthy: cert?.healthy ?? 0,
    realExecutionVerified: cert?.real_execution_verified ?? 0,
    evidenceVerified: cert?.evidence_verified ?? 0,
    persistenceVerified: cert?.persistence_verified ?? false,
    simulatedRuns: cert?.simulated_runs ?? -1,
    uniqueAgents: cert?.unique_agents ?? 0,
    commitSha: cert?.commit_sha ?? null,
    runtimeCommitSha: runtimeCommit,
    commitMatchesRuntime: Boolean(cert?.commit_sha && runtimeCommit && cert.commit_sha === runtimeCommit),
    certifiedAt: cert?.certified_at ?? null,
    runtimeVersion: cert?.runtime_version ?? IVX_AGENT_RUNTIME_VERSION,
    registry,
    policyChecks: cert?.policy_checks ?? null,
    e2eTests: cert?.e2e_tests ?? null,
    summary: cert?.summary ?? null,
    warRoom: WAR_ROOM_POLICY,
    activeRun: getActiveRunProgress(),
  };
}

const alertCooldown = new Map<string, number>();
const ALERT_COOLDOWN_MS = 15 * 60_000;

async function raiseAlertOnce(key: string, alert: Parameters<typeof insertAlert>[0]): Promise<void> {
  const last = alertCooldown.get(key) ?? 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return;
  alertCooldown.set(key, Date.now());
  await insertAlert(alert).catch(() => undefined);
}

/**
 * Live 112/112 dashboard payload: per-agent status, last real tool, last
 * source, last evidence, last heartbeat, duration, errors, retry count, cost —
 * plus persistent alerts for stale heartbeats, stuck agents, and
 * output-without-evidence.
 */
export async function getRealStatusForApi(): Promise<Record<string, unknown>> {
  const ensure = await ensureRealExecutionTables();
  const statesRes = await fetchAgentStates();
  const states = statesRes.data ?? [];
  const now = Date.now();

  const stateByAgent = new Map(states.map((s) => [s.agent_id, s]));
  const agents = ALL_AGENT_CONTRACTS.map((c) => {
    const s = stateByAgent.get(c.agentId) ?? null;
    const heartbeatAgeMs = s?.last_heartbeat ? now - new Date(s.last_heartbeat).getTime() : null;
    const stale = heartbeatAgeMs === null || heartbeatAgeMs > HEARTBEAT_STALE_MS;
    let displayStatus: 'running' | 'blocked' | 'failed' | 'completed' | 'idle' = 'idle';
    if (s?.availability === 'busy') displayStatus = 'running';
    else if (s?.availability === 'paused' || s?.availability === 'disabled') displayStatus = 'blocked';
    else if (s?.last_failed_run && (!s.last_successful_run || s.last_failed_run > s.last_successful_run)) displayStatus = 'failed';
    else if (s?.last_successful_run) displayStatus = 'completed';
    return {
      agentId: c.agentId,
      agentNumber: c.agentNumber,
      name: c.agentName,
      division: c.divisionId,
      status: displayStatus,
      health: s?.health ?? 'unknown',
      lastRealTool: s?.last_tool_used ?? null,
      lastSource: s?.last_source_reference ?? null,
      lastEvidenceSha: s?.last_evidence_sha ?? null,
      lastHeartbeat: s?.last_heartbeat ?? null,
      heartbeatStale: stale,
      lastDurationMs: s?.last_duration_ms ?? 0,
      lastError: s?.last_error ?? null,
      retryCount: s?.retry_count ?? 0,
      costUsd: Number(s?.total_cost_usd ?? 0),
      totalRuns: s?.total_runs ?? 0,
      successfulRuns: s?.successful_runs ?? 0,
      failedRuns: s?.failed_runs ?? 0,
    };
  });

  // Alert sweeps (persisted, with cooldown)
  for (const a of agents) {
    if (a.heartbeatStale && a.lastHeartbeat !== null) {
      await raiseAlertOnce(`stale:${a.agentId}`, { alert_type: 'stale_heartbeat', agent_id: a.agentId, severity: 'warning', detail: `Heartbeat stale for ${a.name} (#${a.agentNumber})` });
    }
    if (a.status === 'running' && a.lastHeartbeat && now - new Date(a.lastHeartbeat).getTime() > 10 * 60_000) {
      await raiseAlertOnce(`stuck:${a.agentId}`, { alert_type: 'stuck_agent', agent_id: a.agentId, severity: 'critical', detail: `${a.name} appears stuck in running state` });
    }
    if (a.successfulRuns > 0 && !a.lastEvidenceSha) {
      await raiseAlertOnce(`noevidence:${a.agentId}`, { alert_type: 'output_without_evidence', agent_id: a.agentId, severity: 'critical', detail: `${a.name} has output without evidence` });
    }
  }

  const alertsRes = await fetchRecentAlerts(40);
  const cert = await fetchLatestCertificate();

  return {
    ok: statesRes.ok,
    marker: REAL_EXECUTION_WORKFLOW_ID,
    persistence: { configured: persistenceConfigured(), tablesReady: ensure.ok, detail: ensure.detail },
    totalAgents: agents.length,
    running: agents.filter((a) => a.status === 'running').length,
    blocked: agents.filter((a) => a.status === 'blocked').length,
    failed: agents.filter((a) => a.status === 'failed').length,
    completed: agents.filter((a) => a.status === 'completed').length,
    staleHeartbeats: agents.filter((a) => a.heartbeatStale).length,
    totalCostUsd: agents.reduce((sum, a) => sum + a.costUsd, 0),
    agents,
    alerts: alertsRes.data ?? [],
    latestCertificate: cert.data?.[0] ?? null,
    activeRun: getActiveRunProgress(),
    warRoom: WAR_ROOM_POLICY,
  };
}

export function buildHeartbeatRows(): ReturnType<typeof buildAgentStateRows> {
  return buildAgentStateRows();
}
