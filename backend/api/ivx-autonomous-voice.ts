import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  buildAutonomousVoiceLaml,
  getSignalWireVoiceStatus,
  listAutonomousVoiceCalls,
  placeAutonomousVoiceCall,
  verifyVoiceTrace,
} from '../services/ivx-signalwire-voice';

export const IVX_AUTONOMOUS_VOICE_API_MARKER = 'ivx-autonomous-voice-api-2026-08-13';

function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export function autonomousVoiceOptions(): Response { return ownerOnlyOptions(); }

export async function handleAutonomousVoiceStatus(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); }
  catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401); }
  return ownerOnlyJson({ ok: true, marker: IVX_AUTONOMOUS_VOICE_API_MARKER, voice: getSignalWireVoiceStatus(), recentCalls: await listAutonomousVoiceCalls(25) });
}

export async function handleAutonomousVoiceTest(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); }
  catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401); }

  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { /* optional body */ }
  const traceId = typeof body.traceId === 'string' && body.traceId.trim() ? body.traceId.trim() : `voice-qa-${Date.now()}`;
  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 900)
    : 'Hello. This is IVX Autonomous. This is a live voice quality assurance call. The Autonomous voice escalation channel is connected and able to contact the owner when a critical action is required.';
  const call = await placeAutonomousVoiceCall({ traceId, message });
  return ownerOnlyJson({ ok: call.requestStatus === 'queued', marker: IVX_AUTONOMOUS_VOICE_API_MARKER, call }, call.requestStatus === 'queued' ? 202 : 503);
}

export async function handleAutonomousVoiceLaml(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const traceId = url.searchParams.get('traceId') || '';
  const sig = url.searchParams.get('sig') || '';
  const message = url.searchParams.get('message') || '';
  if (!traceId || !verifyVoiceTrace(traceId, sig)) return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', 403);
  return xml(buildAutonomousVoiceLaml(message || 'IVX Autonomous requires owner attention. Please open the IVX owner dashboard.'));
}

export async function handleAutonomousVoiceCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const traceId = url.searchParams.get('traceId') || '';
  const sig = url.searchParams.get('sig') || '';
  if (!traceId || !verifyVoiceTrace(traceId, sig)) return ownerOnlyJson({ ok: false }, 403);
  // SignalWire callback delivery itself is evidence that the provider reached IVX.
  // The create-call ledger stores SID/status; provider callbacks are intentionally
  // acknowledged without echoing request fields or credentials.
  return ownerOnlyJson({ ok: true, traceId });
}
