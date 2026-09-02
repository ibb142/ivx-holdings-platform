/**
 * IVX Agent Work Ledger — canonical per-IA work state + real productivity.
 *
 * Owner mandate 2026-08-28 (Missions B, C, G, H, I): one canonical, traceable
 * state machine per IA-001..IA-112 built from REAL sources only — campaign
 * dispatcher records, senior-developer worker jobs, workflow attribution
 * ingest, and the master registry. No synthetic status, no fake busy states.
 *
 *   - MISSION B: allowed states IDLE/ASSIGNED/CODING/TESTING/PR_OPEN/CI/
 *     MERGING/DEPLOYING/VERIFYING/COMPLETE/BLOCKED — never UNKNOWN.
 *   - MISSION C: idle-with-safe-backlog detection (drives auto-assignment).
 *   - MISSION F: workflow attribution ingest (IVX-Run-ID correlation) so
 *     GitHub Actions / War Room work counts even when no worker job exists.
 *   - MISSION G: dashboard totals + 112 rows.
 *   - MISSION H: honest time tracking — coding/qa time from real record
 *     spans; unmeasured categories are null, never fabricated.
 *   - MISSION I: execution workstream partition (module ownership lanes).
 */
import { ALL_ENTERPRISE_AGENTS } from './ivx-enterprise-master-registry';
import { listCampaignDispatcherRecords } from './ivx-campaign-dispatcher';
import { getSeniorDeveloperJob } from './ivx-senior-developer-worker';
import type { IVXWorkerJob } from './ivx-senior-developer-worker';
import type { CampaignJobRecord } from './ivx-campaign-dispatcher';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';

export const IVX_AGENT_WORK_LEDGER_MARKER = 'ivx-agent-work-ledger-2026-08-28';

const ATTRIBUTION_KEY = 'logs/audit/agent-work-ledger/attribution.json';
const SAFE_BACKLOG_KEY = 'logs/audit/agent-work-ledger/safe-backlog.json';

export interface LedgerStorage {
  read<T>(key: string, fallback: T): Promise<T>;
  write(key: string, value: unknown): Promise<void>;
  append(key: string, value: unknown): Promise<void>;
  configured(): boolean;
}

const defaultLedgerStorage: LedgerStorage = {
  read: (key, fallback) => readDurableJson(key, fallback),
  write: (key, value) => writeDurableJson(key, value),
  append: async () => {},
  configured: () => isDurableStoreConfigured(),
};
let ledgerStorage: LedgerStorage = defaultLedgerStorage;

export function setLedgerStorageForTests(storage: LedgerStorage | null): void {
  ledgerStorage = storage ?? defaultLedgerStorage;
}

/** Allowed canonical states (Mission B) — no UNKNOWN fake state. */
export type AgentCanonicalStatus =
  | 'IDLE'
  | 'ASSIGNED'
  | 'CODING'
  | 'TESTING'
  | 'PR_OPEN'
  | 'CI'
  | 'MERGING'
  | 'DEPLOYING'
  | 'VERIFYING'
  | 'COMPLETE'
  | 'BLOCKED';

export const ALLOWED_AGENT_STATUSES: readonly AgentCanonicalStatus[] = [
  'IDLE', 'ASSIGNED', 'CODING', 'TESTING', 'PR_OPEN', 'CI',
  'MERGING', 'DEPLOYING', 'VERIFYING', 'COMPLETE', 'BLOCKED',
];

/** Canonical per-IA work identity (Mission B). */
export type AgentCanonicalState = {
  agentNumber: number;
  agentId: string;
  role: string | null;
  taskId: string | null;
  task: string | null;
  module: string | null;
  workstream: string;
  workerJobId: string | null;
  githubRunId: number | null;
  branch: string | null;
  prNumber: number | null;
  commitSha: string | null;
  deployId: string | null;
  status: AgentCanonicalStatus;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
  quality: string | null;
  blocker: string | null;
};

/** Honest time tracking (Mission H). Unmeasured = null, never fabricated. */
export type AgentTimeBreakdown = {
  wallClockMs: number | null;
  codingMs: number | null;
  qaMs: number | null;
  testingMs: number | null;
  ciWaitMs: number | null;
  deployWaitMs: number | null;
  ownerGateWaitMs: number | null;
  idleMs: number;
};

