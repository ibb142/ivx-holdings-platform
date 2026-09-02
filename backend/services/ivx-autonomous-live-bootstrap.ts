import { getSchedulerState } from './ivx-autonomous-scheduler';
import { getGitHubActionsExternalSupervisorStatus } from './ivx-github-actions-external-supervisor';
import { syncCampaignAssignmentsToDispatcher } from './ivx-app-completion-campaign';
import { getCampaignDispatcherSnapshot, runCampaignBootRecovery, startCampaignDispatcher } from './ivx-campaign-dispatcher';

export const IVX_AUTONOMOUS_LIVE_BOOTSTRAP_MARKER = 'ivx-autonomous-live-bootstrap-2026-09-02-auto-feed';

const DISPATCHER_FEED_INTERVAL_MS = 30_000;
let booted = false;
let bootAt: string | null = null;
let bootError: string | null = null;
let feedTimer: ReturnType<typeof setInterval> | null = null;
let lastFeedAt: string | null = null;
let lastFeedError: string | null = null;

async function feedDispatcher(reason: 'boot' | 'interval'): Promise<void> {
  try {
    await syncCampaignAssignmentsToDispatcher();
    await runCampaignBootRecovery();
    startCampaignDispatcher();
    lastFeedAt = new Date().toISOString();
    lastFeedError = null;
    console.log('[IVX Autonomous Live Bootstrap] dispatcher fed', { reason, lastFeedAt });
  } catch (error) {
    lastFeedError = error instanceof Error ? error.message : String(error);
    if (reason === 'boot') bootError = lastFeedError;
    console.warn('[IVX Autonomous Live Bootstrap] dispatcher feed failed', { reason, error: lastFeedError });
  }
}

export function startAutonomousLiveBootstrap(): void {
  if (booted) return;
  booted = true;
  bootAt = new Date().toISOString();
  startCampaignDispatcher();
  void feedDispatcher('boot');
  feedTimer = setInterval(() => { void feedDispatcher('interval'); }, DISPATCHER_FEED_INTERVAL_MS);
  feedTimer.unref?.();
}

export async function getAutonomousLiveBootstrapStatus() {
  const [scheduler, dispatcher] = await Promise.all([
    getSchedulerState().catch(() => null),
    getCampaignDispatcherSnapshot().catch(() => null),
  ]);
  const github = getGitHubActionsExternalSupervisorStatus();
  return {
    ok: Boolean(booted && scheduler?.enabled && dispatcher && !lastFeedError),
    marker: IVX_AUTONOMOUS_LIVE_BOOTSTRAP_MARKER,
    booted,
    bootAt,
    bootError,
    dispatcherAutoFeed: {
      running: Boolean(feedTimer),
      intervalMs: DISPATCHER_FEED_INTERVAL_MS,
      lastFeedAt,
      lastFeedError,
    },
    totalAgents: 112,
    autonomousScheduler: scheduler ? {
      enabled: scheduler.enabled,
      startedAt: scheduler.startedAt,
      updatedAt: scheduler.updatedAt,
      jobs: Object.values(scheduler.jobs).map((job) => ({ kind: job.kind, intervalMs: job.intervalMs, lastRunAt: job.lastRunAt, nextDueAt: job.nextDueAt, lastStatus: job.lastStatus })),
    } : null,
    dispatcher: dispatcher ? {
      maxConcurrency: dispatcher.maxConcurrency,
      paused: dispatcher.paused,
      emergencyStop: dispatcher.emergencyStop,
      totals: dispatcher.totals,
      utilization24h: dispatcher.utilization24h,
    } : null,
    githubSupervisor: github ? {
      checkedAt: github.checkedAt,
      queued: github.queued,
      inProgress: github.inProgress,
      storm: github.storm,
      cancelledRunIds: github.cancelledRunIds,
      error: github.error,
      organism: github.organism,
    } : null,
  };
}
