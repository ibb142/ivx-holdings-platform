import { describe, expect, it } from 'bun:test';
import { createBoundedSharedRead } from '../lib/bounded-shared-read';

describe('bounded shared remote discovery', () => {
  it('shares one request across concurrent chat callers and caches the result', async () => {
    let calls = 0;
    let finish!: (value: string) => void;
    const read = createBoundedSharedRead(() => {
      calls += 1;
      return new Promise<string>(resolve => { finish = resolve; });
    }, 'unavailable');
    const first = read.get();
    const second = read.get();
    await Promise.resolve();
    expect(calls).toBe(1);
    finish('shared-tables');
    expect(await first).toBe('shared-tables');
    expect(await second).toBe('shared-tables');
    expect(await read.get()).toBe('shared-tables');
    expect(calls).toBe(1);
  });

  it('releases chat even when a network adapter never settles after abort', async () => {
    let signal!: AbortSignal;
    const read = createBoundedSharedRead<string>(input => {
      signal = input;
      return new Promise(() => {});
    }, 'unavailable', 20);
    expect(await read.get()).toBe('unavailable');
    expect(signal.aborted).toBe(true);
  });

  it('does not let a late result overwrite discovery after reconnect', async () => {
    let finishOld!: (value: string) => void;
    let calls = 0;
    const read = createBoundedSharedRead(() => ++calls === 1
      ? new Promise<string>(resolve => { finishOld = resolve; })
      : Promise.resolve('reconnected'), 'unavailable');
    const old = read.get();
    await Promise.resolve();
    read.invalidate();
    expect(await read.get()).toBe('reconnected');
    finishOld('stale');
    await old;
    expect(read.peek()).toBe('reconnected');
  });

  it('keeps failed discovery unavailable and recovers after invalidation', async () => {
    let fail = true;
    const read = createBoundedSharedRead(async () => {
      if (fail) throw new Error('Network unavailable');
      return 'shared-tables';
    }, 'unavailable');
    expect(await read.get()).toBe('unavailable');
    fail = false;
    read.invalidate();
    expect(await read.get()).toBe('shared-tables');
  });
});
