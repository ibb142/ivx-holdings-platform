/** Idle/error polling backs off; active task heartbeats use separate timers. */
export class PollBackoff {
  private attempts = 0;
  private until = 0;
  constructor(private readonly baseMs: number, private readonly maxMs: number,
    private readonly now = Date.now, private readonly random = Math.random) {}
  reset(): void { this.attempts = 0; this.until = 0; }
  defer(): void {
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** Math.min(this.attempts++, 16));
    this.until = this.now() + Math.min(this.maxMs, delay + Math.floor(delay * 0.2 * this.random()));
  }
  remainingMs(): number { return Math.max(0, this.until - this.now()); }
}

/** Schedule after settlement, never overlap, and never restart after stop. */
export function startAdaptivePoll(operation: () => Promise<boolean>, baseMs: number,
  maxMs = 60_000, immediate = false): () => void {
  const backoff = new PollBackoff(baseMs, maxMs);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(tick, delay);
    timer.unref?.();
  };
  const tick = async () => {
    let productive = false;
    try { productive = await operation(); } catch { /* Retry only on the next bounded tick. */ }
    if (productive) backoff.reset(); else backoff.defer();
    schedule(Math.max(baseMs, backoff.remainingMs()));
  };
  schedule(immediate ? 0 : baseMs);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
