import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
// Expo pins the JS compiler API; the root CLI uses TypeScript 7's native binary.
const ts = createRequire(new URL('../expo/package.json', import.meta.url))('typescript');

// Execute the production callbacks and bubble component with a minimal native
// host. This covers the route's early-return branch, which transport-only tests
// cannot see. It does not claim to replace an installed Android APK test.
const root = process.env.IVX_CHAT_SOURCE_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const route = ts.createSourceFile('chat.tsx', read('expo/app/ivx/chat.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const quietConsole = { log() {}, error() {}, warn() {} };
function findNode(source, predicate) {
  let result;
  function visit(node) {
    if (result) return;
    if (predicate(node)) { result = node; return; }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(result, 'Production expression must exist');
  return result;
}
function variable(name) {
  return findNode(route, (node) => ts.isVariableDeclaration(node) && node.name.getText(route) === name).initializer;
}
function evaluate(node, source, bindings = {}) {
  const code = ts.transpileModule(`const value = ${node.getText(source).replace(/^export\s+/, '')};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(bindings), `${code}\nreturn value;`)(...Object.values(bindings));
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
function textContent(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  if (Array.isArray(tree)) return tree.map(textContent).join(' ');
  return textContent(tree.props?.children);
}
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  Fragment: 'Fragment',
  memo: (component) => component,
  useCallback: (callback) => callback,
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
};
const componentExports = {};
const componentCode = ts.transpileModule(read('expo/src/modules/chat/components/MessageBubble.tsx'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
new Function('require', 'exports', componentCode)((id) => {
  if (id === 'react') return React;
  if (id === 'react-native') return {
    Animated: { Value: class {}, View: 'View', Text: 'Text' },
    StyleSheet: { create: (styles) => styles }, Text: 'Text', View: 'View', Pressable: 'Pressable',
  };
  if (id === 'expo-haptics') return { impactAsync: async () => {}, ImpactFeedbackStyle: {} };
  if (id.includes('visibleTextSanitizer')) return {
    containsBlockedUserFacingChatText: () => false,
    redactUserFacingChatSecrets: (text) => text ?? '',
    sanitizeUserFacingChatText: (text) => text ?? '',
  };
  if (id.endsWith('/ivxChat')) return { shouldRenderInlineImage: () => false, shouldRenderTapToOpenAttachment: () => false };
  if (id.endsWith('/ReactionPicker')) return { ReactionPicker: 'ReactionPicker', REACTION_EMOJIS: [] };
  return new Proxy({}, { get: (_target, key) => key === 'default' ? {} : String(key) });
}, componentExports);
const Bubble = componentExports.MessageBubble;
const assistant = (body = '') => ({ id: 'reply-1', senderRole: 'assistant', body, createdAt: '2026-09-13T19:52:00Z', conversationId: 'room-1' });
function renderRow(item, { active = null, pending = [] } = {}) {
  const bindings = {
    React, MessageBubble: Bubble, View: 'View', DateSeparator: 'DateSeparator',
    invertedData: [item], ownerId: 'owner-1', currentStreamingMessageId: active,
    formatMessageDateKey: () => '2026-09-13', isOwnMessage: (message) => message.senderRole === 'owner',
    console: quietConsole, queueMicrotask: () => {}, __DEV__: false,
    IVX_OWNER_AI_PROFILE: { name: 'IVX Owner AI' }, styles: {},
    executionStatusByMessageId: new Map(), coerceExecutionStatusFromPayload: () => null,
    pendingOwnerMessages: pending, parseReplyBody: (body) => ({ body: body ?? '', replyTo: null }),
    highlightedMessageId: null, messageSearchQuery: '', pinnedMessageIdSet: new Set(),
    handleRetryMessage() {}, handleDismissFailedMessage() {}, handleTogglePinnedMessage() {},
    handleStartReplyToMessage() {}, handleJumpToMessage() {},
  };
  const render = evaluate(variable('renderMessage').arguments[0], route, bindings);
  const tree = render({ item, index: 0 });
  const bubble = elements(tree).find((node) => node.type === Bubble);
  assert.ok(bubble, 'The real route must render a message bubble');
  return { props: bubble.props, tree: Bubble(bubble.props) };
}

test('Android screenshot regression: empty active reply shows a cursor, never Not sent', () => {
  const { props, tree } = renderRow(assistant(), { active: 'reply-1' });
  assert.equal(props.isStreaming, true);
  assert.equal(props.message.text, '');
  assert.notEqual(props.message.sendStatus, 'failed');
  assert.ok(tree);
  assert.match(textContent(tree), /Receiving/);
  assert.doesNotMatch(textContent(tree), /Not sent|unable to display|Retry|Delivered/);
});
test('delta and final answer occupy the same bubble without a false error', () => {
  const streaming = renderRow(assistant('Hello'), { active: 'reply-1' });
  const final = renderRow(assistant('Hello Ivan'));
  assert.equal(streaming.props.message.id, final.props.message.id);
  assert.match(textContent(streaming.tree), /Hello/);
  assert.match(textContent(final.tree), /Hello Ivan/);
  assert.doesNotMatch(textContent(final.tree), /Not sent|Receiving/);
});
test('a genuinely empty terminal reply remains an error, without inert retry/remove controls', () => {
  const { tree } = renderRow(assistant());
  assert.match(textContent(tree), /unable to display/);
  assert.doesNotMatch(textContent(tree), /Retry|Remove/);
});
test('real failed owner messages retain working retry and remove actions', () => {
  const message = { id: 'owner-1', text: 'Hi', createdAt: assistant().createdAt, sendStatus: 'failed' };
  let retried, dismissed;
  const tree = Bubble({ message, isMine: true, onRetry: (value) => { retried = value; }, onDismiss: (id) => { dismissed = id; } });
  elements(tree).find((node) => node.props?.testID === 'chat-message-retry-owner-1').props.onPress();
  elements(tree).find((node) => node.props?.testID === 'chat-message-dismiss-owner-1').props.onPress();
  assert.equal(retried, message);
  assert.equal(dismissed, 'owner-1');
});
test('local persistence is never labeled Sent or left Sending', () => {
  const item = { ...assistant('Hi'), id: 'owner-1', senderRole: 'owner' };
  const { tree } = renderRow(item, { pending: [{ clientId: item.id, status: 'saved' }] });
  assert.match(textContent(tree), /Saved on device/);
  assert.doesNotMatch(textContent(tree), /Sending|Sent|Seen/);
});
test('a reloaded device-only owner message cannot gain a remote delivery or read receipt', () => {
  const { tree } = renderRow({ ...assistant('Hi'), id: 'cached-local', senderRole: 'owner', localOnly: true });
  assert.match(textContent(tree), /Saved on device/);
  assert.doesNotMatch(textContent(tree), /Sending|Sent|Seen/);
});
test('device storage failure is not acknowledged as a saved message', async () => {
  const source = ts.createSourceFile('service.ts', read('expo/src/modules/ivx-owner-ai/services/ivxChatService.ts'), ts.ScriptTarget.Latest, true);
  const node = findNode(source, (item) => ts.isFunctionDeclaration(item) && item.name?.text === 'appendLocalMessage');
  const append = evaluate(node, source, { loadLocalMessages: async () => [], saveLocalMessages: async () => false });
  await assert.rejects(append(assistant('Hi')), /Could not save this message/);
});
test('transport completion and failure update the original pending message', () => {
  let messages = [{ clientId: 'request-1', mode: 'send_and_ai', text: 'Hi', status: 'sending' }];
  const options = evaluate(variable('sendQueue').arguments[0], route, {
    setPendingOwnerMessages: (update) => { messages = update(messages); },
  });
  options.onSuccess({ persistence: 'local' }, { clientId: 'request-1' });
  assert.equal(messages[0].status, 'saved');
  options.onSuccess({ persistence: 'remote' }, { clientId: 'request-1' });
  assert.equal(messages[0].status, 'sent');
  options.onError(new Error('Unavailable'), { clientId: 'request-1' });
  assert.equal(messages[0].status, 'failed');
  assert.equal(messages[0].text, 'Hi');
});
function composer(overrides = {}) {
  return evaluate(variable('composerStatusMessage').arguments[0], route, {
    devTestMode: { testModeActive: false }, ownerAIAuthState: 'SIGNED_IN_OWNER', aiReplyPending: false,
    runtimeDebugSnapshot: { failureClass: 'none' },
    hasRuntimeFailure: (state) => !['none', 'pending'].includes(state.failureClass), ...overrides,
  })();
}
test('composer never reports Assistant ready during pending or failed requests', () => {
  assert.equal(composer({ aiReplyPending: true }), '');
  assert.match(composer({ runtimeDebugSnapshot: { failureClass: 'service_unavailable' } }), /last reply failed/);
  assert.equal(composer(), 'Ready to send.');
  assert.match(composer({ ownerAIAuthState: 'SIGNED_OUT' }), /Sign in/);
});
test('stream deltas render even when an optional watchdog trace is absent', () => {
  const progress = findNode(route, (node) => ts.isPropertyAssignment(node) && node.name.getText(route) === 'onProgress' && node.getText(route).includes('setStreamingText'));
  let text = '', messages = [assistant()];
  evaluate(progress.initializer, route, {
    trace: null, transientReplyId: 'reply-1', activeAssistantReplyRef: { current: 'reply-1' },
    conversationQuery: { data: { id: 'room-1' } },
    setStreamingText: (update) => { text = update(text); },
    setTransientAssistantMessages: (update) => { messages = update(messages); },
    buildVisibleAssistantTransient: (input) => input,
  })({ type: 'delta', delta: 'Hello' });
  assert.equal(text, 'Hello');
  assert.equal(messages[0].body, 'Hello');
});
test('a late old request cannot clear the next request streaming state', () => {
  const cleanup = findNode(route, (node) => ts.isIfStatement(node) && node.expression.getText(route) === 'activeAssistantReplyRef.current === transientReplyId');
  const code = ts.transpileModule(cleanup.getText(route), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const ref = { current: 'new-reply' };
  let calls = 0;
  new Function('activeAssistantReplyRef', 'transientReplyId', 'setAiReplyPending', 'setStreamingText', 'setCurrentStreamingMessageId', code)(ref, 'old-reply', () => calls++, () => calls++, () => calls++);
  assert.equal(calls, 0);
  assert.equal(ref.current, 'new-reply');
});
test('an empty placeholder cannot satisfy the terminal visible-reply invariant', () => {
  const predicate = variable('anyEmittedPresent');
  const evaluatePresence = (body) => evaluate(predicate, route, {
    current: [assistant(body)], currentIds: new Set(['reply-1']), emittedBubbleIds: new Set(['reply-1']), safeTrim: (text) => (text ?? '').trim(),
  });
  assert.equal(evaluatePresence(''), false);
  assert.equal(evaluatePresence('Hello'), true);
});
test('the transport returns the actual message identity and persistence scope', async () => {
  const source = ts.createSourceFile('queue.ts', read('expo/src/modules/chat/services/chatTransportQueue.ts'), ts.ScriptTarget.Latest, true);
  const execute = findNode(source, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'executeSend');
  for (const persistence of ['remote', 'local']) {
    const fn = evaluate(execute, source, {
      now: Date.now, QUEUE_TIMEOUT_MS: 20_000, emitLifecycle() {}, isAbortError: () => false,
      ivxChatService: { sendOwnerTextMessage: async () => ({ id: 'actual-id', conversationId: 'actual-room', persistence }) },
    });
    assert.deepEqual(await fn({ mode: 'send_only', text: 'Hi' }), { messageId: 'actual-id', conversationId: 'actual-room', persistence });
  }
});

const ownerGuardSource = ts.createSourceFile('owner-only.ts', read('backend/api/owner-only.ts'), ts.ScriptTarget.Latest, true);
const unavailableExports = {};
new Function('exports', ts.transpileModule(read('backend/api/owner-ai-auth-unavailable.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(unavailableExports);
const ApprovalError = evaluate(findNode(ownerGuardSource, (node) => ts.isClassDeclaration(node) && node.name?.text === 'IVXOwnerApprovalError'), ownerGuardSource);
const unavailableError = () => Object.assign(new Error('IVX owner verification is temporarily unavailable. Please retry.'), { name: 'IVXAuthServiceUnavailableError' });
const guardNode = findNode(ownerGuardSource, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'assertIVXRegisteredOwnerBearer');
function guard(resolve) {
  return evaluate(guardNode, ownerGuardSource, {
    checkIVXAISystemKey: async () => false,
    resolveIVXAuthenticatedRequest: resolve,
    IVXOwnerApprovalError: ApprovalError,
    isOwnerAuthUnavailable: unavailableExports.isOwnerAuthUnavailable,
    parseOwnerEmailAllowlist: () => ['owner@example.test'],
    makeOwnerMutationApprovalProof: (proof) => proof,
    evaluateIVXRegisteredOwnerBearerContext: () => { throw new Error('Unverified context must not reach approval'); },
  });
}
test('an identity-provider outage is rejected as 503 rather than owner-forbidden 403', async () => {
  await assert.rejects(guard(async () => { throw unavailableError(); })(new Request('https://example.test'), 'owner_ai_proxy_status'), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.proof.ownerVerified, false);
    assert.equal(error.cause.name, 'IVXAuthServiceUnavailableError');
    return true;
  });
});
test('missing and invalid credentials still fail closed', async () => {
  for (const [message, expectedStatus] of [['missing bearer token', 401], ['invalid or expired Supabase session', 403]]) {
    await assert.rejects(guard(async () => { throw new Error(message); })(new Request('https://example.test'), 'owner_ai_proxy_status'), (error) => {
      assert.equal(error.status, expectedStatus);
      assert.equal(error.proof.ownerVerified, false);
      assert.equal(unavailableExports.ownerAIAuthUnavailableResponse(error), null);
      return true;
    });
  }
});
test('the real proxy-status handler returns retryable 503 and no assistant success payload', async () => {
  const source = ts.createSourceFile('owner-ai.ts', read('backend/api/ivx-owner-ai.ts'), ts.ScriptTarget.Latest, true);
  const handler = findNode(source, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'handleIVXOwnerAIProxyStatus');
  const fn = evaluate(handler, source, {
    assertIVXRegisteredOwnerBearer: guard(async () => { throw unavailableError(); }),
    IVXOwnerApprovalError: ApprovalError,
    ownerAIAuthUnavailableResponse: unavailableExports.ownerAIAuthUnavailableResponse,
    ownerOnlyJson: (body, status) => Response.json(body, { status }),
  });
  const response = await fn(new Request('https://example.test/api/ivx/owner-ai/proxy-status'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '5');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.code, 'AUTH_SERVICE_UNAVAILABLE');
  assert.equal(body.retryable, true);
  assert.equal(body.answer, undefined);
});
