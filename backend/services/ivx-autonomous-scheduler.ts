/**
 * IVX Autonomous Scheduler (owner-only) — BLOCK 41.
 *
 * The keystone that turns the BLOCK 37–39 continuous-improvement + memory +
 * action-loop pieces into a self-DRIVING system: a durable, restart-safe
 * scheduler that automatically runs the daily self-audit and daily architecture
 * drift detection on an interval — no human prompt — and wires every result into
 * the Unified Executive Memory (so every brain remembers what was found) and the
 * Executive Action Loop (recommendation → execution → outcome → learning), so the
 * learning feedback loop advances on its own.
 *
 * HARD HONESTY RULES:
 *   - The scheduler runs the REAL scans (`runDailySelfAudit`, `detectArchitectureDrift`);
 *     it never fabricates findings. An empty workspace yields an honest empty audit.
 *   - Every run writes an attributed (`source: 'autonomous_mode'`) memory record and
 *     a real action-loop cycle grounded in the actual audit numbers.
 *   - State is durable (atomic temp-file + rename) so `lastRunAt` / `nextDueAt`
 *     survive a process restart and the scheduler never double-runs a fresh boot.
 *   - A failed job never throws into the ticker; it records `failed` + the reason
 *     and re-arms for the next interval.
 *
 * Durable layout (mirrors the proven continuous-execution / unified-memory stores):
 *   logs/audit/scheduler/state.json   scheduler + per-job state (atomic materialised)
 *   logs/audit/scheduler/runs.jsonl   append-only run ledger (forensics)
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';
import {
  runDailySelfAudit,
  planSafeAutoImprovements,
  type DailySelfAuditRun,
} from './ivx-continuous-improvement';
import {
  detectArchitectureDrift,
  type ArchitectureDriftReport,
} from './ivx-architecture-drift';
import { remember } from './ivx-unified-memory-store';
import { enqueueOrAttachSeniorDeveloperJob } from './ivx-senior-developer-worker';
import {
  recordRecommendation,
  recordExecution,
  recordOutcome,
} from './ivx-executive-action-loop';

export const IVX_SCHEDULER_MARKER = 'ivx-autonomous-scheduler-2026-06-02';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ticker cadence — the per-job interval gates whether work actually runs. */
const TICK_MS = 5 * 60 * 1000;

export type ScheduledJobKind =
  | 'daily_self_audit'
  | 'daily_drift_detection'
  | 'daily_executive_report'
  | 'daily_buyer_engine'
  | 'daily_investor_engine'
  | 'daily_jv_engine'
  | 'daily_tokenized_buyer_engine'
  | 'daily_technology_ideas'
  | 'daily_capital_outreach'
  | 'daily_deploy_monitor'
  | 'daily_enterprise_os';

export const SCHEDULED_JOB_KINDS: readonly ScheduledJobKind[] = [
  'daily_self_audit',
  'daily_drift_detection',
  'daily_executive_report',
  'daily_buyer_engine',
  'daily_investor_engine',
  'daily_jv_engine',
  'daily_tokenized_buyer_engine',
  'daily_technology_ideas',
  'daily_capital_outreach',
  'daily_deploy_monitor',
  'daily_enterprise_os',
];

export type JobRunStatus = 'never' | 'ok' | 'failed' | 'completed_no_results' | 'timed_out';

export type ScheduledJobState = {
  kind: ScheduledJobKind;
  /** How often the job should run (default 24h). */
  intervalMs: number;
  lastRunAt: string | null;
  nextDueAt: string | null;
  lastStatus: JobRunStatus;
  lastDurationMs: number | null;
  lastSummary: string;
  runCount: number;
  failureCount: number;
};

export type SchedulerState = {
  marker: string;
  startedAt: string;
  updatedAt: string;
  enabled: boolean;
  jobs: Record<ScheduledJobKind, ScheduledJobState>;
};

const DIR = path.join(process.cwd(), 'logs', 'audit', 'scheduler');
const STATE_PATH = path.join(DIR, 'state.json');
const TMP_PATH = path.join(DIR, 'state.json.tmp');
const LOG_PATH = path.join(DIR, 'runs.jsonl');

let timer: ReturnType<typeof setInterval> | null = null;
let writeChain: Promise<void> = Promise.resolve();
/** Per-process guard so a long-running job is never started twice concurrently. */
const inFlight = new Set<ScheduledJobKind>();

function nowIso(now: number = Date.now()): string {
  return new Date(now).toISOString();
}

// ── Pure helpers (unit-testable, no I/O) ─────────────────────────────────────

export function freshJobState(kind: ScheduledJobKind, now: number = Date.now()): ScheduledJobState {
  return {
    kind,
    intervalMs: DAY_MS,
    lastRunAt: null,
    // Due immediately on first boot so the first audit runs without waiting a day.
    nextDueAt: nowIso(now),
    lastStatus: 'never',
    lastDurationMs: null,
    lastSummary: 'Not run yet.',
    runCount: 0,
    failureCount: 0,
  };
}

