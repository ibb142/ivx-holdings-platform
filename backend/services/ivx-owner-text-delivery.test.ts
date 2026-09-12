import { expect, test } from 'bun:test';
import { deliverOwnerTextTurn } from './ivx-owner-text-delivery';

test('does not execute a provider request before the requested owner write commits', async () => {
  let release!: () => void;
  let generated = false;
  let saved = '';
  const pending = deliverOwnerTextTurn({
    persistUserMessage: true, persistAssistantMessage: true,
    persistOwner: () => new Promise<void>((resolve) => { release = resolve; }),
    generate: async () => { generated = true; return { text: 'real result', model: 'provider' }; },
    persistAssistant: async (result) => { saved = result.text; return 'assistant-1'; },
  });
  await Promise.resolve();
  expect(generated).toBe(false);
  release();
  expect(await pending).toEqual({ result: { text: 'real result', model: 'provider' }, assistantMessageId: 'assistant-1' });
  expect(saved).toBe('real result');
});

test('an unavailable owner write stops before model execution', async () => {
  let calls = 0;
  await expect(deliverOwnerTextTurn({
    persistUserMessage: true, persistAssistantMessage: true,
    persistOwner: async () => { throw new Error('database unavailable'); },
    generate: async () => { calls++; return 'answer'; },
    persistAssistant: async () => 'assistant-1',
  })).rejects.toThrow('database unavailable');
  expect(calls).toBe(0);
});

test('a failed assistant write never reports a persisted result or invokes the model again', async () => {
  let calls = 0;
  await expect(deliverOwnerTextTurn({
    persistUserMessage: false, persistAssistantMessage: true,
    persistOwner: async () => { throw new Error('unexpected owner write'); },
    generate: async () => { calls++; return 'answer'; },
    persistAssistant: async () => { throw new Error('write acknowledgement unavailable'); },
  })).rejects.toThrow('write acknowledgement unavailable');
  expect(calls).toBe(1);
});

test('an empty acknowledgement cannot claim that history was persisted', async () => {
  await expect(deliverOwnerTextTurn({
    persistUserMessage: false, persistAssistantMessage: true,
    persistOwner: async () => {}, generate: async () => 'answer', persistAssistant: async () => '',
  })).rejects.toThrow('OWNER_TEXT_HISTORY_PERSISTENCE_FAILED');
});

test('explicitly ephemeral requests do not write conversation history', async () => {
  const unexpectedWrite = async (): Promise<never> => { throw new Error('unexpected write'); };
  expect(await deliverOwnerTextTurn({
    persistUserMessage: false, persistAssistantMessage: false,
    persistOwner: unexpectedWrite, generate: async () => 'answer', persistAssistant: unexpectedWrite,
  })).toEqual({ result: 'answer', assistantMessageId: null });
});

test('a failed provider never becomes an assistant history row', async () => {
  let writes = 0;
  await expect(deliverOwnerTextTurn({
    persistUserMessage: true, persistAssistantMessage: true,
    persistOwner: async () => {}, generate: async () => { throw new Error('provider interrupted'); },
    persistAssistant: async () => { writes++; return 'assistant-1'; },
  })).rejects.toThrow('provider interrupted');
  expect(writes).toBe(0);
});
