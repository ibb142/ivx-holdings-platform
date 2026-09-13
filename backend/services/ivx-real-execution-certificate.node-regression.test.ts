import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCertificateForApi } from './ivx-real-execution-certificate';

process.env.RENDER_GIT_COMMIT = 'd61be9173fb1320e48692846edcf8170fbe79f6b';

// Regression test for certificate SHA validation
// This test should fail with ERR_ASSERTION before the fix and pass after

test('getCertificateForApi should correctly validate commit SHA', async () => {
  const result = await getCertificateForApi();
  assert.equal(result.commitMatchesRuntime, true, 'Commit SHA should match runtime');
});
