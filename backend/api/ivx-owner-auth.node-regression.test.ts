import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleOwnerAuthorize } from './ivx-owner-auth';

const mockRequest = (headers = {}) => new Request('https://example.com', { headers });

test('logs and returns unauthorized on missing token', async () => {
  const request = mockRequest();
  const response = await handleOwnerAuthorize(request);
  assert.equal(response.status, 401);

  const responseBody = await response.json();
  assert.equal(responseBody.success, false);
  assert.equal(responseBody.reason, 'missing_token');
  assert.equal(responseBody.message, 'Authorization token is required.');
});
