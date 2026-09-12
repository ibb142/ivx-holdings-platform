import { expect, test } from 'bun:test';

test('the mounted env-status route verifies once, rejects non-owners and distinguishes an auth outage', async () => {
  // Isolate the full Hono module and its boot hooks from other backend suites.
  const child = Bun.spawn([process.execPath, '-e', `
    import assert from 'node:assert/strict';
    import { spyOn } from 'bun:test';
    setTimeout(() => process.exit(2), 20000).unref();
    process.env.IVX_PROCESS_ROLE = 'api';
    process.env.NODE_ENV = 'test';
    process.env.IVX_OPEN_ACCESS_MODE = 'false';
    process.env.IVX_TEST_MODE = 'false';
    const unexpectedNetwork = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network in owner route fixture'));
    const ownerOnly = await import('./backend/api/owner-only.ts');
    const originalGuard = ownerOnly.assertIVXOwnerOnly;
    let mode = 'owner', calls = 0;
    const unavailable = () => Object.assign(new Error('Owner verification temporarily unavailable'), { name: 'IVXAuthServiceUnavailableError' });
    const guard = spyOn(ownerOnly, 'assertIVXOwnerOnly').mockImplementation(async request => {
      calls++;
      if (mode === 'anonymous' || mode === 'invalid') return originalGuard(request);
      if (mode === 'unavailable' || (mode === 'owner' && calls > 1)) throw unavailable();
      if (mode === 'member') throw new Error('IVX auth guard failed: owner role required.');
      if (mode === 'empty-user') return { userId: '' };
      return { userId: 'fixture-owner', role: 'owner' };
    });
    const { default: app } = await import('./backend/hono.ts');
    for (const [scenario, status] of [['owner', 200], ['anonymous', 401], ['invalid', 403], ['member', 403], ['empty-user', 401], ['unavailable', 503]]) {
      mode = scenario; calls = 0;
      const headers = mode === 'anonymous' ? {} : { Authorization: 'Bearer invalid-fixture-token' };
      const response = await app.request('/api/ivx/verify/env-status', { headers });
      const body = await response.json();
      assert.equal(response.status, status, scenario + ': ' + JSON.stringify(body));
      assert.equal(calls, 1, scenario + ' must perform exactly one owner verification');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (status === 200) {
        assert.equal(body.ok, true);
        assert.equal(body.secretValuesReturned, false);
      } else {
        assert.equal(body.variables, undefined);
        assert.equal(body.summary, undefined);
        assert.equal(body.deployment, undefined);
      }
      if (status === 503) {
        assert.equal(body.code, 'AUTH_SERVICE_UNAVAILABLE');
        assert.equal(body.retryable, true);
        assert.equal(response.headers.get('retry-after'), '5');
      }
    }
    guard.mockRestore(); unexpectedNetwork.mockRestore();
    process.exit(0);
  `], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect({ exitCode, details: exitCode === 0 ? '' : stdout + stderr }).toEqual({ exitCode: 0, details: '' });
}, 30_000);
