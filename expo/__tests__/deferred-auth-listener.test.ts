import { describe, expect, it } from 'bun:test';
import { createDeferredAuthListener } from '../lib/deferred-auth-listener';

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 10));

describe('Supabase auth event lock boundary', () => {
  it('releases the SDK notification before session-dependent work starts', async () => {
    let locked = true;
    let release!: () => void;
    const sessionLock = new Promise<void>(resolve => { release = resolve; });
    let observed = false;
    const deferred = createDeferredAuthListener(async () => {
      // Authenticated API requests need the same lock held by the notifier.
      expect(locked).toBe(false);
      await sessionLock;
      observed = true;
    }, error => { throw error; });
    const callbackResult = deferred.listener('SIGNED_IN', null);
    expect(callbackResult).toBeUndefined();
    expect(observed).toBe(false);
    locked = false;
    release();
    await nextTurn();
    expect(observed).toBe(true);
    deferred.dispose();
  });

  it('does not restore a queued sign-in after a newer sign-out', async () => {
    const events: string[] = [];
    const deferred = createDeferredAuthListener(event => { events.push(event); }, error => { throw error; });
    deferred.listener('SIGNED_IN', null);
    deferred.listener('SIGNED_OUT', null);
    await nextTurn();
    expect(events).toEqual(['SIGNED_OUT']);
    deferred.dispose();
  });

  it('invalidates work already awaiting a dependency when the session changes', async () => {
    let release!: () => void;
    const dependency = new Promise<void>(resolve => { release = resolve; });
    const accepted: string[] = [];
    const deferred = createDeferredAuthListener(async (event, _session, isCurrent) => {
      await dependency;
      if (isCurrent()) accepted.push(event);
    }, error => { throw error; });
    deferred.listener('SIGNED_IN', null);
    await nextTurn();
    deferred.listener('SIGNED_OUT', null);
    release();
    await nextTurn();
    expect(accepted).toEqual(['SIGNED_OUT']);
    deferred.dispose();
  });

  it('cancels pending work on unmount and handles async errors without locking later events', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const deferred = createDeferredAuthListener(async () => {
      calls += 1;
      if (calls === 1) throw new Error('dependency unavailable');
    }, error => { errors.push(error); });
    deferred.listener('SIGNED_IN', null);
    await nextTurn();
    deferred.listener('TOKEN_REFRESHED', null);
    await nextTurn();
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    deferred.listener('SIGNED_OUT', null);
    deferred.dispose();
    deferred.listener('SIGNED_IN', null);
    await nextTurn();
    expect(calls).toBe(2);
  });
});
