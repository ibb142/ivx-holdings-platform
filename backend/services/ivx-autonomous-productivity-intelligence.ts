import type { ExecutionRow } from './ivx-agent-persistence';

export const IVX_AUTONOMOUS_PRODUCTIVITY_INTELLIGENCE_MARKER = 'ivx-autonomous-productivity-intelligence-2026-09-03';

export type ProductivityCause = 'VERIFIED_NET' | 'FAILED' | 'BLOCKED' | 'DUPLICATE' | 'RETRY_WASTE' | 'UNVERIFIED';

export type AgentProductivity24h = {
  agentId: string;
  agentNumber: number;
  totalHours: number;
  verifiedNetHours: number;
  failedHours: number;
  blockedHours: number;
  duplicateHours: number;
  retryWasteHours: number;
  unverifiedHours: number;
  verifiedOutputs: number;
  utilizationPercent: number;
};

export type NoProgressLoop = {
  signature: string;
  sourceSha: string | null;
  error: string;
  count: number;
  hours: number;
  agentIds: string[];
  circuitBreakerRequired: boolean;
};

export type AutonomousProductivity24h = {
  marker: string;
  windowStart: string;
  windowEnd: string;
  capacityAgentHours: number;
  recordedHours: number;
  verifiedNetHours: number;
  failedHours: number;
  blockedHours: number;
  duplicateHours: number;
  retryWasteHours: number;
  unverifiedHours: number;
  wasteHours: number;
  verifiedOutputs: number;
  verifiedCommits: number;
  utilizationPercent: number;
  netOutputsPerVerifiedHour: number;
  noProgressLoops: NoProgressLoop[];
  circuitBreakerTriggered: boolean;
  perAgent: AgentProductivity24h[];
  landing: {
    recordedHours: number;
    verifiedNetHours: number;
    wasteHours: number;
    verifiedOutputs: number;
    budgetHours: number;
    budgetConsumedPercent: number;
    overBudget: boolean;
  };
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hours(ms: number): number {
  return round2(Math.max(0, ms) / 3_600_000);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function evidenceValue(run: ExecutionRow, key: string): unknown {
  if (run.evidence && key in run.evidence) return run.evidence[key];
  if (run.output && key in run.output) return run.output[key];
  return undefined;
}

function commitSha(run: ExecutionRow): string | null {
  const raw = text(evidenceValue(run, 'commitSha')) || text(evidenceValue(run, 'sourceSha'));
  return raw || null;
}

function isCodeProducingTask(run: ExecutionRow): boolean {
  return /(^|[_\s-])(code|development|implement|implementation|repair|fix|patch|deploy)([_\s-]|$)/i.test(run.task_type);
}

function hasPassingTests(run: ExecutionRow): boolean {
  const testsPassed = evidenceValue(run, 'testsPassed');
  const testsRun = evidenceValue(run, 'testsRun');
  if (testsPassed === true) return true;
  if (testsRun === true && evidenceValue(run, 'testResult') === 'pass') return true;
  return false;
}

export function isVerifiedNetExecution(run: ExecutionRow): boolean {
  if (run.final_status !== 'completed' || run.simulated) return false;
  if (!run.real_tool_used || !run.verified_output) return false;
  if (!text(run.source_reference) || !text(run.tool_result_id)) return false;
  if (isCodeProducingTask(run)) {
    if (!commitSha(run)) return false;
    if (!hasPassingTests(run)) return false;
  }
  return true;
}

function resultFingerprint(run: ExecutionRow): string | null {
  const explicit = text(evidenceValue(run, 'evidenceFingerprint'));
  if (explicit) return explicit;
  if (text(run.evidence_sha256)) return `evidence:${run.evidence_sha256}`;
  const sha = commitSha(run);
  if (sha) return `commit:${sha}:${run.task_type}`;
  if (text(run.source_reference) && text(run.tool_result_id)) {
    return `tool:${run.source_reference}:${run.tool_result_id}:${run.task_type}`;
  }
  return null;
}

function normalizedError(error: string | null): string {
  return text(error).replace(/\s+/g, ' ').replace(/\b\d{4,}\b/g, '#').slice(0, 240).toLowerCase();
}

function failureSignature(run: ExecutionRow): { signature: string; sourceSha: string | null; error: string } | null {
  if (run.final_status !== 'failed' && run.final_status !== 'blocked') return null;
  const error = normalizedError(run.error);
  if (!error) return null;
  const sha = commitSha(run);
  const scope = sha || text(run.dedup_key) || text(run.source_reference) || run.task_type;
  return { signature: `${scope}|${error}`, sourceSha: sha, error };
}

function isLandingRun(run: ExecutionRow): boolean {
  const haystack = JSON.stringify({ taskType: run.task_type, source: run.source_reference, evidence: run.evidence, output: run.output }).toLowerCase();
  return haystack.includes('landing') || haystack.includes('ivxholding-landing');
}

export function buildAutonomousProductivity24h(
  executions: ExecutionRow[],
  opts: { now?: number; fleetSize?: number; landingBudgetHours?: number } = {},
): AutonomousProductivity24h {
  const now = opts.now ?? Date.now();
  const fleetSize = Math.max(1, opts.fleetSize ?? 112);
  const windowStartMs = now - 24 * 60 * 60 * 1000;
  const landingBudgetHours = Math.max(1, opts.landingBudgetHours ?? 120);
  const rows = executions.filter((run) => {
    const started = run.started_at ? Date.parse(run.started_at) : NaN;
    return Number.isFinite(started) && started >= windowStartMs && started <= now;
  });

  const seenResults = new Set<string>();
  const byAgent = new Map<string, AgentProductivity24h>();
  const loopMap = new Map<string, { sourceSha: string | null; error: string; count: number; ms: number; agentIds: Set<string> }>();
  let recordedMs = 0;
  let verifiedMs = 0;
  let failedMs = 0;
  let blockedMs = 0;
  let duplicateMs = 0;
  let retryWasteMs = 0;
  let unverifiedMs = 0;
  let verifiedOutputs = 0;
  const verifiedCommits = new Set<string>();
  let landingRecordedMs = 0;
  let landingVerifiedMs = 0;
  let landingWasteMs = 0;
  let landingVerifiedOutputs = 0;

  for (const run of rows) {
    const durationMs = Math.max(0, Number.isFinite(run.duration_ms) ? run.duration_ms : 0);
    recordedMs += durationMs;
    const landing = isLandingRun(run);
    if (landing) landingRecordedMs += durationMs;

    let cause: ProductivityCause;
    const verified = isVerifiedNetExecution(run);
    const fingerprint = verified ? resultFingerprint(run) : null;
    if (verified && fingerprint && seenResults.has(fingerprint)) {
      cause = 'DUPLICATE';
      duplicateMs += durationMs;
      if (landing) landingWasteMs += durationMs;
    } else if (verified) {
      cause = 'VERIFIED_NET';
      if (fingerprint) seenResults.add(fingerprint);
      verifiedMs += durationMs;
      verifiedOutputs += 1;
      const sha = commitSha(run);
      if (sha) verifiedCommits.add(sha);
      if (landing) {
        landingVerifiedMs += durationMs;
        landingVerifiedOutputs += 1;
      }
    } else if (run.final_status === 'failed') {
      cause = 'FAILED';
      failedMs += durationMs;
      if (landing) landingWasteMs += durationMs;
    } else if (run.final_status === 'blocked') {
      cause = 'BLOCKED';
      blockedMs += durationMs;
      if (landing) landingWasteMs += durationMs;
    } else if (run.retry_count > 0) {
      cause = 'RETRY_WASTE';
      retryWasteMs += durationMs;
      if (landing) landingWasteMs += durationMs;
    } else {
      cause = 'UNVERIFIED';
      unverifiedMs += durationMs;
      if (landing) landingWasteMs += durationMs;
    }

    const agent = byAgent.get(run.agent_id) ?? {
      agentId: run.agent_id,
      agentNumber: run.agent_number,
      totalHours: 0,
      verifiedNetHours: 0,
      failedHours: 0,
      blockedHours: 0,
      duplicateHours: 0,
      retryWasteHours: 0,
      unverifiedHours: 0,
      verifiedOutputs: 0,
      utilizationPercent: 0,
    };
    agent.totalHours += durationMs / 3_600_000;
    if (cause === 'VERIFIED_NET') { agent.verifiedNetHours += durationMs / 3_600_000; agent.verifiedOutputs += 1; }
    else if (cause === 'FAILED') agent.failedHours += durationMs / 3_600_000;
    else if (cause === 'BLOCKED') agent.blockedHours += durationMs / 3_600_000;
    else if (cause === 'DUPLICATE') agent.duplicateHours += durationMs / 3_600_000;
    else if (cause === 'RETRY_WASTE') agent.retryWasteHours += durationMs / 3_600_000;
    else agent.unverifiedHours += durationMs / 3_600_000;
    byAgent.set(run.agent_id, agent);

    const failure = failureSignature(run);
    if (failure) {
      const entry = loopMap.get(failure.signature) ?? { sourceSha: failure.sourceSha, error: failure.error, count: 0, ms: 0, agentIds: new Set<string>() };
      entry.count += 1;
      entry.ms += durationMs;
      entry.agentIds.add(run.agent_id);
      loopMap.set(failure.signature, entry);
    }
  }

  const perAgent = [...byAgent.values()].map((a) => ({
    ...a,
    totalHours: round2(a.totalHours),
    verifiedNetHours: round2(a.verifiedNetHours),
    failedHours: round2(a.failedHours),
    blockedHours: round2(a.blockedHours),
    duplicateHours: round2(a.duplicateHours),
    retryWasteHours: round2(a.retryWasteHours),
    unverifiedHours: round2(a.unverifiedHours),
    utilizationPercent: round2((a.verifiedNetHours / 24) * 100),
  })).sort((a, b) => a.agentNumber - b.agentNumber);

  const noProgressLoops = [...loopMap.entries()]
    .filter(([, value]) => value.count >= 2)
    .map(([signature, value]) => ({
      signature,
      sourceSha: value.sourceSha,
      error: value.error,
      count: value.count,
      hours: hours(value.ms),
      agentIds: [...value.agentIds],
      circuitBreakerRequired: true,
    }))
    .sort((a, b) => b.count - a.count);

  const wasteMs = failedMs + blockedMs + duplicateMs + retryWasteMs + unverifiedMs;
  const verifiedHours = hours(verifiedMs);
  const landingVerifiedHours = hours(landingVerifiedMs);
  const landingWasteHours = hours(landingWasteMs);
  return {
    marker: IVX_AUTONOMOUS_PRODUCTIVITY_INTELLIGENCE_MARKER,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(now).toISOString(),
    capacityAgentHours: fleetSize * 24,
    recordedHours: hours(recordedMs),
    verifiedNetHours: verifiedHours,
    failedHours: hours(failedMs),
    blockedHours: hours(blockedMs),
    duplicateHours: hours(duplicateMs),
    retryWasteHours: hours(retryWasteMs),
    unverifiedHours: hours(unverifiedMs),
    wasteHours: hours(wasteMs),
    verifiedOutputs,
    verifiedCommits: verifiedCommits.size,
    utilizationPercent: round2((verifiedHours / (fleetSize * 24)) * 100),
    netOutputsPerVerifiedHour: verifiedHours > 0 ? round2(verifiedOutputs / verifiedHours) : 0,
    noProgressLoops,
    circuitBreakerTriggered: noProgressLoops.length > 0,
    perAgent,
    landing: {
      recordedHours: hours(landingRecordedMs),
      verifiedNetHours: landingVerifiedHours,
      wasteHours: landingWasteHours,
      verifiedOutputs: landingVerifiedOutputs,
      budgetHours: landingBudgetHours,
      budgetConsumedPercent: round2((landingVerifiedHours / landingBudgetHours) * 100),
      overBudget: landingVerifiedHours > landingBudgetHours,
    },
  };
}
