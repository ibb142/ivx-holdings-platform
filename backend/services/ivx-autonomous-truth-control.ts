import { checkEmergencyStop } from './ivx-emergency-stop-gate';
import { getAllExecutionStates, pauseAgent, resumeAgent, disableAgent, enableAgent } from './ivx-agent-runtime';
import {
  campaignDispatcherControl,
  getCampaignDispatcherSnapshot,
  listCampaignDispatcherRecords,
  runCampaignBootRecovery,
  startCampaignDispatcher,
} from './ivx-campaign-dispatcher';
import { loadControlState, syncCampaignAssignmentsToDispatcher, updateControlState } from './ivx-app-completion-campaign';
import { getGitHubActionsExternalSupervisorStatus } from './ivx-github-actions-external-supervisor';
import { getSchedulerState, setSchedulerEnabled } from './ivx-autonomous-scheduler';
import {
  activeFleetMutationAuthorityCount,
  autonomousQueueBackend,
  autonomousRepairCapacity,
  autonomousRuntimeEnforcerEnabled,
} from './ivx-autonomous-control-policy';
import { evaluateFleetActivationEvidence } from './ivx-project-vision';
import { readPostgresFleetLeaseRows, type AtomicFleetLeaseRow } from './ivx-postgres-autonomous-task-store';

export const IVX_AUTONOMOUS_TRUTH_CONTROL_MARKER = 'ivx-autonomous-truth-control-2026-09-07-v14-postgres-lease-truth';
export const IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS = 60 * 1000;
export const IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS = 30 * 1000;
export const IVX_AUTONOMOUS_CASCADE_SEED_SIZE = 10;
export const IVX_AUTONOMOUS_CASCADE_FANOUT = 10;
export const IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS = 2_500;
export const IVX_AUTONOMOUS_ALWAYS_ON_24X7 = process.env.IVX_AUTONOMOUS_ALWAYS_ON_24X7 !== 'false';
let recoveryCursor = 0;

export type TruthControlAction = 'start_all' | 'stop_all' | 'pause_all' | 'resume_all' | 'pause_agent' | 'resume_agent' | 'disable_agent' | 'enable_agent' | 'retry_agent';
type BoundedDependency<T> = { value: T | null; error: string | null };

function heartbeatAgeMs(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : null;
}

function heartbeatFresh(value: string | null): boolean {
  const age = heartbeatAgeMs(value);
  return age !== null && age <= IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS;
}

