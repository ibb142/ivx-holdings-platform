import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCertApp } from './server';
import { Hono } from 'hono';

const app = createCertApp();

test('should log error with traceId', async () => {
  const response = await app.request('/api/unknown-route', { method: 'GET' });
  assert.equal(response.status, 404);
  const json = await response.json();
  assert(json.error.includes('Route not found'));
  assert(typeof json.traceId === 'string' && json.traceId.startsWith('trace-'), 'traceId should be present in response');
});
