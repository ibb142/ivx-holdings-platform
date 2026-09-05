export type ChatAIProbeHealth = 'inactive' | 'active' | 'degraded';

/**
 * Health probes are advisory for a user send.
 *
 * An explicit `ai_chat === false` is a real capability denial. Missing
 * capability metadata, however, commonly means the probe failed or returned an
 * incomplete payload. Treat that case as degraded so the resilient Owner AI
 * request path is still attempted instead of silently saving the user message
 * with no assistant reply.
 */
export function resolveChatAIHealthFromProbe(input: {
  health: ChatAIProbeHealth;
  aiChatCapability?: boolean | null;
}): ChatAIProbeHealth {
  if (input.aiChatCapability === false) {
    return 'inactive';
  }

  if (input.health === 'active' || input.health === 'degraded') {
    return input.health;
  }

  return 'degraded';
}
