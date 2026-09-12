import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function supportHarness(localFirst: boolean, failInsert = false) {
  const source = readFileSync(new URL('../../expo/src/modules/ivx-owner-ai/services/ivxChatService.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function sendOwnerSupportMessage(');
  const code = source.slice(start, source.indexOf('\nasync function sendOwnerAttachmentMessage(', start));
  let inserts = 0;
  let localWrites = 0;
  const api: any = {};
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(code) + '\napi.send = sendOwnerSupportMessage;', {
    api, Error, isIVXLocalFirstChatEnabled: () => localFirst, trimOrNull: (s: string) => s?.trim() || null,
    getLocalConversation: () => ({ id: 'room' }), createLocalMessage: () => ({ id: 'local' }),
    appendLocalMessage: async () => { localWrites++; }, emitLocalOwnerMessage() {}, trackOwnerSendAudit() {},
    console: { log() {} }, IVX_OWNER_AI_PROFILE: { name: 'IVX' },
    getIVXOwnerAuthContext: async () => ({ userId: 'owner' }), resolveIVXTables: async () => ({ schema: 'ivx', messages: 'ivx_messages' }),
    bootstrapOwnerConversation: async () => ({ id: 'room' }),
    insertMessage: async () => { inserts++; if (failInsert) throw new Error('DB unavailable'); return { id: 'remote' }; },
    updateConversationSummary: async () => {}, ensureInboxState: async () => {},
  });
  return { send: api.send, counts: () => ({ inserts, localWrites }) };
}

test('required shared assistant persistence cannot succeed with only a device copy', async () => {
  const h = supportHarness(true);
  expect(await h.send({ body: 'Real reply', senderRole: 'assistant', requireRemote: true })).toEqual({ id: 'remote' });
  expect(h.counts()).toEqual({ inserts: 1, localWrites: 0 });
});
test('failed required shared insert propagates failure instead of a local success', async () => {
  const h = supportHarness(true, true);
  await expect(h.send({ body: 'Real reply', senderRole: 'assistant', requireRemote: true })).rejects.toThrow('DB unavailable');
  expect(h.counts()).toEqual({ inserts: 1, localWrites: 0 });
});
test('explicitly local support messages remain available offline', async () => {
  const h = supportHarness(true, true);
  expect(await h.send({ body: 'Local notice', senderRole: 'system', requireRemote: false })).toEqual({ id: 'local' });
  expect(h.counts()).toEqual({ inserts: 0, localWrites: 1 });
});
test('assistant save callback requires remote acknowledgement before declaring persistence', async () => {
  const source = readFileSync(new URL('../../expo/app/ivx/chat.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const persistSupportMessage = useCallback(');
  const code = source.slice(start, source.indexOf('\n  const [aiBackendReachable', start));
  let remoteRequested = false;
  const api: any = {};
  runInNewContext(new Bun.Transpiler({ loader: 'tsx' }).transformSync(code) + '\napi.save = persistSupportMessage;', {
    api, useCallback: (fn: unknown) => fn, safeTrim: (s: string) => s.trim(), IVX_OWNER_AI_PROFILE: { name: 'IVX' }, console: { log() {} },
    ivxChatService: { sendOwnerSupportMessage: async (input: any) => { remoteRequested = input.requireRemote === true; if (remoteRequested) throw new Error('DB unavailable'); } },
  });
  await expect(api.save('Real reply', 'assistant')).rejects.toThrow('DB unavailable');
  expect(remoteRequested).toBe(true);
});
