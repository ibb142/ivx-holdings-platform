/**
 * IVX Autonomous owner communication loop.
 *
 * Status SMS: every 2 hours.
 * OWNER_ACTION_REQUIRED: SMS every 5 minutes while unresolved.
 * Critical owner actions: one SignalWire voice escalation per trace every 30
 * minutes while unresolved, with SMS remaining the fallback/parallel channel.
 *
 * SMS transport order is intentionally fixed:
 *   1. SignalWire (primary)
 *   2. Amazon SNS (secondary fallback)
 */
import { sendSnsSms, resolveOwnerRecoveryPhone, type SnsSmsResult } from './ivx-sns-sms';
import { sendSignalWireSms, isSignalWireSmsConfigured, type SignalWireSmsResult } from './ivx-signalwire-sms';
import { listActions, type OwnerActionRequest } from '../api/ivx-owner-action-requests';
import { getSignalWireVoiceStatus, placeAutonomousVoiceCall } from './ivx-signalwire-voice';

export const IVX_SMS_NOTIFIER_MARKER = 'ivx-autonomous-owner-comms-2026-08-16-signalwire-primary';
const STATUS_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const OWNER_ACTION_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
export const OWNER_VOICE_REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const MAX_SMS_PER_DAY = 288;
const MAX_VOICE_CALLS_PER_DAY = 24;

let lastSmsSentAt = 0;
let smsSentToday = 0;
let voiceCallsToday = 0;
let dayResetAt = Date.now() + 24 * 60 * 60 * 1000;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let ownerActionTimer: ReturnType<typeof setInterval> | null = null;
const lastOwnerActionAlertAt = new Map<string, number>();
const lastOwnerActionVoiceAt = new Map<string, number>();

type OwnerSmsResult = SignalWireSmsResult | SnsSmsResult;

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
  if (Date.now() > dayResetAt) {
    smsSentToday = 0;
    voiceCallsToday = 0;
    dayResetAt = Date.now() + 24 * 60 * 60 * 1000;
  }
}