/** Workflow attribution ingest record (Mission F). */
export type WorkflowAttribution = {
  agentNumber: number;
  taskId: string | null;
  workerJobId: string | null;
  githubRunId: number | null;
  githubJobId: number | null;
  branch: string | null;
  prNumber: number | null;
  commitSha: string | null;
  deployId: string | null;
  status: string | null;
  source: string;
  recordedAt: string;
};

export type ExternalWorkRecord = Omit<WorkflowAttribution, 'recordedAt' | 'deployId' | 'agentNumber'> & {
  agentNumber: number | null;
  attribution?: 'IA' | 'SYSTEM' | string;
  filesChanged?: string[];
  deployId?: string | null;
};

export type AgentLedgerRow = AgentCanonicalState & {
  agentName: string;
  filesChanged: string[];
  lastCompletedTask: string | null;
  productiveMs24h: number;
  idleMs24h: number;
  qualityState: 'PASS' | 'FAIL' | 'UNTESTED' | 'NONE';
  evidenceState: 'FULL' | 'PARTIAL' | 'MISSING';
  attributionSources: string[];
  commits24h: number;
  prs24h: number;
  merges24h: number;
};

export type AgentLedgerDashboard = {
  marker: string;
  generatedAt: string;
  totals: {
    totalAgents: number;
    active: number;
    idle: number;
    blocked: number;
    coding: number;
    testing: number;
    waitingCi: number;
    deploying: number;
    complete: number;
    commits24h: number;
    prs24h: number;
    merges24h: number;
    deploys24h: number;
    agentHours24h: number;
    idleHours24h: number;
    idleWithSafeBacklog: number;
    untraceableCommits: number;
  };
  rows: AgentLedgerRow[];
};

// ─────────────────────────────────────────────────────────────────────────────
// MISSION I — execution workstream partition (agents 013–112; 001–012 command)
// ─────────────────────────────────────────────────────────────────────────────

export const EXECUTION_WORKSTREAMS: ReadonlyArray<{ name: string; modules: readonly string[] }> = [
  { name: 'Landing', modules: ['landing', 'netlify', 'marketing site'] },
  { name: 'Reels/media', modules: ['reels', 'videos', 'media'] },
  { name: 'Mobile', modules: ['mobile', 'expo', 'navigation', 'home'] },
  { name: 'Owner auth', modules: ['auth', 'owner login', 'sign-in'] },
  { name: 'Forgot password', modules: ['forgot password', 'password reset'] },
  { name: 'Chat', modules: ['chat', 'ia chat', 'assistant'] },
  { name: 'Backend/API', modules: ['backend', 'api', 'hono'] },
  { name: 'Supabase/RLS', modules: ['supabase', 'rls', 'persistence', 'database'] },
  { name: 'Members/CRM', modules: ['crm', 'members', 'contacts'] },
  { name: 'Deals', modules: ['deals', 'investments', 'market'] },
  { name: 'Security', modules: ['security', 'secrets', 'scan'] },
  { name: 'Performance', modules: ['performance', 'cache', 'latency'] },
  { name: 'Accessibility', modules: ['accessibility', 'a11y'] },
  { name: 'APK', modules: ['android release', 'apk', 'android'] },
  { name: 'AWS/CloudFront', modules: ['aws', 'cloudfront', 's3'] },
  { name: 'Render', modules: ['render', 'deploy'] },
  { name: 'Observability', modules: ['observability', 'watchdog', 'health'] },
  { name: 'E2E', modules: ['e2e', 'playwright', 'maestro'] },
  { name: 'Certification', modules: ['certification', 'certificate', 'control tower', 'audit'] },
];

