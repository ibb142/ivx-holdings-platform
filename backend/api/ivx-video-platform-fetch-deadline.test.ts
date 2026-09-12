import { expect, test } from 'bun:test';

for (const scenario of ['body deadline', 'init cancellation', 'request cancellation']) {
  test(`video platform Supabase transport: ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import assert from 'node:assert/strict';
      import http from 'node:http';
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
      // A real socket sends successful headers and a partial JSON body. The
      // deadline must still cancel the body, and the next read must recover.
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url === '/healthy') res.end('[{"id":"recovered"}]');
        else { res.flushHeaders(); res.write('['); }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = 'http://127.0.0.1:' + server.address().port;
      const controller = new AbortController();
      let watchdog;
      try {
        const input = scenario === 'request cancellation'
          ? new Request(url + '/stalled', { signal: controller.signal })
          : url + '/stalled';
        const init = scenario === 'init cancellation' ? { signal: controller.signal } : undefined;
        const response = await transport(input, init);
        assert.equal(response.status, 200, 'The server sent successful headers');
        const body = response.json();
        if (scenario !== 'body deadline') controller.abort();
        let failure;
        try {
          await Promise.race([body, new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(new Error('Body remained pending after its cancellation deadline')),
              scenario === 'body deadline' ? 6000 : 750);
          })]);
        } catch (error) { failure = error; }
        finally { clearTimeout(watchdog); }
        assert.ok(failure, 'An incomplete response must not be accepted');
        assert.ok(['AbortError', 'TimeoutError'].includes(failure.name), failure.message);
        const recovered = await transport(url + '/healthy');
        assert.deepEqual(await recovered.json(), [{ id: 'recovered' }]);
        console.log(JSON.stringify({ scenario, passed: true, realHttpBody: true, recovered: true }));
      } finally {
        controller.abort();
        clearTimeout(watchdog);
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
    const [code, out, err] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (out.trim()) console.info(out.trim());
    expect(code, err).toBe(0);
  }, 12000);
}
