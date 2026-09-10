import { expect, test } from 'bun:test';
import { MOBILE_CHECK, verifiedMobileSkip } from './ivx-ci-conditional-evidence';
const run = (name: string, conclusion: string | null = 'success', status = 'completed') => ({ name, conclusion, status });
const dependencies = [run('Mobile impact classifier'), run('TypeScript typecheck — HARD GATE')];
test('accepts the workflow conditional skip only with both successful dependencies', () => {
  expect(verifiedMobileSkip([...dependencies, run(MOBILE_CHECK, 'skipped')])).toBe(true);
});
test('missing, pending and failed classifier do not authorize mobile skip', () => {
  for (const classifier of [[], [run('Mobile impact classifier', null, 'in_progress')], [run('Mobile impact classifier', 'failure')]]) {
    expect(verifiedMobileSkip([...classifier, dependencies[1], run(MOBILE_CHECK, 'skipped')])).toBe(false);
  }
});
test('failed typecheck and actual mobile failures remain blocked', () => {
  expect(verifiedMobileSkip([dependencies[0], run(dependencies[1].name, 'failure'), run(MOBILE_CHECK, 'skipped')])).toBe(false);
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    expect(verifiedMobileSkip([...dependencies, run(MOBILE_CHECK, conclusion)])).toBe(false);
  }
});
