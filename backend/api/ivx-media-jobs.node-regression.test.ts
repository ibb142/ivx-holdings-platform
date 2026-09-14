import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaJob, __resetMediaJobStoreForTests } from '../services/ivx-media-jobs';

const validInput = {
  mediaCount: 1,
  mediaTypes: { image: 1 },
  prompt: 'Test prompt',
};

const invalidInput = {
  mediaCount: 1,
  mediaTypes: {},
  prompt: 'Test prompt',
};

test('should create a media job with valid input', () => {
  __resetMediaJobStoreForTests();
  const job = createMediaJob(validInput);
  assert.ok(job);
  assert.strictEqual(job.mediaCount, 1);
});

test('should throw error when no media types are specified', () => {
  __resetMediaJobStoreForTests();
  assert.throws(() => createMediaJob(invalidInput), {
    message: 'at least one media type must be specified',
  });
});
