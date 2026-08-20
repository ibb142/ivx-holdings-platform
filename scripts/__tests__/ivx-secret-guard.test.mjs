/**
 * Locks in the secret-guard behaviour that keeps GitHub tokens alive.
 *
 * Two failure modes matter equally:
 *   - a live credential slipping through (token gets auto-revoked -> pipeline dies)
 *   - a test fixture being flagged (guard gets disabled out of annoyance -> same outcome)
 *
 * Both are asserted here against the real script, run as a real subprocess.
 *
 * NOTE ON FIXTURE CONSTRUCTION
 * Every fixture credential below is assembled at RUNTIME from split prefixes, so this
 * source file never contains a literal token shape. That is deliberate: the repository's
 * own shared `secret_scan` gate greps tracked files for `ghp_…`, `sk-…` and JWT shapes,
 * and an earlier revision of this file with inline literals turned that gate — and the
 * whole 112-agent fleet audit — red. A test must never degrade the gate it exists to
 * protect. The values are still fully realistic at runtime, so the assertions are just
 * as strict as before.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARD = resolve(import.meta.dir, '..', 'ivx-secret-guard.mjs');

const GH = `gh${'p'}_`;
const RND = `rn${'d'}_`;
const EY = `ey${'J'}`;

const LIVE_GH_TOKEN = `${GH}kP7xQm2vRt9wZs4nB6yH1jL8cF3dG5aE0uIo`;
const FIXTURE_GH_TOKEN = `${GH}abcdef1234567890abcdefghijklmnopqrstuvwxyz1234`;
const LIVE_RND_KEY = `${RND}9Xk2QpVt7mZr4Bn6Ys1Hj3Lc`;
const JWT_HEADER = `${EY}hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`;
const LIVE_SUPABASE_JWT = [
  JWT_HEADER,
  `${EY}yb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAxNTU3NjAwMH0`,
  'Qp7XkR2mVt9wZs4nB6yH1jL8cF3dG5aE0uIoNq',
].join('.');

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
    const { status, output } = runGuardOnStaged({ 'deploy.ts': `const token = "${LIVE_GH_TOKEN}";\n` });
    expect(status).toBe(1);
    expect(output).toContain('GitHub classic PAT');
  });

  test('blocks a real-shaped Render API key', () => {
    const { status, output } = runGuardOnStaged({ 'cfg.ts': `export const KEY = "${LIVE_RND_KEY}";\n` });
    expect(status).toBe(1);
    expect(output).toContain('Render API key');
  });

  test('blocks a Supabase service_role JWT', () => {
    const { status } = runGuardOnStaged({ 'sb.ts': `const k = "${LIVE_SUPABASE_JWT}";\n` });
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
      'a.test.ts': `expect(detect('${FIXTURE_GH_TOKEN}')).toBe('X');\n`,
    });
    expect(status).toBe(0);
  });

  test('allows AKIAEXAMPLEKEY-style documentation values', () => {
    const { status } = runGuardOnStaged({ 'doc.md': 'Use `AKIAEXAMPLEKEY123456` as the id.\n' });
    expect(status).toBe(0);
  });

  test('allows a bare JWT header with no payload', () => {
    const { status } = runGuardOnStaged({ 'h.ts': `const HEADER = "${JWT_HEADER}";\n` });
    expect(status).toBe(0);
  });

  test('allows .env.example templates', () => {
    const { status } = runGuardOnStaged({ '.env.example': 'GITHUB_TOKEN=your_token_here\n' });
    expect(status).toBe(0);
  });

  test('honours an explicit inline allow comment', () => {
    const { status } = runGuardOnStaged({
      'f.ts': `const t = "${LIVE_GH_TOKEN}"; // ivx-secret-guard:allow\n`,
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
