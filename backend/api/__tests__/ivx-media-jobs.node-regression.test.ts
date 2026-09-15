import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleIVXMediaJobsCreateRequest } from '../ivx-media-jobs';

async function mockJsonRequest(data: Record<string, unknown>) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

describe('IVX Media Jobs API', () => {
  it('should not create a media job with mediaCount <= 0', async () => {
    const request = await mockJsonRequest({ mediaCount: 0, mediaTypes: {}, prompt: 'Test', ownerId: 'owner123' });
    const response = await handleIVXMediaJobsCreateRequest(request);
    const responseBody = await response.json();
    assert.equal(response.status, 400);
    assert.deepEqual(responseBody, { ok: false, error: 'mediaCount must be > 0.' });
  });

  it('should not create a media job with missing mediaTypes', async () => {
    const request = await mockJsonRequest({ mediaCount: 1, mediaTypes: {}, prompt: 'Test', ownerId: 'owner123' });
    const response = await handleIVXMediaJobsCreateRequest(request);
    const responseBody = await response.json();
    assert.equal(response.status, 400);
    assert.deepEqual(responseBody, { ok: false, error: 'mediaCount must be > 0.' });
  });

  it('should create a media job with valid mediaCount and mediaTypes', async () => {
    const request = await mockJsonRequest({ mediaCount: 1, mediaTypes: { image: 1 }, prompt: 'Test', ownerId: 'owner123' });
    const response = await handleIVXMediaJobsCreateRequest(request);
    const responseBody = await response.json();
    assert.equal(response.status, 201);
    assert.strictEqual(responseBody.ok, true);
    assert.ok(responseBody.job);
  });
});