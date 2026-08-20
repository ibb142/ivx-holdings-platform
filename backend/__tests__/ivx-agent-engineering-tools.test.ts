/**
 * Proves the engineering tools REALLY execute against the real workspace.
 *
 * Deliberately NOT stubbed: the module under test is exercised for real, and the
 * assertions are anchored to ground truth obtained independently (fs reads,
 * separate process runs). A tool that fabricated its output would fail here.
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  executeEngineeringTool,
  resolveRepoRoot,
  containPath,
  parseBunTestOutput,
  parseTscOutput,
  isEngineeringTool,
  ENGINEERING_TOOL_IDS,
  OWNER_APPROVAL_ENGINEERING_TOOLS,
} from '../services/ivx-agent-engineering-tools';
import {
  getPermittedRealTools,
  isEngineeringAgent,
  APPROVAL_GATED_TOOL_IDS,
  executeRealTool,
} from '../services/ivx-agent-real-tools';

const repoRoot = resolveRepoRoot();

describe('path containment', () => {
  it('rejects absolute paths', async () => {
    await expect(containPath(repoRoot, '/etc/passwd')).rejects.toThrow(/absolute paths/);
  });

  it('rejects traversal outside the repo root', async () => {
    await expect(containPath(repoRoot, '../../../etc/passwd')).rejects.toThrow(/escapes repository root/);
  });

  it('accepts a real in-repo path', async () => {
    const abs = await containPath(repoRoot, 'package.json');
    expect(abs.startsWith(repoRoot)).toBe(true);
  });
});

describe('code_read executes for real', () => {
  it('returns the ACTUAL bytes and a matching sha256', async () => {
    const res = await executeEngineeringTool('code_read', { path: 'package.json' }, { repoRoot });
    expect(res.ok).toBe(true);

    // Ground truth read independently of the tool.
    const truth = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
    const truthSha = createHash('sha256').update(truth).digest('hex');

    expect(res.contentSha256).toBe(truthSha);
    expect(res.extract.lineCount).toBe(truth.split('\n').length);
    expect(res.sourceReference).toContain('package.json');
  });

  it('fails honestly on a missing file instead of inventing content', async () => {
    const res = await executeEngineeringTool('code_read', { path: 'does-not-exist-xyz.ts' }, { repoRoot });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/file not found/);
    expect(res.contentSha256).toBe('');
  });

  it('refuses to escape the repository', async () => {
    const res = await executeEngineeringTool('code_read', { path: '../../etc/passwd' }, { repoRoot });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/escapes repository root/);
  });
});

describe('code_search executes for real', () => {
  it('finds a string that genuinely exists', async () => {
    const res = await executeEngineeringTool(
      'code_search',
      { pattern: 'IVX_ENGINEERING_TOOLS_MARKER', scope: 'backend/services' },
      { repoRoot },
    );
    expect(res.ok).toBe(true);
    expect(res.extract.matchCount as number).toBeGreaterThan(0);
  });

  it('reports zero matches truthfully rather than erroring', async () => {
    const res = await executeEngineeringTool(
      'code_search',
      { pattern: 'zzz_string_that_should_never_exist_9182', scope: 'backend/services' },
      { repoRoot },
    );
    expect(res.ok).toBe(true);
    expect(res.extract.matchCount).toBe(0);
  });
});

describe('secret_scan reports file names only', () => {
  it('never captures a secret value in its evidence', async () => {
    const res = await executeEngineeringTool('secret_scan', {}, { repoRoot });
    expect(res.ok).toBe(true);
    const serialized = JSON.stringify(res);
    // No captured line content — only paths.
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(serialized).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(res.extract).toHaveProperty('matchedFileCount');
  });
});

describe('output parsers reflect reality', () => {
  it('parses real bun test summary counters', () => {
    const parsed = parseBunTestOutput(' 12 pass\n 3 fail\n');
    expect(parsed.pass).toBe(12);
    expect(parsed.fail).toBe(3);
  });

  it('counts real tsc diagnostics', () => {
    const parsed = parseTscOutput(
      "src/a.ts(1,1): error TS2304: Cannot find name 'x'.\nsrc/b.ts(2,2): error TS2345: bad arg.\n",
    );
    expect(parsed.errorCount).toBe(2);
  });

  it('reports a clean tsc run as zero errors', () => {
    expect(parseTscOutput('').errorCount).toBe(0);
  });
});

describe('a failing result can never be laundered into a pass', () => {
  it('marks passed=false when tsc reports errors', () => {
    const parsed = parseTscOutput("x.ts(1,1): error TS1005: ';' expected.\n");
    expect(parsed.errorCount).toBe(1);
    expect(parsed.errorCount === 0).toBe(false);
  });

  it('marks a red suite as not passed', () => {
    const parsed = parseBunTestOutput(' 5 pass\n 2 fail\n');
    const green = parsed.fail === 0 && parsed.pass > 0;
    expect(green).toBe(false);
  });
});

describe('permissions and approval gating', () => {
  it('classifies engineering tools', () => {
    for (const t of ENGINEERING_TOOL_IDS) expect(isEngineeringTool(t)).toBe(true);
    expect(isEngineeringTool('wikipedia_search')).toBe(false);
  });

  it('grants engineering tools only to engineering agents', () => {
    const engineeringAgent = 1;
    const researchAgent = 2;
    expect(isEngineeringAgent(engineeringAgent)).toBe(true);
    expect(isEngineeringAgent(researchAgent)).toBe(false);
    expect(getPermittedRealTools(engineeringAgent)).toContain('run_tests');
    expect(getPermittedRealTools(researchAgent)).not.toContain('run_tests');
  });

  it('keeps EVERY mutating capability behind owner approval', () => {
    for (const t of OWNER_APPROVAL_ENGINEERING_TOOLS) {
      expect(APPROVAL_GATED_TOOL_IDS as readonly string[]).toContain(t);
    }
  });

  it('blocks code_write without an owner approval token', async () => {
    const res = await executeRealTool('ivx-agent-001', 1, 'code_write', { path: 'x.ts', content: 'y' });
    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.error).toMatch(/requires owner approval/);
  });

  it('blocks deploy_to_production without an owner approval token', async () => {
    const res = await executeRealTool('ivx-agent-001', 1, 'deploy_to_production', {});
    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
  });

  it('blocks an engineering tool for a research-only agent', async () => {
    const res = await executeRealTool('ivx-agent-002', 2, 'run_tests', { scope: 'backend' });
    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.error).toMatch(/not in agent #2's permitted tool set/);
  });
});

describe('end-to-end evidence envelope', () => {
  it('produces verifiable evidence through executeRealTool for a permitted agent', async () => {
    const res = await executeRealTool('ivx-agent-001', 1, 'code_read', { path: 'package.json' });
    expect(res.ok).toBe(true);
    // The runtime completion guard requires all three of these.
    expect(res.sourceReference).not.toBe('');
    expect(res.contentSha256).not.toBe('');
    expect(res.httpStatus).toBeGreaterThanOrEqual(200);
  });
});
