import { getFleetSloSnapshot, type FleetSloSnapshot } from './ivx-fleet-slo';
import { autonomousDoctorRepairEnabled } from './ivx-autonomous-control-policy';
import type { IVXWorkerJobInput } from './ivx-senior-developer-worker';

export const IVX_AUTONOMOUS_UTILIZATION_GUARDIAN_MARKER = 'ivx-utilization-reasoning-bridge-v2-2026-09-09';
const CHECK_INTERVAL_MS = 60_000;
const COOLDOWN_MS = 15 * 60_000;
type Diagnosis = 'EXECUTION_WITHOUT_RESULTS' | 'DISPATCH_OR_CAPACITY_GAP' | 'PARTIAL_PRODUCTIVITY';
type Dependencies = {
  snapshot: () => FleetSloSnapshot | null;
  enabled: () => boolean;
  now: () => number;
  enqueue: (input: IVXWorkerJobInput) => Promise<{ job: { jobId: string }; attached: boolean }>;
};
export type GuardianStatus = {
  action: 'WAITING_FOR_EVIDENCE' | 'OBSERVE_ONLY' | 'HEALTHY' | 'CONFIRMING_BREACH' | 'COOLDOWN' | 'REPAIR_QUEUED' | 'REPAIR_ATTACHED' | 'ERROR';
  diagnosis: Diagnosis | null;
  jobId: string | null;
  error: string | null;
};

/** Reuse measured, hashed tool evidence. Never infer productive hours from text. */
export class UtilizationReasoningGuardian {
  private inFlight: Promise<GuardianStatus> | null = null;
  private previousSample: string | null = null;
  private previousIncident: string | null = null;
  private submittedAt: number | null = null;
  private status: GuardianStatus = { action: 'WAITING_FOR_EVIDENCE', diagnosis: null, jobId: null, error: null };
  constructor(private readonly deps: Dependencies) {}
  snapshot(): GuardianStatus { return { ...this.status }; }
  run(): Promise<GuardianStatus> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.collect().catch((error) => {
      this.status = { ...this.status, action: 'ERROR', error: error instanceof Error ? error.message : String(error) };
      return this.snapshot();
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  private async collect(): Promise<GuardianStatus> {
    const sample = this.deps.snapshot();
    const now = this.deps.now();
    const measured = Date.parse(sample?.measured_at ?? '');
    if (!sample || sample.status === 'UNKNOWN' || !sample.durable || !Number.isFinite(measured)
      || measured > now || now - measured > 60_000 || !/^[a-f0-9]{40}$/i.test(sample.commit_sha)) {
      this.previousSample = null;
      this.previousIncident = null;
      this.status = { ...this.status, action: 'WAITING_FOR_EVIDENCE', diagnosis: null, error: null };
      return this.snapshot();
    }
    if (sample.status === 'MET') {
      this.previousSample = null;
      this.previousIncident = null;
      this.status = { ...this.status, action: 'HEALTHY', diagnosis: null, error: null };
      return this.snapshot();
    }
    const diagnosis: Diagnosis = sample.running_agents === sample.target_agents && sample.productive_agents === 0
      ? 'EXECUTION_WITHOUT_RESULTS'
      : (sample.running_agents ?? 0) < sample.target_agents ? 'DISPATCH_OR_CAPACITY_GAP' : 'PARTIAL_PRODUCTIVITY';
    const incident = `${sample.commit_sha}:${diagnosis}`;
    const confirmed = this.previousIncident === incident && this.previousSample !== sample.measured_at;
    this.previousIncident = incident;
    this.previousSample = sample.measured_at;
    this.status = { ...this.status, diagnosis, error: null };
    if (!this.deps.enabled()) {
      this.status.action = 'OBSERVE_ONLY';
    } else if (!confirmed) {
      this.status.action = 'CONFIRMING_BREACH';
    } else if (this.submittedAt !== null && now - this.submittedAt < COOLDOWN_MS) {
      this.status.action = 'COOLDOWN';
    } else {
      const input: IVXWorkerJobInput = {
        ownerId: 'autonomous-utilization-guardian',
        taskId: `fleet-reasoning:${incident}:${Math.floor(now / COOLDOWN_MS)}`,
        goal: [
          '[TEMPLATE_MODE:BUG_FIX] Investigate and repair a persistent IVX fleet productivity incident.',
          `Observed hypothesis class: ${diagnosis}. This is a hypothesis, not a proven root cause.`,
          `Exact measured evidence: ${JSON.stringify(sample)}`,
          'Read current worker, dispatcher, queue, Doctor and CI evidence before editing. Compare the deployed SHA with current code and existing repair PRs; continue existing repairs instead of duplicating them.',
          'Distinguish fresh heartbeat, task lease, actual tool execution, successful result and productive duration. Identify the earliest broken transition. Compare competing causes: priority exclusivity, missing worker capacity, database/RPC failure, repeated QA failure, stale evidence or retry exhaustion.',
          'Use actual code and tool results to support or reject each hypothesis. Reproduce the cause, prepare the smallest reversible code fix and a regression test, run typecheck and relevant QA. Preserve the diagnosis, attempted repair and test evidence for subsequent investigations.',
          'Keep Owner Gates for secrets, auth, permissions, infrastructure, database migrations, spending and deployment. Never disable TLS verification, replay ambiguous mutations, weaken tests or bypass emergency stops.',
          'A queued job or successful patch is not recovery. After an authorized deployment require fresh productive evidence on the exact deployed SHA; report unresolved dependencies and failed hypotheses explicitly.',
        ].join('\n'),
        ownerApproved: true, // Reached only under the existing explicit Doctor repair policy.
        approvePatch: false, approveGitDeploy: false, systemMode: true,
        validationMode: 'focused', executionMode: 'code_change',
        ownerApprovedAction: {
          proposedPlan: 'Investigate measured fleet productivity loss and prepare a bounded code repair through existing QA gates',
          filesAffected: [], riskLevel: 'low', rollbackOption: 'Revert the reviewed repair commit', rollbackAvailable: true,
          auditLog: [IVX_AUTONOMOUS_UTILIZATION_GUARDIAN_MARKER, incident, sample.measured_at], secretValuesReturned: false,
        },
      };
      // The existing queue enforces emergency stop, owner single-flight and task identity.
      const result = await this.deps.enqueue(input);
      this.submittedAt = now;
      this.status = { action: result.attached ? 'REPAIR_ATTACHED' : 'REPAIR_QUEUED', diagnosis, jobId: result.job.jobId, error: null };
    }
    return this.snapshot();
  }
}

const guardian = new UtilizationReasoningGuardian({
  snapshot: getFleetSloSnapshot, enabled: autonomousDoctorRepairEnabled, now: Date.now,
  enqueue: async (input) => {
    const { enqueueOrAttachSeniorDeveloperJob } = await import('./ivx-senior-developer-worker');
    return enqueueOrAttachSeniorDeveloperJob(input);
  },
});
let timer: ReturnType<typeof setInterval> | null = null;
export function runAutonomousUtilizationGuardian(): Promise<GuardianStatus> { return guardian.run(); }
export function getAutonomousUtilizationStatus(): GuardianStatus { return guardian.snapshot(); }
export function startAutonomousUtilizationGuardian(): boolean {
  if (timer) return false;
  const tick = () => { void guardian.run().then(status => {
    if (status.action === 'ERROR') console.error('[IVX Utilization Reasoning]', status);
  }); };
  tick();
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
  return true;
}
export function stopAutonomousUtilizationGuardian(): void { if (timer) clearInterval(timer); timer = null; }
