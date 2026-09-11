import { test, expect } from 'bun:test';
import { Transpiler } from 'bun';
import { readFileSync, existsSync } from 'node:fs';

// Execute the existing private credential resolver without booting Auth or
// calling production services. Both the baseline and patched runs use this file.
const source = readFileSync(new URL('./ivx-member-auth-certification.ts', import.meta.url), 'utf8');
const helperPath = new URL('./ivx-owner-password-runtime.ts', import.meta.url);
const helperSource = existsSync(helperPath) ? readFileSync(helperPath, 'utf8').replace('export function', 'function') : '';
const extract = (start: string, end: string) => {
  const at = source.indexOf(start), until = source.indexOf(end, at);
  if (at < 0 || until < 0) throw new Error('Credential resolver boundary missing');
  return source.slice(at, until);
};
const body = new Transpiler({ loader: 'ts' }).transformSync(
  helperSource + extract('function env(', '\nfunction canonicalSupabaseUrl(')
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

test('encoded transport survives character expansion in legacy runtime bindings', async () => {
  for (const password of ['Transport-$$-Pass!2026', ' \tFicción-$$(NAME)-🔒\r\n']) {
    const bindings = { IVX_OWNER_PASSWORD_BASE64: Buffer.from(password, 'utf8').toString('base64'), IVX_OWNER_PASSWORD: password.replaceAll('$$', '$') };
    expect(await resolver(bindings)()).toBe(password);
    const emergency = readFileSync(new URL('../api/ivx-owner-passwordless-login.ts', import.meta.url), 'utf8');
    const start = emergency.indexOf('async function readOwnerPassword('), end = emergency.indexOf('\nfunction sanitizeEmail(', start);
    const code = new Transpiler({ loader: 'ts' }).transformSync(helperSource + emergency.slice(start, end));
    const read = new Function('process', 'getIVXOwnerVariableRuntimeValue', code + '\nreturn readOwnerPassword;')({ env: bindings }, async () => 'stale');
    expect(await read()).toBe(password);
  }
});

test('malformed encoded credentials never fall back to stale passwords', async () => {
  for (const encoded of ['%%%invalid%%%', 'YQ', '/w==', 'YQ==\n']) {
    expect(await resolver({ IVX_OWNER_PASSWORD_BASE64: encoded, IVX_OWNER_PASSWORD: 'stale' }, 'also-stale')()).toBe('');
  }
});
