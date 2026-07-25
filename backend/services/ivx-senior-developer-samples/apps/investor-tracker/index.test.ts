// AUTO-SCAFFOLDED test for the investor-tracker app.
// Uses node:assert so it is import-safe under Node import-smoke validation
// and runnable via `bun test` or `node --test`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runApp, investor_trackerApp } from './index';

describe('investor-tracker scaffolded app', () => {
  test('runApp returns a real execution string', () => {
    const result = runApp('test-input');
    assert.ok(result.includes('investor-tracker'), 'result should contain app name');
    assert.ok(result.includes('test-input'), 'result should contain input');
    assert.ok(result.includes('Scaffolded by IVX Senior Developer'), 'result should mention IVX Senior Developer');
  });

  test('app metadata is real', () => {
    assert.equal(investor_trackerApp.name, "investor-tracker");
    assert.equal(investor_trackerApp.version, '0.1.0');
    assert.ok(investor_trackerApp.createdAt, "createdAt should be truthy");
  });

  test('runApp with no input uses default', () => {
    const result = runApp();
    assert.ok(result.includes('investor-tracker'), 'result should contain app name');
  });
});
