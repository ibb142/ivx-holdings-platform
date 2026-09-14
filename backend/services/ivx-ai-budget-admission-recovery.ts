export interface BudgetReservationProof {
  reservationId: string;
  workerInstanceId: string;
  model: string;
  requestSha: string;
  reservedNano: string;
  status: string;
  policyRevision: string;
  currentPolicyRevision: string;
  policyEnabled: boolean;
  catalogSha256: string;
  validUntil: string;
}
export interface BudgetAdmissionResult { allowed: boolean; reason?: string; reservationId?: string }

export function matchesBudgetReservation(
  parameters: Record<string, unknown>, proof: BudgetReservationProof, now = Date.now(),
): boolean {
  const quote = parameters.p_pricing_evidence as { catalogSha256?: unknown; validUntil?: unknown } | undefined;
  return proof.status === 'reserved' && proof.policyEnabled === true
    && /^[1-9]\d*$/.test(proof.policyRevision)
    && proof.policyRevision === proof.currentPolicyRevision
    && proof.reservationId === parameters.p_reservation_id
    && proof.workerInstanceId === parameters.p_worker_instance_id
    && proof.model === parameters.p_model && proof.requestSha === parameters.p_request_sha
    && proof.reservedNano === parameters.p_reserved_nano
    && proof.catalogSha256 === quote?.catalogSha256 && proof.validUntil === quote?.validUntil
    && Date.parse(proof.validUntil) > now;
}

/**
 * Retry the same reservation UUID, never a new monetary operation. The database
 * serializes admission on its policy row and rejects duplicate UUIDs. A lost
 * acknowledgement or duplicate response requires an exact owned-row readback
 * before the caller may invoke its provider. Policy denials are never retried.
 */
export async function admitBudgetWithRecovery(input: {
  parameters: Record<string, unknown>;
  reserve: () => Promise<BudgetAdmissionResult>;
  readProof: () => Promise<BudgetReservationProof | null>;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<BudgetAdmissionResult> {
  let originalFailure: unknown = new Error('Budget reservation acknowledgement requires reconciliation');
  const wait = input.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await input.reserve();
      if (result.reason !== 'reservation_already_exists') return result;
    } catch (error) { originalFailure = error; }
    try {
      const proof = await input.readProof();
      if (proof) {
        if (matchesBudgetReservation(input.parameters, proof, input.now?.() ?? Date.now())) {
          return { allowed: true, reservationId: proof.reservationId };
        }
        break; // A mismatched, expired or settled reservation cannot authorize work.
      }
    } catch { /* Unknown storage state never authorizes provider execution. */ }
    if (attempt < 2) await wait(Math.floor((200 * 2 ** attempt) * (0.5 + Math.random() * 0.5)));
  }
  throw originalFailure;
}
