/** Canonical IVX SMS transport. All production SMS should route through SignalWire. */
import { normalizePhoneToE164 } from './ivx-sns-sms';

export type SignalWireSmsResult = {
  ok: boolean;
  status: 'sent' | 'missing_config' | 'rate_limited' | 'failed';
  messageId?: string;
  httpStatus?: number;
  to?: string;
  from?: string;
  missingEnvNames: string[];
  error?: string;
  sentAt: string;
  provider: 'signalwire';
};

type Config = { projectId: string; token: string; space: string; from: string | null };

function env(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSpace(raw: string): string {
  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function getSignalWireSmsConfig(): Config | null {
  const projectId = env('SIGNALWIRE_PROJECT_ID') || env('SIGNALWIRE_PROJECT_KEY');
  const token = env('SIGNALWIRE_API_TOKEN') || env('SIGNALWIRE_TOKEN');
  const space = normalizeSpace(env('SIGNALWIRE_SPACE_URL') || env('SIGNALWIRE_SPACE'));
  const from = normalizePhoneToE164(env('SIGNALWIRE_FROM_NUMBER')) || null;
  if (!projectId || !token || !space) return null;
  return { projectId, token, space, from };
}

export function isSignalWireSmsConfigured(): boolean {
  return Boolean(getSignalWireSmsConfig());
}

export function getSignalWireSmsStatus(): {
  configured: boolean;
  projectConfigured: boolean;
  tokenConfigured: boolean;
  spaceConfigured: boolean;
  fromNumberConfigured: boolean;
} {
  return {
    configured: isSignalWireSmsConfigured(),
    projectConfigured: Boolean(env('SIGNALWIRE_PROJECT_ID') || env('SIGNALWIRE_PROJECT_KEY')),
    tokenConfigured: Boolean(env('SIGNALWIRE_API_TOKEN') || env('SIGNALWIRE_TOKEN')),
    spaceConfigured: Boolean(env('SIGNALWIRE_SPACE_URL') || env('SIGNALWIRE_SPACE')),
    fromNumberConfigured: Boolean(env('SIGNALWIRE_FROM_NUMBER')),
  };
}

function auth(config: Config): string {
  return `Basic ${Buffer.from(`${config.projectId}:${config.token}`).toString('base64')}`;
}

async function discoverSmsFromNumber(config: Config): Promise<string | null> {
  if (config.from) return config.from;
  const url = `https://${config.space}/api/laml/2010-04-01/Accounts/${encodeURIComponent(config.projectId)}/IncomingPhoneNumbers.json?PageSize=50`;
  const response = await fetch(url, {
    headers: { Authorization: auth(config), Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const rows = payload && Array.isArray(payload.incoming_phone_numbers) ? payload.incoming_phone_numbers : [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const capabilities = record.capabilities && typeof record.capabilities === 'object'
      ? record.capabilities as Record<string, unknown>
      : null;
    const smsAllowed = capabilities ? capabilities.sms !== false : true;
    const phone = normalizePhoneToE164(typeof record.phone_number === 'string' ? record.phone_number : '');
    if (smsAllowed && phone) return phone;
  }
  return null;
}

/** Send one SMS through SignalWire. Returns structured status and never throws. */
export async function sendSignalWireSms(input: {
  to: string;
  message: string;
  from?: string | null;
}): Promise<SignalWireSmsResult> {
  const sentAt = new Date().toISOString();
  const config = getSignalWireSmsConfig();
  const to = normalizePhoneToE164(input.to);
  const explicitFrom = normalizePhoneToE164(input.from || '');
  const missingEnvNames: string[] = [];

  if (!config) {
    if (!env('SIGNALWIRE_PROJECT_ID') && !env('SIGNALWIRE_PROJECT_KEY')) missingEnvNames.push('SIGNALWIRE_PROJECT_ID');
    if (!env('SIGNALWIRE_API_TOKEN') && !env('SIGNALWIRE_TOKEN')) missingEnvNames.push('SIGNALWIRE_API_TOKEN');
    if (!env('SIGNALWIRE_SPACE_URL') && !env('SIGNALWIRE_SPACE')) missingEnvNames.push('SIGNALWIRE_SPACE_URL');
    return {
      ok: false,
      status: 'missing_config',
      to: to || undefined,
      missingEnvNames,
      error: 'SignalWire SMS is not fully configured.',
      sentAt,
      provider: 'signalwire',
    };
  }

  if (!/^\+\d{8,15}$/.test(to)) {
    return {
      ok: false,
      status: 'failed',
      to: to || undefined,
      missingEnvNames,
      error: 'Destination phone is not a valid E.164 number.',
      sentAt,
      provider: 'signalwire',
    };
  }

  const from = explicitFrom || await discoverSmsFromNumber(config).catch(() => null);
  if (!from) {
    return {
      ok: false,
      status: 'missing_config',
      to,
      missingEnvNames: ['SIGNALWIRE_FROM_NUMBER'],
      error: 'No SignalWire SMS-capable From number could be resolved.',
      sentAt,
      provider: 'signalwire',
    };
  }

  const endpoint = `https://${config.space}/api/laml/2010-04-01/Accounts/${encodeURIComponent(config.projectId)}/Messages.json`;
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', from);
  form.set('Body', input.message.slice(0, 1600));

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth(config),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(body) as Record<string, unknown>; } catch { /* keep empty */ }

    if (!response.ok) {
      const rateLimited = response.status === 429 || /throttl|rate.?limit|too many/i.test(body);
      return {
        ok: false,
        status: rateLimited ? 'rate_limited' : 'failed',
        httpStatus: response.status,
        to,
        from,
        missingEnvNames,
        error: body.slice(0, 400) || `SignalWire responded ${response.status}`,
        sentAt,
        provider: 'signalwire',
      };
    }

    const messageId = typeof json.sid === 'string' ? json.sid.trim() : undefined;
    return {
      ok: true,
      status: 'sent',
      messageId: messageId || undefined,
      httpStatus: response.status,
      to,
      from,
      missingEnvNames,
      sentAt,
      provider: 'signalwire',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      to,
      from,
      missingEnvNames,
      error: error instanceof Error ? error.message : 'SignalWire SMS send request failed.',
      sentAt,
      provider: 'signalwire',
    };
  }
}