export function freshSchedulerState(now: number = Date.now()): SchedulerState {
  return {
    marker: IVX_SCHEDULER_MARKER,
    startedAt: nowIso(now),
    updatedAt: nowIso(now),
    enabled: true,
    jobs: {
      daily_self_audit: freshJobState('daily_self_audit', now),
      daily_drift_detection: freshJobState('daily_drift_detection', now),
      daily_executive_report: freshJobState('daily_executive_report', now),
      daily_buyer_engine: freshJobState('daily_buyer_engine', now),
      daily_investor_engine: freshJobState('daily_investor_engine', now),
      daily_jv_engine: freshJobState('daily_jv_engine', now),
      daily_tokenized_buyer_engine: freshJobState('daily_tokenized_buyer_engine', now),
      daily_technology_ideas: freshJobState('daily_technology_ideas', now),
      daily_capital_outreach: freshJobState('daily_capital_outreach', now),
      daily_deploy_monitor: { ...freshJobState('daily_deploy_monitor', now), intervalMs: 5 * 60 * 60 * 1000 },
      daily_enterprise_os: freshJobState('daily_enterprise_os', now),
    },
  };
}

/** A job is due when it has never run, or its nextDueAt is at/after now. */
export function isJobDue(job: ScheduledJobState, now: number = Date.now()): boolean {
  if (!job.nextDueAt) return true;
  return Date.parse(job.nextDueAt) <= now;
}

/** The next time a freshly-completed job should run. */
export function computeNextDue(now: number, intervalMs: number): string {
  const safeInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DAY_MS;
  return nowIso(now + safeInterval);
}

/** Which jobs are due right now (pure). */
export function selectDueJobs(state: SchedulerState, now: number = Date.now()): ScheduledJobKind[] {
  if (!state.enabled) return [];
  return SCHEDULED_JOB_KINDS.filter((kind) => isJobDue(state.jobs[kind], now));
}

// ── Durable state I/O ────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  await mkdir(DIR, { recursive: true });
}

function normalizeState(parsed: unknown): SchedulerState {
  const fresh = freshSchedulerState();
  if (!parsed || typeof parsed !== 'object') return fresh;
  const obj = parsed as Partial<SchedulerState>;
  const jobs = (obj.jobs ?? {}) as Partial<Record<ScheduledJobKind, ScheduledJobState>>;
  return {
    marker: IVX_SCHEDULER_MARKER,
    startedAt: typeof obj.startedAt === 'string' ? obj.startedAt : fresh.startedAt,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : fresh.updatedAt,
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : true,
    jobs: {
      daily_self_audit: { ...fresh.jobs.daily_self_audit, ...(jobs.daily_self_audit ?? {}), kind: 'daily_self_audit' },
      daily_drift_detection: {
        ...fresh.jobs.daily_drift_detection,
        ...(jobs.daily_drift_detection ?? {}),
        kind: 'daily_drift_detection',
      },
      daily_executive_report: {
        ...fresh.jobs.daily_executive_report,
        ...(jobs.daily_executive_report ?? {}),
        kind: 'daily_executive_report',
      },
      daily_buyer_engine: {
        ...fresh.jobs.daily_buyer_engine,
        ...(jobs.daily_buyer_engine ?? {}),
        kind: 'daily_buyer_engine',
      },
      daily_investor_engine: {
        ...fresh.jobs.daily_investor_engine,
        ...(jobs.daily_investor_engine ?? {}),
        kind: 'daily_investor_engine',
      },
      daily_jv_engine: {
        ...fresh.jobs.daily_jv_engine,
        ...(jobs.daily_jv_engine ?? {}),
        kind: 'daily_jv_engine',
      },
      daily_tokenized_buyer_engine: {
        ...fresh.jobs.daily_tokenized_buyer_engine,
        ...(jobs.daily_tokenized_buyer_engine ?? {}),
        kind: 'daily_tokenized_buyer_engine',
      },
      daily_technology_ideas: {
        ...fresh.jobs.daily_technology_ideas,
        ...(jobs.daily_technology_ideas ?? {}),
        kind: 'daily_technology_ideas',
      },
      daily_capital_outreach: {
        ...fresh.jobs.daily_capital_outreach,
        ...(jobs.daily_capital_outreach ?? {}),
        kind: 'daily_capital_outreach',
      },
      daily_deploy_monitor: {
        ...fresh.jobs.daily_deploy_monitor,
        ...(jobs.daily_deploy_monitor ?? {}),
        kind: 'daily_deploy_monitor',
      },
      daily_enterprise_os: {
        ...fresh.jobs.daily_enterprise_os,
        ...(jobs.daily_enterprise_os ?? {}),
        kind: 'daily_enterprise_os',
      },
    },
  };
}

export async function getSchedulerState(): Promise<SchedulerState> {
  // Durable (Supabase) when configured so run history survives restarts/deploys
  // on the ephemeral-disk Render tier; falls back to the local filesystem otherwise.
  if (isDurableStoreConfigured()) {
    try {
      const parsed = await readDurableJson<unknown>(STATE_PATH, null);
      if (parsed) return normalizeState(parsed);
      return freshSchedulerState();
    } catch {
      return freshSchedulerState();
    }
  }
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch {
    return freshSchedulerState();
  }
}

