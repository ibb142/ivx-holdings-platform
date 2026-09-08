import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as secrets from '../services/ivx-system-secret';
import { checkIVXAISystemKey } from '../api/owner-only';

const resolver = spyOn(secrets, 'resolveActiveIVXSystemSecret');
afterEach(() => resolver.mockReset());
afterAll(() => resolver.mockRestore());

describe('machine key authentication', () => {
  test('a bearer request never reads the machine secret store', async () => {
    resolver.mockImplementation(() => new Promise<string>(() => {}));
    const request = new Request('https://api.ivxholding.com/api/ivx/live-work/agents', {
      headers: { Authorization: 'Bearer owner-session-for-test' },
    });
    expect(await checkIVXAISystemKey(request)).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });

  test('an empty machine key cannot authenticate or trigger storage reads', async () => {
    resolver.mockImplementation(() => new Promise<string>(() => {}));
    expect(await checkIVXAISystemKey(new Request('https://api.ivxholding.com', {
      headers: { 'X-IVX-System-Key': '   ' },
    }))).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });

  test('a supplied machine key still requires an exact secret match', async () => {
    resolver.mockResolvedValue('test-machine-secret');
    for (const key of ['test-machine-secret', 'wrong-machine-secret']) {
      expect(await checkIVXAISystemKey(new Request('https://api.ivxholding.com', {
        headers: { 'X-IVX-System-Key': key },
      }))).toBe(key === 'test-machine-secret');
    }
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
