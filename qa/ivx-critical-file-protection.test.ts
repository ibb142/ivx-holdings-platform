/**
 * IVX Critical File Protection Test
 * CI fails when any P0/P1 critical file is deleted or loses coverage.
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { CRITICAL_FILES, P0_FILES, P1_FILES, isCriticalFile } from './ivx-critical-files';

const REPO_ROOT = join(import.meta.dir, '..');

describe('IVX Critical File Protection', () => {
  it('QA-CRIT-001: All P0 critical files exist', () => {
    const missing: string[] = [];
    for (const f of P0_FILES) {
      const fullPath = join(REPO_ROOT, f.path);
      if (!existsSync(fullPath)) {
        missing.push(f.path);
      }
    }
    expect(missing).toEqual([]);
  });

  it('QA-CRIT-002: All P1 critical files exist', () => {
    const missing: string[] = [];
    for (const f of P1_FILES) {
      const fullPath = join(REPO_ROOT, f.path);
      if (!existsSync(fullPath)) {
        missing.push(f.path);
      }
    }
    expect(missing).toEqual([]);
  });

  it('QA-CRIT-003: All P0 files are non-empty', () => {
    const empty: string[] = [];
    for (const f of P0_FILES) {
      const fullPath = join(REPO_ROOT, f.path);
      if (existsSync(fullPath)) {
        const stat = statSync(fullPath);
        if (stat.size < 10) empty.push(f.path);
      }
    }
    expect(empty).toEqual([]);
  });

  it('QA-CRIT-004: Critical file manifest has at least 20 entries', () => {
    expect(CRITICAL_FILES.length).toBeGreaterThanOrEqual(20);
  });

  it('QA-CRIT-005: Every P0 file has a capability description', () => {
    const missing = P0_FILES.filter(f => !f.description || f.description.length < 10);
    expect(missing).toEqual([]);
  });

  it('QA-CRIT-006: Every P0 file has requiredByTests array', () => {
    const missing = P0_FILES.filter(f => !f.requiredByTests || f.requiredByTests.length === 0);
    expect(missing).toEqual([]);
  });

  it('QA-CRIT-007: isCriticalFile correctly identifies protected paths', () => {
    expect(isCriticalFile('backend/api/ivx-owner-ai.ts')).toBe(true);
    expect(isCriticalFile('backend/services/ivx-autonomous-coder.ts')).toBe(true);
    expect(isCriticalFile('backend/hono.ts')).toBe(true);
    expect(isCriticalFile('random/nonexistent/file.ts')).toBe(false);
  });

  it('QA-CRIT-008: QA system files exist', () => {
    const required = [
      'qa/ivx-qa-runner.ts',
      'qa/ivx-qa-types.ts',
      'qa/ivx-critical-files.ts',
      'qa/ivx-evidence-generator.ts',
      'qa/ivx-critical-file-protection.test.ts',
    ];
    const missing = required.filter(f => !existsSync(join(REPO_ROOT, f)));
    expect(missing).toEqual([]);
  });

  it('QA-CRIT-009: Autonomous coder exports runIVXAutonomousCoder', () => {
    const path = join(REPO_ROOT, 'backend/services/ivx-autonomous-coder.ts');
    if (!existsSync(path)) throw new Error('ivx-autonomous-coder.ts missing');
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('runIVXAutonomousCoder');
  });

  it('QA-CRIT-010: hono.ts has health endpoint', () => {
    const path = join(REPO_ROOT, 'backend/hono.ts');
    if (!existsSync(path)) throw new Error('hono.ts missing');
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('/health');
  });
});
