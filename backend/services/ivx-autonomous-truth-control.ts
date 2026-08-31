import { getAllExecutionStates, pauseAgent, resumeAgent, disableAgent, enableAgent } from './ivx-agent-runtime';
import {
  campaignDispatcherControl,
  getCampaignDispatcherSnapshot,
  listCampaignDispatcherRecords,
  runCampaignBootRecovery,
  startCampaignDispatcher,
} from './ivx-campaign-dispatcher';
import { syncCampaignAssignmentsToDispatcher } from './ivx-app-completion-campaign';
import { getGitHubActionsExternalSupervisorStatus } from './ivx-github-actions-external-supervisor';
import { getSchedulerState } from './ivx-autonomous-scheduler';

export const IVX_AUTONOMOUS_TRUTH_CONTROL_MARKER = 'ivx-autonomous-truth-control-2026-08-30-v3';
const HEARTBEAT_FRESH_MS = 10 * 60 * 1000;

export type TruthControlAction =
  | 'start_all'
  | 'stop_all'
  | 'pause_all'
  | 'resume_all'
  | 'pause_agent'
  | 'resume_agent'
  | 'disable_agent'
  | 'enable_agent'
  | 'retry_agent';

function heartbeatFresh(value: string | null): boolean {
  if (!value) return false;
  const ts = Date.parse(value);
  return Number.isFinite(ts) && Date.now() - ts <= HEARTBEAT_FRESH_MS;
}

export async function getAutonomousTruthSnapshot() {
  startCampaignDispatcher();
  const [dispatcher, scheduler, dispatcherRecords] = await Promise.all([
    getCampaignDispatcherSnapshot(),
    getSchedulerState().catch(() => null),
    listCampaignDispatcherRecords(),
  ]);
  const github = getGitHubActionsExternalSupervisorStatus();
  const states = getAllExecutionStates();
  const runningByAgent = new Map<number, typeof dispatcherRecords[number]>();
  for (const record of dispatcherRecords) {
    if (record.status === 'RUNNING' && record.workerJobId) runningByAgent.set(record.agentNumber, record);
  }

  const agents = states.map((state) => {
    const runtimeHeartbeatFresh = heartbeatFresh(state.lastHeartbeat);
    const dispatcherRecord = runningByAgent.get(state.agentNumber);
    const dispatcherHeartbeatFresh = heartbeatFresh(dispatcherRecord?.lastHeartbeatAt ?? null);
    const runtimeWorking = state.availability === 'busy' && Boolean(state.activeTaskId) && runtimeHeartbeatFresh;
    const dispatcherWorking = Boolean(dispatcherRecord?.workerJobId && dispatcherRecord.status === 'RUNNING' && dispatcherHeartbeatFresh);
    const actuallyWorking = runtimeWorking || dispatcherWorking;
    const blocked = state.pauseState || state.disabledState || state.availability === 'offline' || state.health === 'failed';
    const idle = !actuallyWorking && !blocked && state.availability === 'available';
    return {
      agentId: state.agentId,
      agentNumber: state.agentNumber,
      status: actuallyWorking ? 'WORKING' : blocked ? 'BLOCKED' : idle ? 'IDLE' : 'UNKNOWN',
      actuallyWorking,
      proofSource: runtimeWorking ? 'agent_runtime' : dispatcherWorking ? 'campaign_dispatcher' : null,
      activeTaskId: state.activeTaskId ?? dispatcherRecord?.workerJobId ?? null,
      dutyId: dispatcherRecord?.dutyId ?? null,
      module: dispatcherRecord?.module ?? null,
      workerJobId: dispatcherRecord?.workerJobId ?? null,
      workerStatus: dispatcherRecord?.workerStatus ?? null,
      availability: state.availability,
      health: state.health,
      queueDepth: state.queueDepth,
      paused: state.pauseState,
      disabled: state.disabledState,
      lastHeartbeat: state.lastHeartbeat,
      dispatcherHeartbeat: dispatcherRecord?.lastHeartbeatAt ?? null,
      heartbeatFresh: runtimeHeartbeatFresh || dispatcherHeartbeatFresh,
      totalRuns: state.totalRuns,
      successfulRuns: state.successfulRuns,
      failedRuns: state.failedRuns,
      evidenceCount: state.evidenceCount,
    };
  });

  const counts = {
    total: agents.length,
    working: agents.filter((a) => a.status === 'WORKING').length,
    idle: agents.filter((a) => a.status === 'IDLE').length,
    blocked: agents.filter((a) => a.status === 'BLOCKED').length,
    unknown: agents.filter((a) => a.status === 'UNKNOWN').length,
    freshHeartbeat: agents.filter((a) => a.heartbeatFresh).length,
  };

  const autonomousWorking = Boolean(
    scheduler?.enabled
    && !dispatcher.paused
    && !dispatcher.emergencyStop
    && (dispatcher.totals.running > 0 || dispatcher.totals.queued > 0),
  );

  const totalDevelopmentJobs =
    dispatcher.totals.pendingOwner
    + dispatcher.totals.awaitingImplement
    + dispatcher.totals.queued
    + dispatcher.totals.running
    + dispatcher.totals.completed
    + dispatcher.totals.failed
    + dispatcher.totals.blocked;
  const completionPercent = totalDevelopmentJobs > 0
    ? Math.round((dispatcher.totals.completed / totalDevelopmentJobs) * 10000) / 100
    : 0;
  const activeAgentPercent = agents.length > 0
    ? Math.round((counts.working / agents.length) * 10000) / 100
    : 0;

  return {
    ok: agents.length === 112,
    marker: IVX_AUTONOMOUS_TRUTH_CONTROL_MARKER,
    generatedAt: new Date().toISOString(),
    truthPolicy: {
      workingRequiresOneOf: [
        'agent runtime busy + activeTaskId + heartbeat <=10m',
        'dispatcher RUNNING + real workerJobId + dispatcher heartbeat <=10m',
      ],
      noInferenceFromGithubActions: true,
      noSyntheticWorkingStatus: true,
    },
    autonomous: {
      working: autonomousWorking,
      schedulerEnabled: Boolean(scheduler?.enabled),
      dispatcherPaused: dispatcher.paused,
      emergencyStop: dispatcher.emergencyStop,
      runningJobs: dispatcher.totals.running,
      queuedJobs: dispatcher.totals.queued,
      completedJobs: dispatcher.totals.completed,
      failedJobs: dispatcher.totals.failed,
      blockedJobs: dispatcher.totals.blocked,
      maxConcurrency: dispatcher.maxConcurrency,
    },
    developmentProgress: {
      totalJobs: totalDevelopmentJobs,
      pendingOwner: dispatcher.totals.pendingOwner,
      awaitingImplement: dispatcher.totals.awaitingImplement,
      queued: dispatcher.totals.queued,
      running: dispatcher.totals.running,
      completed: dispatcher.totals.completed,
      failed: dispatcher.totals.failed,
      blocked: dispatcher.totals.blocked,
      completionPercent,
      activeAgentPercent,
    },
    agents: { counts, rows: agents },
    github: github ? {
      checkedAt: github.checkedAt,
      queued: github.queued,
      inProgress: github.inProgress,
      storm: github.storm,
      error: github.error,
    } : null,
  };
}

