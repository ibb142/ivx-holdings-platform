/**
 * IVX Autonomous SMS Notifier — sends owner status updates via AWS SNS.
 *
 * Wired into the autonomous scheduler tick. Every 2 hours, sends a concise
 * status SMS to the owner's phone (IVX_OWNER_RECOVERY_PHONE) with:
 *   - 12-IA agent active count
 *   - Factory agent pending/active count
 *   - Queue depth
 *   - Any blockers
 *
 * HONESTY RULES:
 *   - Never sends fabricated status. Counts come from live Supabase rows.
 *   - If Supabase is unreachable, the SMS says "DB unreachable" — not fake zeros.
 *   - Rate-limited to 1 SMS per 2 hours (12 per day max).
 *   - If AWS SNS is not configured, logs a warning and skips — never throws.
 *
 * Marker: ivx-autonomous-sms-notifier-2026-08-09
 */
import { sendSnsSms, resolveOwnerRecoveryPhone, type SnsSmsResult } from './ivx-sns-sms';

export const IVX_SMS_NOTIFIER_MARKER = 'ivx-autonomous-sms-notifier-2026-08-09';
const NOTIFICATION_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_SMS_PER_DAY = 12;

let lastSmsSentAt = 0;
let smsSentToday = 0;
let smsDayResetAt = Date.now() + 24 * 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

type StatusCounts = {
  agentsActive: number | null;
  agentsTotal: number | null;
  factoryPending: number | null;
  factoryActive: number | null;
  queueDepth: number | null;
  runningTasks: number | null;
  blockedTasks: number | null;
  databaseReachable: boolean;
};

/**
 * Fetch live counts from the IA orchestrator's Supabase queries.
 * Uses the same REST API pattern as ivx-ia-orchestrator.ts.
 */
async function fetchLiveCounts(): Promise<StatusCounts> {
  const supabaseUrl = (process.env.IVX_SUPABASE_URL || process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceKey) {
    return {
      agentsActive: null,
      agentsTotal: null,
      factoryPending: null,
      factoryActive: null,
      queueDepth: null,
      runningTasks: null,
      blockedTasks: null,
      databaseReachable: false,
    };
  }

  try {
    const headers: Record<string, string> = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
    };

    const fetchCount = async (path: string): Promise<number | null> => {
      try {
        const res = await fetch(`${supabaseUrl}${path}&select=id&limit=1`, {
          headers,
          signal: AbortSignal.timeout(8000),
        });
        const range = res.headers.get('content-range') ?? '';
        const total = range.includes('/') ? Number(range.split('/')[1]) : NaN;
        return Number.isFinite(total) ? total : null;
      } catch {
        return null;
      }
    };

    const [agentsTotal, agentsActive, factoryPending, factoryActive, tasksRunning, tasksBlocked, tasksTotal] = await Promise.all([
      fetchCount('/rest/v1/ivx_ia_agents?select=id'),
      fetchCount('/rest/v1/ivx_ia_agents?status=eq.ACTIVE&select=id'),
      fetchCount('/rest/v1/ivx_ia_factory_agents?activation_status=eq.PENDING_OWNER_APPROVAL&select=id'),
      fetchCount('/rest/v1/ivx_ia_factory_agents?activation_status=eq.ACTIVE&select=id'),
      fetchCount('/rest/v1/ivx_ia_tasks?status=eq.RUNNING&select=id'),
      fetchCount('/rest/v1/ivx_ia_tasks?status=eq.BLOCKED&select=id'),
      fetchCount('/rest/v1/ivx_ia_tasks?select=id'),
    ]);

    return {
      agentsActive,
      agentsTotal,
      factoryPending,
      factoryActive,
      queueDepth: tasksTotal,
      runningTasks: tasksRunning,
      blockedTasks: tasksBlocked,
      databaseReachable: agentsTotal !== null,
    };
  } catch {
    return {
      agentsActive: null,
      agentsTotal: null,
      factoryPending: null,
      factoryActive: null,
      queueDepth: null,
      runningTasks: null,
      blockedTasks: null,
      databaseReachable: false,
    };
  }
}

/**
 * Build a concise SMS body (GSM-7 safe, under 160 chars).
 */
function buildStatusSms(counts: StatusCounts): string {
  const db = counts.databaseReachable ? 'OK' : 'DOWN';
  const ia = counts.agentsActive !== null ? `${counts.agentsActive}/${counts.agentsTotal}` : 'n/a';
  const af = counts.factoryPending !== null ? `pend:${counts.factoryPending} active:${counts.factoryActive}` : 'n/a';
  const q = counts.queueDepth !== null ? `q:${counts.queueDepth}` : 'q:n/a';
  const run = counts.runningTasks !== null ? `run:${counts.runningTasks}` : '';
  const blk = counts.blockedTasks && counts.blockedTasks > 0 ? ` BLK:${counts.blockedTasks}` : '';
  return `IVX 24/7: db=${db} IA=${ia} AF=${af} ${q}${run}${blk}`;
}