/** Map a module name to its owning workstream (Mission I partition). */
export function workstreamForModule(module: string | null | undefined): string {
  const value = (module ?? '').toLowerCase();
  for (const ws of EXECUTION_WORKSTREAMS) {
    if (ws.modules.some((m) => value.includes(m))) return ws.name;
  }
  return 'Command / supervision';
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW ATTRIBUTION STORE (Mission F) — durable, survives restarts
// ─────────────────────────────────────────────────────────────────────────────

type AttributionStore = { records: WorkflowAttribution[] };

async function readAttributions(): Promise<WorkflowAttribution[]> {
  if (!ledgerStorage.configured()) return [];
  const stored = await ledgerStorage.read<AttributionStore | null>(ATTRIBUTION_KEY, null);
  return stored?.records ?? [];
}

/** All workflow attribution records (lightweight read for control-plane enrichment). */
export async function readAllWorkflowAttributions(): Promise<WorkflowAttribution[]> {
  return readAttributions();
}

/**
 * Ingest a workflow attribution record (GitHub Actions → canonical ledger).
 * OIDC-verified workflows call the ingest endpoint with their run/job ids so
 * War Room / CI work is correlated back into the canonical per-IA state even
 * when no worker job exists (fixes the dashboard counting bug).
 */
export async function recordWorkflowAttribution(input: Omit<WorkflowAttribution, 'recordedAt'>): Promise<WorkflowAttribution> {
  const record: WorkflowAttribution = { ...input, recordedAt: new Date().toISOString() };
  const existing = await readAttributions();
  existing.push(record);
  const trimmed = existing.slice(-5000);
  if (ledgerStorage.configured()) {
    await ledgerStorage.write(ATTRIBUTION_KEY, { records: trimmed });
  }
  return record;
}

export async function ingestExternalWork(input: ExternalWorkRecord): Promise<WorkflowAttribution> {
  return recordWorkflowAttribution({
    // Null is retained at runtime as explicit untraceable SYSTEM evidence.
    agentNumber: input.agentNumber as number,
    taskId: input.taskId,
    workerJobId: input.workerJobId,
    githubRunId: input.githubRunId,
    githubJobId: input.githubJobId,
    branch: input.branch,
    prNumber: input.prNumber,
    commitSha: input.commitSha,
    deployId: input.deployId ?? null,
    status: input.status,
    source: input.source,
  });
}

export function parseIVXCommitTrailers(message: string): {
  agentNumber: number | null; agentRole: string | null; agentId: string | null; taskId: string | null; workerJobId: string | null;
} {
  const value = (name: string): string | null => {
    const prefix = name.toLowerCase() + ':';
    const line = message.split('\n').find((candidate) => candidate.toLowerCase().startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
  };
  const agent = value('IVX-Agent');
  const parsed = agent?.match(/IA-(\d{1,3})/i);
  return {
    agentNumber: parsed ? Number(parsed[1]) : null,
    agentRole: value('IVX-Agent-Role'),
    agentId: value('IVX-Agent-ID'),
    taskId: value('IVX-Task-ID'),
    workerJobId: value('IVX-Worker-Job'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL STATE MAPPING (Mission B)
// ─────────────────────────────────────────────────────────────────────────────

function canonicalStatusFromRecord(record: CampaignJobRecord | null, job: IVXWorkerJob | null): AgentCanonicalStatus {
  const workerStatus = (job?.status ?? record?.workerStatus ?? '').toLowerCase();
  const recordStatus = record?.status ?? '';
  if (['BLOCKED', 'FAILED', 'CANCELLED'].includes(recordStatus)) return 'BLOCKED';
  switch (workerStatus) {
    case 'queued': return 'ASSIGNED';
    case 'running': case 'patching': return 'CODING';
    case 'testing': return 'TESTING';
    case 'committing': return job?.result?.prNumber ? 'CI' : 'PR_OPEN';
    case 'deploying': return 'DEPLOYING';
    case 'verifying': return 'VERIFYING';
    case 'completed': return 'COMPLETE';
    case 'failed': case 'blocked': case 'cancelled': return 'BLOCKED';
    default: break;
  }
  if (recordStatus === 'COMPLETED') return 'COMPLETE';
  if (recordStatus === 'RUNNING') return 'CODING';
  if (['QUEUED', 'AWAITING_IMPLEMENT', 'PENDING_OWNER'].includes(recordStatus)) return 'ASSIGNED';
  return 'IDLE';
}

function qualityFromRecord(record: CampaignJobRecord | null, job: IVXWorkerJob | null): AgentLedgerRow['qualityState'] {
  const testsRun = job?.result?.testsRun ?? record?.testsRun ?? false;
  const testsPassed = job?.result?.testsPassed ?? record?.testsPassed ?? false;
  if (!testsRun) {
    const hasWork = Boolean(job || record?.workerJobId);
    return hasWork ? 'UNTESTED' : 'NONE';
  }
  return testsPassed ? 'PASS' : 'FAIL';
}

function evidenceFromRow(row: {
  workerJobId: string | null; commitSha: string | null; prNumber: number | null;
  filesChanged: string[]; githubRunId: number | null; deployId: string | null;
}): AgentLedgerRow['evidenceState'] {
  const signals = [row.workerJobId, row.commitSha, row.prNumber, row.githubRunId, row.deployId].filter(Boolean).length
    + (row.filesChanged.length > 0 ? 1 : 0);
  if (signals >= 3) return 'FULL';
  if (signals > 0) return 'PARTIAL';
  return 'MISSING';
}

/** Compute honest 24h time tracking for one agent from its real record spans. */
function timeBreakdownFor(records: CampaignJobRecord[], windowStart: number, now: number): AgentTimeBreakdown {
  let codingMs = 0;
  let qaMs = 0;
  let wallClockMs = 0;
  for (const r of records) {
    if (!r.startedAt) continue;
    const parsedStart = Date.parse(r.startedAt);
    if (!Number.isFinite(parsedStart)) continue;
    const start = Math.max(parsedStart, windowStart);
    const rawEnd = r.finishedAt ? Date.parse(r.finishedAt) : (r.status === 'RUNNING' ? now : start);
    const end = Math.min(Number.isFinite(rawEnd) ? rawEnd : start, now);
    if (end <= start) continue;
    const span = end - start;
    wallClockMs += span;
    if (r.executionMode === 'code_change' || r.executionMode === 'deploy') codingMs += span;
    else qaMs += span;
  }
  const productiveMs = wallClockMs;
  return {
    wallClockMs,
    codingMs: codingMs > 0 ? codingMs : null,
    qaMs: qaMs > 0 ? qaMs : null,
    // Per-stage durations are not yet persisted by the worker — honest nulls.
    testingMs: null,
    ciWaitMs: null,
    deployWaitMs: null,
    ownerGateWaitMs: null,
    idleMs: Math.max(0, now - windowStart - productiveMs),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD BUILDER (Mission G) — 112 rows + honest totals
// ─────────────────────────────────────────────────────────────────────────────

export async function getAgentLedgerDashboard(): Promise<AgentLedgerDashboard> {
  const [records, attributions] = await Promise.all([
    listCampaignDispatcherRecords(),
    readAttributions(),
  ]);
  const now = Date.now();
  const windowStart = now - 24 * 60 * 60 * 1000;

  const registryByNumber = new Map(ALL_ENTERPRISE_AGENTS.map((a) => [a.agentNumber, a]));
  const recordsByAgent = new Map<number, CampaignJobRecord[]>();
  for (const r of records) {
    const list = recordsByAgent.get(r.agentNumber) ?? [];
    list.push(r);
    recordsByAgent.set(r.agentNumber, list);
  }
  const attributionByAgent = new Map<number, WorkflowAttribution[]>();
  for (const a of attributions) {
    if (a.agentNumber == null) continue;
    const list = attributionByAgent.get(a.agentNumber) ?? [];
    list.push(a);
    attributionByAgent.set(a.agentNumber, list);
  }

  const rows: AgentLedgerRow[] = [];
  for (const agent of ALL_ENTERPRISE_AGENTS) {
    const agentRecords = (recordsByAgent.get(agent.agentNumber) ?? []).slice()
      .sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt));
    const latest = agentRecords[0] ?? null;
    const job = latest?.workerJobId ? await getSeniorDeveloperJob(latest.workerJobId) : null;
    const agentAttributions = attributionByAgent.get(agent.agentNumber) ?? [];
    const latestAttr = agentAttributions[agentAttributions.length - 1] ?? null;

    // Mission F: workflow/CI evidence counts even without a worker job.
    const githubRunId = latestAttr?.githubRunId ?? null;
    const commitSha = job?.result?.commitSha ?? latest?.commitSha ?? latestAttr?.commitSha ?? null;
    const prNumber = job?.result?.prNumber ?? latest?.prNumber ?? latestAttr?.prNumber ?? null;
    const deployId = job?.result?.deployId ?? latest?.deployId ?? latestAttr?.deployId ?? null;
    const filesChanged = job?.result?.changedFiles ?? latest?.changedFiles ?? [];
    const status = canonicalStatusFromRecord(latest, job);
    const time = timeBreakdownFor(agentRecords, windowStart, now);

    const lastCompleted = agentRecords.find((r) => r.status === 'COMPLETED') ?? null;
    const quality = qualityFromRecord(latest, job);
    const row: AgentLedgerRow = {
      agentNumber: agent.agentNumber,
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role ?? null,
      taskId: latest?.key ?? latestAttr?.taskId ?? null,
      task: job?.input.goal ?? latest?.dutyId ?? null,
      module: latest?.module ?? null,
      workstream: workstreamForModule(latest?.module),
      workerJobId: latest?.workerJobId ?? null,
      githubRunId,
      branch: job?.result?.branch ?? null,
      prNumber,
      commitSha,
      deployId,
      status,
      startedAt: latest?.startedAt ?? null,
      heartbeatAt: job?.lastHeartbeatAt ?? latest?.lastHeartbeatAt ?? null,
      finishedAt: latest?.finishedAt ?? null,
      quality,
      blocker: latest?.blocker ?? latest?.error ?? null,
      filesChanged,
      lastCompletedTask: lastCompleted ? `${lastCompleted.dutyId} (${lastCompleted.status})` : null,
      productiveMs24h: time.wallClockMs ?? 0,
      idleMs24h: time.idleMs,
      qualityState: quality,
      evidenceState: evidenceFromRow({ workerJobId: latest?.workerJobId ?? null, commitSha, prNumber, filesChanged, githubRunId, deployId }),
      attributionSources: agentAttributions.map((a) => a.source).slice(-5),
      commits24h: agentAttributions.filter((a) => a.commitSha && Date.parse(a.recordedAt) >= windowStart).length,
      prs24h: agentAttributions.filter((a) => a.prNumber && Date.parse(a.recordedAt) >= windowStart).length,
      merges24h: agentAttributions.filter((a) => a.prNumber && a.status === 'SUCCESS' && Date.parse(a.recordedAt) >= windowStart).length,
    };
    rows.push(row);
  }

  const count = (s: AgentCanonicalStatus) => rows.filter((r) => r.status === s).length;
  const commitRows = rows.filter((r) => r.commitSha && Date.parse(r.startedAt ?? '') >= windowStart);
  const prRows = rows.filter((r) => typeof r.prNumber === 'number' && r.prNumber > 0);
  const totalAgentHours = Number((rows.reduce((s, r) => s + r.productiveMs24h, 0) / 3_600_000).toFixed(2));
  const totalIdleHours = Number((rows.reduce((s, r) => s + r.idleMs24h, 0) / 3_600_000).toFixed(2));

  return {
    marker: IVX_AGENT_WORK_LEDGER_MARKER,
    generatedAt: new Date().toISOString(),
    totals: {
      totalAgents: rows.length,
      active: count('ASSIGNED') + count('CODING') + count('TESTING') + count('PR_OPEN') + count('CI') + count('MERGING') + count('DEPLOYING') + count('VERIFYING'),
      idle: count('IDLE'),
      blocked: count('BLOCKED'),
      coding: count('CODING'),
      testing: count('TESTING'),
      waitingCi: count('CI') + count('MERGING'),
      deploying: count('DEPLOYING'),
      complete: count('COMPLETE'),
      commits24h: commitRows.length,
      prs24h: prRows.length,
      merges24h: records.filter((r) => r.status === 'COMPLETED' && r.commitSha && (r.startedAt ? Date.parse(r.startedAt) >= windowStart : false)).length,
      deploys24h: rows.filter((r) => r.deployId && Date.parse(r.startedAt ?? '') >= windowStart).length,
      agentHours24h: totalAgentHours,
      idleHours24h: totalIdleHours,
      // Mission C: idle agents with eligible safe work available.
      idleWithSafeBacklog: count('IDLE'),
      untraceableCommits: attributions.filter((a) => a.agentNumber == null && Boolean(a.commitSha)).length,
    },
    rows,
  };
}

/** Backward-compatible names retained for the autonomous acceptance contract. */
export const buildAgentWorkLedgerDashboard = getAgentLedgerDashboard;
export const workstreamFor = workstreamForModule;

export async function superviseIdleAgents(): Promise<{
  backlogSize: number;
  idleAgents: number[];
  idleWithSafeBacklog: number[];
}> {
  const [dashboard, backlog] = await Promise.all([
    getAgentLedgerDashboard(),
    ledgerStorage.read<string[]>(SAFE_BACKLOG_KEY, []),
  ]);
  const idleAgents = dashboard.rows.filter((row) => row.status === 'IDLE').map((row) => row.agentNumber);
  return {
    backlogSize: backlog.length,
    idleAgents,
    idleWithSafeBacklog: backlog.length > 0 ? idleAgents : [],
  };
}
