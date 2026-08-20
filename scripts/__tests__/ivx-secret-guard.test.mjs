/**
 * Locks in the secret-guard behaviour that keeps GitHub tokens alive.
 *
 * Two failure modes matter equally:
 *   - a live credential slipping through (token gets auto-revoked -> pipeline dies)
 *   - a test fixture being flagged (guard gets disabled out of annoyance -> same outcome)
 *
 * Both are asserted here against the real script, run as a real subprocess.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARD = resolve(import.meta.dir, '..', 'ivx-secret-guard.mjs');

/** Builds a throwaway git repo, stages `files`, and runs the guard over the staged set. */
function runGuardOnStaged(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ivx-guard-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@ivx.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'IVX Test'], { cwd: dir });

    for (const [relPath, content] of Object.entries(files)) {
      const full = join(dir, relPath);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    execFileSync('git', ['add', '-A', '-f'], { cwd: dir });

    let status = 0;
    let output = '';
    try {
      output = execFileSync('node', [GUARD, '--staged'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      status = err.status ?? 1;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    return { status, output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('ivx-secret-guard — blocks live credentials', () => {
  test('blocks a real-shaped GitHub classic PAT', () => {
    const { status, output } = runGuardOnStaged({
      'deploy.ts': 'const token = "ghp_kP7xQm2vRt9wZs4nB6yH1jL8cF3dG5aE0uIo";\n',
    });
    expect(status).toBe(1);
    expect(output).toContain('GitHub classic PAT');
  });

  test('blocks a real-shaped Render API key', () => {
    const { status, output } = runGuardOnStaged({
      'cfg.ts': 'export const KEY = "rnd_9Xk2QpVt7mZr4Bn6Ys1Hj3Lc";\n',
    });
    expect(status).toBe(1);
    expect(output).toContain('Render API key');
  });

  test('blocks a Supabase service_role JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAxNTU3NjAwMH0.' +
      'Qp7XkR2mVt9wZs4nB6yH1jL8cF3dG5aE0uIoNq';
    const { status } = runGuardOnStaged({ 'sb.ts': `const k = "${jwt}";\n` });
    expect(status).toBe(1);
  });

  test('blocks the .rork/history transcripts that caused the revocation loop', () => {
    const { status, output } = runGuardOnStaged({
      '.rork/history/main/chat.json': '{"content":"harmless text"}\n',
    });
    expect(status).toBe(1);
    expect(output).toContain('Rork chat transcripts');
  });

  test('blocks a real .env file', () => {
    const { status, output } = runGuardOnStaged({ '.env': 'FOO=bar\n' });
    expect(status).toBe(1);
    expect(output).toContain('real environment file');
  });
});

describe('ivx-secret-guard — does not flag fixtures', () => {
  test('allows an obvious sequential-alphabet fixture token', () => {
    const { status } = runGuardOnStaged({
      'a.test.ts': "expect(detect('ghp_abcdef1234567890abcdefghijklmnopqrstuvwxyz1234')).toBe('X');\n",
    });
    expect(status).toBe(0);
  });

  test('allows AKIAEXAMPLEKEY-style documentation values', () => {
    const { status } = runGuardOnStaged({ 'doc.md': 'Use `AKIAEXAMPLEKEY123456` as the id.\n' });
    expect(status).toBe(0);
  });

  test('allows a bare JWT header with no payload', () => {
    const { status } = runGuardOnStaged({ 'h.ts': 'const HEADER = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";\n' });
    expect(status).toBe(0);
  });

  test('allows .env.example templates', () => {
    const { status } = runGuardOnStaged({ '.env.example': 'GITHUB_TOKEN=your_token_here\n' });
    expect(status).toBe(0);
  });

  test('honours an explicit inline allow comment', () => {
    const { status } = runGuardOnStaged({
      'f.ts': 'const t = "ghp_kP7xQm2vRt9wZs4nB6yH1jL8cF3dG5aE0uIo"; // ivx-secret-guard:allow\n',
    });
    expect(status).toBe(0);
  });

  test('passes cleanly on an ordinary source tree', () => {
    const { status, output } = runGuardOnStaged({
      'src/index.ts': 'export const greet = (n: string): string => `hi ${n}`;\n',
      'README.md': '# Project\n',
    });
    expect(status).toBe(0);
    expect(output).toContain('clean');
  });
});
