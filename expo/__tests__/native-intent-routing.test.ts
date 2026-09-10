import { describe, expect, test } from 'bun:test';
import { redirectSystemPath } from '../app/+native-intent';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('every Expo route exposes a runtime default export', () => {
  const root = fileURLToPath(new URL('../app', import.meta.url));
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
  const routes = walk(root).filter(file => /\.tsx?$/.test(file)
    && !/^(_providers|\+native-intent)\./.test(basename(file))
    && !/\+api\.tsx?$/.test(file));
  expect(routes.length).toBeGreaterThan(100);
  const missing = routes.filter(file => {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return !source.statements.some(node =>
      (ts.isExportAssignment(node) && !node.isExportEquals)
      || ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
        && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword))
      || (ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause
        && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.some(element => !element.isTypeOnly && element.name.text === 'default')));
  }).map(file => relative(root, file));
  expect(missing).toEqual([]);
});

describe('native link destinations', () => {
  for (const initial of [true, false]) {
    const mode = initial ? 'cold launch' : 'running app';

    test(`opens the requested Dashboard on ${mode}`, () => {
      expect(redirectSystemPath({ path: 'ivx-app:///admin/dashboard', initial }))
        .toBe('/admin/dashboard');
    });

    test(`preserves Chat and its thread parameters on ${mode}`, () => {
      const path = 'ivx-app:///ivx/chat?threadId=qa-thread#latest';
      expect(redirectSystemPath({ path, initial })).toBe('/ivx/chat?threadId=qa-thread#latest');
    });

    test(`preserves a route already normalized by Expo on ${mode}`, () => {
      expect(redirectSystemPath({ path: '/admin/dashboard', initial }))
        .toBe('/admin/dashboard');
    });

    test(`normalizes root navigation for the tab shell on ${mode}`, () => {
      expect(redirectSystemPath({ path: 'ivx-app:///', initial })).toBe('/');
      expect(redirectSystemPath({ path: '/', initial })).toBe('/');
      expect(redirectSystemPath({ path: '', initial })).toBe('/');
      expect(redirectSystemPath({ path: '  ', initial })).toBe('/');
    });
  }
});
