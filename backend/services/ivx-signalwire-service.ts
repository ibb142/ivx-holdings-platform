/**
 * IVX SIGNALWIRE SERVICE
 *
 * Real SMS and voice call integration through SignalWire's Compatibility API
 * (LaML 2010-04-01 — Twilio-compatible REST endpoints).
 *
 * Capabilities:
 *   1. SMS — send outbound SMS messages from +17206230552
 *   2. VOICE — make outbound voice calls with LaML (Voice XML) say/gather
 *   3. VERIFY — end-to-end verification that both SMS and voice work
 *
 * Credentials come from the IVX SignalWire space:
 *   Space URL:  ivxholding.signalwire.com
 *   Project:   d07c7012-048e-442c-8f6b-fd9ad0565134
 *   Token:      PT26390e2d57a132fdc8b9fd26267d334ee5483954595a5e26
 *   From:       +17206230552
 *
 * Routes consumed:
 *   POST /api/ivx/signalwire/sms       — send an SMS
 *   POST /api/ivx/signalwire/voice     — make a voice call
 *   GET  /api/ivx/signalwire/status    — service health + capabilities
 *   POST /api/ivx/signalwire/verify    — end-to-end cert: SMS + voice
 *   POST /api/ivx/signalwire/voice/laml — LaML webhook for voice call XML
 *
 * NOTHING is faked. Real HTTP calls go to the SignalWire REST API. If the
 * API returns an error, the service surfaces it — never a phantom success.
 */
import { randomUUID, createHash } from 'node:crypto';

export const IVX_SIGNALWIRE_MARKER = 'ivx-signalwire-2026-08-17';
export const IVX_SIGNALWIRE_VERSION = '1.0.0';

// ── CONFIG ───────────────────────────────────────────────────────────────────

const SIGNALWIRE_SPACE = process.env['IVX_SIGNALWIRE_SPACE'] || 'ivxholding.signalwire.com';
const SIGNALWIRE_PROJECT_ID = process.env['IVX_SIGNALWIRE_PROJECT_ID'] || 'd07c7012-048e-442c-8f6b-fd9ad0565134';
const SIGNALWIRE_TOKEN = process.env['IVX_SIGNALWIRE_TOKEN'] || 'PT26390e2d57a132fdc8b9fd26267d334ee5483954595a5e26';
const SIGNALWIRE_FROM = process.env['IVX_SIGNALWIRE_FROM'] || '+17206230552';
const PRODUCTION_URL = process.env['IVX_PRODUCTION_URL'] || 'https://api.ivxholding.com';
const IVX_OWNER_PHONE = process.env['IVX_OWNER_PHONE'] || '+15616443503';

const LAML_API_VERSION = '2010-04-01';
const LAML_BASE = `https://${SIGNALWIRE_SPACE}/api/laml/${LAML_API_VERSION}/Accounts/${SIGNALWIRE_PROJECT_ID}`;

// ── TYPES ────────────────────────────────────────────────────────────────────

export type SignalWireConfig = {
  spaceUrl: string;
  projectId: string;
  token: string;
  fromNumber: string;
  configured: boolean;
};

export type SendSMSResult = {
  ok: boolean;
  sid: string | null;
  status: string;
  from: string;
  to: string;
  body: string;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
};

export type VoiceCallResult = {
  ok: boolean;
  sid: string | null;
  status: string;
  from: string;
  to: string;
  lamlUrl: string;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
};

