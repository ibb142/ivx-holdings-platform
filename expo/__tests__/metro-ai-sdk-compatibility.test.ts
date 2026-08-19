import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const projectRoot = join(import.meta.dir, '..');

type MetroConfig = {
  transformer?: {
    babelTransformerPath?: string;
  };
};

type IVXMetroTransformer = {
  patchMetroUnsafeImports: (filename: string, source: string) => string;
};

describe('AI SDK Metro compatibility', () => {
  test('keeps the root layout outside the managed provider-injection signature', () => {
    const rootLayout = readFileSync(join(projectRoot, 'app/_layout.tsx'), 'utf8');

    expect(rootLayout).not.toMatch(/export\s+default\s+function\s+\w+/);
    expect(rootLayout).toContain('export default RootLayout;');
  });

  test('uses the IVX transformer after applying the Rork Metro wrapper', () => {
    const config = require(join(projectRoot, 'metro.config.js')) as MetroConfig;

    expect(config.transformer?.babelTransformerPath).toBe(
      require.resolve('../scripts/ivx-metro-transformer'),
    );
  });

  test('removes non-static AI SDK imports before Metro parses them', () => {
    const transformer = require('../scripts/ivx-metro-transformer') as IVXMetroTransformer;
    const source = [
      'function importNodeModule ( id ) {',
      '  return import( id )',
      '}',
    ].join('\n');

    const transformed = transformer.patchMetroUnsafeImports(
      '/app/node_modules/@ai-sdk/provider-utils/dist/index.mjs',
      source,
    );

    expect(transformed).not.toContain('import( id )');
    expect(transformed).toContain('loading is not supported in this build');
  });

  test('leaves unrelated application source unchanged', () => {
    const transformer = require('../scripts/ivx-metro-transformer') as IVXMetroTransformer;
    const source = 'const loadScreen = () => import("./Screen");';

    expect(transformer.patchMetroUnsafeImports('/app/src/router.ts', source)).toBe(source);
  });
});
