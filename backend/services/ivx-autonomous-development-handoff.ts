import { autonomousDoctorRepairEnabled } from './ivx-autonomous-control-policy';
import { checkpointDevelopmentHandoff, heartbeat, type Task } from './ivx-autonomous-task-engine';
import { classifyOwnerExecutionCommand } from './ivx-owner-execution-mode';
import { developmentJobId, developmentOwnerLane } from './ivx-development-job-identity';
import type { IVXWorkerJob, IVXWorkerJobInput } from './ivx-senior-developer-worker';
import { SENIOR_QUEUE_ACTIVE_STATUSES } from './ivx-senior-work-queue';

type Job = Pick<IVXWorkerJob, 'jobId' | 'input' | 'status'> & {
  result: Pick<NonNullable<IVXWorkerJob['result']>, 'commitSha' | 'deployId' | 'changedFiles'> | null;
};
export type DevelopmentHandoffDependencies = {
  mayPrepareCode: () => boolean;
  checkpoint: typeof checkpointDevelopmentHandoff;
  heartbeat: typeof heartbeat;
  readJob: (id: string) => Promise<Job | null>;
  enqueue: (input: IVXWorkerJobInput) => Promise<{ job: Job }>;
  wait: () => Promise<void>;
  now: () => number;
};
const defaults: DevelopmentHandoffDependencies = {
  // Reuse the explicitly enabled repair authority; never enable it here.
  mayPrepareCode: autonomousDoctorRepairEnabled,
  checkpoint: checkpointDevelopmentHandoff, heartbeat, now: Date.now,
  readJob: async id => (await import('./ivx-senior-developer-worker')).getSeniorDeveloperJob(id),
  enqueue: async input => (await import('./ivx-senior-developer-worker')).enqueueOrAttachSeniorDeveloperJob(input),
  wait: () => new Promise(resolve => setTimeout(resolve, 20_000)),
};

/**
 * The fleet owns task admission; the existing Senior queue owns file execution.
 * Persist the deterministic job ID BEFORE enqueue and reconcile that same ID
 * after any lost acknowledgement. A retry never replaces a terminal job.
 * Keep the fleet lease while waiting, so queued handoffs consume fleet capacity.
 */
