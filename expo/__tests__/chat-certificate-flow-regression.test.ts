import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const chatSource = readFileSync(resolve(import.meta.dir, '../app/ivx/chat.tsx'), 'utf8');
const chatHubSource = readFileSync(resolve(import.meta.dir, '../components/ChatScreenContent.tsx'), 'utf8');
const tabsLayoutSource = readFileSync(resolve(import.meta.dir, '../app/(tabs)/_layout.tsx'), 'utf8');
const homeSource = readFileSync(resolve(import.meta.dir, '../app/(tabs)/home.tsx'), 'utf8');
const loginSource = readFileSync(resolve(import.meta.dir, '../app/login.tsx'), 'utf8');
const flowSource = readFileSync(resolve(import.meta.dir, '../.maestro/ivx-owner-chat-certificate.yaml'), 'utf8');
const transportReliabilitySource = readFileSync(resolve(import.meta.dir, './chat-transport-reliability.test.ts'), 'utf8');

const requiredChatTestIDs = [
  'ivx-owner-chat-composer-dock',
  'ivx-owner-chat-composer',
  'ivx-owner-chat-input',
  'ivx-owner-chat-send',
  'ivx-owner-chat-scroll-to-latest',
];

const E2E_PROMPT = 'Return only the result of joining IVX_CHAT_E2E_ and ${CHAT_E2E_SUFFIX}.';
const E2E_REPLY = 'IVX_CHAT_E2E_${CHAT_E2E_SUFFIX}';

