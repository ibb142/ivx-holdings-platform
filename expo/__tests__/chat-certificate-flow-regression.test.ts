import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const chatSource = readFileSync(resolve(import.meta.dir, '../app/ivx/chat.tsx'), 'utf8');
const tabsLayoutSource = readFileSync(resolve(import.meta.dir, '../app/(tabs)/_layout.tsx'), 'utf8');
const homeSource = readFileSync(resolve(import.meta.dir, '../app/(tabs)/home.tsx'), 'utf8');
const flowSource = readFileSync(resolve(import.meta.dir, '../.maestro/ivx-owner-chat-certificate.yaml'), 'utf8');

const requiredChatTestIDs = [
  'ivx-owner-chat-composer-dock',
  'ivx-owner-chat-composer',
  'ivx-owner-chat-input',
  'ivx-owner-chat-send',
  'ivx-owner-chat-scroll-to-latest',
];

describe('IVX IA chat device certificate regression', () => {
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

  test('device certificate flow only references testIDs that exist in source', () => {
    expect(flowSource).toContain('appId: com.ivxholdings.app.owner');
    const flowTestIDs = [...flowSource.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
    expect(flowTestIDs.length).toBeGreaterThan(0);
    for (const testID of flowTestIDs) {
      const present =
        chatSource.includes(`testID="${testID}"`) ||
        tabsLayoutSource.includes(`tabBarButtonTestID: '${testID}'`);
      expect(present).toBe(true);
    }
  });

  test('device certificate flow sends and asserts the probe message exactly once', () => {
    expect(flowSource).toContain('inputText: "QA cert probe chat check"');
    expect(flowSource.match(/QA cert probe chat check/g)?.length).toBe(2);
    expect(flowSource).toContain('ivx-owner-chat-send');
  });

  test('Home keeps the visible "Home ready" runtime banner for Android Emulator QA', () => {
    expect(homeSource).toContain('Home ready');
    expect(homeSource).toContain('testID="home-runtime-ready"');
  });
});