export async function applyTruthControl(action: TruthControlAction, agentId?: string, agentNumber?: number) {
  if (action === 'start_all' || action === 'resume_all') {
    startCampaignDispatcher();
    await runCampaignBootRecovery().catch(() => 0);
    await syncCampaignAssignmentsToDispatcher();
    for (const state of getAllExecutionStates()) resumeAgent(state.agentId);
    await campaignDispatcherControl('resume_all');
  } else if (action === 'stop_all') {
    for (const state of getAllExecutionStates()) pauseAgent(state.agentId);
    await campaignDispatcherControl('stop_all');
  } else if (action === 'pause_all') {
    for (const state of getAllExecutionStates()) pauseAgent(state.agentId);
    await campaignDispatcherControl('pause_all');
  } else {
    if (!agentId && typeof agentNumber !== 'number') throw new Error('agentId or agentNumber required');
    const state = getAllExecutionStates().find((row) => row.agentId === agentId || row.agentNumber === agentNumber);
    if (!state) throw new Error('agent not found');
    if (action === 'pause_agent') pauseAgent(state.agentId);
    if (action === 'resume_agent') resumeAgent(state.agentId);
    if (action === 'disable_agent') disableAgent(state.agentId);
    if (action === 'enable_agent') enableAgent(state.agentId);
    if (action === 'retry_agent') await campaignDispatcherControl('retry_agent', state.agentNumber);
  }
  return getAutonomousTruthSnapshot();
}
