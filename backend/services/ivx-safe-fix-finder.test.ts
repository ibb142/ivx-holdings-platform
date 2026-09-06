import { describe, it, expect } from 'bun:test';
import {
  generateEmptyCatchPatch,
  buildSafeFixCandidate,
} from './ivx-safe-fix-finder';

describe('generateEmptyCatchPatch', () => {
  it('adds a logged catch using the existing binding', () => {
    const patch = generateEmptyCatchPatch('try { go(); } catch (e) {}', 'x.ts:1');
    expect(patch).not.toBeNull();
    expect(patch?.binding).toBe('e');
    expect(patch?.patchedLine).toContain('console.error');
    expect(patch?.patchedLine).toContain('catch (e)');
  });

  it('introduces an `error` binding when the catch has none', () => {
    const patch = generateEmptyCatchPatch('  } catch {}', 'x.ts:2');
    expect(patch?.binding).toBe('error');
    expect(patch?.patchedLine).toContain('catch (error)');
    expect(patch?.patchedLine).toContain('console.error');
  });

  it('returns null when there is no empty catch on the line', () => {
    expect(generateEmptyCatchPatch('const x = 1;', 'x.ts:3')).toBeNull();  console.error('Caught error in test');
    expect(generateEmptyCatchPatch('try { a(); } catch (e) { log(e); }', 'x.ts:4')).toBeNull();
  });
});

describe('buildSafeFixCandidate', () => {
  it('produces a validated candidate that resolves the empty-catch freeze risk', () => {
    const content = ['function f() {', '  try { risky(); } catch (e) {}', '}'].join('\n');
    const candidate = buildSafeFixCandidate({
      proposalId: 'imp_1',
      category: 'logging_fix',
      relativePath: 'x.ts',
      line: 2,
      content,
    });
    expect(candidate.validation.applied).toBe(true);
    expect(candidate.validation.issueResolved).toBe(true);
    expect(candidate.validation.noNewFreezeRisk).toBe(true);
    expect(candidate.validation.ok).toBe(true);
    expect(candidate.patchedLine).toContain('console.error');
    expect(candidate.diff).toContain('+');
  });

  it('honestly rejects when the recorded line is not an empty catch', () => {
    const content = ['const a = 1;', 'const b = 2;'].join('\n');
    const candidate = buildSafeFixCandidate({
      proposalId: 'imp_2',
      category: 'logging_fix',
      relativePath: 'x.ts',
      line: 1,
      content,
    });
    expect(candidate.validation.applied).toBe(false);
    expect(candidate.validation.ok).toBe(false);
    expect(candidate.validation.reason).toContain('No safe mechanical transform');
  });
});
