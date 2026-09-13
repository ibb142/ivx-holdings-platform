import { createHash } from 'node:crypto';
import type { IVXAutonomousCoderProof } from './ivx-autonomous-coder';
import { dispatchProductionAutonomousTask, type CandidateRunResult } from './agent-runtime/production-runner';

export type CoderCandidateReceipt = CandidateRunResult | { status: 'NOT_APPLICABLE'; reason: string };
type Proof = Pick<IVXAutonomousCoderProof, 'rootCause' | 'technicalPlan' | 'startingSha' | 'filesInspected'>;

/** The immutable event is a specific job attempt's observed diagnosis. A new
 * attempt receives a different event; candidate version 0 is not a queue fence. */
export async function persistCoderCandidate(input: {
  jobId: string; agentId: string | null; workerInstanceId: string | null;
  attempt: number; proof: Proof; assertAuthority: () => Promise<void>;
}, dispatch = dispatchProductionAutonomousTask): Promise<CoderCandidateReceipt> {
  const { proof } = input;
  if (!input.agentId || !input.workerInstanceId) return { status: 'NOT_APPLICABLE', reason: 'NO_FENCED_AGENT_IDENTITY' };
  if (!proof.filesInspected.length || !/^[a-f0-9]{40}$/i.test(proof.startingSha ?? '')
    || !proof.rootCause.trim() || !proof.technicalPlan.trim()) {
    return { status: 'NOT_APPLICABLE', reason: 'NO_SOURCE_BACKED_DIAGNOSIS' };
  }
  const eventId = 'coder-candidate:' + createHash('sha256').update(JSON.stringify([
    input.jobId, input.attempt, input.agentId, proof.startingSha?.toLowerCase(),
  ])).digest('hex');
  return dispatch({ eventId, ownerId: input.workerInstanceId, targetVersion: 0, timeToLiveMs: 30_000, attempt: input.attempt }, async signal => {
    await input.assertAuthority();
    signal.throwIfAborted();
    return { eventId, agentId: input.agentId!, taskType: 'autonomous_coder_diagnosis', version: 0,
      rootCause: proof.rootCause, hypothesis: proof.technicalPlan, gitSha: proof.startingSha! };
  });
}
