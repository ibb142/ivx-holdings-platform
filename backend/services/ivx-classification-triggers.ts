/**
 * IVX Classification Event Triggers
 *
 * Hooks into the payment/transaction lifecycle to automatically trigger
 * member reclassification when financial state changes.
 *
 * Events that trigger reclassification:
 *   - Transaction settles (payment_intent → COMPLETED)
 *   - Payment fails
 *   - Transaction is cancelled
 *   - Principal is refunded
 *   - KYC expires
 *   - Investor status becomes restricted
 *
 * This module is called by the payment service after state transitions.
 */
import { classifyMember, CLASSIFICATION_MARKER } from './ivx-member-classification';

/**
 * Trigger reclassification after a transaction state change.
 * Called by the payment service after finalizeInvestment, refundPayment, etc.
 *
 * @param memberId - The canonical member ID affected by the transaction
 * @param reason - Why reclassification was triggered
 * @returns The classification result, or null if classification failed
 */
export async function triggerReclassification(
  memberId: string,
  reason: string,
): Promise<{ ok: boolean; reason: string; memberId: string; error?: string }> {
  if (!memberId) {
    return { ok: false, reason, memberId, error: 'No member ID provided' };
  }

  try {
    const result = await classifyMember(memberId);
    return {
      ok: result.ok,
      reason: `${reason} → ${result.reason}`,
      memberId,
      error: result.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason,
      memberId,
      error: `Reclassification failed: ${message}`,
    };
  }
}

/**
 * Trigger reclassification after a payment is completed/settled.
 */
export async function onTransactionSettled(
  memberId: string,
  paymentId: string,
  amountCents: number,
): Promise<{ ok: boolean; reason: string; memberId: string }> {
  return triggerReclassification(
    memberId,
    `Transaction ${paymentId} settled for $${(amountCents / 100).toLocaleString()}`,
  );
}

/**
 * Trigger reclassification after a payment fails.
 */
export async function onTransactionFailed(
  memberId: string,
  paymentId: string,
): Promise<{ ok: boolean; reason: string; memberId: string }> {
  return triggerReclassification(
    memberId,
    `Transaction ${paymentId} failed`,
  );
}

/**
 * Trigger reclassification after a payment is cancelled.
 */
export async function onTransactionCancelled(
  memberId: string,
  paymentId: string,
): Promise<{ ok: boolean; reason: string; memberId: string }> {
  return triggerReclassification(
    memberId,
    `Transaction ${paymentId} cancelled`,
  );
}

/**
 * Trigger reclassification after a refund is processed.
 */
export async function onRefundProcessed(
  memberId: string,
  paymentId: string,
  refundAmountCents: number,
): Promise<{ ok: boolean; reason: string; memberId: string }> {
  return triggerReclassification(
    memberId,
    `Refund processed for ${paymentId}: $${(refundAmountCents / 100).toLocaleString()} — qualifying capital recalculated`,
  );
}

/**
 * Trigger reclassification after KYC status changes.
 */
export async function onKYCStatusChanged(
  memberId: string,
  newStatus: string,
): Promise<{ ok: boolean; reason: string; memberId: string }> {
  return triggerReclassification(
    memberId,
    `KYC status changed to ${newStatus}`,
  );
}

/**
 * Trigger reclassification after investor status becomes restricted.
 */
export async function onInvestorRestricted(
  memberId: string,
  restrictedReason: string,
): Promise<{ ok: boolean; reason: string; memberId: string }> {
  return triggerReclassification(
    memberId,
    `Investor status restricted: ${restrictedReason}`,
  );
}

/**
 * Trigger reclassification after a member account merge.
 * Both source and target members need recalculation.
 */
export async function onMemberMerge(
  sourceMemberId: string,
  targetMemberId: string,
): Promise<{ ok: boolean; reason: string; memberId: string }[]> {
  const results: { ok: boolean; reason: string; memberId: string }[] = [];

  // Reclassify the target (merged) member
  const targetResult = await triggerReclassification(
    targetMemberId,
    `Member account merge: ${sourceMemberId} → ${targetMemberId}`,
  );
  results.push(targetResult);

  // The source member is typically deactivated, but we still reclassify
  // to ensure their tier reflects the loss of transactions
  const sourceResult = await triggerReclassification(
    sourceMemberId,
    `Member account merge: source ${sourceMemberId} transactions transferred to ${targetMemberId}`,
  );
  results.push(sourceResult);

  return results;
}

export { CLASSIFICATION_MARKER as TRIGGER_MARKER };