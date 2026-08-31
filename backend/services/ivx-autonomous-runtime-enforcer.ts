import { enforceAutonomous112RuntimeTruth, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS } from './ivx-autonomous-truth-control';

let timer: ReturnType<typeof setInterval> | null = null;
let startedAt: string | null = null;
let lastRunAt: string | null = null;
let lastOk: boolean | null = null;
let lastRecovered: number[] = [];
let lastError: string | null = null;

async function run(reason: 'boot' | 'interval'): Promise<void> {
  lastRunAt = new Date().toISOString();
  try {
    const result = await enforceAutonomous112RuntimeTruth();
    lastOk = result.ok;
    lastRecovered = result.recovered;
    lastError = null;
    console.log('[IVX Autonomous 112 Runtime Enforcer]', {
      reason,
      ok: result.ok,
      action: result.action,
      recovered: result.recovered.length,
      working: result.snapshot.agents.counts.working,
      stale: result.snapshot.agents.counts.stale,
      blocked: result.snapshot.agents.counts.blocked,
      unknown: result.snapshot.agents.counts.unknown,
    });
  } catch (error) {
    lastOk = false;
    lastRecovered = [];
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[IVX Autonomous 112 Runtime Enforcer] failed', { reason, error: lastError });
  }
}

export function startAutonomous112RuntimeEnforcer(): void {
  if (timer) return;
  startedAt = new Date().toISOString();
  const bootKick = setTimeout(() => { void run('boot'); }, 5_000);
  bootKick.unref?.();
  timer = setInterval(() => { void run('interval'); }, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS);
  timer.unref?.();
}

export function getAutonomous112RuntimeEnforcerStatus() {
  return {
    running: Boolean(timer),
    startedAt,
    intervalMs: IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS,
    lastRunAt,
    lastOk,
    lastRecovered,
    lastError,
  };
}
