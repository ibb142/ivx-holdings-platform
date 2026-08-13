import crypto from 'node:crypto';
import path from 'node:path';
import { resolveOwnerRecoveryPhone } from './ivx-sns-sms';
import { readDurableJson, writeDurableJson } from './ivx-durable-store';

export const IVX_SIGNALWIRE_VOICE_MARKER = 'ivx-signalwire-voice-2026-08-13';

const CALL_LEDGER_PATH = path.join(process.cwd(), 'logs', 'audit', 'autonomous-voice', 'calls.json');
const API_BASE = (process.env.IVX_PUBLIC_API_BASE_URL || process.env.IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

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
};

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSpaceUrl(raw: string): string {
  const value = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return value;
}

export function getSignalWireVoiceConfig(): SignalWireConfig | null {
  const projectId = trim(process.env.SIGNALWIRE_PROJECT_ID || process.env.SIGNALWIRE_PROJECT_KEY);
  const apiToken = trim(process.env.SIGNALWIRE_API_TOKEN || process.env.SIGNALWIRE_TOKEN);
  const spaceUrl = normalizeSpaceUrl(trim(process.env.SIGNALWIRE_SPACE_URL || process.env.SIGNALWIRE_SPACE));
  const fromNumber = trim(process.env.SIGNALWIRE_FROM_NUMBER) || null;
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
} {
  return {
    configured: Boolean(getSignalWireVoiceConfig()),
    projectConfigured: Boolean(trim(process.env.SIGNALWIRE_PROJECT_ID || process.env.SIGNALWIRE_PROJECT_KEY)),
    tokenConfigured: Boolean(trim(process.env.SIGNALWIRE_API_TOKEN || process.env.SIGNALWIRE_TOKEN)),
    spaceConfigured: Boolean(trim(process.env.SIGNALWIRE_SPACE_URL || process.env.SIGNALWIRE_SPACE)),
    fromNumberConfigured: Boolean(trim(process.env.SIGNALWIRE_FROM_NUMBER)),
    ownerPhoneConfigured: Boolean(resolveOwnerRecoveryPhone()),
  };
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
    const phone = trim(record.phone_number);
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
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

export async function placeAutonomousVoiceCall(input: {
  traceId: string;
  message: string;
  to?: string | null;
}): Promise<AutonomousVoiceCallRecord> {
  const config = getSignalWireVoiceConfig();
  const to = trim(input.to) || resolveOwnerRecoveryPhone() || '';
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
    };
    await appendCallRecord(record).catch(() => undefined);
    return record;
  };

  if (!config) return fail('SignalWire voice credentials are not bound to runtime variables.');
  if (!to) return fail('Owner recovery phone is not configured.');

  const from = await discoverVoiceFromNumber(config).catch(() => null);
  if (!from) return fail('No SignalWire voice-capable From number could be resolved.');

  const sig = signVoiceTrace(input.traceId, config.apiToken);
  const voiceUrl = `${API_BASE}/api/ivx/autonomous/voice/laml?traceId=${encodeURIComponent(input.traceId)}&sig=${encodeURIComponent(sig)}&message=${encodeURIComponent(input.message.slice(0, 900))}`;
  const statusUrl = `${API_BASE}/api/ivx/autonomous/voice/status?traceId=${encodeURIComponent(input.traceId)}&sig=${encodeURIComponent(sig)}`;
  const endpoint = `https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(config.projectId)}/Calls.json`;
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
      headers: {
        Authorization: basicAuth(config),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(body) as Record<string, unknown>; } catch { /* keep empty */ }
    if (!response.ok) return fail(`SignalWire create call HTTP ${response.status}: ${body.slice(0, 180)}`);

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
    };
    await appendCallRecord(record).catch(() => undefined);
    return record;
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'SignalWire create call failed');
  }
}
