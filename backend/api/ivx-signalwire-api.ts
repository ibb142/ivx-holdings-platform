/**
 * IVX SignalWire API
 *
 * HTTP endpoints for autonomous SMS and voice calls through SignalWire.
 *
 *   GET  /api/ivx/signalwire/status       — service health + capabilities
 *   POST /api/ivx/signalwire/sms           — send an SMS message
 *   GET  /api/ivx/signalwire/sms           — list recent SMS messages
 *   POST /api/ivx/signalwire/voice         — make a voice call
 *   GET  /api/ivx/signalwire/voice         — list recent voice calls
 *   POST /api/ivx/signalwire/voice/laml    — LaML webhook for voice call XML
 *   POST /api/ivx/signalwire/verify        — end-to-end cert: SMS + voice
 */
import {
  sendSMS,
  makeVoiceCall,
  listSMS,
  listCalls,
  getSignalWireStatus,
  runSignalWireVerify,
  buildVoiceLaML,
  IVX_SIGNALWIRE_MARKER,
  type SendSMSResult,
  type VoiceCallResult,
  type VerifyResult,
} from '../services/ivx-signalwire-service';
import { randomUUID, createHash } from 'node:crypto';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function xml(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function readString(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

interface ParsedBody {
  to?: string;
  from?: string;
  body?: string;
  message?: string;
  toNumber?: string;
  smsBody?: string;
  voiceMessage?: string;
}

async function parseBody(req: Request): Promise<ParsedBody> {
  try {
    const ct = req.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      const data = await req.json() as Record<string, unknown>;
      return {
        to: typeof data['to'] === 'string' ? data['to'] : undefined,
        from: typeof data['from'] === 'string' ? data['from'] : undefined,
        body: typeof data['body'] === 'string' ? data['body'] : undefined,
        message: typeof data['message'] === 'string' ? data['message'] : undefined,
        toNumber: typeof data['toNumber'] === 'string' ? data['toNumber'] : undefined,
        smsBody: typeof data['smsBody'] === 'string' ? data['smsBody'] : undefined,
        voiceMessage: typeof data['voiceMessage'] === 'string' ? data['voiceMessage'] : undefined,
      };
    }
    // application/x-www-form-urlencoded (SignalWire webhooks use this)
    const formData = await req.formData();
    return {
      to: (formData.get('To') as string) || undefined,
      from: (formData.get('From') as string) || undefined,
      body: (formData.get('Body') as string) || undefined,
      message: (formData.get('Message') as string) || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * GET /api/ivx/signalwire/status
 */
export function handleSignalWireStatus(): Response {
  const status = getSignalWireStatus();
  return json(status);
}

/**
 * POST /api/ivx/signalwire/sms
 * Body: { to: string, body: string, from?: string }
 */
export async function handleSignalWireSendSMS(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const to = readString(body.to) || readString(body.toNumber);

  if (!to) {
    return json({ ok: false, error: 'Missing "to" phone number (E.164 format, e.g. +15616443503)' }, 400);
  }

  const smsBody = readString(body.body) || readString(body.smsBody);
  if (!smsBody) {
    return json({ ok: false, error: 'Missing "body" for SMS message' }, 400);
  }

  const result = await sendSMS(to, smsBody, { from: body.from });
  return json(result);
}

/**
 * GET /api/ivx/signalwire/sms
 * Query: ?pageSize=10
 */
export async function handleSignalWireListSMS(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
  const result = await listSMS(pageSize);
  return json(result);
}

/**
 * POST /api/ivx/signalwire/voice
 * Body: { to: string, message?: string, from?: string }
 */
export async function handleSignalWireMakeVoiceCall(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const to = readString(body.to) || readString(body.toNumber);

  if (!to) {
    return json({ ok: false, error: 'Missing "to" phone number (E.164 format, e.g. +15616443503)' }, 400);
  }

  const message = readString(body.message) || readString(body.voiceMessage) || '';
  const result = await makeVoiceCall(to, { message, from: body.from });
  return json(result);
}

/**
 * GET /api/ivx/signalwire/voice
 * Query: ?pageSize=10
 */
export async function handleSignalWireListCalls(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
  const result = await listCalls(pageSize);
  return json(result);
}

/**
 * POST /api/ivx/signalwire/voice/laml
 *
 * SignalWire webhook endpoint — returns LaML XML when a call connects.
 * SignalWire fetches this URL to determine what to say on the call.
 */
export async function handleSignalWireVoiceLaML(req: Request): Promise<Response> {
  const body = await parseBody(req);

  // Build a custom message if one was provided, otherwise use default
  const callSid = body.from || '';
  const defaultMessage = `This is I V X Holdings autonomous verification call. SignalWire voice integration is now certified. Your call is being monitored for quality assurance.`;
  const message = readString(body.message) || readString(body.body) || defaultMessage;

  const laMl = buildVoiceLaML(message);

  console.log(`[IVX SignalWire] LaML webhook called — CallSid: ${callSid}, message: ${message.substring(0, 60)}...`);

  return xml(laMl);
}

/**
 * POST /api/ivx/signalwire/verify
 * Body: { to?: string, smsBody?: string, voiceMessage?: string }
 *
 * End-to-end certification: sends a real SMS and makes a real voice call
 * through SignalWire, returns certification evidence.
 */
export async function handleSignalWireVerify(req: Request): Promise<Response> {
  const body = await parseBody(req);

  const result = await runSignalWireVerify({
    to: body.to || body.toNumber,
    smsBody: body.smsBody,
    voiceMessage: body.voiceMessage,
  });

  const certEvidence = {
    certId: result.certId,
    certified: result.certified,
    proofHash: result.proofHash,
    totalDurationMs: result.totalDurationMs,
    summary: result.summary,
    sms: {
      ok: result.sms.ok,
      sid: result.sms.sid,
      status: result.sms.status,
      from: result.sms.from,
      to: result.sms.to,
      body: result.sms.body,
      errorCode: result.sms.errorCode,
      errorMessage: result.sms.errorMessage,
      durationMs: result.sms.durationMs,
    },
    voice: {
      ok: result.voice.ok,
      sid: result.voice.sid,
      status: result.voice.status,
      from: result.voice.from,
      to: result.voice.to,
      lamlUrl: result.voice.lamlUrl,
      errorCode: result.voice.errorCode,
      errorMessage: result.voice.errorMessage,
      durationMs: result.voice.durationMs,
    },
    timestamp: new Date().toISOString(),
    marker: IVX_SIGNALWIRE_MARKER,
  };

  return json(certEvidence);
}
