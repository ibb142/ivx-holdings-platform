import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../expo/app/ivx/chat.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    onSuccess: async (_data, variables) => {', source.indexOf('  const sendMessageMutation ='));
const end = source.indexOf('\n    onError:', start);
if (start < 0 || end < start) throw new Error('Send success callback not found');
const callback = source.slice(start + '    onSuccess: '.length, end).trim().replace(/,$/, '');

async function complete(rows: unknown[], reject = false) {
  let pending = [{ clientId: 'command-1', text: 'The original owner command', status: 'sending' }];
  const fn = runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(`globalThis.extracted = (${callback});`), {
    queryClient: {
      invalidateQueries: async () => { if (reject) throw new Error('Auth unavailable'); },
      getQueryData: () => rows,
    },
    IVX_OWNER_MESSAGES_QUERY_KEY: ['messages'],
    setPendingOwnerMessages: (update: (value: typeof pending) => typeof pending) => { pending = update(pending); },
    safeTrim: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    encodeReplyBody: (text: string) => text,
    requestAnimationFrame: (fn: () => void) => fn(),
    flatListRef: { current: { scrollToOffset() {} } }, console: { log() {} },
  });
  await fn(undefined, { clientId: 'command-1', text: 'The original owner command', replyTo: null });
  return pending;
}

test('failed refetch retains the original owner command', async () => {
  expect((await complete([], true)).map(x => x.clientId)).toEqual(['command-1']);
});
test('successful empty fallback cannot erase the original owner command', async () => {
  expect((await complete([])).map(x => x.clientId)).toEqual(['command-1']);
});
test('assistant content is not confirmation of the owner row', async () => {
  expect((await complete([{ senderRole: 'assistant', body: 'The original owner command' }])).length).toBe(1);
});
test('confirmed owner row replaces the optimistic copy', async () => {
  expect(await complete([{ senderRole: 'owner', body: 'The original owner command' }])).toEqual([]);
});
