/**
 * IVX 112 three-layer productivity verifier.
 *
 * Layer 1: runtime truth — 112/112 must have fresh real runtime evidence.
 * Layer 2: time integrity — productive time is reconstructed from real sources,
 *          deduplicated, fail-closed, and never inferred from registration or uptime.
 * Layer 3: certificate truth — exact production SHA + 20h/agent SLA + zero current
 *          FAILED/BLOCKED work + layers 1/2 PASS.
 *
 * The verifier intentionally under-counts when two evidence systems cannot be
 * correlated safely. It never adds ambiguous overlapping sources together.
 */
import { listCampaignDispatcherRecords } from './ivx-campaign-dispatcher';
import { getAllTasks, type Task } from './ivx-autonomous-task-engine';
import { getAutonomousTruthSnapshot } from './ivx-autonomous-truth-control';
import { resolveProductionSha } from './ivx-landing-p0-backlog';
import type { AgentLedgerDashboard } from './ivx-agent-work-ledger';

export const IVX_112_THREE_LAYER_VERIFY_MARKER = 'ivx-112-three-layer-verifier-2026-09-04-v1';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_AGENT_MS = 20 * HOUR_MS;
const FUTURE_SKEW_MS = 2 * 60 * 1000;
const FRESH_WORK_MS = 60 * 1000;
const LANDING_PREFIX = 'LANDING_P0_RESULT ';

export type ParsedLandingProductivityEvidence = {
  unitId: string;
  agentNumber: number;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  startedAt: string;
  completedAt: string;
  productiveSeconds: number;
  productionSha: string;
};

export function parseLandingProductivityEvidence(summary: string): ParsedLandingProductivityEvidence | null {
  const index = summary.indexOf(LANDING_PREFIX);
  if (index < 0) return null;
  const raw = summary.slice(index + LANDING_PREFIX.length).trim();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const agentNumber = Number(parsed.agent_number);
    const productiveSeconds = Number(parsed.productive_seconds);
    const status = String(parsed.status ?? '');
    const startedAt = String(parsed.started_at ?? '');
    const completedAt = String(parsed.completed_at ?? '');
    const productionSha = String(parsed.production_sha ?? '');
    const unitId = String(parsed.unit_id ?? '');
    if (!Number.isInteger(agentNumber) || agentNumber < 1 || agentNumber > 112) return null;
    if (!Number.isFinite(productiveSeconds) || productiveSeconds < 0) return null;
    if (!['PASS', 'FAIL', 'BLOCKED'].includes(status)) return null;
    if (!unitId || !productionSha || !startedAt || !completedAt) return null;
    return {
      unitId,
      agentNumber,
      status: status as ParsedLandingProductivityEvidence['status'],
      startedAt,
      completedAt,
      productiveSeconds,
      productionSha,
    };
  } catch {
    return null;
  }
}

type Interval = { start: number; end: number };

function mergedDurationMs(intervals: Interval[]): number {
  const sorted = intervals
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length === 0) return 0;
  let total = 0;
  let start = sorted[0].start;
  let end = sorted[0].end;
  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    if (next.start <= end) {
      end = Math.max(end, next.end);
      continue;
    }
    total += end - start;
    start = next.start;
    end = next.end;
  }
  return total + (end - start);
}

export function conservativeProductiveMs(campaignMs: number, evidenceMs: number): number {
  // Both systems may describe the same underlying execution. Until a stable
  // cross-system execution id exists, MAX is the only non-inflating merge.
  return Math.max(0, Math.min(DAY_MS, Math.max(campaignMs, evidenceMs)));
}

function recentTaskErrors(tasks: Task[], windowStart: number): Task[] {
  return tasks.filter((task) => {
    const updated = Date.parse(task.updatedAt ?? '');
    return Number.isFinite(updated)
      && updated >= windowStart
      && (task.state === 'FAILED' || task.state === 'BLOCKED');
  });
}

