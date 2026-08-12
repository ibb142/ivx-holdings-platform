/**
 * IVX AI Gateway Key Monitor
 *
 * Probes the AI gateway every 4 hours. If the key is expired/revoked,
 * sends ONE SMS alert to the owner (not repeated every cycle).
 * When the key is restored, sends a recovery SMS.
 *
 * This prevents the owner from discovering a dead key only when users
 * complain — they get alerted within 4 hours of expiry.
 *
 * Marker: ivx-ai-key-monitor-2026-08-12
 */

import { probeAIGatewayLive } from './ivx-owner-ai-task-queue';
import { sendTwilioSms } from './ivx-twilio-sms';

const PROBE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const OWNER_PHONE = process.env.IVX_OWNER_RECOVERY_PHONE || '';

type MonitorState = {
  lastOk: boolean;
  lastProbeAt: string | null;
  lastAlertAt: string | null;
  consecutiveFailures: number;
};

let state: MonitorState = {
  lastOk: true,
  lastProbeAt: null,
  lastAlertAt: null,
  consecutiveFailures: 0,
};

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runProbe(): Promise<void> {
  const result = await probeAIGatewayLive();
  const now = new Date().toISOString();
  state.lastProbeAt = now;

  if (result.ok) {
    // Key is working
    if (!state.lastOk) {
      // Recovery — key was down, now it's back
      console.log('[IVXAIKeyMonitor] Gateway RECOVERED', { latencyMs: result.latencyMs });
      if (OWNER_PHONE) {
        await sendTwilioSms({
          to: OWNER_PHONE,
          message: 'IVX AI Gateway RESTORED: Key is working again. Provider PROVIDER_READY, chat back online.',
        }).catch(() => {});
      }
    }
    state.lastOk = true;
    state.consecutiveFailures = 0;
  } else {
    state.consecutiveFailures += 1;
    console.warn('[IVXAIKeyMonitor] Gateway FAILED', {
      status: result.status,
      reason: result.reason,
      consecutiveFailures: state.consecutiveFailures,
    });

    // Only send SMS on the FIRST failure (not every 4h)
    if (state.lastOk && OWNER_PHONE) {
      const shortReason = result.reason.slice(0, 80);
      await sendTwilioSms({
        to: OWNER_PHONE,
        message: `IVX ALERT: AI Gateway key expired or failing (${result.status}). ${shortReason}. Update Vercel key at vercel.com/~/ai-gateway/api-keys then set IVX_AI_GATEWAY_KEY on Render.`,
      }).catch(() => {});
      state.lastAlertAt = now;
    }
    state.lastOk = false;
  }
}

export function startAIKeyMonitor(): void {
  if (intervalHandle) return;
  console.log('[IVXAIKeyMonitor] Starting — probes every 4h, SMS alert on key failure');

  // Initial probe after 30s (let boot settle)
  setTimeout(() => { void runProbe().catch(() => {}); }, 30_000);

  intervalHandle = setInterval(() => {
    void runProbe().catch(() => {});
  }, PROBE_INTERVAL_MS);

  intervalHandle.unref?.();
}

export function stopAIKeyMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function getAIKeyMonitorState(): MonitorState & { intervalMs: number } {
  return { ...state, intervalMs: PROBE_INTERVAL_MS };
}
