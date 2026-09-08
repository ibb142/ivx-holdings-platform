/**
 * IVX Self-Heal Cycle — verified autonomous engineering loop.
 *
 * Pipeline:
 *   detect -> prioritize -> execute low-risk repair -> test -> verify -> rollback
 *   if needed -> resume queue -> report verified evidence.
 *
 * Low-risk code repairs are executed by the real IVX Senior Developer Worker.
 * Secrets, billing, IAM/permissions, destructive data operations and critical
 * infrastructure/security-boundary changes remain owner-gated.
 */
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildPriorityQueue, type PriorityEntry, type PriorityTier } from './ivx-priority-engine';
import { runStructuredTestReport, type TestReport, type TestSuite } from './ivx-test-reporter';
import { getProductionHealth, triggerProductionRollback, type ProductionHealth, type RollbackResult } from './ivx-production-guard';
import {
  enqueueOrAttachSeniorDeveloperJob,
  getSeniorDeveloperJob,
  type IVXWorkerJob,
} from './ivx-senior-developer-worker';
import { IVX_SAFE_PATCH_CONFIRM_TEXT } from './ivx-senior-developer-runtime';
import { readDurableJson, writeDurableJson, appendDurableEvent } from './ivx-durable-store';

export const IVX_SELF_HEAL_CYCLE_MARKER = 'ivx-self-heal-cycle-2026-09-08-real-executor-v2';
export type TestSuiteList = TestSuite[];

const SELF_HEAL_ROOT = path.join(process.cwd(), 'logs', 'audit', 'self-heal');
const SELF_HEAL_LOG = path.join(SELF_HEAL_ROOT, 'events.log');
const REPORT_INDEX_KEY = 'logs/audit/self-heal/reports.json';
const MAX_REPORTS = 100;
const REPAIR_WAIT_MS = 20 * 60_000;
const REPAIR_POLL_MS = 2_000;

export type StageStatus = 'verified' | 'failed' | 'skipped' | 'unverified';
export type CycleStage = { step: number; name: string; status: StageStatus; proof: string; startedAt: string; finishedAt: string };
export type SelfHealCycleReport = {
  marker: string;
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  allVerified: boolean;
  blocker: { found: boolean; tier: PriorityTier | null; title: string | null; source: string | null; reference: string | null };
  prioritization: { totalOpen: number; tierCounts: Record<PriorityTier, number> };
  repair: {
    attempted: boolean;
    ownerGated: boolean;
    jobId: string | null;
    finalStatus: string | null;
    changedFiles: string[];
    commitSha: string | null;
    prNumber: number | null;
    prMerged: boolean;
    testsPassed: boolean | null;
    typecheckPassed: boolean | null;
    error: string | null;
  };
  tests: TestReport[];
  production: ProductionHealth | null;
  rollback: RollbackResult | null;
  resumeQueue: { id: string; tier: PriorityTier; title: string }[];
  stages: CycleStage[];
  verifiedResults: CycleStage[];
};

export type RunSelfHealCycleOptions = {
  suites?: TestSuite[];
  approverEmail?: string;
  resumeLimit?: number;
};

