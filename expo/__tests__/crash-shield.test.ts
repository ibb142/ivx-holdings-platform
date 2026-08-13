// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * IVX Crash Shield regression tests.
 *
 * 1. Undefined-JSX sweep — statically guards the exact "Property 'Mail' doesn't
 *    exist" crash family: an icon/component used in JSX but never imported or
 *    defined resolves to `undefined` at runtime and throws "element type is
 *    invalid". This scan fails the build if any screen reintroduces that class
 *    of bug.
 * 2. Route error-boundary coverage — every route SEGMENT layout must expose a
 *    route-level error boundary so a crash in one screen can never white-screen
 *    the whole app.
 */

const APP_ROOT = join(import.meta.dir, '..');

function collectTsx(rel: string): string[] {
  const root = join(APP_ROOT, rel);
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (p.endsWith('.tsx')) out.push(p);
    }
  };
  walk(root);
  return out;
}

const GLOBAL_JSX = new Set<string>([
  'React', 'Fragment', 'View', 'Text', 'Image', 'ScrollView', 'Pressable',
  'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'FlatList',
  'SectionList', 'TextInput', 'Switch', 'Modal', 'ActivityIndicator', 'SafeAreaView',
  'KeyboardAvoidingView', 'StatusBar', 'RefreshControl', 'ImageBackground', 'Animated',
  'VirtualizedList', 'Button', 'Suspense',
]);

/**
 * Remove comments while preserving strings, newlines, and source offsets.
 *
 * Regex comment stripping is unsafe for TSX because comment-looking text can
 * legally occur inside strings and template literals (`https://...`, `/* ... */`).
 * This tiny lexer blanks only actual comments, leaving executable source intact.
 */
function stripCommentsPreserveLines(src: string): string {
  type State = 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment';
  let state: State = 'code';
  let out = '';

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];

    if (state === 'line-comment') {
      if (ch === '\n') {
        out += '\n';
        state = 'code';
      } else {
        out += ' ';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 1;
        state = 'code';
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      out += ch;
      if (ch === '\\' && next !== undefined) {
        out += next;
        i += 1;
        continue;
      }
      if (
        (state === 'single' && ch === "'") ||
        (state === 'double' && ch === '"') ||
        (state === 'template' && ch === '`')
      ) {
        state = 'code';
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      out += '  ';
      i += 1;
      state = 'line-comment';
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 1;
      state = 'block-comment';
      continue;
    }
    if (ch === "'") state = 'single';
    else if (ch === '"') state = 'double';
    else if (ch === '`') state = 'template';
    out += ch;
  }

  return out;
}

/** Returns JSX element identifiers used in `src` that are neither imported nor defined. */
function findUndefinedJsxIdentifiers(src: string): { name: string; line: number }[] {
  const analyzable = stripCommentsPreserveLines(src);
  const imported = new Set<string>();
  for (const m of analyzable.matchAll(/import\s+([^;]+?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    const def = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (def && !clause.trim().startsWith('{') && !clause.trim().startsWith('*')) imported.add(def[1]);
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) imported.add(ns[1]);
    const named = clause.match(/\{([^}]*)\}/);
    if (named) named[1].split(',').forEach((x) => {
      const n = x.trim().split(/\s+as\s+/).pop()!.trim();
      if (n) imported.add(n);
    });
  }

  const local = new Set<string>();
  // Collect declarations from the raw TypeScript source. Comment sanitization is
  // only needed for JSX-use detection; using sanitized text for declarations can
  // hide real components when a preceding template literal contains code samples.
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  // object/array destructure bindings: const { A } = ...
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    m[1].split(',').forEach((x) => {
      const n = x.trim().split(':').pop()!.trim().split(/\s+as\s+/).pop()!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) local.add(n);
    });
  }
  // rename bindings anywhere: `foo: Name` (e.g. .map(({ icon: Icon }) => ...))
  for (const m of src.matchAll(/[A-Za-z0-9_$]+\s*:\s*([A-Z][A-Za-z0-9_]*)/g)) local.add(m[1]);
  // shorthand bindings inside any destructure block { ... Name ... }
  for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
    m[1].split(',').forEach((x) => {
      const n = x.trim();
      if (/^[A-Z][A-Za-z0-9_]*$/.test(n)) local.add(n);
    });
  }

  const offenders: { name: string; line: number }[] = [];
  // Real JSX only: '<' not preceded by a word char, '<' or '.' (excludes generics like useState<X>)
  for (const m of analyzable.matchAll(/(^|[^A-Za-z0-9_<.])<([A-Z][A-Za-z0-9_]*)(?=[\s/>])/g)) {
    const name = m[2];
    if (name.length === 1) continue; // single-letter generic type params (T, K, V, S, P)
    if (GLOBAL_JSX.has(name) || imported.has(name) || local.has(name)) continue;
    const line = analyzable.slice(0, m.index).split('\n').length;
    offenders.push({ name, line });
  }
  return offenders;
}

