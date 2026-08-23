import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('Android auth-route black-screen regression', () => {
  it('never mounts Tabs while signed out', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain('if (!openAccessMode && !isAuthenticated)');
    expect(layout).toContain('testID="tabs-auth-gate"');
    expect(layout).toContain('<Redirect href="/login" />');
  });

  it('does not use an asynchronous signed-out router.replace race', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    const signedOutGate = layout.slice(layout.indexOf('if (!openAccessMode && !isAuthenticated)'));
    expect(signedOutGate).not.toContain("router.replace('/login')");
  });

  it('renders visible pixels while the auth redirect commits', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain('Opening secure sign in…');
    expect(layout).toContain("backgroundColor: '#0B1220'");
  });

  it('registers the actual dynamic property leaf route', () => {
    const providers = read('app/_providers.tsx');
    expect(providers).toContain('name="property/[id]"');
    expect(providers).not.toContain('name="property"');
  });

  it('production certification requires visible UI at multiple checkpoints', () => {
    const script = read('scripts/certify-android-launch.sh');
    const workflow = read('../.github/workflows/android-v11030-delivery.yml');
    expect(script).toContain('assert_visible_text "$EXPECTED_TEXT" "t6"');
    expect(script).toContain('assert_visible_text "$EXPECTED_TEXT" "t16"');
    expect(script).toContain('assert_visible_text "$EXPECTED_TEXT" "restart8"');
    expect(workflow).toContain('"Sign In"');
  });

  it('ships a new Android binary identity', () => {
    const config = read('app.config.ts');
    expect(config).toContain('version: "1.10.30"');
    expect(config).toContain('versionCode: 128');
  });
});
