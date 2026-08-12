/**
 * IVX AI Provider Credential Monitor
 *
 * Probes the active AI provider every 4 hours. If authentication fails,
 * sends ONE SMS alert to the owner (not repeated every cycle). When service
 * recovers, sends a recovery SMS.
 *
 * Important: a 401 is an authentication/provider-binding failure, not a TLS
 * certificate error. The alert intentionally avoids telling the owner to rotate
 * a Vercel key unless the runtime actually selected the Vercel AI Gateway.
 *
 * Marker: ivx-ai-key-monitor-provider-aware-2026-08-12
 */

import { probeAIGatewayLive } from './ivx-owner-ai-task-queue';
import { sendSnsSms } from './ivx-sns-sms';
import { getIVXAIProviderType } from '../ivx-ai-runtime';

const PROBE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const OWNER_PHONE = process.env.IVX_OWNER_RECOVERY_PHONE || '';

export type MonitorState = {
  lastOk: boolean;
  lastProbeAt: string | null;
  lastAlertAt: string | null;
  consecutiveFailures: number;
  provider: 'vercel_gateway' | 'openai_direct' | 'unknown';
  lastStatus: number | null;
  lastReason: string | null;
};

let state: MonitorState = {
  lastOk: true,
  lastProbeAt: null,
  lastAlertAt: null,
  consecutiveFailures: 0,
  provider: 'unknown',
  lastStatus: null,
  lastReason: null,
};

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function providerLabel(provider: MonitorState['provider']): string {
  if (provider === 'vercel_gateway') return 'Vercel AI Gateway';
  if (provider === 'openai_direct') return 'OpenAI direct';
  return 'AI provider';
}

function remediation(provider: MonitorState['provider'], status: number | null): string {
  if (status === 401 || status === 403) {
    if (provider === 'vercel_gateway') {
      return 'Check the active Vercel AI Gateway key and its Render binding (IVX_AI_GATEWAY_KEY or AI_GATEWAY_API_KEY).';
    }
    if (provider === 'openai_direct') {
      return 'Check the active OpenAI key and its Render binding (IVX_OPENAI_API_KEY or OPENAI_API_KEY).';
    }
    return 'Check the active provider key and Render environment binding; provider could not be identified.';
  }
  if (status === 429) return 'Provider rate limit reached; credential may still be valid.';
  if (status !== null && status >= 500) return 'Provider returned a server error; do not rotate credentials unless authentication also fails.';
  return 'Check provider connectivity and runtime binding.';
}

async function runProbe(): Promise<void> {
  const provider = getIVXAIProviderType();
  const result = await probeAIGatewayLive();
  const now = new Date().toISOString();
  state.lastProbeAt = now;
  state.provider = provider;
  state.lastStatus = result.status ?? null;
  state.lastReason = result.reason || null;

  if (result.ok) {
    if (!state.lastOk) {
      console.log('[IVXAIKeyMonitor] Provider RECOVERED', { provider, latencyMs: result.latencyMs });
      if (OWNER_PHONE) {
        await sendSnsSms({
          to: OWNER_PHONE,
          message: `IVX AI RESTORED: ${providerLabel(provider)} is authenticated and responding again.`,
          senderId: 'IVX',
        }).catch(() => {});
      }
    }
    state.lastOk = true;
    state.consecutiveFailures = 0;
    return;
  }

  state.consecutiveFailures += 1;
  console.warn('[IVXAIKeyMonitor] Provider FAILED', {
    provider,
    status: result.status,
    reason: result.reason,
    consecutiveFailures: state.consecutiveFailures,
  });

  if (state.lastOk && OWNER_PHONE) {
    const shortReason = (result.reason || 'authentication/provider probe failed').slice(0, 70);
    const action = remediation(provider, result.status ?? null).slice(0, 120);
    await sendSnsSms({
      to: OWNER_PHONE,
      message: `IVX ALERT: ${providerLabel(provider)} failed (${result.status ?? 'n/a'}). ${shortReason}. ${action}`,
      senderId: 'IVX',
    }).catch(() => {});
    state.lastAlertAt = now;
  }
  state.lastOk = false;
}

export function startAIKeyMonitor(): void {
  if (intervalHandle) return;
  console.log('[IVXAIKeyMonitor] Starting provider-aware monitor — probes every 4h');

  const bootProbe = setTimeout(() => { void runProbe().catch(() => {}); }, 30_000);
  bootProbe.unref?.();

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
