import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/ivx-112-24x7-watchdog.yml', 'utf8');

describe('IVX 112 watchdog fail-closed evidence ordering', () => {
  test('persists per-agent evidence before hard-gate assertions', () => {
    const evidenceWrite = workflow.indexOf('ivx-112-24x7-agent-results.json');
    const failureWrite = workflow.indexOf('ivx-112-24x7-failures.json');
    const successGate = workflow.indexOf('test "$success" = 112');
    const evidenceGate = workflow.indexOf('test "$evidence" = 112');

    expect(evidenceWrite).toBeGreaterThan(-1);
    expect(failureWrite).toBeGreaterThan(-1);
    expect(successGate).toBeGreaterThan(evidenceWrite);
    expect(evidenceGate).toBeGreaterThan(failureWrite);
  });

  test('keeps 112/112 and evidence/tool matching as hard requirements', () => {
    expect(workflow).toContain('test "$total" = 112');
    expect(workflow).toContain('test "$success" = 112');
    expect(workflow).toContain('test "$failed" = 0');
    expect(workflow).toContain('test "$evidence" = 112');
    expect(workflow).toContain('test "$tool_match" = 112');
  });

  test('always uploads diagnostics and failure details', () => {
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('ivx-112-24x7-cycle-diagnostics.json');
    expect(workflow).toContain('ivx-112-24x7-failures.json');
  });
});
