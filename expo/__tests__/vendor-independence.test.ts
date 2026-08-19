/**
 * IVX vendor independence gate.
 *
 * This is the enforcement point for end-to-end independence from the Rork
 * toolkit. It exists as a TEST, not only as a CI workflow, so that it runs in
 * every existing pipeline and on every local `bun test` — no extra token scope
 * or workflow wiring required.
 *
 * Why a gate is necessary at all:
 *
 *   `expo/metro.config.js` used to be six lines. Line 2 was
 *   `require("@rork-ai/toolkit-sdk/metro")` at module scope and the file
 *   exported `withRorkMetro(config)`. That made the vendor a HARD BUILD
 *   dependency — no APK, AAB or web bundle could be produced on any machine
 *   without that package. That is lock-in at the build layer, not branding.
 *
 * Why it keeps mattering:
 *
 *   The removal was silently reverted TWICE by an external sync writing over
 *   `package.json` and `metro.config.js`. A revert is invisible during normal
 *   development, because the vendor package is not installed here — nothing
 *   breaks locally until a build runs somewhere that does have it. These tests
 *   turn that silent revert into a loud, immediate failure.
 *
 * If one of these fails, independence has regressed. Do not "fix" it by
 * relaxing the assertion.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const EXPO_DIR = join(import.meta.dir, '..');
const VENDOR = 'rork';

function read(relativePath: string): string {
  return readFileSync(join(EXPO_DIR, relativePath), 'utf8');
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const manifest: PackageManifest = JSON.parse(read('package.json')) as PackageManifest;

describe('Gate 1 — the vendor package must not be a dependency', () => {
  const sections: (keyof PackageManifest)[] = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];

  it.each(sections)('%s contains no vendor package', (section) => {
    const names = Object.keys(manifest[section] ?? {});
    expect(names.filter((n) => n.toLowerCase().includes(VENDOR))).toEqual([]);
  });

  it('the vendor package is not installed in node_modules', () => {
    expect(existsSync(join(EXPO_DIR, 'node_modules', '@rork-ai'))).toBe(false);
  });
});

describe('Gate 2 — the build must not require the vendor', () => {
  it('metro.config.js has zero vendor references', () => {
    // Deliberately strict: a mention in a comment is still a mention, and the
    // audit script that ships with this repo treats it as a violation too.
    expect(read('metro.config.js').toLowerCase()).not.toContain(VENDOR);
  });

  it('metro.config.js is a self-contained Expo config', () => {
    const source = read('metro.config.js');
    expect(source).toContain('expo/metro-config');
    expect(source).toContain('module.exports');
    expect(source).not.toContain('withRorkMetro');
  });

  it('metro.config.js loads with the vendor package absent', () => {
    // The real regression test. The old config called
    // require("@rork-ai/toolkit-sdk/metro") at module scope, so this threw.
    const load = (): unknown => require(join(EXPO_DIR, 'metro.config.js')) as unknown;
    expect(load).not.toThrow();
  });

  it('the babel transformer does not delegate to the vendor', () => {
    // A try/catch fallback still puts vendor code on the bundler hot path
    // whenever it happens to be installed, so two machines could bundle the
    // same source differently. Expo's transformer must be the only path.
    expect(read('scripts/ivx-metro-transformer.js')).not.toContain('@rork-ai');
  });
});

describe('Gate 3 — the shipped app must not talk to vendor servers', () => {
  const RUNTIME_DIRS: string[] = ['app', 'components', 'lib', 'hooks', 'constants'];
  const CODE_EXT: string[] = ['.ts', '.tsx', '.js', '.jsx'];

  function walk(dir: string, out: string[] = []): string[] {
    const abs = join(EXPO_DIR, dir);
    if (!existsSync(abs)) return out;
    for (const entry of readdirSync(abs)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const rel = join(dir, entry);
      if (statSync(join(EXPO_DIR, rel)).isDirectory()) walk(rel, out);
      else if (CODE_EXT.some((e) => entry.endsWith(e))) out.push(rel);
    }
    return out;
  }

  const runtimeFiles: string[] = RUNTIME_DIRS.flatMap((d) => walk(d));

  it('finds the runtime source files', () => {
    expect(runtimeFiles.length).toBeGreaterThan(50);
  });

  it('no runtime file contains a vendor server URL', () => {
    const pattern = /https?:\/\/[a-zA-Z0-9.-]*rork/i;
    const offenders = runtimeFiles.filter((f) => pattern.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('no runtime file reads a vendor environment variable', () => {
    const pattern = /EXPO_PUBLIC_RORK[A-Z_]*|RORK_PUBLIC_[A-Z_]*/;
    const offenders = runtimeFiles.filter((f) => pattern.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
