import crypto from 'node:crypto';
import path from 'node:path';
import { normalizePhoneToE164, resolveOwnerRecoveryPhone } from './ivx-sns-sms';
import { readDurableJson, writeDurableJson } from './ivx-durable-store';
import {
  extractIVXSupabaseServiceRoleKey,
  getIVXOwnerEmailAllowlist,
  resolveIVXSupabaseUrl,
} from '../../expo/shared/ivx/access-control';

export const IVX_SIGNALWIRE_VOICE_MARKER = 'ivx-signalwire-voice-2026-08-16-live-cert-v3';

const CALL_LEDGER_PATH = path.join(process.cwd(), 'logs', 'audit', 'autonomous-voice', 'calls.json');
const API_BASE = (process.env.IVX_PUBLIC_API_BASE_URL || process.env.IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

/** Resolve Twilio credentials from any of the known env var naming patterns. */
function getTwilioConfig(): { accountSid: string; authToken: string; fromNumber: string | null } | null {
  const accountSid = trim(process.env.IVX_TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || '');
  const authToken = trim(process.env.IVX_TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || '');
  const fromNumber = normalizePhoneToE164(trim(process.env.IVX_TWILIO_FROM_PHONE || process.env.TWILIO_FROM_PHONE || process.env.TWILIO_FROM_NUMBER || '')) || null;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken, fromNumber };
}

type SignalWireConfig = {
  projectId: string;
  apiToken: string;
  spaceUrl: string;
  fromNumber: string | null;
};

export type AutonomousVoiceCallRecord = {
  id: string;
  traceId: string;
  toMasked: string;
  fromMasked: string | null;
  callSid: string | null;
  providerStatus: string | null;
  requestStatus: 'queued' | 'failed';
  error: string | null;
  createdAt: string;
  callbackAt?: string | null;
};

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSpaceUrl(raw: string): string {
  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function getSignalWireVoiceConfig(): SignalWireConfig | null {
  const projectId = trim(process.env.SIGNALWIRE_PROJECT_ID || process.env.SIGNALWIRE_PROJECT_KEY);
  const apiToken = trim(process.env.SIGNALWIRE_API_TOKEN || process.env.SIGNALWIRE_TOKEN);
  const spaceUrl = normalizeSpaceUrl(trim(process.env.SIGNALWIRE_SPACE_URL || process.env.SIGNALWIRE_SPACE));
  const fromNumber = normalizePhoneToE164(trim(process.env.SIGNALWIRE_FROM_NUMBER)) || null;
  if (!projectId || !apiToken || !spaceUrl) return null;
  return { projectId, apiToken, spaceUrl, fromNumber };
}

export function getSignalWireVoiceStatus(): {
  configured: boolean;
  projectConfigured: boolean;
  tokenConfigured: boolean;
  spaceConfigured: boolean;
  fromNumberConfigured: boolean;
  ownerPhoneConfigured: boolean;
  twilioConfigured: boolean;
} {
  const twilio = getTwilioConfig();
  return {
    configured: Boolean(getSignalWireVoiceConfig()) || Boolean(twilio),
    projectConfigured: Boolean(trim(process.env.SIGNALWIRE_PROJECT_ID || process.env.SIGNALWIRE_PROJECT_KEY)) || Boolean(twilio?.accountSid),
    tokenConfigured: Boolean(trim(process.env.SIGNALWIRE_API_TOKEN || process.env.SIGNALWIRE_TOKEN)) || Boolean(twilio?.authToken),
    spaceConfigured: Boolean(trim(process.env.SIGNALWIRE_SPACE_URL || process.env.SIGNALWIRE_SPACE)) || Boolean(twilio?.accountSid),
    fromNumberConfigured: Boolean(trim(process.env.SIGNALWIRE_FROM_NUMBER)) || Boolean(twilio?.fromNumber),
    ownerPhoneConfigured: Boolean(resolveOwnerRecoveryPhone()),
    twilioConfigured: Boolean(twilio),
  };
}

function resolveServiceRoleKey(): string {
  return extractIVXSupabaseServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY)
    || extractIVXSupabaseServiceRoleKey(process.env.SUPABASE_SERVICE_KEY)
    || '';
}

/**
 * Resolve an owner phone without hard-coding personal data in source.
 * Priority: explicit call target -> protected runtime env -> allowlisted owner profile.
 * The database lookup uses the backend service-role key and only accepts a profile
 * whose email is already in the canonical IVX owner allowlist.
 */
