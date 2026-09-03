import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('autonomous workflow regression guards', () => {
  test('executive report tolerates incomplete agent evidence', () => {
    const workflow = readFileSync('.github/workflows/ivx-112-executive-report.yml', 'utf8');
    expect(workflow).toContain('.assignment // ""');
    expect(workflow).toContain('.name // .agentId // "unknown"');
  });

  test('known-gap replay explicitly skips obsolete legacy targets', () => {
    const repair = readFileSync('qa/ivx-enterprise-known-gap-repair.mjs', 'utf8');
    expect(repair).toContain('transform.optional === true');
    expect(repair).toContain("id: 'production-down-fail-closed',\n    optional: true");
  });
});
