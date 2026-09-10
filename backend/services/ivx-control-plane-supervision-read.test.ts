import { describe, expect, test } from 'bun:test';
import { createSupervisionRead } from './ivx-control-plane-supervision-read';

describe('control plane supervision reads', () => {
  test('returns no certification while repairs are pending and coalesces readers', async () => {
    let calls = 0;
    let finish!: (value: { certified: boolean }) => void;
    const read = createSupervisionRead(() => { calls++; return new Promise<{ certified: boolean }>(resolve => { finish = resolve; }); }, 10);
    expect(await Promise.all([read(), read(), read()])).toEqual([null, null, null]);
    expect(calls).toBe(1);
    finish({ certified: false });
    expect(await read()).toEqual({ certified: false });
    expect(await read()).toEqual({ certified: false });
    expect(calls).toBe(1);
  });
  test('fails closed on provider failure and permits a later retry', async () => {
    let calls = 0;
    const read = createSupervisionRead(async () => { if (++calls === 1) throw new Error('unavailable'); return { certified: false }; }, 20);
    expect(await read()).toBeNull();
    expect(await read()).toEqual({ certified: false });
  });
});