async function resolveAutonomousOwnerPhone(explicit?: string | null): Promise<string> {
  const direct = normalizePhoneToE164(trim(explicit));
  if (direct) return direct;

  const envPhone = normalizePhoneToE164(resolveOwnerRecoveryPhone());
  if (envPhone) return envPhone;

  const serviceRole = resolveServiceRoleKey();
  const ownerEmails = getIVXOwnerEmailAllowlist();
  if (!serviceRole || ownerEmails.length === 0) return '';

  const supabaseUrl = resolveIVXSupabaseUrl().replace(/\/+$/, '');
  for (const ownerEmail of ownerEmails) {
    try {
      const query = new URLSearchParams({
        select: 'email,phone,role',
        email: `eq.${ownerEmail}`,
        limit: '1',
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${query.toString()}`, {
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const rows = await response.json().catch(() => []) as Array<Record<string, unknown>>;
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) continue;
      const email = trim(row.email).toLowerCase();
      const role = trim(row.role).toLowerCase();
      const phone = normalizePhoneToE164(trim(row.phone));
      if (email === ownerEmail && role === 'owner' && phone) return phone;
    } catch {
      // Continue to the next allowlisted owner; caller will persist a clear failure if none resolve.
    }
  }
  return '';
}

function basicAuth(config: SignalWireConfig): string {
  return `Basic ${Buffer.from(`${config.projectId}:${config.apiToken}`).toString('base64')}`;
}

function maskPhone(value: string | null): string | null {
  if (!value) return null;
  return value.length >= 6 ? `${value.slice(0, 2)}***${value.slice(-4)}` : '***';
}

async function discoverVoiceFromNumber(config: SignalWireConfig): Promise<string | null> {
  if (config.fromNumber) return config.fromNumber;
  const url = `https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(config.projectId)}/IncomingPhoneNumbers.json?PageSize=50`;
  const response = await fetch(url, {
    headers: { Authorization: basicAuth(config), Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const rows = payload && Array.isArray(payload.incoming_phone_numbers) ? payload.incoming_phone_numbers : [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const capabilities = record.capabilities && typeof record.capabilities === 'object' ? record.capabilities as Record<string, unknown> : null;
    const voiceAllowed = capabilities ? capabilities.voice !== false : true;
    const phone = normalizePhoneToE164(trim(record.phone_number));
    if (voiceAllowed && phone) return phone;
  }
  return null;
}

export function signVoiceTrace(traceId: string, token?: string): string {
  const secret = token || getSignalWireVoiceConfig()?.apiToken || '';
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(traceId).digest('hex');
}

export function verifyVoiceTrace(traceId: string, signature: string): boolean {
  const expected = signVoiceTrace(traceId);
  if (!expected || !signature || expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function buildAutonomousVoiceLaml(message: string): string {
  const safe = xmlEscape(message.slice(0, 1600));
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-US" voice="woman">${safe}</Say><Pause length="1"/><Say language="en-US" voice="woman">Please open the IVX owner dashboard for the exact action and trace ID. Autonomous will resume automatically after verification.</Say><Hangup/></Response>`;
}

async function appendCallRecord(record: AutonomousVoiceCallRecord): Promise<void> {
  const existing = await readDurableJson<AutonomousVoiceCallRecord[]>(CALL_LEDGER_PATH, []);
  const next = [record, ...(Array.isArray(existing) ? existing : [])].slice(0, 500);
  await writeDurableJson(CALL_LEDGER_PATH, next);
}

export async function listAutonomousVoiceCalls(limit = 50): Promise<AutonomousVoiceCallRecord[]> {
  const rows = await readDurableJson<AutonomousVoiceCallRecord[]>(CALL_LEDGER_PATH, []);
  return (Array.isArray(rows) ? rows : []).slice(0, Math.max(1, Math.min(200, limit)));
}

export async function recordAutonomousVoiceCallback(input: { traceId: string; providerStatus?: string | null; callSid?: string | null }): Promise<AutonomousVoiceCallRecord | null> {
  const rows = await readDurableJson<AutonomousVoiceCallRecord[]>(CALL_LEDGER_PATH, []);
  if (!Array.isArray(rows)) return null;
  const index = rows.findIndex((row) => row.traceId === input.traceId);
  if (index < 0) return null;
  const current = rows[index];
  const updated: AutonomousVoiceCallRecord = {
    ...current,
    providerStatus: trim(input.providerStatus) || current.providerStatus,
    callSid: trim(input.callSid) || current.callSid,
    callbackAt: new Date().toISOString(),
  };
  rows[index] = updated;
  await writeDurableJson(CALL_LEDGER_PATH, rows.slice(0, 500));
  return updated;
}

export async function placeAutonomousVoiceCall(input: { traceId: string; message: string; to?: string | null }): Promise<AutonomousVoiceCallRecord> {
  const config = getSignalWireVoiceConfig();
  const twilio = getTwilioConfig();
  const to = await resolveAutonomousOwnerPhone(input.to);
  const createdAt = new Date().toISOString();
  const id = `voice-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const fail = async (error: string): Promise<AutonomousVoiceCallRecord> => {
    const record: AutonomousVoiceCallRecord = {
      id,
      traceId: input.traceId,
      toMasked: maskPhone(to) || 'missing',
      fromMasked: null,
      callSid: null,
      providerStatus: null,
      requestStatus: 'failed',
      error,
      createdAt,
      callbackAt: null,
    };
    await appendCallRecord(record).catch(() => undefined);
    return record;
  };

  if (!config && !twilio) return fail('No voice provider credentials (SignalWire or Twilio) are bound to runtime variables.');
  if (!to) return fail('Owner phone could not be resolved from explicit target, protected runtime config, or allowlisted owner profile.');

  // ── Try Twilio first if SignalWire is not configured ──
  if (!config && twilio) {
    return placeTwilioVoiceCall(twilio, to, input, id, createdAt, fail);
  }

  // ── SignalWire path ──
  const from = await discoverVoiceFromNumber(config!).catch(() => null);
  if (!from) {
    if (twilio) return placeTwilioVoiceCall(twilio, to, input, id, createdAt, fail);
    return fail('No SignalWire voice-capable From number could be resolved.');
  }

  const sig = signVoiceTrace(input.traceId, config!.apiToken);
  const voiceUrl = `${API_BASE}/api/ivx/autonomous/voice/laml?traceId=${encodeURIComponent(input.traceId)}&sig=${encodeURIComponent(sig)}&message=${encodeURIComponent(input.message.slice(0, 900))}`;
  const statusUrl = `${API_BASE}/api/ivx/autonomous/voice/status?traceId=${encodeURIComponent(input.traceId)}&sig=${encodeURIComponent(sig)}`;
  const endpoint = `https://${config!.spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(config!.projectId)}/Calls.json`;
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', from);
  form.set('Url', voiceUrl);
  form.set('Method', 'POST');
  form.set('StatusCallback', statusUrl);
  form.set('StatusCallbackMethod', 'POST');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: basicAuth(config!), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(body) as Record<string, unknown>; } catch { /* keep empty */ }
    if (!response.ok) {
      if (twilio) return placeTwilioVoiceCall(twilio, to, input, id, createdAt, fail);
      return fail(`SignalWire create call HTTP ${response.status}: ${body.slice(0, 180)}`);
    }

    const record: AutonomousVoiceCallRecord = {
      id,
      traceId: input.traceId,
      toMasked: maskPhone(to) || '***',
      fromMasked: maskPhone(from),
      callSid: trim(json.sid) || null,
      providerStatus: trim(json.status) || 'queued',
      requestStatus: 'queued',
      error: null,
      createdAt,
      callbackAt: null,
    };
    await appendCallRecord(record).catch(() => undefined);
    return record;
  } catch (error) {
    if (twilio) return placeTwilioVoiceCall(twilio, to, input, id, createdAt, fail);
    return fail(error instanceof Error ? error.message : 'SignalWire create call failed');
  }
}

/**
 * Place a voice call via Twilio Programmable Voice.
 * Uses the IVX LAML endpoint for the voice message and status callbacks.
 */
async function placeTwilioVoiceCall(
  twilio: { accountSid: string; authToken: string; fromNumber: string | null },
  to: string,
  input: { traceId: string; message: string },
  id: string,
  createdAt: string,
  fail: (error: string) => Promise<AutonomousVoiceCallRecord>,
): Promise<AutonomousVoiceCallRecord> {
  const from = twilio.fromNumber;
  if (!from) return fail('Twilio is configured but no from-number is bound (IVX_TWILIO_FROM_PHONE / TWILIO_FROM_PHONE).');

  const sig = signVoiceTrace(input.traceId, twilio.authToken);
  const voiceUrl = `${API_BASE}/api/ivx/autonomous/voice/laml?traceId=${encodeURIComponent(input.traceId)}&sig=${encodeURIComponent(sig)}&message=${encodeURIComponent(input.message.slice(0, 900))}`;
  const statusUrl = `${API_BASE}/api/ivx/autonomous/voice/status?traceId=${encodeURIComponent(input.traceId)}&sig=${encodeURIComponent(sig)}`;
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilio.accountSid)}/Calls.json`;
  const auth = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64');
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', from);
  form.set('Url', voiceUrl);
  form.set('Method', 'POST');
  form.set('StatusCallback', statusUrl);
  form.set('StatusCallbackMethod', 'POST');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(body) as Record<string, unknown>; } catch { /* keep empty */ }
    if (!response.ok) return fail(`Twilio create call HTTP ${response.status}: ${body.slice(0, 180)}`);

    const record: AutonomousVoiceCallRecord = {
      id,
      traceId: input.traceId,
      toMasked: maskPhone(to) || '***',
      fromMasked: maskPhone(from),
      callSid: trim(json.sid) || null,
      providerStatus: trim(json.status) || 'queued',
      requestStatus: 'queued',
      error: null,
      createdAt,
      callbackAt: null,
    };
    await appendCallRecord(record).catch(() => undefined);
    return record;
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Twilio create call failed');
  }
}
