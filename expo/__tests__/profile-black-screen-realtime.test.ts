import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPO_ROOT = join(import.meta.dir, '..');

function read(relativePath: string): string {
  return readFileSync(join(EXPO_ROOT, relativePath), 'utf8');
}

describe('Profile black-screen regression — route must always resolve to a real screen', () => {
  const profile = read('app/(tabs)/profile.tsx');

  it('Profile is a real leaf tab screen and the tabs layout registers it directly', () => {
    expect(existsSync(join(EXPO_ROOT, 'app', '(tabs)', 'profile.tsx'))).toBe(true);
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain('name="profile"');
    expect(layout).not.toContain('name="(profile)"');
  });

  it('Profile paints a synchronous fail-safe root and title', () => {
    expect(profile).toContain('testID="profile-screen-root"');
    expect(profile).toContain('testID="profile-title"');
    expect(profile).toContain('>Profile</Text>');
  });

  it('Profile initial paint does not depend on realtime, remote query or optional image renderers', () => {
    expect(profile).not.toContain('useRealtimeTable');
    expect(profile).not.toContain('useQuery(');
    expect(profile).not.toContain('supabase.');
    expect(profile).not.toContain('<IVXImage');
  });

  it('keeps essential authenticated profile navigation available', () => {
    expect(profile).toContain("'/personal-info'");
    expect(profile).toContain("'/wallet'");
    expect(profile).toContain("'/security-settings'");
    expect(profile).toContain("'/(tabs)/chat'");
    expect(profile).toContain('profile-sign-out');
  });
});

describe('Profile black-screen regression — shared realtime hook remains render-stable', () => {
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

  it('setupChannels reads current configs from a ref and depends only on stable inputs', () => {
    const setupStart = hook.indexOf('const setupChannels = useCallback');
    expect(setupStart).toBeGreaterThan(-1);
    const setupEnd = hook.indexOf('\n\n  useEffect(() => {', setupStart);
    expect(setupEnd).toBeGreaterThan(setupStart);
    const setupBlock = hook.slice(setupStart, setupEnd);
    // Subscription topology is keyed by configSignature in the effect below.
    // The callback itself reads configsRef, so it must not acquire a dependency
    // on the caller's freshly allocated configs array (which caused the loop).
    expect(setupBlock).toContain('const activeConfigs = configsRef.current;');
    const dependencyList = setupBlock.match(/\},\s*\[([^\]]*)\]\);\s*$/)?.[1];
    expect(dependencyList).toBeDefined();
    const dependencies = dependencyList!.split(',').map((item) => item.trim()).sort();
    expect(dependencies).toEqual(['applyDeltas', 'autoReconnect', 'cleanupChannels', 'queryClient']);
  });

  it('subscription effect is also keyed by semantic signature', () => {
    expect(hook).toContain('[configSignature, setupChannels, cleanupChannels, pauseOnBackground]');
  });
});
