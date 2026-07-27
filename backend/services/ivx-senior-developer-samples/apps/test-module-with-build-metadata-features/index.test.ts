// AUTO-SCAFFOLDED test for the test-module-with-build-metadata-features app.
// Uses node:assert so it is import-safe under Node import-smoke validation
// and runnable via `bun test` or `node --test`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runApp, test_module_with_build_metadata_featuresApp } from './index';

describe('test-module-with-build-metadata-features scaffolded app', () => {
  test('runApp returns a real execution string', () => {
    const result = runApp('test-input');
    assert.ok(result.includes('test-module-with-build-metadata-features'), 'result should contain app name');
    assert.ok(result.includes('test-input'), 'result should contain input');
    assert.ok(result.includes('Scaffolded by IVX Senior Developer'), 'result should mention IVX Senior Developer');
  });

  test('app metadata is real', () => {
    assert.equal(test_module_with_build_metadata_featuresApp.name, "test-module-with-build-metadata-features");
    assert.equal(test_module_with_build_metadata_featuresApp.version, '0.1.0');
    assert.ok(test_module_with_build_metadata_featuresApp.createdAt, "createdAt should be truthy");
  });

  test('runApp with no input uses default', () => {
    const result = runApp();
    assert.ok(result.includes('test-module-with-build-metadata-features'), 'result should contain app name');
  });
});
