/** Limit failed queue acquisition without delaying active-task heartbeats. */
export class RefillBackoff {
  private failures = 0;
  private nextAttemptAt = 0;
  constructor(private readonly now = Date.now, private readonly random = Math.random) {}

  async run(operation: () => Promise<void>): Promise<void> {
    if (this.now() < this.nextAttemptAt) return;
    try {
      await operation();
      this.failures = 0;
      this.nextAttemptAt = 0;
    } catch (error) {
      this.failures = Math.min(this.failures + 1, 4);
      const delay = Math.min(60_000, 10_000 * 2 ** (this.failures - 1));
      // Replica jitter prevents both workers retrying the database together.
      this.nextAttemptAt = this.now() + delay + Math.floor(this.random() * 5_000);
      throw error;
    }
  }

  status() {
    return { consecutiveFailures: this.failures, nextAttemptAt: this.nextAttemptAt || null,
      remainingMs: Math.max(0, this.nextAttemptAt - this.now()) };
  }
}
