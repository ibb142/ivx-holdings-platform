import { describe, expect, test } from 'bun:test';
import { evaluateIVXChatQualityFirewall } from '@/src/modules/ivx-owner-ai/services/ivxChatQualityFirewall';

describe('IVX Chat Quality Firewall', () => {
  test('blocks the exact screenshot class: Autonomous question -> stale property answer', () => {
    const decision = evaluateIVXChatQualityFirewall({
      ownerText: 'Where is autonomous and why quality is not catching this?',
      assistantText: '3 active properties in production right now. I filtered by active status in jv_deals.',
    });
    expect(decision.allow).toBe(false);
    expect(decision.code).toBe('INTENT_TOPIC_MISMATCH');
    expect(decision.severity).toBe('critical');
  });

  test('blocks exact stale answer after owner prompt changes', () => {
    const stale = 'The production deployment is healthy and the current commit is verified.';
    const decision = evaluateIVXChatQualityFirewall({
      ownerText: 'Why is chat memory repeating old answers?',
      previousOwnerText: 'Is production live?',
      previousAssistantTexts: [stale],
      assistantText: stale,
    });
    expect(decision.allow).toBe(false);
    expect(decision.code).toBe('STALE_DUPLICATE_RESPONSE');
  });

  test('allows a relevant technical reply', () => {
    const decision = evaluateIVXChatQualityFirewall({
      ownerText: 'Audit the chat error and fix Autonomous.',
      assistantText: 'Autonomous detected the chat error. QA will validate the code path and deployment trace.',
    });
    expect(decision.allow).toBe(true);
    expect(decision.code).toBe('PASS');
  });

  test('does not block a property answer when the owner asked about properties', () => {
    const decision = evaluateIVXChatQualityFirewall({
      ownerText: 'How many active properties do we have?',
      assistantText: 'There are 3 active properties in the current deal inventory.',
    });
    expect(decision.allow).toBe(true);
  });
});
