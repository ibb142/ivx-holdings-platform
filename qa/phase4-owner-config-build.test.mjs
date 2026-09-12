import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Resolve the same Expo compiler dependencies used by the application build.
const requireExpo = createRequire(new URL('../expo/package.json', import.meta.url));
const { transformSync } = requireExpo('@babel/core');
const { expoInlineEnvVars } = requireExpo('babel-preset-expo/build/inline-env-vars');
const sourceUrl = new URL('../expo/lib/ivx-supabase-client.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const publicKeys = [
  'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL',
  'EXPO_PUBLIC_IVX_API_BASE_URL',
  'EXPO_PUBLIC_API_BASE_URL',
];
const secretKey = 'SUPABASE_SERVICE_ROLE_KEY';
const secretSentinel = 'phase4-test-server-secret-must-not-be-bundled';

function buildAndAudit(buildEnv = {}) {
  const keys = [...publicKeys, secretKey];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  let compiled;
  try {
    for (const key of publicKeys) {
      if (buildEnv[key] === undefined) delete process.env[key];
      else process.env[key] = buildEnv[key];
    }
    process.env[secretKey] = secretSentinel;
    compiled = transformSync(source, {
      filename: sourceUrl.pathname,
      configFile: false,
      babelrc: false,
      caller: { name: 'metro', isDev: false, platform: 'web' },
      presets: [requireExpo('@babel/preset-typescript')],
      plugins: [expoInlineEnvVars, requireExpo('@babel/plugin-transform-modules-commonjs')],
    }).code;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const imports = {
    '@supabase/supabase-js': {},
    'react-native': { Platform: { OS: 'web' } },
    '@/lib/admin-access-lock': {},
    '@/lib/supabase': {},
    '@/lib/supabase-env': {},
    '@/shared/ivx': { IVX_OWNER_AI_API_PATH: '/api/ivx/owner-ai' },
  };
  const module = { exports: {} };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
    // Published web clients have no server build environment at runtime.
    process: { env: {} },
    __DEV__: false,
    window: { location: { origin: 'https://chat.ivxholding.com' } },
    URL,
    console: { log() {} },
  }, { filename: 'ivx-supabase-client.production.js', timeout: 1000 });
  return { audit: module.exports.getIVXOwnerAIConfigAudit(), compiled };
}

test('production build retains the explicit owner endpoint and its precedence', () => {
  const { audit } = buildAndAudit({
    EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL: ' https://owner.example.test/ ',
    EXPO_PUBLIC_IVX_API_BASE_URL: 'https://project.example.test',
  });
  assert.equal(audit.configuredFrom, 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL');
  assert.equal(audit.activeEndpoint, 'https://owner.example.test/api/ivx/owner-ai');
  assert.equal(audit.routingPolicy, 'production_explicit');
  assert.equal(audit.productionReady, true);
});

test('production build retains the project endpoint when no owner override exists', () => {
  const { audit } = buildAndAudit({ EXPO_PUBLIC_IVX_API_BASE_URL: 'https://project.example.test/' });
  assert.equal(audit.configuredFrom, 'EXPO_PUBLIC_IVX_API_BASE_URL');
  assert.equal(audit.projectApiBaseUrl, 'https://project.example.test');
  assert.equal(audit.activeEndpoint, 'https://project.example.test/api/ivx/owner-ai');
  assert.equal(audit.productionReady, true);
});

test('app-wide API configuration remains diagnostic and does not replace the owner endpoint', () => {
  const { audit } = buildAndAudit({ EXPO_PUBLIC_API_BASE_URL: 'https://app.example.test/' });
  assert.equal(audit.directApiBaseUrl, 'https://app.example.test');
  assert.equal(audit.appApiHealthCheckUrl, 'https://app.example.test/health');
  assert.equal(audit.activeEndpoint, 'https://api.ivxholding.com/api/ivx/owner-ai');
  assert.equal(audit.configuredFrom, null);
  assert.equal(audit.productionReady, false);
});

test('an unconfigured production build does not claim an explicit production pin', () => {
  const { audit } = buildAndAudit();
  assert.equal(audit.activeEndpoint, 'https://api.ivxholding.com/api/ivx/owner-ai');
  assert.equal(audit.explicitProductionPinApplied, false);
  assert.equal(audit.productionReady, false);
});

test('a development host cannot replace the production owner endpoint', () => {
  const { audit } = buildAndAudit({ EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL: 'http://localhost:3000' });
  assert.equal(audit.activeEndpoint, 'https://api.ivxholding.com/api/ivx/owner-ai');
  assert.ok(audit.candidateEndpoints.every((endpoint) => endpoint.startsWith('https://api.ivxholding.com/')));
});

test('production transformation never embeds the server service-role secret', () => {
  const { compiled } = buildAndAudit({ EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL: 'https://owner.example.test' });
  assert.equal(compiled.includes(secretSentinel), false);
});
