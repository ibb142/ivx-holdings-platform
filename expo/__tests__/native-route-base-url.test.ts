import { expect, test } from 'bun:test';
import { join } from 'node:path';

const projectRoot = join(import.meta.dir, '..');

// Run Babel and the installed Expo parser in a fresh production process:
// NODE_ENV=test deliberately disables EXPO_BASE_URL inlining in Expo's preset.
// URL normalization alone missed the later prefix stripping in the APK.
function compiledPaths(platform: 'android' | 'ios' | 'web', baseUrl: string, paths: string[]): string[] {
  const child = Bun.spawnSync([process.execPath, '-e', `
    const { readFileSync } = require('node:fs');
    const { createRequire } = require('node:module');
    const { runInNewContext } = require('node:vm');
    const r = createRequire(${JSON.stringify(join(projectRoot, 'package.json'))});
    const filename = r.resolve('expo-router/build/fork/getStateFromPath-forks');
    const options = { platform: ${JSON.stringify(platform)}, dev: false,
      projectRoot: ${JSON.stringify(projectRoot)}, enableBabelRCLookup: true,
      experimentalImportSupport: false, type: 'module',
      customTransformOptions: { baseUrl: ${JSON.stringify(baseUrl)}, routerRoot: 'app' } };
    const before = JSON.stringify(options);
    const result = r('./scripts/ivx-metro-transformer').transform({
      filename, src: readFileSync(filename, 'utf8'), options, plugins: [] });
    if (JSON.stringify(options) !== before) throw new Error('mutated Metro caller options');
    const mod = { exports: {} };
    runInNewContext(r('@babel/generator').default(result.ast).code,
      { module: mod, exports: mod.exports, require: createRequire(filename), URL, process: { env: {} } });
    console.log(JSON.stringify(${JSON.stringify(paths)}.map(path =>
      mod.exports.getUrlWithReactNavigationConcessions(path).nonstandardPathname)));
  `], { cwd: projectRoot, env: { ...process.env, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' });
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  return JSON.parse(child.stdout.toString().trim());
}

for (const platform of ['android', 'ios'] as const) {
  test(`${platform} keeps App Guide when the web export is mounted at /app`, () => {
    expect(compiledPaths(platform, '/app', [
      '/admin/waitlist-admin', '/chat-hub', '/app-guide', '/app-guide?section=chat', '/application',
    ])).toEqual(['admin/waitlist-admin/', 'chat-hub/', 'app-guide/', 'app-guide/', 'application/']);
  }, 15_000);
}

test('AWS web export retains its /app mount', () => {
  expect(compiledPaths('web', '/app', ['/app/chat-hub', '/app/app-guide'])).toEqual(['chat-hub/', 'app-guide/']);
}, 15_000);

test('Render web export keeps root paths without a mount prefix', () => {
  expect(compiledPaths('web', '', ['/chat-hub', '/app-guide'])).toEqual(['chat-hub/', 'app-guide/']);
}, 15_000);

