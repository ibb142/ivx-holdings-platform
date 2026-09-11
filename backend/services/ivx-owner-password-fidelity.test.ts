import { test, expect } from 'bun:test';
import { Transpiler } from 'bun';
import { readFileSync } from 'node:fs';

// Execute the existing private credential resolver without booting Auth or
// calling production services. Both the baseline and patched runs use this file.
const source = readFileSync(new URL('./ivx-member-auth-certification.ts', import.meta.url), 'utf8');
const extract = (start: string, end: string) => {
  const at = source.indexOf(start), until = source.indexOf(end, at);
  if (at < 0 || until < 0) throw new Error('Credential resolver boundary missing');
  return source.slice(at, until);
};
const body = new Transpiler({ loader: 'ts' }).transformSync(
  extract('function env(', '\nfunction canonicalSupabaseUrl(')
  + extract('async function ownerPasswordFromRuntime(', '\nfunction adminClient('),
);
const resolver = (bindings: Record<string, string>, stored = '') => new Function(
  'process', 'getIVXOwnerVariableRuntimeValue', body + '\nreturn ownerPasswordFromRuntime;',
)({ env: bindings }, async () => stored) as () => Promise<string>;

test('the runtime preserves the exact configured password bytes', async () => {
  const password = ' \tFixture-Passphrase!9\r\n';
  expect(await resolver({ IVX_OWNER_PASSWORD: password })()).toBe(password);
});
test('the legacy environment binding preserves exact values', async () => {
  const password = ' Fixture-Legacy!9 ';
  expect(await resolver({ OWNER_NEW_PASSWORD: password })()).toBe(password);
});
test('the store fallback is not normalized by the resolver', async () => {
  const password = ' Fixture-Stored!9 ';
  expect(await resolver({}, password)()).toBe(password);
});
test('the explicit runtime binding takes priority over a stale fallback', async () => {
  expect(await resolver({ IVX_OWNER_PASSWORD: 'valid', OWNER_NEW_PASSWORD: 'old' }, 'stale')()).toBe('valid');
  expect(await resolver({})()).toBe('');
});
