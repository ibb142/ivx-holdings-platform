import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Execute the actual route callbacks with React's pre-render state held stale.
// This reproduces two native events in the same render without importing the
// route's native modules. It is not a browser or provider certification.
const route = readFileSync(path.join(import.meta.dir, '../app/ivx/chat.tsx'), 'utf8');
const utils = readFileSync(path.join(import.meta.dir, '../src/modules/chat/services/chatMessageUtils.ts'), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'ts' });
function pure(name: string): (...args: unknown[]) => unknown {
  const start = utils.indexOf(`export function ${name}(`);
  const end = utils.indexOf('\n}', start) + 2;
  if (start < 0 || end < start) throw new Error(`Missing helper ${name}`);
  return new Function(transpiler.transformSync(utils.slice(start, end).replace('export ', '')) + `\nreturn ${name};`)();
}
const normalizeComposerText = pure('normalizeComposerText');
const safeTrim = pure('safeTrim');

function callback(name: string, context: Record<string, unknown>): (...args: unknown[]) => unknown {
  const marker = `const ${name} = useCallback(`;
  const start = route.indexOf(marker) + marker.length;
  const end = route.indexOf('\n  }, [', start) + 4;
  if (start < marker.length || end < start) throw new Error(`Missing callback ${name}`);
  const code = transpiler.transformSync(`const handle = ${route.slice(start, end)};`);
  return new Function(...Object.keys(context), code + '\nreturn handle;')(...Object.values(context));
}

function harness(attachments = false) {
  const calls: Array<{ kind: string; variables?: Record<string, unknown> }> = [];
  const settlements: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  let sequence = 0;
  let throwSynchronously = false;
  const begin = (kind: string, variables?: Record<string, unknown>) => {
    calls.push({ kind, variables });
    if (throwSynchronously) throw new Error('synchronous dispatch failure');
    return new Promise<void>((resolve, reject) => settlements.push({ resolve, reject }));
  };
  const mutation = (kind: string) => ({
    isPending: false, // both event handlers observe the same render snapshot
    mutate: (variables: Record<string, unknown>) => { void begin(kind, variables).catch(() => {}); },
    mutateAsync: (variables: Record<string, unknown>) => begin(kind, variables),
  });
  const composerValueRef = { current: 'repair the chat' };
  const submissionInFlightRef = { current: false };
  let pending: Record<string, unknown>[] = [];
  const retry = { clientId: 'original-message', text: 'repair the chat', mode: attachments ? 'attachment' : 'send_and_ai', upload: attachments ? { name: 'fixture.png' } : undefined };
  const noop = () => {};
  const trace = { traceId: 'trace-fixture', pass: noop };
  const context = {
    console: { log: noop }, submissionInFlightRef,
    sendMessageMutation: mutation('message'), attachmentMutation: mutation('attachment'),
    isPickingFile: false, aiReplyPending: false, composerHasText: true,
    draftAttachments: attachments ? [{ upload: { name: 'fixture.png' } }] : [],
    sendDraftAttachment: () => begin('batch'), composerValueRef, normalizeComposerText, safeTrim,
    localFirstChatMode: false, OWNER_COMMAND_PREFIX: '/',
    createTransientMessageId: () => `message-${++sequence}`, selectedReplyContext: null,
    setPendingOwnerMessages: (update: (rows: Record<string, unknown>[]) => Record<string, unknown>[]) => { pending = update(pending); },
    setSelectedReplyContext: noop, setActiveLiveWorkTask: noop, detectChatLiveWorkTask: () => null,
    ivxAIWatchdog: { recordTap: noop, recordTapBlocked: noop, createTrace: () => trace },
    activeWatchdogTracesRef: { current: new Map() }, conversationQuery: { data: { id: 'room-fixture' } },
    stagedTimeoutStartRef: { current: 0 }, aiReachableRef: { current: true },
    setStagedTimeoutTraceId: noop, setStagedTimeoutMessageId: noop, setStagedTimeoutRequestStarted: noop,
    setStagedTimeoutLastCheckpoint: noop,
    commitComposerClear: () => { composerValueRef.current = ''; },
    pendingOwnerMessages: [retry], startUploadProgressTimer: noop,
  };
  return {
    calls, settlements, composerValueRef, submissionInFlightRef,
    send: callback('handleSend', context), ask: callback('handleAskAI', context),
    retry: callback('handleRetryMessage', context),
    pending: () => pending,
    throwNext: () => { throwSynchronously = true; },
  };
}

describe('owner chat submission before React renders pending state', () => {
  test('two native submit events produce one message identity', async () => {
    const h = harness(); const first = h.send('repair the chat'); h.send('repair the chat');
    expect(h.calls).toHaveLength(1); expect(h.pending()).toHaveLength(1);
    h.settlements[0].resolve(); await first;
  });
  test('button then stale native submit cannot produce another message', async () => {
    const h = harness(); const first = h.send(); h.send('repair the chat');
    expect(h.calls).toHaveLength(1); h.settlements[0].resolve(); await first;
  });
  test('two attachment submits start one batch', async () => {
    const h = harness(true); const first = h.send(); h.send();
    expect(h.calls).toEqual([{ kind: 'batch' }]); h.settlements[0].resolve(); await first;
  });
  test('Ask AI and Send share the same admission guard', async () => {
    const h = harness(); const first = h.ask('repair the chat'); h.send('repair the chat');
    expect(h.calls).toHaveLength(1); h.settlements[0].resolve(); await first;
  });
  for (const attachment of [false, true]) test(`two retries preserve one original ${attachment ? 'attachment' : 'message'} operation`, async () => {
    const h = harness(attachment); const first = h.retry({ id: 'original-message' }); h.retry({ id: 'original-message' });
    expect(h.calls).toHaveLength(1); expect(h.calls[0].variables?.clientId).toBe('original-message');
    h.settlements[0].resolve(); await first;
  });
  test('completion releases the guard and equal text later is a new instruction', async () => {
    const h = harness(); const first = h.send('repair the chat');
    h.settlements[0].resolve(); await first;
    h.composerValueRef.current = 'repair the chat'; const second = h.send('repair the chat');
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0].variables?.clientId).not.toBe(h.calls[1].variables?.clientId);
    h.settlements[1].resolve(); await second;
  });
  test('a delayed native event cannot resubmit the draft that was already cleared', async () => {
    const h = harness(); const first = h.send('repair the chat');
    h.settlements[0].resolve(); await first;
    await h.send('repair the chat'); await h.ask('repair the chat');
    expect(h.calls).toHaveLength(1);
  });
  test('a rejected mutation releases the guard without changing the retry identity', async () => {
    const h = harness(); const first = h.retry({ id: 'original-message' });
    h.settlements[0].reject(new Error('lost acknowledgement')); await first;
    expect(h.submissionInFlightRef.current).toBe(false);
    const second = h.retry({ id: 'original-message' });
    expect(h.calls.map(c => c.variables?.clientId)).toEqual(['original-message', 'original-message']);
    h.settlements[1].resolve(); await second;
  });
  test('an empty send does not lock a later valid message', async () => {
    const h = harness(); await h.send(''); expect(h.calls).toHaveLength(0);
    const sent = h.send('repair the chat'); expect(h.calls).toHaveLength(1);
    h.settlements[0].resolve(); await sent;
  });
  test('synchronous dispatch failure cannot strand the composer lock', async () => {
    const h = harness(); h.throwNext(); await h.send('repair the chat');
    expect(h.submissionInFlightRef.current).toBe(false);
  });
});
