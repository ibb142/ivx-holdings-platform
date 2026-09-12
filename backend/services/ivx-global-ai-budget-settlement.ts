import { setTimeout as scheduleTimer } from 'node:timers';

export type BudgetSettlement = Readonly<{
  p_reservation_id: string;
  p_worker_instance_id: string;
  p_status: 'settled' | 'uncertain' | 'cancelled';
  p_settled_upper_nano: string | null;
  p_generation_id: string | null;
}>;
type Receipt = { ok: boolean; pricingBoundBreached?: boolean };
type Options = {
  schedule?: (run: () => void, delayMs: number) => void;
  onConfirmed?: (receipt: Receipt, attempts: number) => void;
  onRetry?: (settlement: BudgetSettlement, attempts: number, delayMs: number) => void;
  onUnconfirmed?: (settlement: BudgetSettlement, attempts: number) => void;
};
const RETRY_DELAYS_MS = [1000, 5000, 15000] as const;

/** Retry only an identical, idempotent database settlement. Never replay AI. */
export async function settleBudgetWithRetry(
  write: (settlement: BudgetSettlement) => Promise<Receipt>,
  settlement: BudgetSettlement,
  options: Options = {},
): Promise<void> {
  // A lost acknowledgement may follow a committed write. Every retry must keep
  // the same identity, cost, status and generation ID, including unknown charges.
  const payload = Object.freeze({ ...settlement });
  const schedule = options.schedule ?? ((run, delayMs) => {
    scheduleTimer(run, delayMs).unref();
  });
  let attempts = 0;
  async function attempt(): Promise<void> {
    attempts += 1;
    let receipt: Receipt;
    try {
      receipt = await write(payload);
      if (receipt?.ok !== true) throw new Error('Budget settlement unconfirmed');
    } catch {
      const delay = RETRY_DELAYS_MS[attempts - 1];
      if (delay !== undefined) {
        options.onRetry?.(payload, attempts, delay);
        // Return the provider response after the first attempt. Later database
        // attempts are bounded, sequential and do not hold the response open.
        schedule(() => { void attempt(); }, delay);
      } else {
        // The durable reservation is retained when all attempts fail. Metadata
        // allows reviewed recovery without inventing a refund or losing receipt IDs.
        options.onUnconfirmed?.(payload, attempts);
      }
      return;
    }
    options.onConfirmed?.(receipt, attempts);
  }
  await attempt();
}
