import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCertificateForApi } from './ivx-real-execution-certificate';

// Mock environment variables for testing
process.env.SOURCE_VERSION = '799e6457d96f239b9d81c139901391b6d78d7b83';
process.env.RENDER_GIT_COMMIT = 'incorrect-sha';
process.env.GIT_COMMIT_SHA = 'another-incorrect-sha';

// Regression test for commit SHA

test('getCertificateForApi returns the correct commit SHA', async () => {
  const result = await getCertificateForApi();
  assert.equal(result.runtimeCommitSha, '799e6457d96f239b9d81c139901391b6d78d7b83', 'commit SHA should match SOURCE_VERSION');
});
