import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the actual hook with deterministic React/native/Supabase boundaries.
// The fake SDK retains a subscribed topic until asynchronous removal completes,
// matching the device error: cannot add postgres_changes after subscribe().
function harness() {
  const channels: any[] = [];
  const topics = new Map<string, any>();
  const effects: Array<() => () => void> = [];
  const listeners = new Set<(state: string) => void>();
  const timeouts = new Map<number, () => void>();
  const logs: string[] = [];
  const reads: Array<(value: unknown) => void> = [];
  let timer = 0;
  const invalidations: unknown[] = [];
  const queryClient = { invalidateQueries(input: unknown) { invalidations.push(input); }, refetchQueries() {} };
  const supabase = {
    from: () => ({ select: () => ({ limit: () => new Promise(resolve => reads.push(resolve)) }) }),
    channel(topic: string) {
      if (topics.has(topic)) return topics.get(topic);
      const channel: any = { topic, joined: false, callback: null,
        on(kind: string, _filter: unknown, callback: (payload: unknown) => void) {
          if (kind === 'postgres_changes' && this.joined) throw new Error('cannot add postgres_changes callbacks after subscribe()');
          this.event = callback;
          return this;
        },
        subscribe(callback: (status: string) => void) { this.joined = true; this.callback = callback; return this; },
      };
      channels.push(channel); topics.set(topic, channel); return channel;
    },
    // Deliberately pending: reconnect must not reuse this channel in the meantime.
    removeChannel: () => new Promise(() => {}),
  };
  const deps: Record<string, unknown> = {
    react: { useEffect: (fn: () => () => void) => effects.push(fn), useRef: (current: unknown) => ({ current }),
      useCallback: (fn: unknown) => fn, useState: (value: unknown) => [value, () => {}] },
    'react-native': { Platform: { OS: 'android' }, AppState: { addEventListener: (_: string, fn: (s: string) => void) => {
      listeners.add(fn); return { remove: () => listeners.delete(fn) };
    } } },
    '@tanstack/react-query': { useQueryClient: () => queryClient },
    '@/lib/supabase': { supabase, isSupabaseConfigured: () => true },
    '@/lib/landing-sync': { syncToLandingPage: async () => ({}) },
    '@/lib/jv-storage': { resetSupabaseCheck() {} },
    '@/lib/canonical-deals': { invalidateCanonicalCache() {} },
    '@/lib/jv-persistence': {},
  };
  const source = readFileSync(new URL('../../expo/lib/jv-realtime.ts', import.meta.url), 'utf8')
    .replace(/^import .+;$/gm, '').replace(/^export /gm, '');
  const output = new Bun.Transpiler({ loader: 'ts', target: 'bun' }).transformSync(source);
  const exports: any = {};
  runInNewContext(output + '\nexports.useJVRealtime = useJVRealtime;', {
    ...Object.assign({}, ...Object.values(deps)), exports,
    console: { log: (...args: unknown[]) => logs.push(args.join(' ')) },
  setTimeout: (fn: () => void) => { timeouts.set(++timer, fn); return timer; }, clearTimeout: (id: number) => timeouts.delete(id),
  setInterval: () => ++timer, clearInterval() {} });
  return {
    channels, logs, reads, timeouts, invalidations,
    mount: () => { exports.useJVRealtime('home-jv-deals', false); const setup = effects.pop()!; return { setup, cleanup: setup() }; },
    foreground: () => { for (const fn of listeners) fn('active'); },
    settle: async () => { for (const resolve of reads.splice(0)) resolve({ error: null }); for (let i = 0; i < 5; i++) await Promise.resolve(); },
    primary: () => channels.filter(c => c.topic.startsWith('home-jv-deals')),
  };
}

describe('JV realtime lifecycle after native foreground/deep links', () => {
  test('coalesces overlapping table verification and foreground reconnects', async () => {
    const h = harness(); h.mount(); h.foreground(); h.foreground(); await h.settle();
    expect(h.primary()).toHaveLength(1);
    expect(h.logs.filter(s => s.includes('Setup failed'))).toEqual([]);
  });
  test('does not share subscribed postgres channels between mounted screens', async () => {
    const h = harness(); h.mount(); await h.settle(); h.mount(); await h.settle();
    expect(h.primary()).toHaveLength(2);
    expect(h.logs.filter(s => s.includes('after subscribe'))).toEqual([]);
  });
  test('replaces a failed channel while removal is pending without registering twice', async () => {
    const h = harness(); h.mount(); await h.settle();
    const previous = h.primary()[0]; previous.callback('CHANNEL_ERROR');
    h.foreground(); await h.settle();
    expect(h.primary()).toHaveLength(2);
    expect(h.logs.filter(s => s.includes('after subscribe'))).toEqual([]);
    const before = h.timeouts.size;
    previous.callback('CLOSED');
    expect(h.timeouts.size).toBe(before);
  });
  test('does not create channels after unmount during verification', async () => {
    const h = harness(); const mounted = h.mount(); mounted.cleanup(); await h.settle();
    expect(h.channels).toHaveLength(0);
  });
  test('old effect cannot resume after cleanup followed by React effect replay', async () => {
    const h = harness(); const mounted = h.mount(); mounted.cleanup(); mounted.setup(); await h.settle();
    expect(h.primary()).toHaveLength(1);
    expect(h.logs.filter(s => s.includes('after subscribe'))).toEqual([]);
  });
  test('keeps live change delivery and ignores replaced-channel events', async () => {
    const h = harness(); h.mount(); await h.settle();
    const previous = h.primary()[0];
    previous.event({ eventType: 'UPDATE', new: { id: 'deal-1' }, old: {} });
    expect(h.invalidations.length).toBeGreaterThan(0);
    previous.callback('CHANNEL_ERROR'); h.foreground(); await h.settle();
    const before = h.invalidations.length;
    previous.event({ eventType: 'UPDATE', new: { id: 'stale-deal' }, old: {} });
    expect(h.invalidations.length).toBe(before);
    h.primary()[1].event({ eventType: 'UPDATE', new: { id: 'deal-2' }, old: {} });
    expect(h.invalidations.length).toBeGreaterThan(before);
  });
  test('successful recovery cancels scheduled retries', async () => {
    const h = harness(); h.mount(); await h.settle();
    h.primary()[0].callback('CHANNEL_ERROR'); expect(h.timeouts.size).toBe(1);
    h.primary()[0].callback('SUBSCRIBED'); expect(h.timeouts.size).toBe(0);
  });
  test('cleanup removes pending reconnects and ignores terminal callbacks', async () => {
    const h = harness(); const mounted = h.mount(); await h.settle();
    h.primary()[0].callback('CHANNEL_ERROR'); expect(h.timeouts.size).toBe(1);
    mounted.cleanup(); expect(h.timeouts.size).toBe(0);
    h.primary()[0].callback('CLOSED'); expect(h.timeouts.size).toBe(0);
  });
});
