import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('a directly opened chat room has its real storage adapter before any configuration effect', () => {
  const source = readFileSync(new URL('../../expo/src/modules/chat/services/chatProvider.ts', import.meta.url), 'utf8');
  const code = source.replace(/^import[^;]+;\s*/gm, '').replace(/^export /gm, '');
  const storage = { listMessages: async () => ['durable-message'] };
  const api: any = {};
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(code) + '\nObject.assign(api, {getChatProvider,setChatProvider});', {
    api, supabaseChatProvider: storage, console: { log() {} },
  });
  expect(api.getChatProvider()).toBe(storage);
  const override = { listMessages: async () => ['injected-message'] };
  api.setChatProvider(override);
  expect(api.getChatProvider()).toBe(override);
});

test('Intro route establishes its context before rendering the context consumer', () => {
  const source = readFileSync(new URL('../../expo/app/admin/intro.tsx', import.meta.url), 'utf8');
  const match = /export default function IntroManagement\(\)\s*\{\s*return\s*\(\s*<IntroProvider>\s*<IntroManagementContent\s*\/>\s*<\/IntroProvider>\s*\);?\s*\}/.exec(source);
  expect(match).not.toBeNull();
  expect(source).toMatch(/function IntroManagementContent\(\)/);
  expect(source).toMatch(/import\s*\{[^}]*IntroProvider[^}]*\}\s*from ['"]@\/lib\/intro-context['"]/);
  // The guard remains in the parent layout; adding a provider is not access.
  const layout = readFileSync(new URL('../../expo/app/admin/_layout.tsx', import.meta.url), 'utf8');
  expect(layout).toContain('useAdminGuard(guardOptions)');
  expect(layout).toContain('if (!isAdmin)');
});