function leaseFresh(row: AtomicFleetLeaseRow): boolean {
  if (!heartbeatFresh(row.lastHeartbeatAt)) return false;
  if (!row.leaseExpiresAt) return true;
  const expiresAt = Date.parse(row.leaseExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

async function boundedDependency<T>(label: string, task: Promise<T>, budgetMs = IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS): Promise<BoundedDependency<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label}_timeout_${budgetMs}ms`)),
        budgetMs,
      );
    });
    return { value: await Promise.race([task, timeout]), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[IVXAutonomousTruth] dependency degraded:', { label, message: message.slice(0, 220) });
    return { value: null, error: message.slice(0, 220) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveAtomicLeaseAgentNumber(
  row: AtomicFleetLeaseRow,
  stateById: Map<string, ReturnType<typeof getAllExecutionStates>[number]>,
): number | null {
  // Canonical fleet proof is bound to the logical worker that actually holds
  // the lease. An assigned agent number alone is planning metadata and cannot
  // prove that the assigned IA claimed or is executing the task.
  if (!row.leaseHolder.startsWith('agent:')) return null;
  const agentId = row.leaseHolder.slice('agent:'.length);
  const runtimeState = stateById.get(agentId);
  if (!runtimeState) return null;
  if (row.assignedAgentNumber !== null && row.assignedAgentNumber !== runtimeState.agentNumber) return null;
  return runtimeState.agentNumber;
}

async function cascadeStartAllAgents(): Promise<{ seedAgents: number[]; activated: number[]; waves: number[][] }> {
  const states = [...getAllExecutionStates()].sort((a, b) => a.agentNumber - b.agentNumber);
  const eligible = states.filter((state) => !state.disabledState);
  const activated = new Set<number>();
  const waves: number[][] = [];
  const seedAgents = eligible.slice(0, IVX_AUTONOMOUS_CASCADE_SEED_SIZE).map((state) => state.agentNumber);
  let frontier = [...seedAgents];
  while (frontier.length > 0 && activated.size < eligible.length) {
    const wave: number[] = [];
    for (const parentNumber of frontier) {
      const parent = eligible.find((state) => state.agentNumber === parentNumber);
      if (parent && !activated.has(parentNumber)) {
        resumeAgent(parent.agentId);
        await campaignDispatcherControl('retry_agent', parentNumber).catch(() => undefined);
        activated.add(parentNumber);
        wave.push(parentNumber);
      }
      const children = eligible
        .filter((state) => !activated.has(state.agentNumber) && !frontier.includes(state.agentNumber))
        .slice(0, IVX_AUTONOMOUS_CASCADE_FANOUT);
      for (const child of children) {
        resumeAgent(child.agentId);
        await campaignDispatcherControl('retry_agent', child.agentNumber).catch(() => undefined);
        activated.add(child.agentNumber);
        wave.push(child.agentNumber);
      }
    }
    if (wave.length === 0) break;
    waves.push(wave);
    frontier = wave.filter((number) => !seedAgents.includes(number));
  }
  for (const state of eligible) {
    if (activated.has(state.agentNumber)) continue;
    resumeAgent(state.agentId);
    await campaignDispatcherControl('retry_agent', state.agentNumber).catch(() => undefined);
    activated.add(state.agentNumber);
    waves.push([state.agentNumber]);
  }
  await campaignDispatcherControl('resume_all');
  return { seedAgents, activated: [...activated].sort((a, b) => a - b), waves };
}

export async function getAutonomousTruthSnapshot() {
  const configuredQueueBackend = autonomousQueueBackend();
  const atomicQueueSelected = configuredQueueBackend === 'postgres_atomic';
  const atomicRuntimeControlPlane = atomicQueueSelected && autonomousRuntimeEnforcerEnabled();
  const [dispatcherResult, schedulerResult, dispatcherRecordsResult, atomicLeasesResult, ownerControlResult, emergencyResult] = await Promise.all([
    atomicRuntimeControlPlane
      ? Promise.resolve({ value: null, error: null })
      : boundedDependency('dispatcher_snapshot', Promise.resolve(getCampaignDispatcherSnapshot())),
    atomicRuntimeControlPlane
      ? Promise.resolve({ value: null, error: null })
      : boundedDependency('scheduler_state', Promise.resolve(getSchedulerState())),
    atomicRuntimeControlPlane
      ? Promise.resolve({ value: [] as Awaited<ReturnType<typeof listCampaignDispatcherRecords>>, error: null })
      : boundedDependency('dispatcher_records', Promise.resolve(listCampaignDispatcherRecords())),
    atomicQueueSelected
      ? boundedDependency('postgres_atomic_leases', readPostgresFleetLeaseRows(), 30_000)
      : Promise.resolve({ value: [] as AtomicFleetLeaseRow[], error: null }),
    boundedDependency('owner_control', loadControlState({ required: true })),
    boundedDependency('emergency_stop', checkEmergencyStop()),
  ]);
  const ownerControl = ownerControlResult.value;
  const ownerControlVerified = Boolean(ownerControl && !ownerControlResult.error
    && emergencyResult.value && emergencyResult.value.source !== 'unavailable' && !emergencyResult.error);
  const dispatcher = dispatcherResult.value ?? {
    paused: !atomicRuntimeControlPlane,
    emergencyStop: false,
    totals: { pendingOwner: 0, awaitingImplement: 0, queued: 0, running: 0, completed: 0, failed: 0, blocked: 0 },
    maxConcurrency: atomicRuntimeControlPlane ? autonomousRepairCapacity() : 0,
  };
  // Atomic workers must observe the same durable owner intent as the dashboard.
  // Unavailable control stops new work without claiming that the owner pressed stop.
  const dispatcherPaused = dispatcher.paused || !ownerControlVerified || Boolean(ownerControl?.paused || ownerControl?.stopped);
  const emergencyStop = dispatcher.emergencyStop || Boolean(emergencyResult.value?.active || ownerControl?.stopped);
  const scheduler = schedulerResult.value;
  const dispatcherRecords = dispatcherRecordsResult.value ?? [];
  const atomicLeaseRows = atomicLeasesResult.value ?? [];
  const degradedDependencies = [
    !atomicRuntimeControlPlane && dispatcherResult.error ? 'dispatcher_snapshot' : null,
    !atomicRuntimeControlPlane && schedulerResult.error ? 'scheduler_state' : null,
    !atomicRuntimeControlPlane && dispatcherRecordsResult.error ? 'dispatcher_records' : null,
    atomicQueueSelected && atomicLeasesResult.error ? 'postgres_atomic_leases' : null,
    ownerControlResult.error || !ownerControl ? 'owner_control' : null,
    emergencyResult.error || !emergencyResult.value || emergencyResult.value.source === 'unavailable' ? 'emergency_stop' : null,
  ].filter((value): value is string => Boolean(value));

  const github = getGitHubActionsExternalSupervisorStatus();
  const states = getAllExecutionStates();
  const stateById = new Map(states.map((state) => [state.agentId, state]));
  const runningByAgent = new Map<number, (typeof dispatcherRecords)[number]>();
  for (const record of dispatcherRecords) {
    if (record.status === 'RUNNING' && record.workerJobId) runningByAgent.set(record.agentNumber, record);
  }
  const atomicByAgent = new Map<number, AtomicFleetLeaseRow>();
  for (const row of atomicLeaseRows) {
    const agentNumber = resolveAtomicLeaseAgentNumber(row, stateById);
    if (agentNumber == null) continue;
    const previous = atomicByAgent.get(agentNumber);
    if (!previous || Date.parse(row.lastHeartbeatAt) > Date.parse(previous.lastHeartbeatAt)) atomicByAgent.set(agentNumber, row);
  }

  const agents = states.map((state) => {
    const runtimeAgeMs = heartbeatAgeMs(state.lastHeartbeat);
    const runtimeHeartbeatFresh = heartbeatFresh(state.lastHeartbeat);
    const dispatcherRecord = runningByAgent.get(state.agentNumber);
    const dispatcherHeartbeat = dispatcherRecord?.lastHeartbeatAt ?? null;
    const dispatcherAgeMs = heartbeatAgeMs(dispatcherHeartbeat);
    const dispatcherHeartbeatFresh = heartbeatFresh(dispatcherHeartbeat);
    const taskLease = atomicByAgent.get(state.agentNumber) ?? null;
    const taskEngineHeartbeat = taskLease?.lastHeartbeatAt ?? null;
    const taskEngineAgeMs = heartbeatAgeMs(taskEngineHeartbeat);
    const taskEngineWorking = Boolean(
      atomicQueueSelected && taskLease && taskLease.workerInstanceId && leaseFresh(taskLease),
    );
    const runtimeWorking = state.availability === 'busy' && Boolean(state.activeTaskId) && runtimeHeartbeatFresh;
    const dispatcherWorking = Boolean(dispatcherRecord?.workerJobId && dispatcherRecord.status === 'RUNNING' && dispatcherHeartbeatFresh);
    const ownerPaused = dispatcherPaused || Boolean(ownerControl?.pausedAgents.includes(state.agentNumber) || ownerControl?.stoppedAgents.includes(state.agentNumber));
    const blocked = ownerPaused || emergencyStop || state.pauseState || state.disabledState || state.availability === 'offline' || state.health === 'failed';
    const actuallyWorking = !blocked && (taskEngineWorking || runtimeWorking || dispatcherWorking);
    const hasClaimedWork = Boolean(taskLease?.taskId || state.activeTaskId || dispatcherRecord?.workerJobId);
    // A registry/global heartbeat without claimed work is not work proof.
    const anyHeartbeatFresh = actuallyWorking;
    const stale = !actuallyWorking && !blocked && hasClaimedWork && !anyHeartbeatFresh;
    const idle = !actuallyWorking && !blocked && !stale && state.availability === 'available';
    const ages = [taskEngineAgeMs, runtimeAgeMs, dispatcherAgeMs].filter((age): age is number => age !== null);
    return {
      agentId: state.agentId,
      agentNumber: state.agentNumber,
      status: blocked ? 'BLOCKED' : actuallyWorking ? 'WORKING' : stale ? 'STALE' : idle ? 'IDLE' : 'UNKNOWN',
      actuallyWorking,
      proofSource: taskEngineWorking ? 'postgres_atomic_task' : runtimeWorking ? 'agent_runtime' : dispatcherWorking ? 'campaign_dispatcher' : null,
      activeTaskId: taskLease?.taskId ?? state.activeTaskId ?? dispatcherRecord?.workerJobId ?? null,
      dutyId: dispatcherRecord?.dutyId ?? null,
      module: dispatcherRecord?.module ?? null,
      workerJobId: dispatcherRecord?.workerJobId ?? null,
      workerStatus: dispatcherRecord?.workerStatus ?? null,
      workerInstanceId: taskLease?.workerInstanceId ?? null,
      availability: state.availability,
      health: state.health,
      queueDepth: state.queueDepth,
      paused: state.pauseState || ownerPaused,
      disabled: state.disabledState,
      lastHeartbeat: state.lastHeartbeat,
      dispatcherHeartbeat,
      taskEngineHeartbeat,
      heartbeatFresh: anyHeartbeatFresh,
      heartbeatAgeMs: ages.length ? Math.min(...ages) : null,
      totalRuns: state.totalRuns,
      successfulRuns: state.successfulRuns,
      failedRuns: state.failedRuns,
      evidenceCount: state.evidenceCount,
    };
  });
  const counts = {
    total: agents.length,
    working: agents.filter((agent) => agent.status === 'WORKING').length,
    idle: agents.filter((agent) => agent.status === 'IDLE').length,
    blocked: agents.filter((agent) => agent.status === 'BLOCKED').length,
    stale: agents.filter((agent) => agent.status === 'STALE').length,
    unknown: agents.filter((agent) => agent.status === 'UNKNOWN').length,
    freshHeartbeat: agents.filter((agent) => agent.heartbeatFresh).length,
  };

  const registeredAgentNumbers = new Set(states.map((state) => state.agentNumber));
  const eligibleAgentNumbers = new Set(agents
    .filter((state) => !state.paused && !state.disabled && state.availability !== 'offline' && state.health !== 'failed')
    .map((state) => state.agentNumber));
  const canonicalRows = atomicLeaseRows.filter((row) => {
    if (!row.workerInstanceId || !leaseFresh(row)) return false;
    const agentNumber = resolveAtomicLeaseAgentNumber(row, stateById);
    return agentNumber !== null && registeredAgentNumbers.has(agentNumber) && eligibleAgentNumbers.has(agentNumber);
  });
  const canonicalAgentNumbers = new Set(
    canonicalRows
      .map((row) => resolveAtomicLeaseAgentNumber(row, stateById))
      .filter((agentNumber): agentNumber is number => agentNumber !== null),
  );
  const distinctActiveAgents = canonicalAgentNumbers.size;
  const distinctActiveLeases = new Set(canonicalRows.map((row) => row.taskId)).size;
  const freshHeartbeats = canonicalAgentNumbers.size;
  const knownWorkerIdentities = new Set(
    canonicalRows.map((row) => row.workerInstanceId).filter((identity): identity is string => Boolean(identity)),
  ).size;
  const provenQueueBackend = atomicQueueSelected
    ? (atomicLeasesResult.error ? 'postgres_atomic_unavailable' : 'postgres_atomic')
    : configuredQueueBackend;
  const deployedConcurrency = atomicRuntimeControlPlane
    ? autonomousRepairCapacity()
    : Math.min(dispatcher.maxConcurrency, autonomousRepairCapacity());
  const fleetActivationGate = evaluateFleetActivationEvidence({
    registeredAgents: agents.length,
    distinctActiveAgents,
    distinctActiveLeases,
    freshHeartbeats,
    knownWorkerIdentities,
    deployedConcurrency,
    mutationAuthorities: activeFleetMutationAuthorityCount(),
    queueBackend: provenQueueBackend,
    staleAgents: counts.stale,
    blockedAgents: counts.blocked,
    emergencyStop,
  });
  const schedulerEnabled = atomicRuntimeControlPlane || Boolean(scheduler?.enabled);
  const autonomousWorking = Boolean(
    schedulerEnabled && !dispatcherPaused && !emergencyStop
    && (dispatcher.totals.running > 0 || dispatcher.totals.queued > 0 || counts.working > 0),
  );
  const continuousRuntimeCertified = degradedDependencies.length === 0
    && counts.unknown === 0 && autonomousWorking && fleetActivationGate.certified;
  const totalDevelopmentJobs = dispatcher.totals.pendingOwner + dispatcher.totals.awaitingImplement
    + dispatcher.totals.queued + dispatcher.totals.running + dispatcher.totals.completed
    + dispatcher.totals.failed + dispatcher.totals.blocked;
  const completionPercent = totalDevelopmentJobs > 0
    ? Math.round((dispatcher.totals.completed / totalDevelopmentJobs) * 10_000) / 100 : 0;
  const activeAgentPercent = agents.length > 0 ? Math.round((distinctActiveAgents / agents.length) * 10_000) / 100 : 0;

  return {
    ok: continuousRuntimeCertified,
    marker: IVX_AUTONOMOUS_TRUTH_CONTROL_MARKER,
    generatedAt: new Date().toISOString(),
    degraded: degradedDependencies.length > 0,
    degradedDependencies,
    truthPolicy: {
      alwaysOn24x7: IVX_AUTONOMOUS_ALWAYS_ON_24X7,
      heartbeatFreshMs: IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS,
      dependencyTimeoutMs: IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS,
      workingRequiresOneOf: [
        'postgres_atomic task + distinct leaseHolder + workerInstanceId + heartbeat <=60s',
        'agent runtime busy + activeTaskId + heartbeat <=60s',
        'dispatcher RUNNING + real workerJobId + dispatcher heartbeat <=60s',
      ],
      fleetActivationRequires: [
        '112 distinct active agents', '112 distinct active leases', '112 fresh heartbeats',
        'deployed concurrency >=112', 'exactly one mutation authority', 'postgres_atomic queue backend',
        'zero stale/blocked agents', 'emergency stop inactive',
      ],
      durableJsonTaskStoreRemovedFromHotTruthPath: true,
      atomicTaskRowsAreCanonicalFleetProof: true,
      noInferenceFromGithubActions: true,
      noInferenceFromContinuityPromiseCount: true,
      noInferenceFromTaskUpdatedAt: true,
      noSyntheticWorkingStatus: true,
      staleFailsClosed: true,
      dependencyFailureFailsClosedWithoutTurningTruthEndpointIntoA500: true,
      cascadeActivation:{seedSize:IVX_AUTONOMOUS_CASCADE_SEED_SIZE,fanout:IVX_AUTONOMOUS_CASCADE_FANOUT},
    },
    certification: {
      continuousRuntimeCertified,
      requiredAgents: 112,
      workingAgents: distinctActiveAgents,
      distinctActiveLeases,
      freshHeartbeatAgents: freshHeartbeats,
      knownWorkerIdentities,
      fleetActivationGate,
      reason: continuousRuntimeCertified
        ? '112/112 real agents have distinct leases, fresh task heartbeats, sufficient deployed capacity, one authority, and an atomic PostgreSQL queue'
        : degradedDependencies.length
          ? `Fail-closed: degraded truth dependencies: ${degradedDependencies.join(',')}`
          : `Fail-closed: ${fleetActivationGate.blockers.join(',') || 'Autonomous control plane is not running'}`,
    },
    autonomous: {
      working: autonomousWorking,
      schedulerEnabled,
      dispatcherPaused,
      ownerControlVerified,
      ownerControl,
      emergencyStop,
      runningJobs: dispatcher.totals.running,
      queuedJobs: dispatcher.totals.queued,
      taskEngineRunning: canonicalRows.length,
      completedJobs: dispatcher.totals.completed,
      failedJobs: dispatcher.totals.failed,
      blockedJobs: dispatcher.totals.blocked,
      maxConcurrency: dispatcher.maxConcurrency,
      configuredQueueBackend,
      provenQueueBackend,
      mutationAuthorities: activeFleetMutationAuthorityCount(),
    },
    developmentProgress: {
      totalJobs: totalDevelopmentJobs,
      pendingOwner: dispatcher.totals.pendingOwner,
      awaitingImplement: dispatcher.totals.awaitingImplement,
      queued: dispatcher.totals.queued,
      running: dispatcher.totals.running,
      taskEngineRunning: canonicalRows.length,
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

export async function enforceAutonomous112RuntimeTruth() {
  const before = await getAutonomousTruthSnapshot();
  const control = before.autonomous.ownerControl;
  if (!before.autonomous.ownerControlVerified || !control) {
    return { ok: false, action: 'owner_control_unavailable', recovered: [], recoverableTotal: 0, recoveryCapacity: autonomousRepairCapacity(), snapshot: before };
  }
  if (before.autonomous.emergencyStop) return { ok: false, action: 'emergency_stop_respected', recovered: [], snapshot: before };
  if (control.stopped || control.paused) {
    return { ok: false, action: 'explicit_owner_stop_respected', recovered: [], recoverableTotal: 0, recoveryCapacity: autonomousRepairCapacity(), snapshot: before };
  }
  // The PostgreSQL queue and runtime enforcer are the sole mutation authority
  // in Landing focus mode. Do not start or synchronize the legacy JSON-backed
  // campaign dispatcher: that path competes for the same database and is not
  // part of canonical atomic lease proof.
  if (autonomousQueueBackend() === 'postgres_atomic' && autonomousRuntimeEnforcerEnabled()) {
    const recoverable = before.agents.rows.filter((agent) =>
      !agent.disabled && !agent.paused && ['IDLE', 'STALE', 'UNKNOWN', 'BLOCKED'].includes(agent.status));
    for (const agent of recoverable) resumeAgent(agent.agentId);
    const after = await getAutonomousTruthSnapshot();
    return {
      ok: after.certification.continuousRuntimeCertified,
      action: recoverable.length ? 'recovered_atomic_agents' : 'verified_atomic_runtime',
      recovered: recoverable.map((agent) => agent.agentNumber),
      recoverableTotal: recoverable.length,
      recoveryCapacity: autonomousRepairCapacity(),
      snapshot: after,
    };
  }
  let controlPlaneRecovered = false;
  if (!before.autonomous.schedulerEnabled || before.autonomous.dispatcherPaused) {
    await setSchedulerEnabled(true);
    startCampaignDispatcher();
    await runCampaignBootRecovery().catch(() => 0);
    await syncCampaignAssignmentsToDispatcher();
    await campaignDispatcherControl('resume_all');
    controlPlaneRecovered = true;
  }
  const current = controlPlaneRecovered ? await getAutonomousTruthSnapshot() : before;
  await runCampaignBootRecovery().catch(() => 0);
  await syncCampaignAssignmentsToDispatcher();
  const allRecoverable = current.agents.rows.filter((agent) => !agent.disabled && !agent.paused && ['IDLE', 'STALE', 'UNKNOWN', 'BLOCKED'].includes(agent.status));
  const recoveryLimit = Math.min(autonomousRepairCapacity(), allRecoverable.length);
  const recoverable = Array.from({ length: recoveryLimit }, (_, index) => allRecoverable[(recoveryCursor + index) % allRecoverable.length]);
  if (allRecoverable.length > 0) recoveryCursor = (recoveryCursor + recoveryLimit) % allRecoverable.length;
  for (const agent of recoverable) {
    resumeAgent(agent.agentId);
    await campaignDispatcherControl('retry_agent', agent.agentNumber).catch(() => undefined);
  }
  if (recoverable.length) await campaignDispatcherControl('resume_all');
  const after = await getAutonomousTruthSnapshot();
  return {
    ok: after.certification.continuousRuntimeCertified,
    action: controlPlaneRecovered
      ? (recoverable.length ? 'recovered_control_plane_and_agents' : 'recovered_control_plane')
      : (recoverable.length ? 'recovered_nonworking_agents' : 'verified'),
    recovered: recoverable.map((agent) => agent.agentNumber),
    recoverableTotal: allRecoverable.length,
    recoveryCapacity: autonomousRepairCapacity(),
    snapshot: after,
  };
}

export async function applyTruthControl(action: TruthControlAction, agentId?: string, agentNumber?: number) {
  if (action === 'start_all' || action === 'resume_all') {
    await setSchedulerEnabled(true);
    startCampaignDispatcher();
    await runCampaignBootRecovery().catch(() => 0);
    await updateControlState('resume_all');
    await syncCampaignAssignmentsToDispatcher();
    if(action==='start_all') await cascadeStartAllAgents();
    else {
      for (const state of getAllExecutionStates()) resumeAgent(state.agentId);
      await campaignDispatcherControl('resume_all');
    }
  } else if (action === 'stop_all' || action === 'pause_all') {
    for (const state of getAllExecutionStates()) pauseAgent(state.agentId);
    if (action === 'stop_all') {
      await updateControlState('stop_all');
      await campaignDispatcherControl('stop_all');
      await setSchedulerEnabled(false);
    } else {
      await updateControlState('pause_all');
      await campaignDispatcherControl('pause_all');
    }
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
