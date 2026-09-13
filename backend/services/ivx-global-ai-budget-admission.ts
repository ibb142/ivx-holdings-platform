import { settleBudgetWithRetry, type BudgetSettlement } from './ivx-global-ai-budget-settlement';

type Admission = { allowed: boolean; reason?: string; reservationId?: string };
type Identity = Pick<BudgetSettlement, 'p_reservation_id' | 'p_worker_instance_id'>;

/** Only for admission before a provider request can be sent. Never use this to
 * reconcile an old reservation or a request that may already have reached AI. */
export async function confirmBudgetReservation(
  reserve: () => Promise<Admission>,
  finish: Parameters<typeof settleBudgetWithRetry>[0],
  identity: Identity,
  options: Parameters<typeof settleBudgetWithRetry>[2] = {},
): Promise<Admission> {
  const owner = Object.freeze({ ...identity });
  const cancelUnstarted = () => settleBudgetWithRetry(finish, {
    ...owner, p_status: 'cancelled', p_settled_upper_nano: '0', p_generation_id: null,
  }, options);
  let result: Admission;
  try {
    // A transport rejection may follow a committed reservation. The caller
    // still has no lease and cannot have sent its provider request.
    result = await reserve();
  } catch (error) {
    await cancelUnstarted();
    throw error;
  }
  // An explicit denial created no new reservation. In particular, never
  // cancel an existing reservation after a duplicate-ID rejection.
  if (result?.allowed === false) return result;
  if (result?.allowed === true && result.reservationId === owner.p_reservation_id) return result;
  await cancelUnstarted();
  throw new Error('Budget admission acknowledgement mismatch');
}
