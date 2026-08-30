import { getSchedulerState } from './ivx-autonomous-scheduler';
import { getGitHubActionsExternalSupervisorStatus } from './ivx-github-actions-external-supervisor';
import { getCampaignDispatcherSnapshot, runCampaignBootRecovery, startCampaignDispatcher } from './ivx-campaign-dispatcher';

export const IVX_AUTONOMOUS_LIVE_BOOTSTRAP_MARKER = 'ivx-autonomous-live-bootstrap-2026-08-30';

let booted = false;
let bootAt: string | null = null;
let bootError: string | null = null;

export function startAutonomousLiveBootstrap(): void {
  if (booted) return;
  booted = true;
  bootAt = new Date().toISOString();
  startCampaignDispatcher();
  void runCampaignBootRecovery().catch((error) => {
    bootError = error instanceof Error ? error.message : String(error);
    console.warn('[IVX Autonomous Live Bootstrap] campaign recovery failed', { error: bootError });
  });
}

export async function getAutonomousLiveBootstrapStatus() {
  const [scheduler, dispatcher] = await Promise.all([
    getSchedulerState().catch(() => null),
    getCampaignDispatcherSnapshot().catch(() => null),
  ]);
  const github = getGitHubActionsExternalSupervisorStatus();
  return {
    ok: Boolean(booted && scheduler?.enabled && dispatcher),
    marker: IVX_AUTONOMOUS_LIVE_BOOTSTRAP_MARKER,
    booted,
    bootAt,
    bootError,
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