async function fetchLiveCounts(): Promise<StatusCounts> {
  const supabaseUrl = (process.env.IVX_SUPABASE_URL || process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    return { agentsActive: null, agentsTotal: null, factoryPending: null, factoryActive: null, queueDepth: null, runningTasks: null, blockedTasks: null, databaseReachable: false };
  }
  try {
    const headers: Record<string, string> = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'count=exact' };
    const fetchCount = async (requestPath: string): Promise<number | null> => {
      try {
        const joiner = requestPath.includes('?') ? '&' : '?';
        const res = await fetch(`${supabaseUrl}${requestPath}${joiner}select=id&limit=1`, { headers, signal: AbortSignal.timeout(8000) });
        const range = res.headers.get('content-range') ?? '';
        const total = range.includes('/') ? Number(range.split('/')[1]) : NaN;
        return Number.isFinite(total) ? total : null;
      } catch { return null; }
    };
    const [agentsTotal, agentsActive, factoryPending, factoryActive, tasksRunning, tasksBlocked, tasksTotal] = await Promise.all([
      fetchCount('/rest/v1/ivx_ia_agents'), fetchCount('/rest/v1/ivx_ia_agents?status=eq.ACTIVE'),
      fetchCount('/rest/v1/ivx_ia_factory_agents?activation_status=eq.PENDING_OWNER_APPROVAL'), fetchCount('/rest/v1/ivx_ia_factory_agents?activation_status=eq.ACTIVE'),
      fetchCount('/rest/v1/ivx_ia_tasks?status=eq.RUNNING'), fetchCount('/rest/v1/ivx_ia_tasks?status=eq.BLOCKED'), fetchCount('/rest/v1/ivx_ia_tasks'),
    ]);
    return { agentsActive, agentsTotal, factoryPending, factoryActive, queueDepth: tasksTotal, runningTasks: tasksRunning, blockedTasks: tasksBlocked, databaseReachable: agentsTotal !== null };
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

async function sendSms(message: string): Promise<OwnerSmsResult> {
  resetDailyCounterIfNeeded();
  const phone = resolveOwnerRecoveryPhone();
  if (!phone) return { ok: false, status: 'missing_config', missingEnvNames: ['IVX_OWNER_RECOVERY_PHONE'], error: 'No owner phone configured', sentAt: new Date().toISOString() };
  if (smsSentToday >= MAX_SMS_PER_DAY) return { ok: false, status: 'rate_limited', missingEnvNames: [], error: 'Daily SMS cap reached', sentAt: new Date().toISOString() };

  let result: OwnerSmsResult = await sendSignalWireSms({ to: phone, message: message.slice(0, 155) });
  let transport: 'signalwire' | 'amazon_sns' = 'signalwire';

  if (!result.ok) {
    console.warn('[IVX-Owner-Comms] SignalWire SMS failed, using Amazon SNS fallback:', result.status, result.error?.slice(0, 120));
    result = await sendSnsSms({ to: phone, message: message.slice(0, 155), senderId: 'IVX' });
    transport = 'amazon_sns';
  }

  if (result.ok) {
    lastSmsSentAt = Date.now();
    smsSentToday += 1;
    console.log('[IVX-Owner-Comms] SMS sent via', transport, 'to', `${phone.slice(0, 2)}***${phone.slice(-4)}`);
  } else {
    console.warn('[IVX-Owner-Comms] SignalWire primary and Amazon SNS fallback both failed:', result.status, result.error?.slice(0, 120));
  }
  return result;
}

export async function sendOwnerStatusSms(): Promise<OwnerSmsResult> { return sendSms(buildStatusSms(await fetchLiveCounts())); }
export async function sendOwnerAlertSms(alertMessage: string): Promise<OwnerSmsResult> { return sendSms(`IVX ALERT: ${alertMessage}`); }

function buildOwnerActionSms(action: OwnerActionRequest): string {
  const task = action.taskName.slice(0, 42);
  const need = (action.actionRequired || action.blockerMessage || 'Owner action required').slice(0, 72);
  return `IVX NEEDS YOU: ${task}. ${need}. Trace ${action.traceId}`;
}

function buildOwnerActionVoice(action: OwnerActionRequest): string {
  const task = action.taskName.replace(/[_-]+/g, ' ').slice(0, 120);
  const blocker = (action.blockerMessage || 'Autonomous cannot continue this task without owner action.').slice(0, 350);
  const required = (action.actionRequired || 'Please review the IVX owner dashboard and complete the requested owner action.').slice(0, 350);
  return `Hello. This is IVX Autonomous. I need your attention for ${task}. The current blocker is: ${blocker}. What I need from you is: ${required}. Once verified, Autonomous will continue the work automatically.`;
}

function isCriticalOwnerAction(action: OwnerActionRequest): boolean {
  const combined = `${action.taskName} ${action.blockerMessage} ${action.actionRequired}`.toLowerCase();
  return /critical|p0|production|deploy|credential|payment|approval|security|auth|database|outage|blocked/.test(combined);
}

export async function scanAndNotifyOwnerActions(): Promise<{ pending: number; smsSent: number; voiceQueued: number; skipped: number }> {
  resetDailyCounterIfNeeded();
  let smsSent = 0;
  let voiceQueued = 0;
  let skipped = 0;
  const actions = await listActions();
  const pending = actions.filter((action) => action.ownerActionRequired && action.status === 'OWNER_ACTION_REQUIRED');
  const pendingIds = new Set(pending.map((action) => action.traceId));

  for (const traceId of [...lastOwnerActionAlertAt.keys()]) if (!pendingIds.has(traceId)) lastOwnerActionAlertAt.delete(traceId);
  for (const traceId of [...lastOwnerActionVoiceAt.keys()]) if (!pendingIds.has(traceId)) lastOwnerActionVoiceAt.delete(traceId);

  for (const action of pending) {
    const now = Date.now();
    const lastSms = lastOwnerActionAlertAt.get(action.traceId) ?? 0;
    if (now - lastSms >= OWNER_ACTION_REMINDER_INTERVAL_MS) {
      const result = await sendOwnerAlertSms(buildOwnerActionSms(action));
      if (result.ok) { lastOwnerActionAlertAt.set(action.traceId, now); smsSent += 1; } else skipped += 1;
    }

    const lastVoice = lastOwnerActionVoiceAt.get(action.traceId) ?? 0;
    if (isCriticalOwnerAction(action) && voiceCallsToday < MAX_VOICE_CALLS_PER_DAY && now - lastVoice >= OWNER_VOICE_REMINDER_INTERVAL_MS) {
      const call = await placeAutonomousVoiceCall({ traceId: action.traceId, message: buildOwnerActionVoice(action) });
      if (call.requestStatus === 'queued') {
        lastOwnerActionVoiceAt.set(action.traceId, now);
        voiceCallsToday += 1;
        voiceQueued += 1;
      } else {
        console.warn('[IVX-Owner-Comms] Voice escalation failed:', call.error);
        skipped += 1;
      }
    }
  }
  return { pending: pending.length, smsSent, voiceQueued, skipped };
}

export function startSmsNotificationScheduler(): void {
  if (!statusTimer) {
    const bootKick = setTimeout(() => {
      void sendOwnerStatusSms().catch((err) => console.warn('[IVX-Owner-Comms] Boot status failed:', err instanceof Error ? err.message : err));
      void scanAndNotifyOwnerActions().catch((err) => console.warn('[IVX-Owner-Comms] Boot owner-action scan failed:', err instanceof Error ? err.message : err));
    }, 30_000);
    if (typeof bootKick.unref === 'function') bootKick.unref();
    statusTimer = setInterval(() => {
      resetDailyCounterIfNeeded();
      if (Date.now() - lastSmsSentAt < STATUS_INTERVAL_MS - 60_000) return;
      void sendOwnerStatusSms().catch((err) => console.warn('[IVX-Owner-Comms] Scheduled status failed:', err instanceof Error ? err.message : err));
    }, STATUS_INTERVAL_MS);
    if (typeof statusTimer.unref === 'function') statusTimer.unref();
  }
  if (!ownerActionTimer) {
    ownerActionTimer = setInterval(() => {
      void scanAndNotifyOwnerActions().catch((err) => console.warn('[IVX-Owner-Comms] Owner-action scan failed:', err instanceof Error ? err.message : err));
    }, OWNER_ACTION_REMINDER_INTERVAL_MS);
    if (typeof ownerActionTimer.unref === 'function') ownerActionTimer.unref();
  }
  console.log('[IVX-Owner-Comms] Scheduler started: status=2h owner-action-sms=5m critical-voice=30m sms=signalwire->amazon-sns');
}

export function stopSmsNotificationScheduler(): void {
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  if (ownerActionTimer) { clearInterval(ownerActionTimer); ownerActionTimer = null; }
}

export function getSmsNotifierStatus() {
  const phone = resolveOwnerRecoveryPhone();
  return {
    marker: IVX_SMS_NOTIFIER_MARKER,
    phoneConfigured: Boolean(phone),
    signalwireSmsConfigured: isSignalWireSmsConfigured(),
    smsPrimary: 'signalwire' as const,
    smsFallback: 'amazon_sns' as const,
    phoneMasked: phone ? `${phone.slice(0, 2)}***${phone.slice(-4)}` : null,
    lastSmsSentAt: lastSmsSentAt > 0 ? new Date(lastSmsSentAt).toISOString() : null,
    smsSentToday,
    smsDailyCap: MAX_SMS_PER_DAY,
    schedulerRunning: Boolean(statusTimer),
    ownerActionSchedulerRunning: Boolean(ownerActionTimer),
    ownerActionReminderMinutes: OWNER_ACTION_REMINDER_INTERVAL_MS / 60_000,
    trackedPendingActions: lastOwnerActionAlertAt.size,
    voice: {
      ...getSignalWireVoiceStatus(),
      callsToday: voiceCallsToday,
      dailyCap: MAX_VOICE_CALLS_PER_DAY,
      criticalReminderMinutes: OWNER_VOICE_REMINDER_INTERVAL_MS / 60_000,
      trackedPendingActions: lastOwnerActionVoiceAt.size,
    },
  };
}
