import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { capOwnerMessages, mergeOwnerMessages } from '../../expo/src/modules/ivx-owner-ai/services/ivxChatMessageMerge';

// Execute the real storage and insert functions; only device storage and DB
// boundaries are controlled. Reproduces the 20:41:12 -> 20:41:18 stale read
// that removed an already rendered reply before the real Android restart.
function harness() {
  const source = readFileSync(new URL('../../expo/src/modules/ivx-owner-ai/services/ivxChatService.ts', import.meta.url), 'utf8');
  const section = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const code = [
    'let localMessageWriteQueue: Promise<void> = Promise.resolve();',
    section('async function saveLocalMessages(', 'function getLocalConversation('),
    section('async function appendLocalMessage(', 'function emitLocalOwnerMessage('),
    section('async function insertMessage(', '/**\n * CONVERSATION-ID FIX'),
  ].join('\n');
  let stored: any[] = [];
  let failWrite = false;
  let writeGate: Promise<void> | null = null;
  const inserted = message('remote-reply', 'assistant');
  const api: any = {};
  const storage = {
    async setItem(_key: string, value: string) {
      const gate = writeGate; writeGate = null;
      if (gate) await gate;
      if (failWrite) { failWrite = false; throw new Error('device storage unavailable'); }
      stored = JSON.parse(value);
    },
  };
  const client = { from: () => ({ insert: () => ({ select: async () => ({ data: [inserted], error: null }) }) }) };
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(code) +
    '\nObject.assign(api, {saveLocalMessages,persistOwnerMessageMirror,appendOwnerMessagesToLocalMirror,appendLocalMessage,insertMessage});', {
    api, AsyncStorage: storage, IVX_LOCAL_MESSAGES_STORAGE_KEY: 'fixture-owner-mirror', IVX_LOCAL_MESSAGES_MIRROR_CAP: 400,
    loadLocalMessages: async () => structuredClone(stored), capOwnerMessages, mergeOwnerMessages,
    trimOrNull: (x: string | null) => x?.trim() || null, console: { log() {} },
    getIVXSupabaseClient: () => client, getScopedSupabaseClient: () => client,
    buildMessageInsertPayload: (_schema: string, input: unknown) => input,
    getFirstRowFromSelectResult: (rows: any[]) => rows[0], mapMessage: async (row: unknown) => row,
  });
  return { api, read: () => stored, seed: (rows: any[]) => { stored = structuredClone(rows); },
    failNextWrite: () => { failWrite = true; }, holdNextWrite: (gate: Promise<void>) => { writeGate = gate; }, inserted };
}

function message(id: string, role = 'owner', body = id, time = 1) {
  return { id, conversationId: 'owner-room', senderUserId: null, senderRole: role, body,
    attachmentUrl: null, attachmentName: null, createdAt: new Date(time * 1000).toISOString() };
}

test('a late history snapshot cannot remove a reply already in the durable mirror', async () => {
  const h = harness(); const owner = message('owner'); const reply = message('reply', 'assistant');
  h.seed([owner]); const staleSnapshot = [owner];
  await h.api.appendOwnerMessagesToLocalMirror([reply]);
  await h.api.persistOwnerMessageMirror(staleSnapshot, 'owner-room');
  expect(h.read().map(x => x.id).sort()).toEqual(['owner', 'reply']);
});

test('simultaneous owner and assistant appends retain both turns after restart', async () => {
  const h = harness();
  await Promise.all([h.api.appendLocalMessage(message('owner')), h.api.appendOwnerMessagesToLocalMirror([message('reply', 'assistant')])]);
  expect(h.read().map(x => x.id).sort()).toEqual(['owner', 'reply']);
});

test('a slow older write cannot finish after and overwrite a newer reply', async () => {
  const h = harness(); let release!: () => void;
  h.holdNextWrite(new Promise<void>(resolve => { release = resolve; }));
  const old = h.api.persistOwnerMessageMirror([message('owner')], 'owner-room');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const fresh = h.api.appendOwnerMessagesToLocalMirror([message('reply', 'assistant')]);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  release(); await Promise.all([old, fresh]);
  expect(h.read().map(x => x.id).sort()).toEqual(['owner', 'reply']);
});

test('remote insert readback is mirrored before the caller starts slower summary work', async () => {
  const h = harness();
  const result = await h.api.insertMessage({ schema: 'ivx', dbSchema: 'public', messages: 'ivx_messages' }, {
    conversationId: 'owner-room', senderUserId: null, senderRole: 'assistant', senderLabel: 'IVX', body: 'real provider reply',
  });
  expect(result).toEqual(h.inserted);
  expect(h.read()).toEqual([h.inserted]);
});

test('a failed device write does not poison later writes or manufacture remote success', async () => {
  const h = harness(); h.failNextWrite();
  await h.api.appendLocalMessage(message('failed-local-write'));
  expect(h.read()).toEqual([]);
  await h.api.appendLocalMessage(message('later'));
  expect(h.read().map(x => x.id)).toEqual(['later']);
});

test('merges retain role distinction and keep the existing 400-message bound', async () => {
  const h = harness();
  h.seed(Array.from({ length: 400 }, (_, i) => message(`old-${i}`, 'owner', `old-${i}`, i + 1)));
  await h.api.appendOwnerMessagesToLocalMirror([message('q', 'owner', 'same text', 500), message('a', 'assistant', 'same text', 501)]);
  expect(h.read()).toHaveLength(400);
  expect(h.read().slice(-2).map(x => x.senderRole)).toEqual(['owner', 'assistant']);
});