function nowIso(): string { return new Date().toISOString(); }
function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `selfheal-${crypto.randomUUID()}`;
  return `selfheal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); }); }
function stage(step: number, name: string, status: StageStatus, proof: string, startedAt: string): CycleStage {
  return { step, name, status, proof, startedAt, finishedAt: nowIso() };
}

async function logEvent(event: string, detail: string): Promise<void> {
  try {
    await mkdir(SELF_HEAL_ROOT, { recursive: true });
    await appendFile(SELF_HEAL_LOG, `${nowIso()} ${event} ${detail}\n`, 'utf8');
  } catch { /* durable event below is the authoritative path */ }
  await appendDurableEvent(REPORT_INDEX_KEY, { event, detail: detail.slice(0, 500), at: nowIso() }).catch(() => undefined);
  console.log(`[IVXSelfHeal] ${event} ${detail}`);
}

/**
 * Fail closed for mutations that must never be silently automated. Ordinary
 * application code, tests, UI, APIs and non-destructive config repairs are not
 * owner-gated here; the Senior Developer Worker still enforces its own safety
 * and validation contracts.
 */
export function requiresOwnerGate(entry: PriorityEntry): boolean {
  const text = `${entry.title} ${entry.source} ${entry.reference ?? ''}`.toLowerCase();
  return /\b(secret|credential|password|token rotation|billing|payment|stripe|iam|permission|role policy|service role|drop table|truncate|delete all|destructive migration|production database migration|security boundary|mfa|auth architecture|aws root|cloudflare account)\b/i.test(text);
}

function buildRepairGoal(entry: PriorityEntry, cycleId: string): string {
  return [
    `AUTONOMOUS 360 SELF-HEAL cycle ${cycleId}.`,
    `Fix this real IVX blocker end-to-end: [${entry.tier}] ${entry.title}.`,
    `Source=${entry.source}; reference=${entry.reference ?? 'n/a'}.`,
    'Inspect the actual repository and runtime evidence. Determine root cause; make the smallest correct code change; run focused tests and typecheck; create the commit/PR and wait for required CI according to the existing autonomous-coder policy.',
    'Do not invent success. If no code change is necessary, prove why. Do not modify secrets, billing, IAM/permissions, destructive data operations, or critical security boundaries; return BLOCKED with the exact owner action for those scopes.',
  ].join(' ');
}

async function waitForRepair(jobId: string): Promise<IVXWorkerJob | null> {
  const deadline = Date.now() + REPAIR_WAIT_MS;
  while (Date.now() < deadline) {
    const job = await getSeniorDeveloperJob(jobId);
    if (!job) return null;
    if (['completed', 'failed', 'blocked', 'cancelled'].includes(job.status)) return job;
    await sleep(REPAIR_POLL_MS);
  }
  return await getSeniorDeveloperJob(jobId);
}

async function executeRepair(entry: PriorityEntry, cycleId: string): Promise<{ job: IVXWorkerJob | null; ownerGated: boolean; error: string | null }> {
  if (requiresOwnerGate(entry)) return { job: null, ownerGated: true, error: 'Sensitive/high-impact scope requires owner authorization.' };
  try {
    const result = await enqueueOrAttachSeniorDeveloperJob({
      goal: buildRepairGoal(entry, cycleId),
      ownerApproved: true,
      approvePatch: true,
      patchConfirmationText: IVX_SAFE_PATCH_CONFIRM_TEXT,
      approveGitDeploy: false,
      validationMode: 'focused',
      systemMode: true,
      ownerApprovedAction: null,
      ownerId: `machine:self-heal:${entry.id}`,
      executionMode: 'code_change',
      taskId: entry.id,
      actor: 'SYSTEM',
    });
    const jobId = result.job.jobId;
    const terminal = await waitForRepair(jobId);
    return { job: terminal ?? result.job, ownerGated: false, error: terminal ? null : 'Repair job disappeared before terminal proof.' };
  } catch (error) {
    return { job: null, ownerGated: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runSelfHealCycle(options: RunSelfHealCycleOptions = {}): Promise<SelfHealCycleReport> {
  const cycleId = uid();
  const startedAt = nowIso();
  const startMs = Date.now();
  const suites: TestSuite[] = options.suites && options.suites.length > 0 ? options.suites : ['typecheck', 'lint'];
  const resumeLimit = Math.min(Math.max(1, options.resumeLimit ?? 20), 100);
  const stages: CycleStage[] = [];
  await logEvent('SELF_HEAL_CYCLE_STARTED', `cycle=${cycleId}`);

  let s = nowIso();
  const queue = await buildPriorityQueue(200);
  const next = queue.next;
  stages.push(stage(1, 'find blocker', next ? 'verified' : 'skipped', next ? `Top blocker [${next.tier}] ${next.source}: ${next.title}` : 'No open blocker.', s));

  s = nowIso();
  stages.push(stage(2, 'prioritize automatically', 'verified', `Ranked ${queue.totalOpen} open item(s); blockersFirst=${queue.blockersFirst}.`, s));

  const repairState: SelfHealCycleReport['repair'] = {
    attempted: false, ownerGated: false, jobId: null, finalStatus: null, changedFiles: [], commitSha: null, prNumber: null, prMerged: false,
    testsPassed: null, typecheckPassed: null, error: null,
  };

  s = nowIso();
  if (!next) {
    stages.push(stage(3, 'execute repair', 'skipped', 'No blocker to repair.', s));
  } else {
    repairState.attempted = true;
    const executed = await executeRepair(next, cycleId);
    repairState.ownerGated = executed.ownerGated;
    repairState.jobId = executed.job?.jobId ?? null;
    repairState.finalStatus = executed.job?.status ?? null;
    repairState.changedFiles = executed.job?.result?.changedFiles ?? [];
    repairState.commitSha = executed.job?.result?.commitSha ?? null;
    repairState.prNumber = executed.job?.result?.prNumber ?? null;
    repairState.prMerged = executed.job?.result?.prMerged === true;
    repairState.testsPassed = executed.job?.result?.testsPassed ?? null;
    repairState.typecheckPassed = executed.job?.result?.typecheckPassed ?? null;
    repairState.error = executed.error ?? executed.job?.error ?? executed.job?.result?.error ?? null;

    if (executed.ownerGated) {
      stages.push(stage(3, 'execute repair', 'unverified', `Owner-gated sensitive scope: ${executed.error}`, s));
    } else if (executed.job?.status === 'completed' && executed.job.result?.ok) {
      stages.push(stage(3, 'execute repair', 'verified', `Real worker ${executed.job.jobId} completed; files=${repairState.changedFiles.length}; commit=${repairState.commitSha ?? 'no-change'}; PR=${repairState.prNumber ?? 'n/a'}; merged=${repairState.prMerged}.`, s));
    } else {
      stages.push(stage(3, 'execute repair', 'failed', `Repair did not complete: job=${executed.job?.jobId ?? 'none'} status=${executed.job?.status ?? 'none'} error=${repairState.error ?? 'unknown'}.`, s));
    }
  }

  const repairActuallyCompleted = !next || stages.some((row) => row.step === 3 && row.status === 'verified');
  const tests: TestReport[] = [];
  if (repairActuallyCompleted) {
    for (const suite of suites) {
      s = nowIso();
      const test = await runStructuredTestReport(suite);
      tests.push(test);
      stages.push(stage(4, `run tests (${suite})`, test.ok ? 'verified' : 'failed', `exit=${test.exitCode ?? 'null'} durationMs=${test.durationMs}${test.error ? ` error=${test.error}` : ''}`, s));
    }
  } else {
    s = nowIso();
    stages.push(stage(4, 'run tests', 'skipped', 'Post-repair tests skipped because no real repair reached a verified terminal state.', s));
  }
  const testsPassed = tests.length === 0 ? repairActuallyCompleted : tests.every((test) => test.ok);

  s = nowIso();
  let production: ProductionHealth | null = null;
  try {
    production = getProductionHealth();
    stages.push(stage(5, 'verify production', 'verified', `failureRate=${production.failureRate.toFixed(2)} thresholdExceeded=${production.thresholdExceeded} renderConfigured=${production.renderConfigured}.`, s));
  } catch (error) {
    stages.push(stage(5, 'verify production', 'failed', `Health probe failed: ${error instanceof Error ? error.message : String(error)}`, s));
  }

  s = nowIso();
  const needsRollback = !testsPassed || (production?.thresholdExceeded ?? false);
  let rollback: RollbackResult | null = null;
  if (needsRollback) {
    const reason = !testsPassed ? 'Self-heal post-repair checks failed.' : `Production failure rate ${production?.failureRate.toFixed(2)} exceeded threshold.`;
    rollback = await triggerProductionRollback({ reason });
    stages.push(stage(6, 'rollback if needed', rollback.ok || !rollback.triggered ? 'verified' : 'failed', rollback.triggered ? `Rollback triggered target=${rollback.targetDeployId} new=${rollback.newDeployId}.` : `Rollback evaluated, not triggered: ${rollback.reason}.`, s));
  } else {
    stages.push(stage(6, 'rollback if needed', 'skipped', 'Repair checks passed and production is healthy.', s));
  }

  s = nowIso();
  const remaining = queue.queue.filter((entry) => !next || entry.id !== next.id).slice(0, resumeLimit).map((entry) => ({ id: entry.id, tier: entry.tier, title: entry.title }));
  stages.push(stage(7, 'resume queued work', 'verified', `${remaining.length} ranked item(s) retained for immediate next pass.`, s));

  s = nowIso();
  const verifiedBeforeReport = stages.filter((row) => row.status === 'verified').length;
  stages.push(stage(8, 'report only verified results', 'verified', `${verifiedBeforeReport}/${stages.length + 1} stages had proof before final report.`, s));

  const report: SelfHealCycleReport = {
    marker: IVX_SELF_HEAL_CYCLE_MARKER,
    cycleId,
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startMs,
    allVerified: stages.every((row) => row.status === 'verified' || row.status === 'skipped'),
    blocker: { found: Boolean(next), tier: next?.tier ?? null, title: next?.title ?? null, source: next?.source ?? null, reference: next?.reference ?? null },
    prioritization: { totalOpen: queue.totalOpen, tierCounts: queue.tierCounts },
    repair: repairState,
    tests,
    production,
    rollback,
    resumeQueue: remaining,
    stages,
    verifiedResults: stages.filter((row) => row.status === 'verified'),
  };
  await persistReport(report);
  await logEvent('SELF_HEAL_CYCLE_FINISHED', `cycle=${cycleId} allVerified=${report.allVerified} repairJob=${repairState.jobId ?? 'none'}`);
  return report;
}

async function persistReport(report: SelfHealCycleReport): Promise<void> {
  try {
    const existing = await readDurableJson<SelfHealCycleReport[]>(REPORT_INDEX_KEY, []);
    const next = [report, ...existing.filter((row) => row.cycleId !== report.cycleId)].slice(0, MAX_REPORTS);
    await writeDurableJson(REPORT_INDEX_KEY, next);
  } catch { /* local fallback below */ }
  try {
    await mkdir(SELF_HEAL_ROOT, { recursive: true });
    await writeFile(path.join(SELF_HEAL_ROOT, `${report.cycleId}.json`), JSON.stringify(report, null, 2), 'utf8');
  } catch { /* best effort */ }
}

export async function listSelfHealReports(limit: number = 20): Promise<SelfHealCycleReport[]> {
  const capped = Math.min(Math.max(1, limit), 100);
  try {
    const durable = await readDurableJson<SelfHealCycleReport[]>(REPORT_INDEX_KEY, []);
    if (durable.length > 0) return durable.slice(0, capped);
  } catch { /* local fallback */ }
  try {
    const files = await readdir(SELF_HEAL_ROOT);
    const reports: SelfHealCycleReport[] = [];
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      try { reports.push(JSON.parse(await readFile(path.join(SELF_HEAL_ROOT, file), 'utf8')) as SelfHealCycleReport); } catch { /* skip */ }
    }
    reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return reports.slice(0, capped);
  } catch { return []; }
}
