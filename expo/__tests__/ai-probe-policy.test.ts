import { describe, expect, it } from 'bun:test';
import { resolveChatAIHealthFromProbe } from '@/src/modules/chat/services/aiProbePolicy';

describe('IVX AI probe gating policy', () => {
  it('keeps assistant sends eligible when probe capability metadata is missing', () => {
    expect(resolveChatAIHealthFromProbe({
      health: 'inactive',
      aiChatCapability: null,
    })).toBe('degraded');
  });

  it('honors an explicit ai_chat capability denial', () => {
    expect(resolveChatAIHealthFromProbe({
      health: 'active',
      aiChatCapability: false,
    })).toBe('inactive');
  });

  it('preserves active and degraded probe health when capability is available', () => {
    expect(resolveChatAIHealthFromProbe({ health: 'active', aiChatCapability: true })).toBe('active');
    expect(resolveChatAIHealthFromProbe({ health: 'degraded', aiChatCapability: true })).toBe('degraded');
  });
});