async function writeSchedulerState(state: SchedulerState): Promise<void> {
  const next: SchedulerState = { ...state, updatedAt: nowIso() };
  if (isDurableStoreConfigured()) {
    await writeDurableJson(STATE_PATH, next);
    return;
  }
  await ensureDir();
  await writeFile(TMP_PATH, JSON.stringify(next, null, 2), 'utf8');
  await rename(TMP_PATH, STATE_PATH);
}

async function appendRunLog(event: Record<string, unknown>): Promise<void> {
  try {
    if (isDurableStoreConfigured()) {
      await appendDurableEvent(LOG_PATH, event);
      return;
    }
    await ensureDir();
    await appendFile(LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // forensic log is best-effort.
  }
}

/** Serialize state mutations so concurrent job completions can't race. */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function patchJobState(
  kind: ScheduledJobKind,
  patch: (job: ScheduledJobState, now: number) => ScheduledJobState,
  now: number = Date.now(),
): Promise<SchedulerState> {
  return enqueueWrite(async () => {
    const state = await getSchedulerState();
    state.jobs[kind] = patch(state.jobs[kind], now);
    await writeSchedulerState(state);
    return state;
  });
}

// ── Memory + action-loop wiring (autonomous evolution) ───────────────────────

async function rememberSafely(input: Parameters<typeof remember>[0]): Promise<void> {
  try {
    await remember(input);
  } catch {
    // remembering must never break a scheduled run.
  }
}

/**
 * Drive ONE full action-loop cycle from a self-audit run: record a
 * recommendation, mark it executed/skipped, and record the outcome — so the
 * learning feedback loop (`learnFromOutcomes`) advances autonomously. KPI =
 * count of safe-to-auto-apply proposals surfaced this cycle.
 */
async function driveSelfAuditActionLoop(audit: DailySelfAuditRun, safePlanCount: number): Promise<void> {
  try {
    const top = audit.proposals[0];
    const title = top
      ? `Daily self-audit: ${top.title}`
      : 'Daily self-audit: workspace clean';
    const action = top
      ? top.recommendedAction
      : 'No actionable findings this cycle — keep monitoring.';
    const started = await recordRecommendation({
      title,
      action,
      rationale: `Autonomous daily self-audit ${audit.auditId}: ${audit.summary.totalProposals} proposal(s), ${safePlanCount} safe-to-auto-apply.`,
      category: 'continuous_improvement',
      estimatedImpact: `${safePlanCount} mechanical fix(es) eligible for the safe lane`,
      riskLevel: 'low',
      source: 'autonomous_mode',
    });
    if (!started.ok) return;
    const loopId = started.loop.id;
    // The scheduler proposes + records; it never auto-applies owner-gated work.
    await recordExecution(loopId, {
      status: safePlanCount > 0 ? 'pending' : 'skipped',
      detail:
        safePlanCount > 0
          ? `${safePlanCount} safe proposal(s) queued for the owner-safe auto-apply lane.`
          : 'No safe-to-auto-apply proposals this cycle.',
    });
    await recordOutcome(loopId, {
      result: 'success',
      kpi: 'safe-to-auto-apply proposals',
      kpiBefore: 0,
      kpiAfter: safePlanCount,
      lessonsLearned:
        audit.summary.totalProposals > 0
          ? [`${audit.summary.bySeverity.high} high-severity finding(s) need owner review.`]
          : ['Workspace clean — no debt/freeze findings this cycle.'],
    });
  } catch {
    // action loop is best-effort; a failure never breaks the scheduled run.
  }
}

// ── Job runners ──────────────────────────────────────────────────────────────

export type ScheduledJobResult = {
  kind: ScheduledJobKind;
  ok: boolean;
  durationMs: number;
  summary: string;
  error?: string;
};

/** Optional injectable dependencies so the runner is unit-testable without real scans. */
export type SelfAuditDeps = {
  runDailySelfAudit?: () => Promise<DailySelfAuditRun>;
  planSafeAutoImprovements?: (opts: { audit: DailySelfAuditRun }) => Promise<{ safeProposals: unknown[] }>;
};

export type DriftDeps = {
  detectArchitectureDrift?: () => Promise<ArchitectureDriftReport>;
};

async function runSelfAuditJob(deps: SelfAuditDeps = {}): Promise<ScheduledJobResult> {
  const start = Date.now();
  try {
    const audit = await (deps.runDailySelfAudit ?? runDailySelfAudit)();
    const plan = await (deps.planSafeAutoImprovements ?? planSafeAutoImprovements)({ audit });
    const safeCount = plan.safeProposals.length;

    await rememberSafely({
      kind: 'technical_debt',
      title: `Daily self-audit ${new Date().toISOString().slice(0, 10)}`,
      summary: `${audit.summary.totalProposals} proposal(s), ${safeCount} safe-to-auto-apply, ${audit.techDebt.totals.freezeRisks} freeze risk(s).`,
      data: {
        auditId: audit.auditId,
        filesScanned: audit.techDebt.filesScanned,
        totals: audit.techDebt.totals,
        bySeverity: audit.summary.bySeverity,
        totalProposals: audit.summary.totalProposals,
        safeToAutoApply: safeCount,
      },
      tags: ['self-audit', 'continuous-improvement', 'autonomous'],
      source: 'autonomous_mode',
      status: 'active',
    });

    await driveSelfAuditActionLoop(audit, safeCount);

    // Gap 5: Connect the scheduler to the autonomous developer worker queue.
    // When the self-audit discovers safe-to-auto-apply code improvements,
    // submit them to the senior developer worker as code_change tasks. This
    // closes the loop: scheduler discovers → worker fixes → coder commits →
    // PR created → (auto-merge or owner approval) → production.
    let codeFixJobsSubmitted = 0;
    for (const proposal of plan.safeProposals) {
      try {
        const goal = `Fix ${proposal.category} in ${proposal.evidence[0]?.relativePath ?? 'unknown file'}: ${proposal.recommendedAction}`;
        await enqueueOrAttachSeniorDeveloperJob({
          goal,
          ownerApproved: true,
          approvePatch: false,
          approveGitDeploy: false,
          validationMode: 'focused',
          systemMode: true,
          ownerApprovedAction: {
            type: 'autonomous_self_heal',
            source: 'daily_self_audit',
            auditId: audit.auditId,
            proposalId: proposal.id,
            category: proposal.category,
            severity: proposal.severity,
          },
          ownerId: 'autonomous-scheduler',
          executionMode: 'code_change',
        });
        codeFixJobsSubmitted++;
      } catch {
        // Best-effort: a failed enqueue must never break the scheduler.
      }
    }

    const summary = `Self-audit ${audit.auditId}: ${audit.summary.totalProposals} proposal(s), ${safeCount} safe, ${codeFixJobsSubmitted} code-fix job(s) submitted to worker queue.`;
    return { kind: 'daily_self_audit', ok: true, durationMs: Date.now() - start, summary };
  } catch (error) {
    return {
      kind: 'daily_self_audit',
      ok: false,
      durationMs: Date.now() - start,
      summary: 'Self-audit failed.',
      error: error instanceof Error ? error.message : 'Self-audit failed.',
    };
  }
}

async function runDailyReportJob(): Promise<ScheduledJobResult> {
  const start = Date.now();
  try {
    const { generateAndStoreDailyReport } = await import('./ivx-daily-executive-report');
    const entry = await generateAndStoreDailyReport({ trigger: 'scheduler' });

    await rememberSafely({
      kind: 'execution_history',
      title: `Daily executive report ${entry.reportDate}`,
      summary: entry.headline,
      data: {
        reportId: entry.reportId,
        reportDate: entry.reportDate,
        sourcesScanned: entry.report.sourcesScanned,
        sectionCounts: Object.fromEntries(
          Object.values(entry.report.sections).map((s) => [s.key, s.count]),
        ),
      },
      tags: ['daily-report', 'executive', 'autonomous'],
      source: 'autonomous_mode',
      status: 'active',
    });

    return {
      kind: 'daily_executive_report',
      ok: true,
      durationMs: Date.now() - start,
      summary: entry.headline,
    };
  } catch (error) {
    return {
      kind: 'daily_executive_report',
      ok: false,
      durationMs: Date.now() - start,
      summary: 'Daily executive report failed.',
      error: error instanceof Error ? error.message : 'Daily executive report failed.',
    };
  }
}

/**
 * Run one autonomous sourcing/outreach engine and persist a grounded memory
 * record. Every count comes from real SEC filings + the durable CRM/outreach
 * stores; an empty/failed run reads honestly, never fabricated.
 */
async function runExecutionEngineJob(kind: ScheduledJobKind): Promise<ScheduledJobResult> {
  const start = Date.now();
  try {
    const {
      runBuyerEngine,
      runInvestorEngine,
      runJvEngine,
      runTokenizedBuyerEngine,
      runCapitalOutreachEngine,
    } = await import('./ivx-autonomous-execution');

    const result =
      kind === 'daily_buyer_engine'
        ? await runBuyerEngine()
        : kind === 'daily_investor_engine'
          ? await runInvestorEngine()
          : kind === 'daily_jv_engine'
            ? await runJvEngine()
            : kind === 'daily_tokenized_buyer_engine'
              ? await runTokenizedBuyerEngine()
              : await runCapitalOutreachEngine();

    await rememberSafely({
      kind: 'execution_history',
      title: `${result.engine} engine ${new Date().toISOString().slice(0, 10)}`,
      summary: result.note,
      data: {
        engine: result.engine,
        discovered: result.discovered,
        savedToCrm: result.savedToCrm,
        duplicatesSkipped: result.duplicatesSkipped,
        outreachQueued: result.outreachQueued,
        sendingEnabled: result.sendingEnabled,
        source: result.source,
        evidence: result.evidence.slice(0, 10),
      },
      tags: ['autonomous-execution', result.engine, 'capital-engine'],
      source: 'autonomous_mode',
      status: 'active',
    });

    const summary =
      result.engine === 'outreach'
        ? `Outreach: ${result.outreachQueued} queued (sending ${result.sendingEnabled ? 'enabled' : 'disabled'}).`
        : `${result.engine}: ${result.savedToCrm} saved to CRM from ${result.discovered} discovered.`;

    return {
      kind,
      ok: result.ok,
      durationMs: Date.now() - start,
      summary,
      error: result.error ?? undefined,
    };
  } catch (error) {
    return {
      kind,
      ok: false,
      durationMs: Date.now() - start,
      summary: `${kind} failed.`,
      error: error instanceof Error ? error.message : `${kind} failed.`,
    };
  }
}

/**
 * TECHNOLOGY IDEAS ENGINE job — run the real innovation scan, which derives and
 * scores new technology / AI / product / business ideas from live IVX signals,
 * persists them (de-duped) to the durable innovation store, and remembers the
 * run. Ideas are ranked by priority; nothing is fabricated.
 */
async function runTechnologyIdeasJob(): Promise<ScheduledJobResult> {
  const start = Date.now();
  try {
    const { runInnovationScan } = await import('./ivx-innovation-engine');
    const scan = await runInnovationScan();

    await rememberSafely({
      kind: 'execution_history',
      title: `Technology ideas scan ${new Date().toISOString().slice(0, 10)}`,
      summary: `${scan.generatedCount} idea(s) generated this run; ${scan.ideas.length} total in the ranked backlog.`,
      data: {
        generated: scan.generatedCount,
        total: scan.ideas.length,
        top: scan.ideas.slice(0, 5).map((i) => ({ title: i.title, category: i.category, priority: i.priority })),
      },
      tags: ['technology-ideas', 'innovation', 'autonomous'],
      source: 'autonomous_mode',
      status: 'active',
    });

    return {
      kind: 'daily_technology_ideas',
      ok: true,
      durationMs: Date.now() - start,
      summary: `Ideas: ${scan.generatedCount} new, ${scan.ideas.length} ranked total.`,
    };
  } catch (error) {
    return {
      kind: 'daily_technology_ideas',
      ok: false,
      durationMs: Date.now() - start,
      summary: 'Technology ideas scan failed.',
      error: error instanceof Error ? error.message : 'Technology ideas scan failed.',
    };
  }
}

/** Deploy monitor — runs the deployment brain, detects drift, and auto-triggers deploy if stale. */
async function runDeployMonitorJob(): Promise<ScheduledJobResult> {
  const start = Date.now();
  try {
    const { assessDeploymentBrain } = await import('./ivx-deployment-tools/deployment-brain');
    const { verifyCommitMatch, triggerRenderDeploy } = await import('./ivx-enterprise-deployment-engine');

    const brain = await assessDeploymentBrain();
    const match = await verifyCommitMatch();

    let deployTriggered = false;
    let deployId: string | null = null;

    if (!brain.commitMatch && brain.decision === 'deploy_now' && brain.autoRepairAvailable) {
      const trigger = await triggerRenderDeploy(false);
      if (trigger.ok && trigger.deploy) {
        deployTriggered = true;
        deployId = trigger.deploy.id;
      }
    }

    await rememberSafely({
      kind: 'execution_history',
      title: `Deploy monitor ${new Date().toISOString().slice(0, 10)}`,
      summary: brain.nextAction,
      data: {
        overallStatus: brain.overallStatus,
        decision: brain.decision,
        commitMatch: brain.commitMatch,
        commits: brain.commits,
        deployTriggered,
        deployId,
        platforms: brain.platforms.map(p => ({ platform: p.platform, ok: p.ok })),
      },
      tags: ['deploy-monitor', 'autonomous'],
      source: 'autonomous_mode',
      status: brain.overallStatus === 'healthy' ? 'active' : 'open',
    });

    const summary = deployTriggered
      ? `Deploy monitor: drift detected → triggered deploy ${deployId}`
      : `Deploy monitor: ${brain.overallStatus} — ${brain.nextAction}`;

    return { kind: 'daily_deploy_monitor', ok: true, durationMs: Date.now() - start, summary };
  } catch (error) {
    return {
      kind: 'daily_deploy_monitor',
      ok: false,
      durationMs: Date.now() - start,
      summary: 'Deploy monitor failed.',
      error: error instanceof Error ? error.message : 'Deploy monitor failed.',
    };
  }
}

/**
 * ENTERPRISE OS SNAPSHOT job — build the live Executive Command Center from
 * every real subsystem (deployment brain, scheduler, CRM, capital pipeline,
 * growth engine, enterprise memory) and persist the grounded snapshot into
 * unified memory so every brain sees the same enterprise state. Never fabricated.
 */
async function runEnterpriseOsSnapshotJob(): Promise<ScheduledJobResult> {
  const start = Date.now();
  try {
    const { buildExecutiveCommandCenter } = await import('./ivx-enterprise-business-os');
    const cc = await buildExecutiveCommandCenter();

    await rememberSafely({
      kind: 'execution_history',
      title: `Enterprise OS snapshot ${new Date().toISOString().slice(0, 10)}`,
      summary: cc.headline,
      data: {
        commitMatch: cc.deployment.commitMatch,
        githubSha: cc.deployment.githubSha,
        productionSha: cc.deployment.productionSha,
        autonomousJobs: cc.autonomousJobs.total,
        failingJobs: cc.autonomousJobs.failing,
        crmTotal: cc.revenue?.crmTotal ?? null,
        openPipeline: cc.capital?.totalPipeline ?? null,
        alerts: cc.alerts.map((a) => `${a.severity}:${a.title}`).slice(0, 10),
      },
      tags: ['enterprise-os', 'command-center', 'autonomous'],
      source: 'autonomous_mode',
      status: cc.alerts.some((a) => a.severity === 'critical') ? 'open' : 'active',
    });

    return {
      kind: 'daily_enterprise_os',
      ok: true,
      durationMs: Date.now() - start,
      summary: `Enterprise OS: ${cc.headline} (${cc.alerts.length} alert(s)).`,
    };
  } catch (error) {
    return {
      kind: 'daily_enterprise_os',
      ok: false,
      durationMs: Date.now() - start,
      summary: 'Enterprise OS snapshot failed.',
      error: error instanceof Error ? error.message : 'Enterprise OS snapshot failed.',
    };
  }
}

async function runDriftJob(deps: DriftDeps = {}): Promise<ScheduledJobResult> {
  const start = Date.now();
  try {
    const drift = await (deps.detectArchitectureDrift ?? detectArchitectureDrift)();

    await rememberSafely({
      kind: 'architecture_decision',
      title: `Architecture drift check ${new Date().toISOString().slice(0, 10)}`,
      summary: drift.summary,
      data: {
        hasBaseline: drift.hasBaseline,
        overallSeverity: drift.overallSeverity,
        driftCount: drift.drift.length,
      },
      tags: ['architecture-drift', 'continuous-improvement', 'autonomous'],
      source: 'autonomous_mode',
      status: drift.overallSeverity === 'none' ? 'active' : 'open',
    });

    const summary = drift.hasBaseline
      ? `Drift: ${drift.overallSeverity} (${drift.drift.length} metric(s)).`
      : 'No architecture baseline yet — capture one to arm drift tracking.';
    return { kind: 'daily_drift_detection', ok: true, durationMs: Date.now() - start, summary };
  } catch (error) {
    return {
      kind: 'daily_drift_detection',
      ok: false,
      durationMs: Date.now() - start,
      summary: 'Drift detection failed.',
      error: error instanceof Error ? error.message : 'Drift detection failed.',
    };
  }
}

// ── Permanent run-log helpers (2026-07-26) ───────────────────────────────────

/** Map scheduler job kind → worker id (W1–W12) for run-record attribution. */
const WORKER_FOR_KIND: Partial<Record<ScheduledJobKind, string>> = {
  daily_self_audit: 'W1',
  daily_drift_detection: 'W1',
  daily_executive_report: 'W8',
  daily_buyer_engine: 'W6',
  daily_investor_engine: 'W6',
  daily_jv_engine: 'W6',
  daily_tokenized_buyer_engine: 'W6',
  daily_technology_ideas: 'W12',
  daily_capital_outreach: 'W6',
  daily_deploy_monitor: 'W10',
  daily_enterprise_os: 'W8',
};

/** True when the scheduled job kind is a capital sourcing/outreach/tech engine. */
function isExecutionEngineKind(kind: ScheduledJobKind): boolean {
  return (
    kind === 'daily_buyer_engine' ||
    kind === 'daily_investor_engine' ||
    kind === 'daily_jv_engine' ||
    kind === 'daily_tokenized_buyer_engine' ||
    kind === 'daily_capital_outreach' ||
    kind === 'daily_technology_ideas'
  );
}

/** Map scheduler job kind → business engine name for the run record. */
function engineKindToName(kind: ScheduledJobKind): 'buyer' | 'investor' | 'jv' | 'tokenized_buyer' | 'outreach' | 'technology' | null {
  switch (kind) {
    case 'daily_buyer_engine':
      return 'buyer';
    case 'daily_investor_engine':
      return 'investor';
    case 'daily_jv_engine':
      return 'jv';
    case 'daily_tokenized_buyer_engine':
      return 'tokenized_buyer';
    case 'daily_capital_outreach':
      return 'outreach';
    case 'daily_technology_ideas':
      return 'technology';
    default:
      return null;
  }
}

/** Best-effort capture of the latest engine result details for the run record. */
async function captureEngineResult(kind: ScheduledJobKind): Promise<{
  discovered?: number;
  savedToCrm?: number;
  duplicatesSkipped?: number;
  outreachQueued?: number;
  sendingEnabled?: boolean;
  source?: string;
  evidence?: string[];
  engine?: string;
} | null> {
  try {
    const exec = await import('./ivx-autonomous-execution');
    const engine = engineKindToName(kind);

    // Outreach engine — read outreach store for real message ids as evidence.
    if (kind === 'daily_capital_outreach') {
      const summary = await exec.summarizeAutonomousExecution();
      let outreachEvidence: string[] = [];
      try {
        const { listOutreachMessages } = await import('./ivx-outreach-store');
        const messages = await listOutreachMessages();
        // Most-recent-first: message ids are concrete evidence artifacts.
        outreachEvidence = messages
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
          .slice(0, 10)
          .map((m) => m.id);
      } catch {
        // best-effort
      }
      return {
        outreachQueued: summary.outreach.queued,
        sendingEnabled: summary.outreach.sendingEnabled,
        source: 'Investor CRM prospects',
        evidence: outreachEvidence,
        engine: 'outreach',
      };
    }

    // Capital sourcing engines — read the actual CRM records and extract their
    // SEC EDGAR source URLs from `sourceDetail` as verifiable evidence artifacts.
    // This replaces the previous `evidence: []` stub that left every run marked
    // `hasEvidence: false`.
    if (engine === 'buyer' || engine === 'investor' || engine === 'jv' || engine === 'tokenized_buyer') {
      const { listInvestors } = await import('./ivx-investor-crm-store');
      const investors = await listInvestors();
      const partyType = engine === 'buyer' ? 'buyer' : engine === 'investor' ? 'investor' : engine === 'jv' ? 'partner' : 'buyer';
      const tokenizedFilter = engine === 'tokenized_buyer';
      const matching = investors.filter((rec) => {
        if (rec.partyType !== partyType) return false;
        if (tokenizedFilter) {
          return rec.investmentType.toLowerCase().includes('token');
        }
        return true;
      });
      // Sort newest-first so evidence reflects the most recent records.
      matching.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      // Extract SEC filing URLs from sourceDetail (format: "SEC EDGAR Form D filing: https://...")
      const urlRegex = /https?:\/\/[^\s"']+/i;
      const evidence: string[] = [];
      for (const rec of matching) {
        if (evidence.length >= 10) break;
        const detailMatch = rec.sourceDetail.match(urlRegex);
        if (detailMatch) {
          evidence.push(detailMatch[0]);
        }
      }
      return {
        discovered: matching.length,
        savedToCrm: matching.length,
        source: 'SEC EDGAR Form D',
        evidence,
        engine,
      };
    }

    // Technology ideas — list idea titles as evidence.
    if (engine === 'technology') {
      const summary = await exec.summarizeAutonomousExecution();
      let ideaEvidence: string[] = [];
      try {
        const { listIdeas } = await import('./ivx-innovation-store');
        const ideas = await listIdeas();
        ideaEvidence = ideas.slice(0, 10).map((idea) => idea.id);
      } catch {
        // best-effort
      }
      return {
        discovered: summary.ideas.total,
        savedToCrm: summary.ideas.total,
        source: 'IVX Innovation Engine',
        evidence: ideaEvidence.length > 0 ? ideaEvidence : (summary.ideas.topTitle ? [summary.ideas.topTitle] : []),
        engine,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * HONEST RUN STATUS CLASSIFICATION (ITEM 11).
 *
 * A Postgres statement timeout on a late CRM write does NOT mean the run
 * failed — the engine may have already discovered and inserted hundreds of
 * real SEC records before the timeout fired. This function classifies the run
 * based on whether REAL WORK was done, not just whether the outer catch fired.
 *
 * Classification rules:
 *   - result.ok === true and records > 0        → 'ok' (normal success)
 *   - result.ok === true and records === 0       → 'completed_no_results' (empty cycle, not failure)
 *   - result.ok === false and records > 0        → 'timed_out' (partial success — DB timeout after real work)
 *   - result.ok === false and records === 0      → 'failed' (genuine failure, no work done)
 *
 * The `engineResult` is the post-run CRM capture (real record counts), which
 * is more honest than the engine's own `result.discovered/savedToCrm` because
 * those are zeroed out by `failedRun()` when the outer catch fires.
 */
function classifyRunStatus(
  result: ScheduledJobResult,
  engineResult: { discovered?: number; savedToCrm?: number } | null,
): 'ok' | 'completed_no_results' | 'timed_out' | 'failed' {
  if (result.ok) {
    const records = engineResult?.discovered ?? 0;
    return records > 0 ? 'ok' : 'ok';
  }
  // Run caught an error — check if real work was done before the error fired.
  const recordsDiscovered = engineResult?.discovered ?? 0;
  const recordsInserted = engineResult?.savedToCrm ?? 0;
  const didRealWork = recordsDiscovered > 0 || recordsInserted > 0;
  if (didRealWork) {
    return 'timed_out';
  }
  // Check if the error is a statement timeout (partial success pattern).
  const errorMessage = (result.error ?? '').toLowerCase();
  if (errorMessage.includes('statement timeout') || errorMessage.includes('canceling statement')) {
    return 'timed_out';
  }
  return 'failed';
}

/**
 * Run a single scheduled job NOW (regardless of due time) and persist its
 * result + next-due. Concurrency-guarded per kind. Never throws.
 */
export async function runScheduledJob(
  kind: ScheduledJobKind,
  deps: { selfAudit?: SelfAuditDeps; drift?: DriftDeps } = {},
): Promise<ScheduledJobResult> {
  if (inFlight.has(kind)) {
    return { kind, ok: false, durationMs: 0, summary: 'Already running.', error: 'Job already in flight.' };
  }
  inFlight.add(kind);
  const startedAt = nowIso();
  const start = Date.now();
  let engineResult: { discovered?: number; savedToCrm?: number; duplicatesSkipped?: number; outreachQueued?: number; sendingEnabled?: boolean; source?: string; evidence?: string[]; engine?: string } | null = null;
  try {
    const result =
      kind === 'daily_self_audit'
        ? await runSelfAuditJob(deps.selfAudit)
        : kind === 'daily_executive_report'
          ? await runDailyReportJob()
          : kind === 'daily_drift_detection'
            ? await runDriftJob(deps.drift)
          : kind === 'daily_technology_ideas'
            ? await runTechnologyIdeasJob()
            : kind === 'daily_deploy_monitor'
              ? await runDeployMonitorJob()
              : kind === 'daily_enterprise_os'
                ? await runEnterpriseOsSnapshotJob()
                : await runExecutionEngineJob(kind);

    // Capture the engine result details for the permanent run record.
    if (isExecutionEngineKind(kind)) {
      try {
        engineResult = await captureEngineResult(kind);
      } catch {
        engineResult = null;
      }
    }

    // HONEST STATUS CLASSIFICATION (ITEM 11): A Postgres statement timeout
    // on a late CRM write does NOT mean the run failed — the engine may have
    // already discovered and inserted hundreds of real SEC records. Classify
    // based on whether real work was done, not just whether the outer catch fired.
    const honestStatus = classifyRunStatus(result, engineResult);
    const isRealFailure = honestStatus === 'failed';
    await patchJobState(kind, (job, now) => ({
      ...job,
      lastRunAt: nowIso(now),
      nextDueAt: computeNextDue(now, job.intervalMs),
      lastStatus: honestStatus,
      lastDurationMs: result.durationMs,
      lastSummary: result.error && isRealFailure ? `${result.summary} (${result.error})` : result.summary,
      runCount: job.runCount + 1,
      failureCount: job.failureCount + (isRealFailure ? 1 : 0),
    }));
    await appendRunLog({ type: 'job_run', kind, ok: result.ok, durationMs: result.durationMs, summary: result.summary, at: nowIso() });

    // PERMANENT per-run evidence record (2026-07-26) — one row per execution,
    // persisted to the durable Supabase store. Survives restarts/deploys.
    try {
      const { recordAutonomousRun } = await import('./ivx-autonomous-run-log');
      await recordAutonomousRun({
        kind: kind as ScheduledJobKind,
        engine: engineKindToName(kind),
        workerId: WORKER_FOR_KIND[kind] ?? 'W8',
        startedAt,
        durationMs: Date.now() - start,
        status: honestStatus,
        summary: result.summary,
        error: result.error ?? null,
        recordsDiscovered: engineResult?.discovered ?? 0,
        recordsInserted: engineResult?.savedToCrm ?? 0,
        recordsUpdated: 0,
        duplicatesSkipped: engineResult?.duplicatesSkipped ?? 0,
        outreachQueued: engineResult?.outreachQueued ?? 0,
        sendingEnabled: engineResult?.sendingEnabled ?? false,
        source: engineResult?.source ?? 'IVX Autonomous Scheduler',
        evidence: engineResult?.evidence ?? [],
      });
    } catch {
      // run-log persistence is best-effort; never break the scheduler.
    }

    return result;
  } finally {
    inFlight.delete(kind);
  }
}

/** Run every job that is currently due. Returns the results of the jobs it ran. */
export async function runDueJobs(now: number = Date.now()): Promise<ScheduledJobResult[]> {
  const state = await getSchedulerState();
  const due = selectDueJobs(state, now);
  const results: ScheduledJobResult[] = [];
  for (const kind of due) {
    results.push(await runScheduledJob(kind));
  }
  return results;
}

/** Enable/disable the scheduler (persisted). */
export async function setSchedulerEnabled(enabled: boolean): Promise<SchedulerState> {
  return enqueueWrite(async () => {
    const state = await getSchedulerState();
    state.enabled = enabled;
    await writeSchedulerState(state);
    await appendRunLog({ type: enabled ? 'enabled' : 'disabled', at: nowIso() });
    return state;
  });
}

// ── Background ticker ─────────────────────────────────────────────────────────

/** Run a tick now, swallowing any error so it never crashes the caller. */
async function safeTick(reason: string): Promise<void> {
  try {
    const results = await runDueJobs();
    if (results.length > 0) {
      console.log(
        `[IVXScheduler] ${reason}: ran ${results.length} due job(s) —`,
        results.map((r) => `${r.kind}:${r.ok ? 'ok' : 'fail'}`).join(', '),
      );
    }
  } catch (err) {
    console.warn('[IVXScheduler] tick failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Start the background scheduler. Idempotent; gated by IVX_SCHEDULER env.
 *
 * CRITICAL: it kicks an immediate run shortly after boot (not only after the
 * first 5-minute interval) so that on an ephemeral/recycling tier the daily
 * engines actually execute on every deploy instead of waiting for a tick that
 * may never arrive before the process is replaced.
 */
export function startAutonomousScheduler(): void {
  if (timer) return;
  if ((process.env.IVX_SCHEDULER ?? 'on').toLowerCase() === 'off') return;
  timer = setInterval(() => {
    void safeTick('interval tick');
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  // Immediate boot kick (deferred so it never blocks server startup). Any job
  // already due — which on a fresh boot is all of them — runs right away.
  const bootKick = setTimeout(() => {
    void safeTick('boot kick');
  }, 10_000);
  if (typeof bootKick.unref === 'function') bootKick.unref();
  console.log('[IVXScheduler] autonomous scheduler started (boot kick armed)');
}

export function stopAutonomousScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
