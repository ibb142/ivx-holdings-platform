import { describe, expect, test } from 'bun:test';
import {
  runGithubReadFile,
  runGithubSearchCode,
  runGithubListDirectory,
  runGithubGetFileTree,
  runGithubGetWorkflowLogs,
  runAiDiagnoseFailure,
  runAiAnalyzeCode,
  runAiGenerateFix,
  runAiReviewArchitecture,
  runAnalyzeDependencies,
} from './api/ivx-developer-deploy-control';

const TEST_REPO_URL = 'https://github.com/ibb142/rork-global-real-estate-invest';
const hasGithubToken = Boolean((process.env.GITHUB_TOKEN ?? '').trim());

// ─── github_read_file ──────────────────────────────────────────────────────

describe('github_read_file input validation', () => {
  test('rejects empty path', async () => {
    await expect(runGithubReadFile({ repoUrl: TEST_REPO_URL })).rejects.toThrow('path');
  });

  test('rejects path containing ..', async () => {
    await expect(runGithubReadFile({ repoUrl: TEST_REPO_URL, path: '../etc/passwd' })).rejects.toThrow('path');
  });

  test('rejects secret-bearing paths', async () => {
    await expect(runGithubReadFile({ repoUrl: TEST_REPO_URL, path: '.env' })).rejects.toThrow('secret');
  });

  test('rejects .pem files', async () => {
    await expect(runGithubReadFile({ repoUrl: TEST_REPO_URL, path: 'server.pem' })).rejects.toThrow('secret');
  });

  test('rejects paths containing "secret"', async () => {
    await expect(runGithubReadFile({ repoUrl: TEST_REPO_URL, path: 'config/secret-keys.json' })).rejects.toThrow('secret');
  });

  test('allows .env.example (not blocked)', async () => {
    // This should NOT throw a secret error — it may throw a GitHub HTTP error
    // if the repo doesn't have that file, but the path validation itself passes.
    try {
      await runGithubReadFile({ repoUrl: TEST_REPO_URL, path: '.env.example' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      expect(msg.includes('secret')).toBe(false);
    }
  }, 15_000);
});

describe('github_read_file (live, token-dependent)', () => {
  test.skipIf(!hasGithubToken)('reads a real file from the repo', async () => {
    const result = await runGithubReadFile({ repoUrl: TEST_REPO_URL, path: 'package.json' });
    expect(result.provider).toBe('github');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.content).toBe('string');
    expect((result.content as string).length).toBeGreaterThan(0);
    expect(result.path).toBe('package.json');
    expect(result.sha).toBeTruthy();
  }, 30_000);
});

// ─── github_search_code ────────────────────────────────────────────────────

describe('github_search_code input validation', () => {
  test('rejects empty query', async () => {
    await expect(runGithubSearchCode({ repoUrl: TEST_REPO_URL })).rejects.toThrow('query');
  });

  test('rejects single-character query', async () => {
    await expect(runGithubSearchCode({ repoUrl: TEST_REPO_URL, query: 'x' })).rejects.toThrow('query');
  });
});

describe('github_search_code (live, token dependent)', () => {
  test.skipIf(!hasGithubToken)('searches for a known pattern', async () => {
    const result = await runGithubSearchCode({ repoUrl: TEST_REPO_URL, query: 'IVXBrandLogo', perPage: 3 });
    expect(result.provider).toBe('github');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(Array.isArray(result.results)).toBe(true);
    const results = result.results as Array<Record<string, unknown>>;
    if (results.length > 0) {
      expect(results[0].path).toBeTruthy();
    }
  }, 30_000);
});

// ─── github_list_directory ─────────────────────────────────────────────────

describe('github_list_directory input validation', () => {
  test.skipIf(!hasGithubToken)('rejects when directory does not exist (HTTP error)', async () => {
    await expect(
      runGithubListDirectory({ repoUrl: TEST_REPO_URL, path: 'this-directory-does-not-exist-xyz' }),
    ).rejects.toThrow('HTTP');
  }, 15_000);
});

describe('github_list_directory (live, token dependent)', () => {
  test.skipIf(!hasGithubToken)('lists the root directory', async () => {
    const result = await runGithubListDirectory({ repoUrl: TEST_REPO_URL, path: '' });
    expect(result.provider).toBe('github');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(Array.isArray(result.entries)).toBe(true);
    const entries = result.entries as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThan(0);
    // Should have at least 'backend' or 'expo' in root
    const names = entries.map((e) => e.name);
    expect(names.includes('backend') || names.includes('expo')).toBe(true);
  }, 30_000);

  test.skipIf(!hasGithubToken)('lists the backend directory', async () => {
    const result = await runGithubListDirectory({ repoUrl: TEST_REPO_URL, path: 'backend' });
    expect(result.provider).toBe('github');
    expect(Array.isArray(result.entries)).toBe(true);
    const entries = result.entries as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThan(0);
  }, 30_000);
});

// ─── github_get_file_tree ──────────────────────────────────────────────────

describe('github_get_file_tree (live, token dependent)', () => {
  test.skipIf(!hasGithubToken)('returns the recursive file tree', async () => {
    const result = await runGithubGetFileTree({ repoUrl: TEST_REPO_URL });
    expect(result.provider).toBe('github');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(Array.isArray(result.tree)).toBe(true);
    const tree = result.tree as Array<Record<string, unknown>>;
    expect(tree.length).toBeGreaterThan(0);
    // Tree entries should have path, type, size
    expect(tree[0].path).toBeTruthy();
    expect(tree[0].type).toBe('blob');
  }, 30_000);
});

// ─── github_get_workflow_logs ──────────────────────────────────────────────

describe('github_get_workflow_logs input validation', () => {
  test('requires a numeric jobId', async () => {
    await expect(runGithubGetWorkflowLogs({ repoUrl: TEST_REPO_URL })).rejects.toThrow('jobId');
  });

  test('rejects non-positive jobId', async () => {
    await expect(runGithubGetWorkflowLogs({ repoUrl: TEST_REPO_URL, jobId: -1 })).rejects.toThrow('jobId');
  });

  test('rejects zero jobId', async () => {
    await expect(runGithubGetWorkflowLogs({ repoUrl: TEST_REPO_URL, jobId: 0 })).rejects.toThrow('jobId');
  });
});

// ─── ai_diagnose_failure ───────────────────────────────────────────────────

describe('ai_diagnose_failure input validation', () => {
  test('rejects empty failureContext', async () => {
    await expect(runAiDiagnoseFailure({})).rejects.toThrow('failureContext');
  });

  test('rejects very short context', async () => {
    await expect(runAiDiagnoseFailure({ failureContext: 'err' })).rejects.toThrow('failureContext');
  });

  test('rejects empty logs', async () => {
    await expect(runAiDiagnoseFailure({ logs: '' })).rejects.toThrow('failureContext');
  });
});

// ─── ai_analyze_code ───────────────────────────────────────────────────────

describe('ai_analyze_code input validation', () => {
  test('rejects empty code', async () => {
    await expect(runAiAnalyzeCode({})).rejects.toThrow('code');
  });

  test('rejects very short code', async () => {
    await expect(runAiAnalyzeCode({ code: 'x = 1' })).rejects.toThrow('code');
  });

  test('accepts path + code without language', async () => {
    // Should not throw on input validation (may throw if AI not configured)
    try {
      await runAiAnalyzeCode({ path: 'test.ts', code: 'const x: number = 42; console.log(x);' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // If it fails, it should be AI config, not input validation
      expect(msg.includes('code')).toBe(false);
    }
  }, 15_000);
});

// ─── ai_generate_fix ───────────────────────────────────────────────────────

describe('ai_generate_fix input validation', () => {
  test('rejects empty code', async () => {
    await expect(runAiGenerateFix({ issue: 'bug in code' })).rejects.toThrow('code');
  });

  test('rejects empty issue', async () => {
    await expect(runAiGenerateFix({ code: 'const x = 1;' })).rejects.toThrow('issue');
  });

  test('rejects very short issue', async () => {
    await expect(runAiGenerateFix({ code: 'const x = 1;', issue: 'x' })).rejects.toThrow('issue');
  });
});

// ─── ai_review_architecture ────────────────────────────────────────────────

describe('ai_review_architecture input validation', () => {
  test('rejects when no inputs provided', async () => {
    await expect(runAiReviewArchitecture({})).rejects.toThrow('fileTree');
  });

  test('accepts fileTree alone', async () => {
    try {
      await runAiReviewArchitecture({ fileTree: 'src/\n  index.ts\n  app.ts' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      expect(msg.includes('fileTree')).toBe(false);
    }
  }, 15_000);

  test('accepts description alone', async () => {
    try {
      await runAiReviewArchitecture({ description: 'A real estate investment platform with mobile app and landing page.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      expect(msg.includes('fileTree')).toBe(false);
    }
  }, 15_000);
});

// ─── analyze_dependencies ──────────────────────────────────────────────────

describe('analyze_dependencies (live, token dependent)', () => {
  test.skipIf(!hasGithubToken)('reads package.json files from the repo', async () => {
    const result = await runAnalyzeDependencies({ repoUrl: TEST_REPO_URL });
    expect(result.provider).toBe('ivx');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(Array.isArray(result.packages)).toBe(true);
    const packages = result.packages as Array<Record<string, unknown>>;
    expect(packages.length).toBeGreaterThan(0);
    // Root package.json should be there
    const paths = packages.map((p) => p.path);
    expect(paths.includes('package.json')).toBe(true);
    // Each package should have dependencies
    const rootPkg = packages.find((p) => p.path === 'package.json');
    expect(rootPkg).toBeTruthy();
    expect(Array.isArray(rootPkg!.dependencies)).toBe(true);
    expect(Array.isArray(rootPkg!.devDependencies)).toBe(true);
    // Should have shared dependencies between packages
    expect(Array.isArray(result.sharedDependencies)).toBe(true);
  }, 30_000);
});

// ─── Read-only action safety ───────────────────────────────────────────────

describe('read-only action safety properties', () => {
  test.skipIf(!hasGithubToken)('github_read_file returns readOnly=true and secretValuesReturned=false', async () => {
    const result = await runGithubReadFile({ repoUrl: TEST_REPO_URL, path: 'package.json' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('github_list_directory returns readOnly=true and secretValuesReturned=false', async () => {
    const result = await runGithubListDirectory({ repoUrl: TEST_REPO_URL, path: '' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('github_get_file_tree returns readOnly=true and secretValuesReturned=false', async () => {
    const result = await runGithubGetFileTree({ repoUrl: TEST_REPO_URL });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('github_search_code returns readOnly=true and secretValuesReturned=false', async () => {
    const result = await runGithubSearchCode({ repoUrl: TEST_REPO_URL, query: 'export function', perPage: 2 });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('analyze_dependencies returns readOnly=true and secretValuesReturned=false', async () => {
    const result = await runAnalyzeDependencies({ repoUrl: TEST_REPO_URL });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);
});
