import { Request, Response } from 'hono';
import { placeAutonomousVoiceCall } from '../services/ivx-signalwire-voice';

export async function handleLiveCertification(request: Request): Promise<Response> {
  const traceId = 'ivx-live-cert-workflow-20260816-v1';
  const message = 'This is a live certification call for the IVX voice module.';
  
  try {
    const call = await placeAutonomousVoiceCall({ traceId, message });
    
    return new Response(JSON.stringify({
      ok: call.requestStatus === 'queued',
      traceId,
      message,
      callStatus: call.requestStatus,
    }), { status: call.requestStatus === 'queued' ? 200 : 503, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      traceId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