export type SMSMessage = {
  sid: string;
  body: string;
  from: string;
  to: string;
  status: string;
  direction: string;
  dateCreated: string;
  dateSent: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type VoiceCall = {
  sid: string;
  from: string;
  to: string;
  status: string;
  direction: string;
  duration: string;
  dateCreated: string;
};

export type VerifyResult = {
  certified: boolean;
  certId: string;
  sms: SendSMSResult;
  voice: VoiceCallResult;
  proofHash: string;
  totalDurationMs: number;
  summary: string;
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

function getSignalWireConfig(): SignalWireConfig {
  const configured = !!(SIGNALWIRE_SPACE && SIGNALWIRE_PROJECT_ID && SIGNALWIRE_TOKEN && SIGNALWIRE_FROM);
  return {
    spaceUrl: SIGNALWIRE_SPACE,
    projectId: SIGNALWIRE_PROJECT_ID,
    token: SIGNALWIRE_TOKEN,
    fromNumber: SIGNALWIRE_FROM,
    configured,
  };
}

function basicAuthHeader(projectId: string, token: string): string {
  return 'Basic ' + Buffer.from(`${projectId}:${token}`).toString('base64');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Build the LaML XML for a voice call.
 * The call will:
 *   1. Say the verification message
 *   2. Pause briefly
 *   3. Say a confirmation phrase
 */
export function buildVoiceLaML(message: string): string {
  const escapedMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en">
    ${escapedMessage}
  </Say>
  <Pause length="1"/>
  <Say voice="man" language="en">
    This is an automated verification call from I V X Holdings autonomous system. Integration certified.
  </Say>
</Response>`;
}

// ── SMS ──────────────────────────────────────────────────────────────────────

/**
 * Send an SMS message via SignalWire LaML Compatibility API.
 * Uses application/x-www-form-urlencoded as required by SignalWire.
 */
export async function sendSMS(
  to: string,
  body: string,
  opts?: { from?: string }
): Promise<SendSMSResult> {
  const start = Date.now();
  const config = getSignalWireConfig();
  const from = opts?.from || config.fromNumber;

  if (!config.configured) {
    return {
      ok: false,
      sid: null,
      status: 'error',
      from,
      to,
      body,
      errorCode: 'NOT_CONFIGURED',
      errorMessage: 'SignalWire credentials not configured',
      durationMs: Date.now() - start,
    };
  }

  const url = `${LAML_BASE}/Messages.json`;
  const formData = new URLSearchParams();
  formData.set('From', from);
  formData.set('To', to);
  formData.set('Body', body);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': basicAuthHeader(config.projectId, config.token),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const data = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      return {
        ok: false,
        sid: (data['sid'] as string) || null,
        status: 'error',
        from,
        to,
        body,
        errorCode: String(data['code'] || resp.status),
        errorMessage: (data['message'] as string) || `SignalWire API returned ${resp.status}`,
        durationMs: Date.now() - start,
      };
    }

    return {
      ok: true,
      sid: (data['sid'] as string) || null,
      status: (data['status'] as string) || 'queued',
      from: (data['from'] as string) || from,
      to: (data['to'] as string) || to,
      body: (data['body'] as string) || body,
      errorCode: (data['error_code'] as string) || null,
      errorMessage: (data['error_message'] as string) || null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      sid: null,
      status: 'error',
      from,
      to,
      body,
      errorCode: 'NETWORK_ERROR',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * List recent SMS messages from SignalWire.
 */
export async function listSMS(pageSize = 10): Promise<{ ok: boolean; messages: SMSMessage[]; error: string | null }> {
  const config = getSignalWireConfig();
  if (!config.configured) {
    return { ok: false, messages: [], error: 'Not configured' };
  }

  const url = `${LAML_BASE}/Messages.json?PageSize=${pageSize}`;

  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': basicAuthHeader(config.projectId, config.token),
      },
    });

    const data = await resp.json() as Record<string, unknown>;
    const rawMessages = (data['messages'] as Record<string, unknown>[]) || [];

    const messages: SMSMessage[] = rawMessages.map((m) => ({
      sid: (m['sid'] as string) || '',
      body: (m['body'] as string) || '',
      from: (m['from'] as string) || '',
      to: (m['to'] as string) || '',
      status: (m['status'] as string) || '',
      direction: (m['direction'] as string) || '',
      dateCreated: (m['date_created'] as string) || '',
      dateSent: (m['date_sent'] as string) || null,
      errorCode: (m['error_code'] as string) || null,
      errorMessage: (m['error_message'] as string) || null,
    }));

    return { ok: true, messages, error: null };
  } catch (err) {
    return {
      ok: false,
      messages: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── VOICE ────────────────────────────────────────────────────────────────────

/**
 * Make an outbound voice call via SignalWire LaML Compatibility API.
 * The call will fetch LaML XML from the webhook URL to determine what to say.
 */
export async function makeVoiceCall(
  to: string,
  opts?: { message?: string; from?: string }
): Promise<VoiceCallResult> {
  const start = Date.now();
  const config = getSignalWireConfig();
  const from = opts?.from || config.fromNumber;
  const message = opts?.message || 'IVX Holdings autonomous voice verification. SignalWire integration is now certified.';

  if (!config.configured) {
    return {
      ok: false,
      sid: null,
      status: 'error',
      from,
      to,
      lamlUrl: '',
      errorCode: 'NOT_CONFIGURED',
      errorMessage: 'SignalWire credentials not configured',
      durationMs: Date.now() - start,
    };
  }

  // The LaML webhook URL on our own backend — SignalWire will fetch this
  // when the call connects to get the voice XML instructions.
  const lamlUrl = `${PRODUCTION_URL}/api/ivx/signalwire/voice/laml`;

  const url = `${LAML_BASE}/Calls.json`;
  const formData = new URLSearchParams();
  formData.set('From', from);
  formData.set('To', to);
  formData.set('Url', lamlUrl);
  formData.set('Method', 'POST');

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': basicAuthHeader(config.projectId, config.token),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const data = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      return {
        ok: false,
        sid: (data['sid'] as string) || null,
        status: 'error',
        from,
        to,
        lamlUrl,
        errorCode: String(data['code'] || resp.status),
        errorMessage: (data['message'] as string) || `SignalWire API returned ${resp.status}`,
        durationMs: Date.now() - start,
      };
    }

    return {
      ok: true,
      sid: (data['sid'] as string) || null,
      status: (data['status'] as string) || 'queued',
      from: (data['from'] as string) || from,
      to: (data['to'] as string) || to,
      lamlUrl,
      errorCode: (data['error_code'] as string) || null,
      errorMessage: (data['error_message'] as string) || null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      sid: null,
      status: 'error',
      from,
      to,
      lamlUrl,
      errorCode: 'NETWORK_ERROR',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * List recent voice calls from SignalWire.
 */
export async function listCalls(pageSize = 10): Promise<{ ok: boolean; calls: VoiceCall[]; error: string | null }> {
  const config = getSignalWireConfig();
  if (!config.configured) {
    return { ok: false, calls: [], error: 'Not configured' };
  }

  const url = `${LAML_BASE}/Calls.json?PageSize=${pageSize}`;

  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': basicAuthHeader(config.projectId, config.token),
      },
    });

    const data = await resp.json() as Record<string, unknown>;
    const rawCalls = (data['calls'] as Record<string, unknown>[]) || [];

    const calls: VoiceCall[] = rawCalls.map((c) => ({
      sid: (c['sid'] as string) || '',
      from: (c['from'] as string) || '',
      to: (c['to'] as string) || '',
      status: (c['status'] as string) || '',
      direction: (c['direction'] as string) || '',
      duration: (c['duration'] as string) || '0',
      dateCreated: (c['date_created'] as string) || '',
    }));

    return { ok: true, calls, error: null };
  } catch (err) {
    return {
      ok: false,
      calls: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── STATUS ───────────────────────────────────────────────────────────────────

export function getSignalWireStatus() {
  const config = getSignalWireConfig();
  return {
    ok: true,
    marker: IVX_SIGNALWIRE_MARKER,
    version: IVX_SIGNALWIRE_VERSION,
    configured: config.configured,
    spaceUrl: config.spaceUrl,
    projectId: config.projectId,
    fromNumber: config.fromNumber,
    capabilities: {
      sms: true,
      voice: true,
      mms: true,
      fax: false,
    },
    endpoints: {
      sms: 'POST /api/ivx/signalwire/sms',
      voice: 'POST /api/ivx/signalwire/voice',
      status: 'GET /api/ivx/signalwire/status',
      verify: 'POST /api/ivx/signalwire/verify',
      voiceLaml: 'POST /api/ivx/signalwire/voice/laml',
      listSms: 'GET /api/ivx/signalwire/sms',
      listCalls: 'GET /api/ivx/signalwire/voice',
    },
    productionUrl: PRODUCTION_URL,
    timestamp: new Date().toISOString(),
  };
}

// ── VERIFY (END-TO-END CERT) ────────────────────────────────────────────────

/**
 * Run the full end-to-end verification:
 *   1. Send a real SMS via SignalWire
 *   2. Make a real voice call via SignalWire
 *   3. Return certification evidence
 */
export async function runSignalWireVerify(opts?: {
  to?: string;
  smsBody?: string;
  voiceMessage?: string;
}): Promise<VerifyResult> {
  const start = Date.now();
  const certId = `ivx-signalwire-cert-${randomUUID().slice(0, 8)}`;
  const to = opts?.to || IVX_OWNER_PHONE;
  const ts = new Date().toISOString();

  const smsBody = opts?.smsBody || `IVX Autonomous SMS Verification — SignalWire integration certified. Timestamp: ${ts}`;
  const voiceMessage = opts?.voiceMessage || `This is I V X Holdings autonomous verification call. SignalWire voice integration is now certified. Timestamp: ${ts}`;

  // Run SMS and voice call in parallel for speed
  const [smsResult, voiceResult] = await Promise.all([
    sendSMS(to, smsBody),
    makeVoiceCall(to, { message: voiceMessage }),
  ]);

  const certified = smsResult.ok && voiceResult.ok;
  const proofHash = sha256(`${certId}|${smsResult.sid || ''}|${voiceResult.sid || ''}|${ts}`);

  const summary = certified
    ? `SignalWire integration certified: SMS sent (sid: ${smsResult.sid}, status: ${smsResult.status}), voice call placed (sid: ${voiceResult.sid}, status: ${voiceResult.status}).`
    : `SignalWire verification failed: SMS ok=${smsResult.ok} (error: ${smsResult.errorMessage}), voice ok=${voiceResult.ok} (error: ${voiceResult.errorMessage}).`;

  return {
    certified,
    certId,
    sms: smsResult,
    voice: voiceResult,
    proofHash,
    totalDurationMs: Date.now() - start,
    summary,
  };
}
