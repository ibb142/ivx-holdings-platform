import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Exercise the installed Expo router after the real Metro/Babel transform.
// A source-only route assertion missed the production /app-guide -> -guide
// failure because Expo strips EXPO_BASE_URL only outside development mode.
const probe = String.raw`
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const generate = require('@babel/generator').default;
  const { transform } = require('./scripts/ivx-metro-transformer');
  const filename = require.resolve('expo-router/build/fork/getStateFromPath-forks');
  const src = fs.readFileSync(filename, 'utf8');
  const results = [];
  for (const [platform, baseUrl] of [['android', '/app'], ['ios', '/app'], ['web', '/app'], ['web', '']]) {
    const options = {
      dev: false, platform, projectRoot: process.cwd(),
      enableBabelRCLookup: true, experimentalImportSupport: false,
      customTransformOptions: { baseUrl, engine: platform === 'web' ? undefined : 'hermes' },
    };
    const before = JSON.stringify(options);
    const { ast } = transform({ filename, src, options });
    const exports = {};
    vm.runInNewContext(generate(ast).code, {
      exports, require: createRequire(filename), process: { env: { NODE_ENV: 'production' } }, URL,
    });
    results.push({
      platform, baseUrl, inputPreserved: JSON.stringify(options) === before,
      guide: exports.stripBaseUrl('/app-guide'),
      application: exports.stripBaseUrl('/application'),
      admin: exports.stripBaseUrl('/admin/waitlist-admin'),
      hostedGuide: exports.stripBaseUrl('/app/app-guide'),
    });
  }
  console.log(JSON.stringify(results));
`;

const result = spawnSync('node', ['-e', probe], {
  cwd: resolve(import.meta.dir, '..'),
  env: { ...process.env, NODE_ENV: 'production', BABEL_ENV: 'production' },
  encoding: 'utf8', timeout: 30_000,
});
if (result.status !== 0) throw new Error(`Production route probe failed: ${result.stderr || result.error}`);
const observations = JSON.parse(result.stdout.trim()) as Array<{
  platform: string; baseUrl: string; inputPreserved: boolean;
  guide: string; application: string; admin: string; hostedGuide: string;
}>;

describe('Production native routes and web hosting prefixes', () => {
  for (const platform of ['android', 'ios']) {
    test(`${platform} preserves app-prefixed destinations when the web config uses /app`, () => {
      const row = observations.find(value => value.platform === platform)!;
      expect(row.guide).toBe('/app-guide');
      expect(row.application).toBe('/application');
      expect(row.admin).toBe('/admin/waitlist-admin');
      expect(row.inputPreserved).toBe(true);
    });
  }

  test('AWS web retains its /app mount and Render web retains root routes', () => {
    const aws = observations.find(value => value.platform === 'web' && value.baseUrl === '/app')!;
    const render = observations.find(value => value.platform === 'web' && value.baseUrl === '')!;
    expect(aws.hostedGuide).toBe('/app-guide');
    expect(render.guide).toBe('/app-guide');
    expect(aws.inputPreserved && render.inputPreserved).toBe(true);
  });
});
