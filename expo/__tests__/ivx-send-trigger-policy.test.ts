import { describe, expect, it } from 'bun:test';
import { shouldStartAssistantBeforePersistence } from '@/src/modules/chat/services/ivxSendTriggerPolicy';

describe('IVX local-first send trigger policy', () => {
  it('starts an AI reply without waiting for local message persistence', () => {
    expect(shouldStartAssistantBeforePersistence({
      localFirstChatMode: true,
      mode: 'send_and_ai',
    })).toBe(true);
  });

  it('does not bypass persistence for send-only or attachment operations', () => {
    expect(shouldStartAssistantBeforePersistence({
      localFirstChatMode: true,
      mode: 'send_only',
    })).toBe(false);
    expect(shouldStartAssistantBeforePersistence({
      localFirstChatMode: true,
      mode: 'attachment',
    })).toBe(false);
  });

  it('keeps remote-first sends persistence-first', () => {
    expect(shouldStartAssistantBeforePersistence({
      localFirstChatMode: false,
      mode: 'send_and_ai',
    })).toBe(false);
  });
});
