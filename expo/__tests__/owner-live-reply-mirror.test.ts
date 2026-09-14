import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildVisibleAssistantTransient, isInternalTranscriptMessage, safeTrim, sortMessagesByCanonicalOrder } from '../src/modules/chat/services/chatMessageUtils';
import type { IVXMessage } from '../shared/ivx';

// Execute the production selectors with the exact race observed in the Android
// certificate: remote final + mirrored delta + live final sharing the delta ID.
const source = readFileSync(new URL('../app/ivx/chat.tsx', import.meta.url), 'utf8');
function selector(name: string, end: string, context: Record<string, unknown>) {
  const start = source.indexOf(`  const ${name} = useMemo<IVXMessage[]>`);
  const code = source.slice(start, source.indexOf(end, start) + end.length);
  return runInNewContext(new Bun.Transpiler({ loader: 'tsx' }).transformSync(code) + `\n${name}`, {
    useMemo: (fn: () => unknown) => fn(), safeTrim, isInternalTranscriptMessage,
    sortMessagesByCanonicalOrder, duplicateMessageCountRef: { current: 0 },
    conversationQuery: { data: { id: 'owner-room' } }, ownerId: 'owner', ownerLabel: 'Owner',
    pendingOwnerMessages: [], ...context,
  }) as IVXMessage[];
}
const endAll = '}, [conversationQuery.data?.id, currentStreamingMessageId, messages, ownerId, ownerLabel, pendingOwnerMessages, transientAssistantMessages]);';
const answer = 'IVX_CHAT_E2E_34884015370_1_1789413172';
const row = (id: string, body: string, taskId?: string) => buildVisibleAssistantTransient({ id, body, conversationId: 'owner-room', taskId });

test('the complete answer survives a refetch containing an older mirrored delta under its live ID', () => {
  for (const taskId of [undefined, 'task-a']) {
    const messages = selector('allMessages', endAll, {
      currentStreamingMessageId: null,
      messages: [row('server-final', answer), row('live-reply', 'IVX_CHAT_E2E_')],
      transientAssistantMessages: [row('live-reply', answer, taskId)],
    });
    const matches = messages.filter(message => message.body?.includes('34884015370_1_1789413172'));
    expect(matches).toHaveLength(1); expect(matches[0]?.body).toBe(answer);
    expect(matches[0]?.id).toBe('live-reply');
  }
});

test('the stored final answer is available after the transient state is gone', () => {
  const messages = selector('allMessages', endAll, { currentStreamingMessageId: null,
    messages: [row('server-final', answer)], transientAssistantMessages: [] });
  expect(messages.map(message => message.body)).toEqual([answer]);
});

test('streaming deltas stay out of the durable mirror until finalization', () => {
  const input = { allMessages: [row('live-reply', answer), row('prior-reply', 'Earlier reply')] };
  const end = '}, [allMessages, currentStreamingMessageId]);';
  expect(selector('durableMirrorPayload', end, { ...input, currentStreamingMessageId: 'live-reply' })
    .map(message => message.id)).toEqual(['prior-reply']);
  expect(selector('durableMirrorPayload', end, { ...input, currentStreamingMessageId: null })
    .map(message => message.id)).toEqual(['live-reply', 'prior-reply']);
});