export async function runDevelopmentHandoff(task: Task, workerId: string,
  shouldContinue: () => boolean = () => true, deps: DevelopmentHandoffDependencies = defaults,
): Promise<{ ok: boolean; states: string[]; error: string | null }> {
  const jobId = developmentJobId(task.taskId);
  const stop = (error: string) => ({ ok: false, states: [] as string[], error });
  const finish = async (blocker: string, job?: Job, failed = false) => {
    const saved = await deps.checkpoint({ taskId: task.taskId, workerId, jobId,
      state: failed ? 'FAILED' : 'BLOCKED', blocker,
      commitSha: job?.result?.commitSha, deploymentId: job?.result?.deployId,
      filesChanged: job?.result?.changedFiles,
    });
    return { ok: saved.ok, states: saved.ok ? [failed ? 'FAILED' : 'BLOCKED'] : [], error: saved.error ?? blocker };
  };
  try {
    if (task.taskType !== 'development') return stop('Task type is not supported by the development handoff.');
    if (!shouldContinue()) return stop('Development handoff stopped before admission.');
    const saved = await deps.checkpoint({ taskId: task.taskId, workerId, jobId, state: 'RUNNING' });
    if (!saved.ok) return stop(saved.error ?? 'Development handoff lease not confirmed.');
    let job = await deps.readJob(jobId);
    if (!job) {
      if (!deps.mayPrepareCode()) return finish('OWNER_POLICY_REQUIRED: autonomous code preparation is not enabled; enqueue this task through the authenticated Senior Developer API.');
      const policy = classifyOwnerExecutionCommand(`${task.title}\n${task.description}`);
      if (policy.requiresApproval) return finish(`OWNER_GATE: ${policy.approvalCategories.join(', ')} requires its existing protected-action approval.`);
      const authority = await deps.heartbeat(task.taskId, workerId);
      if (!authority.ok || !shouldContinue()) return stop(authority.error ?? 'Development handoff stopped.');
      try {
        ({ job } = await deps.enqueue({
          taskId: task.taskId, ownerId: developmentOwnerLane(task.assignedAgentNumber), autonomousTaskHandoff: true,
          agentNumber: task.assignedAgentNumber,
          agentId: task.assignedAgentNumber == null ? null : `ivx_holdings_${task.assignedAgentNumber}`,
          actor: 'AUTONOMOUS', executionMode: 'code_change', validationMode: 'focused',
          // The configured repair policy permits preparation only. This flag
          // does not authorize deployment, protected operations or auto-merge.
          ownerApproved: true, approvePatch: false, approveGitDeploy: false, systemMode: false,
          goal: '[TEMPLATE_MODE:BUG_FIX] Prepare a scoped code repair and PR for this autonomous task. Preserve existing behavior and owner gates. Do not deploy, change secrets, run production migrations or weaken checks.\n'
            + JSON.stringify({ taskId: task.taskId, title: task.title, description: task.description,
              acceptanceCriteria: task.acceptanceCriteria.map(({ id, description, verificationMethod }) => ({ id, description, verificationMethod })) }),
          ownerApprovedAction: {
            proposedPlan: 'Inspect, prepare a reversible code patch in an isolated checkout, run relevant tests, and open a PR for owner review.',
            filesAffected: [], riskLevel: 'low', rollbackOption: 'Discard the unmerged repair branch.', rollbackAvailable: true,
            auditLog: ['IVX_AUTONOMOUS_DOCTOR_REPAIR_ENABLED=true', `taskId=${task.taskId}`, `jobId=${jobId}`, 'Publication remains owner-gated.'],
            secretValuesReturned: false,
          },
        }));
      } catch (error) {
        // Read once after an ambiguous mutation; do not issue another enqueue.
        job = await deps.readJob(jobId);
        if (!job) {
          const message = error instanceof Error ? error.message : '';
          if (message.startsWith('EMERGENCY_STOP_UNAVAILABLE')) return finish('OWNER_CONTROL_UNAVAILABLE: enqueue refused until the existing owner stop is readable.');
          if (message.startsWith('EMERGENCY_STOP_ACTIVE')) return finish('OWNER_STOP_ACTIVE: enqueue refused by the existing emergency stop.');
          return finish('DEVELOPER_ENQUEUE_UNCONFIRMED: retain the recorded job identity and reconcile before retrying.');
        }
      }
    }
    const deadline = deps.now() + 30 * 60_000;
    while (true) {
      if (!shouldContinue()) return stop('Development handoff stopped; the recorded job must be reconciled.');
      if (job.jobId !== jobId || job.input.taskId !== task.taskId || job.input.autonomousTaskHandoff !== true || !job.input.ownerApproved
        || job.input.executionMode !== 'code_change' || job.input.approveGitDeploy) {
        return finish('DEVELOPER_JOB_IDENTITY_MISMATCH: the recorded job cannot certify this task.');
      }
      if (job.status === 'failed' || job.status === 'cancelled') return finish(`DEVELOPER_JOB_${job.status.toUpperCase()}: ${jobId}. Inspect the durable job outcome before retrying.`, job, true);
      if (job.status === 'blocked') return finish(`DEVELOPER_JOB_BLOCKED: ${jobId}. Inspect the prepared PR, checks and owner approval requirements.`, job);
      if (job.status === 'completed') return finish(`DEVELOPER_ACCEPTANCE_PENDING: ${jobId} finished; verify the task criteria with the recorded commit and deployment evidence.`, job);
      if (!(SENIOR_QUEUE_ACTIVE_STATUSES as readonly string[]).includes(job.status)) return finish('DEVELOPER_JOB_INVALID_STATE: inspect the durable job before continuing.');
      if (deps.now() >= deadline) return finish(`DEVELOPER_JOB_PENDING: ${jobId}. The observation deadline elapsed; retain the same job for reconciliation.`, job);
      const renewed = await deps.heartbeat(task.taskId, workerId);
      if (!renewed.ok) return stop(renewed.error ?? 'Development task lease lost.');
      await deps.wait();
      job = await deps.readJob(jobId);
      if (!job) return finish(`DEVELOPER_JOB_UNAVAILABLE: ${jobId}. No replacement execution was started.`);
    }
  } catch {
    // Storage uncertainty cannot be converted into a completed or absent job.
    return stop('DEVELOPER_HANDOFF_UNAVAILABLE: durable task/job state could not be confirmed.');
  }
}
