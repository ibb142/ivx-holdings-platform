import { placeAutonomousVoiceCall, getSignalWireVoiceStatus } from './ivx-signalwire-voice';

export async function p3VoiceLiveCertWorkflow(traceId: string): Promise<{ ok: boolean; error?: string }> {
  // Ensure the traceId is valid
  if (!traceId || traceId.length > 160) {
    return { ok: false, error: 'Invalid traceId' };
  }

  // Check if voice service is configured
  const voiceStatus = getSignalWireVoiceStatus();
  if (!voiceStatus.configured) {
    return { ok: false, error: 'Voice service not configured' };
  }

  try {
    // Place the voice call
    await placeAutonomousVoiceCall({
      traceId,
      message: 'This is a live certification voice call.',
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to place call' };
  }
}
