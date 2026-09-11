import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('the enterprise secret gate catches key boundaries without matching task markers', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ivx-enterprise-qa.yml', import.meta.url), 'utf8');
  const pattern = workflow.match(/'([^'\n]*sk-\[A-Za-z0-9_\-\][^'\n]*)'/)?.[1];
  expect(pattern).toBeDefined();
  const matches = (value: string) => spawnSync('grep', ['-Eq', pattern!], { input: value }).status === 0;
  const synthetic = 'sk-' + 'x'.repeat(36);
  for (const value of [synthetic, `KEY="${synthetic}"`, `Bearer ${synthetic}`]) expect(matches(value)).toBe(true);
  for (const value of ['ivx-autonomous-task-engine-2026-09-07-fleet-batch-v1',
    'ivx-postgres-autonomous-task-store-2026-09-08-current-work-v3-direct-failover']) expect(matches(value)).toBe(false);
});
