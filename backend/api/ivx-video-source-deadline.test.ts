import { expect, test } from 'bun:test';

const scenarios = [
  'stalled body after successful headers',
  'source never sends headers',
  'caller cancellation during source reads',
  'completed JSON and HTTP failure remain unchanged',
  'bodyless response remains empty',
  'next read recovers after a stalled body',
  'pre-cancelled caller cannot issue a request',
];

for (const scenario of scenarios) {
  test(`source deadline: ${scenario}`, async () => {
    // Capture the actual imported transport, including its imported helpers.
    // Isolate the Supabase capture from other suites and use real HTTP sockets:
    // native fetch resolves at headers but its signal also governs the body.
    const child = Bun.spawn([process.execPath, '-e', `
      import assert from 'node:assert/strict';
      import { createServer } from 'node:http';
      import { mock } from 'bun:test';
      const scenario = ${JSON.stringify(scenario)};
      let transport;
      mock.module('@supabase/supabase-js', () => ({
        createClient: (_url, _key, options) => {
          transport = options.global.fetch;
          throw new Error('Fixture captured the shipped Supabase transport');
        },
      }));
      const { handlePlatformHomeFeed } = await import('./backend/api/ivx-video-platform.ts');
      await handlePlatformHomeFeed(new Request('https://fixture.invalid/home-feed'));
      assert.equal(typeof transport, 'function');
      let requests = 0, notifyRequest;
      const requested = new Promise(resolve => { notifyRequest = resolve; });
      const server = createServer((req, res) => {
        requests++;
        notifyRequest();
        if (req.url === '/stalled-headers') return;
        if (req.url === '/empty') { res.writeHead(204); res.end(); return; }
        const status = req.url === '/unavailable' ? 503 : 200;
        res.writeHead(status, { 'content-type': 'application/json', 'content-range': '0-0/1' });
        if (req.url === '/stalled-body') { res.flushHeaders(); res.write('['); return; }
        res.end(JSON.stringify(status === 200 ? [{ id: 'published-video' }] : { code: 'SOURCE_UNAVAILABLE' }));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = 'http://127.0.0.1:' + server.address().port;
      const run = (path, init) => transport(base + path, init);
      const caller = new AbortController();
      // The SDK boundary may normalize TimeoutError to AbortError to suppress
      // automatic retries. Both must reject the real outstanding HTTP read.
      const cancelled = error => ['AbortError', 'TimeoutError'].includes(error?.name);
      const started = Date.now();
      try {
        if (scenario === 'stalled body after successful headers') {
          const response = await run('/stalled-body');
          assert.equal(response.status, 200);
          await assert.rejects(response.json(), cancelled);
          assert.equal(requests, 1);
        } else if (scenario === 'source never sends headers') {
          await assert.rejects(run('/stalled-headers'), cancelled);
          assert.equal(requests, 1);
        } else if (scenario === 'caller cancellation during source reads') {
          const work = run('/stalled-headers', { signal: caller.signal })
            .then(() => ({ name: 'UnexpectedSuccess' }), error => error);
          await requested;
          caller.abort();
          assert.equal((await work).name, 'AbortError');
          assert.equal(requests, 1);
        } else if (scenario === 'completed JSON and HTTP failure remain unchanged') {
          for (const [path, status] of [['/healthy', 200], ['/unavailable', 503]]) {
            const body = JSON.stringify(status === 200 ? [{ id: 'published-video' }] : { code: 'SOURCE_UNAVAILABLE' });
            const response = await run(path);
            assert.equal(response.status, status);
            assert.equal(response.headers.get('content-range'), '0-0/1');
            assert.equal(await response.text(), body);
          }
        } else if (scenario === 'bodyless response remains empty') {
          const response = await run('/empty');
          assert.equal(response.status, 204);
          assert.equal(await response.text(), '');
        } else if (scenario === 'next read recovers after a stalled body') {
          const response = await run('/stalled-body');
          await assert.rejects(response.json(), cancelled);
          assert.deepEqual(await (await run('/healthy')).json(), [{ id: 'published-video' }]);
          assert.equal(requests, 2);
        } else if (scenario === 'pre-cancelled caller cannot issue a request') {
          caller.abort();
          await assert.rejects(run('/healthy', { signal: caller.signal }), { name: 'AbortError' });
          assert.equal(requests, 0);
          assert.deepEqual(await (await run('/healthy')).json(), [{ id: 'published-video' }]);
          assert.equal(requests, 1);
        } else { throw new Error('Unknown transport scenario'); }
        if (scenario.includes('stalled body') || scenario === 'source never sends headers') {
          const elapsed = Date.now() - started;
          assert.ok(elapsed >= 4500 && elapsed < 8000, 'Shipped five-second deadline was not respected: ' + elapsed);
        }
        console.log(JSON.stringify({ scenario, passed: true, realHttp: true, importedTransport: true }));
      } finally {
        caller.abort();
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        }));
      }
    `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 12000 });
    const [code, out, err] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (out.trim()) console.info(out.trim());
    expect(code, err).toBe(0);
  }, 15000);
}