describe('IVX Crash Shield — undefined JSX sweep (Mail-class bug guard)', () => {
  test('no screen uses a JSX icon/component that is not imported or defined', () => {
    const files = [
      ...collectTsx('app'),
      ...collectTsx('components'),
      ...collectTsx('src'),
    ];
    expect(files.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const f of files) {
      const offenders = findUndefinedJsxIdentifiers(readFileSync(f, 'utf8'));
      for (const o of offenders) {
        failures.push(`${f.replace(APP_ROOT + '/', '')}:${o.line} <${o.name}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('the analyzer catches a missing import (self-check)', () => {
    const bad = `import { View } from 'react-native';\nexport default () => <View><Mail /></View>;`;
    const offenders = findUndefinedJsxIdentifiers(bad);
    expect(offenders.some((o) => o.name === 'Mail')).toBe(true);
  });

  test('the analyzer ignores JSX examples inside block comments', () => {
    const documented = `import { View } from 'react-native';\n/** Example: <MissingDocOnly /> */\nexport default () => <View />;`;
    expect(findUndefinedJsxIdentifiers(documented)).toEqual([]);
  });

  test('the analyzer ignores JSX examples inside line comments', () => {
    const documented = `import { View } from 'react-native';\n// Example: <MissingDocOnly />\nexport default () => <View />;`;
    expect(findUndefinedJsxIdentifiers(documented)).toEqual([]);
  });

  test('the analyzer preserves declarations after URL strings', () => {
    const withUrl = `import { View } from 'react-native';\nconst docs = 'https://ivxholding.com';\nfunction LocalCard() { return <View />; }\nexport default () => <LocalCard />;`;
    expect(findUndefinedJsxIdentifiers(withUrl)).toEqual([]);
  });

  test('comment markers inside strings do not erase following declarations', () => {
    const withMarkers = `import { View } from 'react-native';\nconst docs = 'literal /* not a comment */';\nfunction LocalCard() { return <View />; }\nexport default () => <LocalCard />;`;
    expect(findUndefinedJsxIdentifiers(withMarkers)).toEqual([]);
  });

  test('raw declaration discovery survives template-literal code examples', () => {
    const withTemplate = "import { View } from 'react-native';\nconst sample = `const fake = '<DocOnly />'`;\nfunction LocalCard() { return <View />; }\nexport default () => <LocalCard />;";
    expect(findUndefinedJsxIdentifiers(withTemplate)).toEqual([]);
  });

  test('the analyzer does not flag an imported icon (self-check)', () => {
    const good = `import { View } from 'react-native';\nimport { Mail } from 'lucide-react-native';\nexport default () => <View><Mail /></View>;`;
    expect(findUndefinedJsxIdentifiers(good)).toEqual([]);
  });
});

describe('IVX Crash Shield — route error-boundary coverage', () => {
  const SEGMENT_LAYOUTS = [
    'app/_layout.tsx',
    'app/(tabs)/_layout.tsx',
    'app/(tabs)/(home)/_layout.tsx',
    'app/(tabs)/invest/_layout.tsx',
    'app/admin/_layout.tsx',
    'app/ivx/_layout.tsx',
  ];

  for (const rel of SEGMENT_LAYOUTS) {
    test(`${rel} exposes a route-level ErrorBoundary`, () => {
      const p = join(APP_ROOT, rel);
      expect(existsSync(p)).toBe(true);
      const src = readFileSync(p, 'utf8');
      // expo-router treats an exported `ErrorBoundary` as the segment's route boundary.
      const hasBoundary =
        /export\s*\{\s*ErrorBoundary\s*\}\s*from\s*['"]expo-router['"]/.test(src) ||
        /export\s+(?:const|function|class)\s+ErrorBoundary\b/.test(src) ||
        /<(?:AppErrorBoundary|ErrorBoundary)\b/.test(src);
      expect(hasBoundary).toBe(true);
    });
  }
});
