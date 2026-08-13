/**
 * IVX Autonomous SMS Notifier — owner status + blocker conversation loop.
 *
 * Status: every 2 hours.
 * Owner-action alerts: every 5 minutes while a verified OWNER_ACTION_REQUIRED
 * request remains unresolved. Alerts are deduplicated by traceId and stop when
 * the request leaves OWNER_ACTION_REQUIRED.
 *
 * No phone number is hard-coded. The destination is resolved from secure
 * runtime owner variables (IVX_OWNER_RECOVERY_PHONE and existing fallbacks).
 */
import { sendSnsSms, resolveOwnerRecoveryPhone, type SnsSmsResult } from './ivx-sns-sms';
import { sendTwilioSms, isTwilioSmsConfigured, type TwilioSmsResult } from './ivx-twilio-sms';
import { listActions, type OwnerActionRequest } from '../api/ivx-owner-action-requests';

export const IVX_SMS_NOTIFIER_MARKER = 'ivx-autonomous-sms-notifier-2026-08-13-enterprise';
const STATUS_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const OWNER_ACTION_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SMS_PER_DAY = 288;

let lastSmsSentAt = 0;
let smsSentToday = 0;
let smsDayResetAt = Date.now() + 24 * 60 * 60 * 1000;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let ownerActionTimer: ReturnType<typeof setInterval> | null = null;
const lastOwnerActionAlertAt = new Map<string, number>();

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

function resetDailyCounterIfNeeded(): void {
  if (Date.now() > smsDayResetAt) {
    smsSentToday = 0;
    smsDayResetAt = Date.now() + 24 * 60 * 60 * 1000;
  }
}

async function fetchLiveCounts(): Promise<StatusCounts> {
  const supabaseUrl = (process.env.IVX_SUPABASE_URL || process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    return { agentsActive: null, agentsTotal: null, factoryPending: null, factoryActive: null, queueDepth: null, runningTasks: null, blockedTasks: null, databaseReachable: false };
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
        const joiner = path.includes('?') ? '&' : '?';
        const res = await fetch(`${supabaseUrl}${path}${joiner}select=id&limit=1`, { headers, signal: AbortSignal.timeout(8000) });
        const range = res.headers.get('content-range') ?? '';
        const total = range.includes('/') ? Number(range.split('/')[1]) : NaN;
        return Number.isFinite(total) ? total : null;
      } catch {
        return null;
      }
    };
    const [agentsTotal, agentsActive, factoryPending, factoryActive, tasksRunning, tasksBlocked, tasksTotal] = await Promise.all([
      fetchCount('/rest/v1/ivx_ia_agents'),
      fetchCount('/rest/v1/ivx_ia_agents?status=eq.ACTIVE'),
      fetchCount('/rest/v1/ivx_ia_factory_agents?activation_status=eq.PENDING_OWNER_APPROVAL'),
      fetchCount('/rest/v1/ivx_ia_factory_agents?activation_status=eq.ACTIVE'),
      fetchCount('/rest/v1/ivx_ia_tasks?status=eq.RUNNING'),
      fetchCount('/rest/v1/ivx_ia_tasks?status=eq.BLOCKED'),
      fetchCount('/rest/v1/ivx_ia_tasks'),
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
    return { agentsActive: null, agentsTotal: null, factoryPending: null, factoryActive: null, queueDepth: null, runningTasks: null, blockedTasks: null, databaseReachable: false };
  }
}

function buildStatusSms(counts: StatusCounts): string {
  const db = counts.databaseReachable ? 'OK' : 'DOWN';
  const ia = counts.agentsActive !== null ? `${counts.agentsActive}/${counts.agentsTotal}` : 'n/a';
  const af = counts.factoryPending !== null ? `pend:${counts.factoryPending} active:${counts.factoryActive}` : 'n/a';
  const q = counts.queueDepth !== null ? `q:${counts.queueDepth}` : 'q:n/a';
  const run = counts.runningTasks !== null ? ` run:${counts.runningTasks}` : '';
  const blk = counts.blockedTasks && counts.blockedTasks > 0 ? ` BLK:${counts.blockedTasks}` : '';
  return `IVX 24/7: db=${db} IA=${ia} AF=${af} ${q}${run}${blk}`;
}

async function sendSms(message: string): Promise<SnsSmsResult> {
  resetDailyCounterIfNeeded();
  const phone = resolveOwnerRecoveryPhone();
  if (!phone) {
    return { ok: false, status: 'missing_config', missingEnvNames: ['IVX_OWNER_RECOVERY_PHONE'], error: 'No owner phone configured', sentAt: new Date().toISOString() };
  }
  if (smsSentToday >= MAX_SMS_PER_DAY) {
    return { ok: false, status: 'rate_limited', missingEnvNames: [], error: 'Daily SMS cap reached', sentAt: new Date().toISOString() };
  }

  let result: SnsSmsResult | TwilioSmsResult = await sendSnsSms({ to: phone, message: message.slice(0, 155), senderId: 'IVX' });
  if (!result.ok && isTwilioSmsConfigured()) {
    result = await sendTwilioSms({ to: phone, message: message.slice(0, 155) });
  }
  if (result.ok) {
    lastSmsSentAt = Date.now();
    smsSentToday += 1;
    console.log('[IVX-SMS-Notifier] SMS sent to', `${phone.slice(0, 2)}***${phone.slice(-4)}`);
  } else {
    console.warn('[IVX-SMS-Notifier] SMS failed:', result.status, result.error?.slice(0, 120));
  }
  return result as SnsSmsResult;
}

