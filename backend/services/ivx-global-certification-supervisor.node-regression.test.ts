import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGlobalCertification } from './ivx-global-certification-supervisor';
import { GlobalCertificationInput } from './ivx-global-certification-supervisor';

test('handle skipped workflow with SHA mismatch correctly results in RED', async () => {
  const input: GlobalCertificationInput = {
    mainSha: 'abc123',
    productionSha: 'abc123',
    productionHealthy: true,
    runs: [
      {
        workflow: 'IVX 112 Exact SHA Auto-Deploy Certificate',
        runId: 123,
        headSha: 'def456', // SHA mismatch
        headBranch: 'main',
        status: 'completed',
        conclusion: 'skipped',
      },
    ],
    collector: 'github_actions_api',
  };

  const result = computeGlobalCertification(input);
  assert.strictEqual(result.status, 'RED', 'Certification should be RED due to skipped workflow with SHA mismatch');
});