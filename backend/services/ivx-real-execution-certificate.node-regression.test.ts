import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCertificateForApi } from './ivx-real-execution-certificate';

process.env.RENDER_GIT_COMMIT = '1be62be9d422d27d8eae37eb0d15d9a9e41d3924';

// Regression test for commit SHA issue

test('getCertificateForApi should return correct commitSha', async () => {
  const result = await getCertificateForApi();
  assert.strictEqual(result.commitSha, '1be62be9d422d27d8eae37eb0d15d9a9e41d3924');
});