export async function buildThreeLayerVerifiedLedger(base: AgentLedgerDashboard) {
  const now = Date.now();
  const windowStart = now - DAY_MS;
  const productionSha = resolveProductionSha();
  const [records, tasks, runtimeTruth] = await Promise.all([
    listCampaignDispatcherRecords(),
    getAllTasks(),
    getAutonomousTruthSnapshot(),
  ]);

  const campaignIntervals = new Map<number, Interval[]>();
  let invalidCampaignSpans = 0;
  for (const record of records) {
    if (!record.workerJobId || !record.startedAt) continue;
    const agentNumber = Number(record.agentNumber);
    const rawStart = Date.parse(record.startedAt);
    const heartbeat = Date.parse(record.lastHeartbeatAt ?? '');
    const completed = Date.parse(record.finishedAt ?? '');
    const runningFresh = record.status === 'RUNNING'
      && Number.isFinite(heartbeat)
      && now - heartbeat <= FRESH_WORK_MS;
    const rawEnd = Number.isFinite(completed) ? completed : (runningFresh ? now : Number.NaN);
    if (!Number.isInteger(agentNumber) || agentNumber < 1 || agentNumber > 112
      || !Number.isFinite(rawStart) || !Number.isFinite(rawEnd)
      || rawEnd < rawStart || rawStart > now + FUTURE_SKEW_MS || rawEnd > now + FUTURE_SKEW_MS) {
      invalidCampaignSpans += 1;
      continue;
    }
    const start = Math.max(rawStart, windowStart);
    const end = Math.min(rawEnd, now);
    if (end <= start) continue;
    const list = campaignIntervals.get(agentNumber) ?? [];
    list.push({ start, end });
    campaignIntervals.set(agentNumber, list);
  }

  const evidenceMsByAgent = new Map<number, number>();
  const exactShaAgents = new Set<number>();
  const seenExecution = new Set<string>();
  let malformedLandingEvidence = 0;
  let invalidLandingTiming = 0;
  let duplicateLandingEvidence = 0;
  let staleShaEvidence = 0;
  let landingEvidenceRecords24h = 0;

  for (const task of tasks) {
    for (const evidence of task.evidence) {
      if (!evidence.summary.includes(LANDING_PREFIX)) continue;
      const parsed = parseLandingProductivityEvidence(evidence.summary);
      if (!parsed) {
        malformedLandingEvidence += 1;
        continue;
      }
      const start = Date.parse(parsed.startedAt);
      const end = Date.parse(parsed.completedAt);
      const productiveMs = parsed.productiveSeconds * 1000;
      const elapsedMs = end - start;
      if (!Number.isFinite(start) || !Number.isFinite(end)
        || end < start || start > now + FUTURE_SKEW_MS || end > now + FUTURE_SKEW_MS
        || productiveMs > elapsedMs + 1500) {
        invalidLandingTiming += 1;
        continue;
      }
      const fingerprint = `${parsed.unitId}|${parsed.agentNumber}|${parsed.startedAt}|${parsed.completedAt}|${parsed.productiveSeconds}|${parsed.productionSha}`;
      if (seenExecution.has(fingerprint)) {
        duplicateLandingEvidence += 1;
        continue;
      }
      seenExecution.add(fingerprint);
      if (end < windowStart) continue;
      landingEvidenceRecords24h += 1;
      evidenceMsByAgent.set(parsed.agentNumber, (evidenceMsByAgent.get(parsed.agentNumber) ?? 0) + productiveMs);
      if (parsed.productionSha === productionSha) exactShaAgents.add(parsed.agentNumber);
      else staleShaEvidence += 1;
    }
  }

  const campaignMsByAgent = new Map<number, number>();
  for (const [agentNumber, intervals] of campaignIntervals) {
    campaignMsByAgent.set(agentNumber, mergedDurationMs(intervals));
  }

  const rowNumbers = base.rows.map((row) => row.agentNumber);
  const uniqueRowNumbers = new Set(rowNumbers);
  const duplicateLedgerRows = rowNumbers.length - uniqueRowNumbers.size;
  const missingAgentRows = 112 - uniqueRowNumbers.size;

  const rows = base.rows.map((row) => {
    const campaignMs24h = campaignMsByAgent.get(row.agentNumber) ?? 0;
    const evidenceMs24h = evidenceMsByAgent.get(row.agentNumber) ?? 0;
    const productiveMs24h = conservativeProductiveMs(campaignMs24h, evidenceMs24h);
    return {
      ...row,
      productiveMs24h,
      idleMs24h: Math.max(0, DAY_MS - productiveMs24h),
      timeVerification: {
        campaignMs24h,
        evidenceMs24h,
        unifiedMs24h: productiveMs24h,
        mergePolicy: 'conservative_max_no_double_count',
        exactProductionShaEvidence: exactShaAgents.has(row.agentNumber),
        meets20h: productiveMs24h >= MIN_AGENT_MS,
      },
    };
  });

  const agentHours24h = Number((rows.reduce((sum, row) => sum + row.productiveMs24h, 0) / HOUR_MS).toFixed(4));
  const idleHours24h = Number((rows.reduce((sum, row) => sum + row.idleMs24h, 0) / HOUR_MS).toFixed(4));
  const meets20h = rows.filter((row) => row.productiveMs24h >= MIN_AGENT_MS).length;
  const over24h = rows.filter((row) => row.productiveMs24h > DAY_MS).map((row) => row.agentNumber);
  const currentErrors = recentTaskErrors(tasks, windowStart);
  const qualityFailures = rows.filter((row) => row.qualityState === 'FAIL').map((row) => row.agentNumber);

  const layer1Pass = Boolean(runtimeTruth.certification.continuousRuntimeCertified)
    && runtimeTruth.agents.counts.total === 112
    && runtimeTruth.agents.counts.working === 112
    && runtimeTruth.agents.counts.freshHeartbeat === 112
    && runtimeTruth.agents.counts.stale === 0
    && runtimeTruth.agents.counts.blocked === 0
    && runtimeTruth.agents.counts.unknown === 0;

  const layer2Pass = base.rows.length === 112
    && duplicateLedgerRows === 0
    && missingAgentRows === 0
    && invalidCampaignSpans === 0
    && malformedLandingEvidence === 0
    && invalidLandingTiming === 0
    && over24h.length === 0;

  const layer3Pass = layer1Pass
    && layer2Pass
    && meets20h === 112
    && exactShaAgents.size === 112
    && currentErrors.length === 0
    && qualityFailures.length === 0;

  return {
    dashboard: {
      ...base,
      marker: `${base.marker}+${IVX_112_THREE_LAYER_VERIFY_MARKER}`,
      generatedAt: new Date(now).toISOString(),
      totals: {
        ...base.totals,
        agentHours24h,
        idleHours24h,
      },
      rows,
    },
    verificationLayers: {
      marker: IVX_112_THREE_LAYER_VERIFY_MARKER,
      measuredAt: new Date(now).toISOString(),
      productionSha,
      layer1RuntimeTruth: {
        pass: layer1Pass,
        requiredAgents: 112,
        working: runtimeTruth.agents.counts.working,
        freshHeartbeat: runtimeTruth.agents.counts.freshHeartbeat,
        stale: runtimeTruth.agents.counts.stale,
        blocked: runtimeTruth.agents.counts.blocked,
        unknown: runtimeTruth.agents.counts.unknown,
      },
      layer2TimeIntegrity: {
        pass: layer2Pass,
        policy: 'Count only real worker spans or explicit LANDING_P0_RESULT productive_seconds. Ambiguous source overlap is merged with MAX, never SUM.',
        rowCount: base.rows.length,
        uniqueAgents: uniqueRowNumbers.size,
        duplicateLedgerRows,
        missingAgentRows,
        invalidCampaignSpans,
        malformedLandingEvidence,
        invalidLandingTiming,
        duplicateLandingEvidenceRemoved: duplicateLandingEvidence,
        staleShaEvidence,
        landingEvidenceRecords24h,
        over24hAgents: over24h,
        agentHours24h,
      },
      layer3CertificateTruth: {
        pass: layer3Pass,
        requiredProductiveHoursPerAgent: 20,
        meets20h,
        exactShaAgents: exactShaAgents.size,
        recentFailedOrBlockedTasks: currentErrors.length,
        qualityFailures: qualityFailures.length,
        certificate: layer3Pass ? 'PASS' : 'FAIL',
        failClosed: true,
      },
    },
  };
}
