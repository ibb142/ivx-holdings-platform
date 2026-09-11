import { describe, expect, test } from 'bun:test';
import { evaluateQAGate } from './ivx-qa-verdict';

describe('QA acceptance exit status', () => {
  test('a FAIL blocks the observed matrix even when its ERROR count is zero', () => {
    const results = [...Array.from({ length: 16 }, () => ({ status: 'PASS' })),
      { status: 'FAIL' }, ...Array.from({ length: 5 }, () => ({ status: 'SKIP' }))];
    expect(evaluateQAGate(results)).toEqual({ verdict: 'FAIL', exitCode: 1 });
  });
  test('ERROR also fails acceptance', () => {
    expect(evaluateQAGate([{ status: 'PASS' }, { status: 'ERROR' }])).toEqual({ verdict: 'FAIL', exitCode: 1 });
  });
  test('only complete executed success passes', () => {
    expect(evaluateQAGate([{ status: 'PASS' }, { status: 'PASS' }])).toEqual({ verdict: 'PASS', exitCode: 0 });
  });
  test('skipped production or owner scenarios remain incomplete', () => {
    expect(evaluateQAGate([{ status: 'PASS' }, { status: 'SKIP' }])).toEqual({ verdict: 'INCOMPLETE', exitCode: 2 });
    expect(evaluateQAGate([{ status: 'SKIP' }]).exitCode).toBe(2);
  });
  test('an empty or malformed status report cannot pass', () => {
    expect(evaluateQAGate([])).toEqual({ verdict: 'INCOMPLETE', exitCode: 2 });
    expect(evaluateQAGate([{ status: 'success' }]).exitCode).toBe(2);
  });
  test('the shell receives a nonzero status for failure and incomplete QA', () => {
    const modulePath = new URL('./ivx-qa-verdict.ts', import.meta.url).pathname;
    for (const [status, exitCode] of [['PASS', 0], ['FAIL', 1], ['ERROR', 1], ['SKIP', 2]] as const) {
      const child = Bun.spawnSync([process.execPath, '-e',
        'import { evaluateQAGate } from ' + JSON.stringify(modulePath) +
        '; process.exit(evaluateQAGate([{ status: ' + JSON.stringify(status) + ' }]).exitCode);']);
      expect(child.exitCode).toBe(exitCode);
    }
  });
});
