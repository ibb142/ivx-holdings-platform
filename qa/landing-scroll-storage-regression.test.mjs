import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../expo/ivxholding-landing/ivx-ui-utils.js', import.meta.url), 'utf8');
function page(storage) {
  const events = new Map();
  const diagnostics = [];
  runInNewContext(source, {
    location: { pathname: '/private-page' },
    window: { scrollY: 217, addEventListener: (name, callback) => events.set(name, callback) },
    document: { readyState: 'loading', querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    MutationObserver: class { observe() {} },
    sessionStorage: storage,
    console: { error: (...args) => diagnostics.push(args), warn: (...args) => diagnostics.push(args) },
  });
  return { hide: () => events.get('pagehide')(), diagnostics };
}

test('pagehide reports a storage failure once without copying its private error message', () => {
  const marker = 'PRIVATE_SESSION_VALUE_934';
  const p = page({ setItem() { throw new Error(marker); } });
  assert.doesNotThrow(p.hide);
  assert.equal(p.diagnostics.length, 1);
  assert.equal(p.diagnostics[0][0], '[IVX] Scroll position could not be saved.');
  assert.equal(JSON.stringify(p.diagnostics).includes(marker), false);
});

for (const thrown of [null, { get message() { throw new Error('unsafe error getter'); } }]) {
  test('storage failures with an untrusted thrown value do not break pagehide', () => {
    const p = page({ setItem() { throw thrown; } });
    assert.doesNotThrow(p.hide);
    assert.equal(p.diagnostics.length, 1);
  });
}

test('successful storage retains the original key and scroll position', () => {
  const writes = [];
  const p = page({ setItem: (...args) => writes.push(args) });
  p.hide();
  assert.deepEqual(writes, [['ivx_scroll_/private-page', '217']]);
  assert.deepEqual(p.diagnostics, []);
});
