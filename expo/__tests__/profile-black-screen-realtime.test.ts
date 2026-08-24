import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPO_ROOT = join(import.meta.dir, '..');

function read(relativePath: string): string {
  return readFileSync(join(EXPO_ROOT, relativePath), 'utf8');
}

describe('Profile black-screen regression — route must always resolve to a real screen', () => {
  it('Profile is a real leaf tab screen and the tabs layout registers it directly', () => {
    expect(existsSync(join(EXPO_ROOT, 'app', '(tabs)', 'profile.tsx'))).toBe(true);
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain('name="profile"');
    expect(layout).not.toContain('name="(profile)"');
  });

  it('Profile realtime subscriptions remain explicit and auditable', () => {
    const profile = read('app/(tabs)/profile.tsx');
    expect(profile).toContain("useRealtimeTable('wallets'");
    expect(profile).toContain("useRealtimeTable('profiles'");
  });
});

describe('Profile black-screen regression — realtime must not resubscribe on render identity', () => {
  const hook = read('hooks/useRealtimeChannel.ts');

  it('derives a primitive semantic signature for subscription topology', () => {
    expect(hook).toContain('export function buildRealtimeConfigSignature');
    expect(hook).toContain('const configSignature = buildRealtimeConfigSignature(configs);');
  });

  it('keeps the latest caller config in a ref instead of making object identity an effect trigger', () => {
    expect(hook).toContain('const configsRef = useRef(configs);');
    expect(hook).toContain('configsRef.current = configs;');
    expect(hook).toContain('const activeConfigs = configsRef.current;');
  });

  it('setupChannels is keyed by semantic signature, never raw configs identity', () => {
    const setupStart = hook.indexOf('const setupChannels = useCallback');
    expect(setupStart).toBeGreaterThan(-1);
    const setupEnd = hook.indexOf('\n\n  useEffect(() => {', setupStart);
    expect(setupEnd).toBeGreaterThan(setupStart);
    const setupBlock = hook.slice(setupStart, setupEnd);
    expect(setupBlock).toContain('[configSignature, queryClient, cleanupChannels, autoReconnect, applyDeltas]');
    expect(setupBlock).not.toMatch(/\[configs[,\]]/);
  });

  it('subscription effect is also keyed by semantic signature', () => {
    expect(hook).toContain('[configSignature, setupChannels, cleanupChannels, pauseOnBackground]');
  });

  it('single-table helper does not recreate a useMemo dependency trap around queryKeys', () => {
    const helperStart = hook.indexOf('export function useRealtimeTable');
    expect(helperStart).toBeGreaterThan(-1);
    const helperBlock = hook.slice(helperStart);
    expect(helperBlock).toContain('return useRealtimeChannel([');
    expect(helperBlock).not.toContain('useMemo<RealtimeChannelConfig[]>');
  });

  it('idempotent status writes cannot self-trigger renders when status is unchanged', () => {
    expect(hook).toContain("prev.status === 'not_configured'");
    expect(hook).toContain('prev.status === nextStatus ? prev');
    expect(hook).toContain("prev.status === 'disconnected'");
  });
});
