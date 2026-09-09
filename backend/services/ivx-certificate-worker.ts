import { resumePendingCertificateRuns } from './ivx-real-execution-certificate';

let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;

/** Serial polling also discovers certificates enqueued after worker boot. */
export function startCertificateWorker(): void {
  if (process.env.IVX_PROCESS_ROLE !== 'worker' || !stopped) return;
  stopped = false;
  const poll = async () => {
    if (stopped) return;
    try {
      await resumePendingCertificateRuns();
    } catch (error) {
      console.error('[IVXRealExecutionCert] worker recovery failed', error instanceof Error ? error.message : String(error));
    } finally {
      if (!stopped) timer = setTimeout(poll, 30_000);
    }
  };
  void poll();
}

export function stopCertificateWorker(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