export async function sendOwnerStatusSms(): Promise<SnsSmsResult> {
  return sendSms(buildStatusSms(await fetchLiveCounts()));
}

export async function sendOwnerAlertSms(alertMessage: string): Promise<SnsSmsResult> {
  return sendSms(`IVX ALERT: ${alertMessage}`);
}

function buildOwnerActionSms(action: OwnerActionRequest): string {
  const task = action.taskName.slice(0, 42);
  const need = (action.actionRequired || action.blockerMessage || 'Owner action required').slice(0, 72);
  return `IVX NEEDS YOU: ${task}. ${need}. Trace ${action.traceId}`;
}

/**
 * Scan durable owner-action requests and send/remind every 5 minutes only while
 * a request is unresolved. This is the server-side "Autonomous can talk" loop.
 */
export async function scanAndNotifyOwnerActions(): Promise<{ pending: number; sent: number; skipped: number }> {
  resetDailyCounterIfNeeded();
  let sent = 0;
  let skipped = 0;
  const actions = await listActions();
  const pending = actions.filter((action) => action.ownerActionRequired && action.status === 'OWNER_ACTION_REQUIRED');
  const pendingIds = new Set(pending.map((action) => action.traceId));

  for (const traceId of [...lastOwnerActionAlertAt.keys()]) {
    if (!pendingIds.has(traceId)) lastOwnerActionAlertAt.delete(traceId);
  }

  for (const action of pending) {
    const last = lastOwnerActionAlertAt.get(action.traceId) ?? 0;
    if (Date.now() - last < OWNER_ACTION_REMINDER_INTERVAL_MS) {
      skipped += 1;
      continue;
    }
    const result = await sendOwnerAlertSms(buildOwnerActionSms(action));
    if (result.ok) {
      lastOwnerActionAlertAt.set(action.traceId, Date.now());
      sent += 1;
    } else {
      skipped += 1;
    }
  }
  return { pending: pending.length, sent, skipped };
}

export function startSmsNotificationScheduler(): void {
  if (!statusTimer) {
    const bootKick = setTimeout(() => {
      void sendOwnerStatusSms().catch((err) => console.warn('[IVX-SMS-Notifier] Boot status failed:', err instanceof Error ? err.message : err));
      void scanAndNotifyOwnerActions().catch((err) => console.warn('[IVX-SMS-Notifier] Boot owner-action scan failed:', err instanceof Error ? err.message : err));
    }, 30_000);
    if (typeof bootKick.unref === 'function') bootKick.unref();

    statusTimer = setInterval(() => {
      resetDailyCounterIfNeeded();
      if (Date.now() - lastSmsSentAt < STATUS_INTERVAL_MS - 60_000) return;
      void sendOwnerStatusSms().catch((err) => console.warn('[IVX-SMS-Notifier] Scheduled status failed:', err instanceof Error ? err.message : err));
    }, STATUS_INTERVAL_MS);
    if (typeof statusTimer.unref === 'function') statusTimer.unref();
  }

  if (!ownerActionTimer) {
    ownerActionTimer = setInterval(() => {
      void scanAndNotifyOwnerActions().catch((err) => console.warn('[IVX-SMS-Notifier] Owner-action scan failed:', err instanceof Error ? err.message : err));
    }, OWNER_ACTION_REMINDER_INTERVAL_MS);
    if (typeof ownerActionTimer.unref === 'function') ownerActionTimer.unref();
  }

  console.log('[IVX-SMS-Notifier] Scheduler started: status=2h owner-action=5m');
}

export function stopSmsNotificationScheduler(): void {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
  if (ownerActionTimer) {
    clearInterval(ownerActionTimer);
    ownerActionTimer = null;
  }
}

export function getSmsNotifierStatus(): {
  marker: string;
  phoneConfigured: boolean;
  twilioConfigured: boolean;
  phoneMasked: string | null;
  lastSmsSentAt: string | null;
  smsSentToday: number;
  smsDailyCap: number;
  schedulerRunning: boolean;
  ownerActionSchedulerRunning: boolean;
  ownerActionReminderMinutes: number;
  trackedPendingActions: number;
} {
  const phone = resolveOwnerRecoveryPhone();
  return {
    marker: IVX_SMS_NOTIFIER_MARKER,
    phoneConfigured: Boolean(phone),
    twilioConfigured: isTwilioSmsConfigured(),
    phoneMasked: phone ? `${phone.slice(0, 2)}***${phone.slice(-4)}` : null,
    lastSmsSentAt: lastSmsSentAt > 0 ? new Date(lastSmsSentAt).toISOString() : null,
    smsSentToday,
    smsDailyCap: MAX_SMS_PER_DAY,
    schedulerRunning: Boolean(statusTimer),
    ownerActionSchedulerRunning: Boolean(ownerActionTimer),
    ownerActionReminderMinutes: OWNER_ACTION_REMINDER_INTERVAL_MS / 60_000,
    trackedPendingActions: lastOwnerActionAlertAt.size,
  };
}
