import { test, expect } from 'bun:test';
import { diagnosePatchResponse, PATCH_JSON_GUIDANCE } from './ivx-patch-response';

const operation = { path: 'backend/api/deals.ts', kind: 'replace_exact', oldText: 'return row;', newText: 'return normalize(row);' };
const response = (operations: unknown[]) => JSON.stringify({ rootCause: 'missing normalization', technicalPlan: 'normalize existing media', operations });

test('malformed operations never become an empty successful plan or a partial patch', () => {
  for (const bad of [null, { ...operation, kind: 'update' }, { ...operation, newText: null }, { ...operation, oldText: '' }]) {
    expect(diagnosePatchResponse(response([bad])).plan).toBeNull();
    expect(diagnosePatchResponse(response([operation, bad])).plan).toBeNull();
  }
  expect(diagnosePatchResponse(response([])).plan?.operations).toEqual([]);
});

test('JSON strings retain exact source bytes, Unicode, fences and source trailing commas', () => {
  const code = 'const value = { title: "“Casa”", items: [1,], };\nconst example = `\n```json\n{}\n```\n`;';
  const input = response([{ ...operation, newText: code }]);
  expect(diagnosePatchResponse(input).plan?.operations[0]?.newText).toBe(code);
  expect(diagnosePatchResponse('```json\n' + input + '\n```').plan?.operations[0]?.newText).toBe(code);
});

test('broken JSON gets explicit revision guidance without speculative source rewriting', () => {
  for (const bad of ['{"operations":[', response([operation]).replace('normalize', 'normalize\n'), response([operation]).replace(']}', ',]}')]) {
    expect(diagnosePatchResponse(bad).error).toContain('PATCH_JSON_INVALID');
  }
  expect(PATCH_JSON_GUIDANCE).toContain('\\n');
  expect(PATCH_JSON_GUIDANCE).toContain('\\"');
});

test('new regression files require their full content and cannot overwrite an existing file via oldText', () => {
  const create = { path: 'backend/api/deals.node-regression.test.ts', kind: 'create_file', oldText: '', newText: "import { test } from 'node:test';" };
  expect(diagnosePatchResponse(response([operation, create])).plan?.operations).toHaveLength(2);
  expect(diagnosePatchResponse(response([{ ...create, oldText: 'existing' }])).plan).toBeNull();
});