describe('IVX IA chat device certificate regression', () => {
  test('both device certificate callers bind the fresh reply marker and restart credentials', () => {
    for (const script of ['ivx-owner-home-android-e2e.sh', 'ivx-dashboard-chat-android-e2e.sh']) {
      const source = readFileSync(resolve(import.meta.dir, '../../scripts', script), 'utf8');
      const invocation = source.slice(source.indexOf('test expo/.maestro/ivx-owner-chat-certificate.yaml')).split('\n\n')[0];
      for (const name of ['CHAT_E2E_SUFFIX', 'OWNER_EMAIL', 'OWNER_PASSWORD']) {
        expect(invocation).toContain(`--env ${name}=`);
      }
    }
  });

  test('keeps every certificate testID rendered by the chat surface', () => {
    for (const testID of requiredChatTestIDs) {
      expect(chatSource).toContain(`testID="${testID}"`);
    }
  });

  test('keeps the fresh-build chat certificate marker on the composer dock', () => {
    expect(chatSource).toContain('IVX owner chat certificate v1');
  });

  test('keeps the chat tab reachable from the owner tab bar', () => {
    expect(tabsLayoutSource).toContain("tabBarButtonTestID: 'tab-chat'");
  });

  test('keeps the owner AI room reachable from the Live Support hub', () => {
    expect(chatHubSource).toContain('testID="chat-open-message-room"');
    expect(chatHubSource).toContain("router.push('/ivx/chat'");
  });

  test('device certificate flow only references stable route/composer testIDs', () => {
    expect(flowSource).toContain('appId: com.ivxholdings.app.owner');
    const flowTestIDs = [...flowSource.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
    expect(flowTestIDs.length).toBeGreaterThan(0);
    for (const testID of flowTestIDs) {
      const present =
        chatSource.includes(`testID="${testID}"`) ||
        loginSource.includes(`testID="${testID}"`) ||
        chatHubSource.includes(`testID="${testID}"`) ||
        tabsLayoutSource.includes(`tabBarButtonTestID: '${testID}'`);
      expect(present).toBe(true);
    }
  });

  test('hard-gates send -> live AI reply -> visible render', () => {
    expect(E2E_PROMPT).not.toContain(E2E_REPLY);
    expect(flowSource).toContain(`inputText: "${E2E_PROMPT}"`);
    expect(flowSource).toContain(`element: "${E2E_PROMPT}"`);
    expect(flowSource).toContain(`visible: "${E2E_REPLY}"`);
    expect(flowSource).toContain('timeout: 200000');
    expect(flowSource).toContain('assertNotVisible: "Not sent"');
    expect(flowSource).toContain('assertNotVisible: "I was unable to display this reply"');
  });

  test('starts the normal conversational AI request before durable persistence can stall', () => {
    const triggerIndex = chatSource.indexOf('2.2_AI_TRIGGER_BEFORE_PERSISTENCE');
    const decisionIndex = chatSource.lastIndexOf('const startAssistantImmediately', triggerIndex);
    const persistenceIndex = chatSource.indexOf('const queueResult = await sendQueue.mutateAsync', triggerIndex);

    expect(triggerIndex).toBeGreaterThan(-1);
    expect(decisionIndex).toBeGreaterThan(-1);
    expect(persistenceIndex).toBeGreaterThan(triggerIndex);
    expect(chatSource.slice(triggerIndex, persistenceIndex)).toContain('void triggerAssistantWithRetry()');
    expect(chatSource.slice(decisionIndex, triggerIndex)).toContain('!trustContext.requiresElevatedConfirmation');
  });

  test('does not cancel or duplicate a running AI reply when background persistence degrades', () => {
    const mutationIndex = chatSource.indexOf('const sendMessageMutation = useMutation');
    const degradedIndex = chatSource.indexOf('2.4_BACKGROUND_PERSISTENCE_DEGRADED_AI_CONTINUES', mutationIndex);
    const modeContinuationIndex = chatSource.indexOf("if (mode === 'ai_only')", degradedIndex);
    const mutationEndIndex = chatSource.indexOf('\n\n  useEffect(', mutationIndex);

    expect(mutationIndex).toBeGreaterThan(-1);
    expect(degradedIndex).toBeGreaterThan(mutationIndex);
    expect(modeContinuationIndex).toBeGreaterThan(degradedIndex);
    expect(chatSource.slice(degradedIndex - 700, modeContinuationIndex)).toContain('if (startAssistantImmediately)');
    expect(chatSource.slice(degradedIndex, modeContinuationIndex)).toContain("persistence=degraded ai=continues");
    expect(mutationEndIndex).toBeGreaterThan(modeContinuationIndex);
    expect(chatSource.slice(mutationIndex, mutationEndIndex)).toContain('retry: false');
  });

  test('hard-gates app restart persistence without clearing state', () => {
    const stopIndex = flowSource.indexOf('- stopApp');
    const launchIndex = flowSource.indexOf('- launchApp:');
    const clearStateIndex = flowSource.indexOf('clearState: false');
    expect(stopIndex).toBeGreaterThan(-1);
    expect(launchIndex).toBeGreaterThan(stopIndex);
    expect(clearStateIndex).toBeGreaterThan(launchIndex);

    const afterRestart = flowSource.slice(clearStateIndex);
    expect(afterRestart).toContain('inputText: ${OWNER_EMAIL}');
    expect(afterRestart).toContain('inputText: ${OWNER_PASSWORD}');
    expect(afterRestart.indexOf('id: "login-submit"')).toBeLessThan(afterRestart.indexOf('id: "tab-chat"'));
    expect(afterRestart).toContain(`element: "${E2E_PROMPT}"`);
    expect(afterRestart).toContain(`element: "${E2E_REPLY}"`);
    expect(afterRestart).toContain('id: "ivx-owner-chat-composer-dock"');
  });

  test('keeps retry behavior hard-gated in the transport reliability suite', () => {
    expect(transportReliabilitySource).toContain("it('retrySend resets a failed operation back to queued'");
    expect(transportReliabilitySource).toContain('retrySend(reqId)');
    expect(transportReliabilitySource).toContain("expect(after.status).toBe('queued')");
    expect(transportReliabilitySource).toContain('expect(after.attempts).toBe(0)');
    expect(transportReliabilitySource).toContain('expect(after.lastError).toBeNull()');
  });

  test('device certificate flow navigates the hub to the owner AI room before asserting the composer', () => {
    expect(flowSource.indexOf('id: "chat-open-message-room"')).toBeLessThan(
      flowSource.indexOf('id: "ivx-owner-chat-composer-dock"'),
    );
  });

  test('Home keeps the visible "Home ready" runtime banner for Android Emulator QA', () => {
    expect(homeSource).toContain('Home ready');
    expect(homeSource).toContain('testID="home-runtime-ready"');
  });
});