/**
 * Send a status SMS to the owner. Returns the SNS result.
 */
export async function sendOwnerStatusSms(): Promise<SnsSmsResult> {
  const phone = resolveOwnerRecoveryPhone();
  if (!phone) {
    console.warn('[IVX-SMS-Notifier] No owner phone configured — skipping SMS');
    return {
      ok: false,
      status: 'missing_config',
      missingEnvNames: ['IVX_OWNER_RECOVERY_PHONE'],
      error: 'No owner phone configured',
      sentAt: new Date().toISOString(),
    };
  }

  const counts = await fetchLiveCounts();
  const message = buildStatusSms(counts);
  const result = await sendSnsSms({ to: phone, message, senderId: 'IVX' });

  if (result.ok) {
    lastSmsSentAt = Date.now();
    smsSentToday += 1;
    console.log('[IVX-SMS-Notifier] Status SMS sent to', phone.slice(0, 2) + '***' + phone.slice(-4), '— message:', message);
  } else {
    console.warn('[IVX-SMS-Notifier] SMS send failed:', result.status, result.error?.slice(0, 100));
  }

  return result;
}

/**
 * Send an immediate alert SMS (e.g. blocker, failure, factory milestone).
 * Bypasses the 2-hour interval but still respects daily cap.
 */
export async function sendOwnerAlertSms(alertMessage: string): Promise<SnsSmsResult> {
  const phone = resolveOwnerRecoveryPhone();
  if (!phone) {
    return {
      ok: false,
      status: 'missing_config',
      missingEnvNames: ['IVX_OWNER_RECOVERY_PHONE'],
      error: 'No owner phone configured',
      sentAt: new Date().toISOString(),
    };
  }

  // Reset daily counter if needed
  if (Date.now() > smsDayResetAt) {
    smsSentToday = 0;
    smsDayResetAt = Date.now() + 24 * 60 * 60 * 1000;
  }

  if (smsSentToday >= MAX_SMS_PER_DAY) {
    console.warn('[IVX-SMS-Notifier] Daily SMS cap reached — skipping alert');
    return {
      ok: false,
      status: 'rate_limited',
      missingEnvNames: [],
      error: 'Daily SMS cap reached',
      sentAt: new Date().toISOString(),
    };
  }

  const truncated = alertMessage.slice(0, 140);
  const result = await sendSnsSms({ to: phone, message: `IVX ALERT: ${truncated}`, senderId: 'IVX' });

  if (result.ok) {
    smsSentToday += 1;
    console.log('[IVX-SMS-Notifier] Alert SMS sent:', truncated.slice(0, 60));
  }

  return result;
}

/**
 * Start the autonomous SMS notification scheduler.
 * Sends a status SMS every 2 hours. Idempotent.
 */
export function startSmsNotificationScheduler(): void {
  if (timer) return;

  // Send an initial status SMS 30 seconds after boot
  const bootKick = setTimeout(() => {
    void sendOwnerStatusSms().catch((err) => {
      console.warn('[IVX-SMS-Notifier] Boot SMS failed:', err instanceof Error ? err.message : err);
    });
  }, 30_000);
  if (typeof bootKick.unref === 'function') bootKick.unref();

  // Then every 2 hours
  timer = setInterval(() => {
    // Reset daily counter if needed
    if (Date.now() > smsDayResetAt) {
      smsSentToday = 0;
      smsDayResetAt = Date.now() + 24 * 60 * 60 * 1000;
    }

    if (smsSentToday >= MAX_SMS_PER_DAY) {
      console.warn('[IVX-SMS-Notifier] Daily SMS cap reached — skipping scheduled SMS');
      return;
    }

    if (Date.now() - lastSmsSentAt < NOTIFICATION_INTERVAL_MS - 60_000) {
      return; // Too soon since last SMS
    }

    void sendOwnerStatusSms().catch((err) => {
      console.warn('[IVX-SMS-Notifier] Scheduled SMS failed:', err instanceof Error ? err.message : err);
    });
  }, NOTIFICATION_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
  console.log('[IVX-SMS-Notifier] SMS notification scheduler started (2h interval, boot kick armed)');
}

export function stopSmsNotificationScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Get current SMS notifier state (for health/dashboard).
 */
export function getSmsNotifierStatus(): {
  marker: string;
  phoneConfigured: boolean;
  phoneMasked: string | null;
  lastSmsSentAt: string | null;
  smsSentToday: number;
  smsDailyCap: number;
  schedulerRunning: boolean;
} {
  const phone = resolveOwnerRecoveryPhone();
  return {
    marker: IVX_SMS_NOTIFIER_MARKER,
    phoneConfigured: Boolean(phone),
    phoneMasked: phone ? `${phone.slice(0, 2)}***${phone.slice(-4)}` : null,
    lastSmsSentAt: lastSmsSentAt > 0 ? new Date(lastSmsSentAt).toISOString() : null,
    smsSentToday,
    smsDailyCap: MAX_SMS_PER_DAY,
    schedulerRunning: Boolean(timer),
  };
}
