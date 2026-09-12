import { expect, test } from 'bun:test';

for (const scenario of ['read outage', 'mutation outage', 'missing document']) {
  test(`platform durable authority: ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import assert from 'node:assert/strict';
      import { mock } from 'bun:test';
      const scenario = ${JSON.stringify(scenario)};
      const unavailable = new Error('Supabase schema cache unavailable: HTTP 503');
      let unavailableNow = scenario !== 'missing document';
      const calls = { reads: 0, durableWrites: 0, s3Reads: 0, s3Writes: 0 };
      const fresh = { video: { status: 'draft', is_hidden: true } };
      const stale = { video: { status: 'published', is_hidden: false } };
      process.env.SUPABASE_URL = 'https://localtest.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
      process.env.AWS_ACCESS_KEY_ID = 'test-only-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-only-key';
      mock.module('./backend/services/ivx-durable-store', () => ({
        isDurableStoreConfigured: () => true,
        readDurableJson: async () => {
          calls.reads++;
          if (unavailableNow) throw unavailable;
          return scenario === 'missing document' ? null : structuredClone(fresh);
        },
        writeDurableJson: async () => { calls.durableWrites++; },
      }));
      class GetObjectCommand { constructor(input) { this.input = input; } }
      class PutObjectCommand { constructor(input) { this.input = input; } }
      mock.module('@aws-sdk/client-s3', () => ({
        GetObjectCommand, PutObjectCommand,
        S3Client: class {
          async send(command) {
            if (command instanceof GetObjectCommand) {
              calls.s3Reads++;
              return { Body: { transformToByteArray: async () => Buffer.from(JSON.stringify(stale)) } };
            }
            calls.s3Writes++;
            return {};
          }
        },
      }));
      globalThis.fetch = async () => { throw Error('Unexpected network request'); };
      const store = await import('./backend/services/ivx-video-platform-store');
      if (scenario === 'missing document') {
        assert.deepEqual(await store.getMetaDoc(), stale);
        assert.deepEqual(calls, { reads: 1, durableWrites: 1, s3Reads: 1, s3Writes: 0 });
      } else {
        const operation = scenario === 'read outage'
          ? store.getMetaDoc()
          : store.upsertViewerProfile('viewer-1', { audience: 'buyer' });
        let failure;
        try { await operation; } catch (error) { failure = error; }
        console.log(JSON.stringify({ scenario, beforeAssertions: true, calls, rejected: failure === unavailable }));
        assert.equal(failure, unavailable);
        assert.deepEqual(calls, { reads: 1, durableWrites: 0, s3Reads: 0, s3Writes: 0 });
        unavailableNow = false;
        assert.deepEqual(await store.getMetaDoc(), fresh);
        assert.deepEqual(calls, { reads: 2, durableWrites: 0, s3Reads: 0, s3Writes: 0 });
      }
      console.log(JSON.stringify({ scenario, passed: true, calls }));
    `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
    const [code, out, err] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (out.trim()) console.info(out.trim());
    expect(code, err).toBe(0);
  }, 15000);
}
