import { expect, test } from 'bun:test';
import { createSerializedMessageMirror } from '../lib/serialized-message-mirror';

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

test('an older remote snapshot cannot overwrite a newly committed reply', async () => {
  let stored = ['owner'];
  const save = createSerializedMessageMirror(
    async () => [...stored], async (messages) => { stored = messages; }, union,
  );
  await Promise.all([save(['owner', 'assistant']), save(['owner'])]);
  expect(stored).toEqual(['owner', 'assistant']);
});

test('concurrent appends read the previous completed write', async () => {
  let stored: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const save = createSerializedMessageMirror(async () => [...stored], async (messages) => {
    if (++writes === 1) await gate;
    stored = messages;
  }, union);
  const first = save(['first']);
  const second = save(['second']);
  release();
  await Promise.all([first, second]);
  expect(stored).toEqual(['first', 'second']);
});

test('a storage failure is reported without poisoning later writes', async () => {
  let stored: string[] = [];
  let fail = true;
  const save = createSerializedMessageMirror(async () => stored, async (messages) => {
    if (fail) { fail = false; throw new Error('disk unavailable'); }
    stored = messages;
  }, union);
  await expect(save(['first'])).rejects.toThrow('disk unavailable');
  await save(['second']);
  expect(stored).toEqual(['second']);
});
