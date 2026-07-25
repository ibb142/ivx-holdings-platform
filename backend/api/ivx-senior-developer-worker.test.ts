import { describe, expect, test } from 'bun:test';
import { resolveWorkerExecutionMode } from './ivx-senior-developer-worker';

describe('resolveWorkerExecutionMode', () => {
  test('routes an owner-approved production mutation through deploy even when no mode was supplied', () => {
    expect(resolveWorkerExecutionMode(undefined, true, true)).toBe('deploy');
  });

  test('routes an approved patch without deployment through the code-change executor', () => {
    expect(resolveWorkerExecutionMode(undefined, true, false)).toBe('code_change');
  });

  test('does not allow a QA mode to downgrade an owner-approved production mutation', () => {
    expect(resolveWorkerExecutionMode('qa_only', true, true)).toBe('deploy');
  });

  test('preserves an explicit safe read-only mode without mutation approvals', () => {
    expect(resolveWorkerExecutionMode('read_only', false, false)).toBe('read_only');
  });
});
