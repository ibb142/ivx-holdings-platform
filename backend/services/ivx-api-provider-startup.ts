type Timer = { unref?: () => void };

/** API replicas need their own real provider observation. Worker health and
 * loaded credentials cannot certify another process's execution readiness. */
export function createApiProviderStartup(input: {
  processRole?: string; nodeEnv?: string; probe: () => Promise<unknown>;
  schedule?: (run: () => Promise<void>, delay: number) => Timer;
  cancel?: (timer: Timer) => void; reportFailure?: () => void;
}) {
  const schedule = input.schedule ?? ((run, delay) => setTimeout(() => { void run(); }, delay));
  const cancel = input.cancel ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let started = false, stopped = false, timer: Timer | null = null;
  return {
    start() {
      if (started || stopped || input.processRole !== 'api' || input.nodeEnv === 'test') return false;
      started = true;
      timer = schedule(async () => {
        timer = null;
        if (stopped) return;
        // The existing probe enforces the global budget, request deadline and
        // provider state transitions. Never mark readiness from configuration.
        try { await input.probe(); } catch { input.reportFailure?.(); }
      }, 30_000);
      timer.unref?.();
      return true;
    },
    stop() { stopped = true; if (timer) cancel(timer); timer = null; },
  };
}
