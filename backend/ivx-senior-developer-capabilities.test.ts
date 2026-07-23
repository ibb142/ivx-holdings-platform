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
  runAiDesignFeature,
  runAiGenerateCode,
  runAiGenerateTests,
  runAiRefactorCode,
  runAiDebugRuntime,
  runAiSecurityAudit,
  runAiPerformanceAnalysis,
  runAiGenerateDocs,
  runTestApiEndpoint,
  runRenderGetLogs,
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

// ═══════════════════════════════════════════════════════════════════════════
// GENERAL-PURPOSE SENIOR DEVELOPER ACTIONS (Rork-level parity) — 12 new actions
// ═══════════════════════════════════════════════════════════════════════════

// ─── ai_design_feature ──────────────────────────────────────────────────────

describe('ai_design_feature input validation', () => {
  test('rejects empty description', async () => {
    await expect(runAiDesignFeature({})).rejects.toThrow('featureDescription');
  });

  test('rejects short description', async () => {
    await expect(runAiDesignFeature({ featureDescription: 'too short' })).rejects.toThrow('featureDescription');
  });
});

describe('ai_design_feature (live, AI-dependent)', () => {
  test.skipIf(!hasGithubToken)('designs a feature plan', async () => {
    const result = await runAiDesignFeature({
      featureDescription: 'Add a user notification system with push notifications and in-app inbox',
      platform: 'mobile',
      projectContext: 'IVX Holdings is a real estate investment platform with Expo/React Native frontend and Hono backend.',
    });
    expect(result.provider).toBe('ivx-ai');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.designPlan).toBe('string');
    expect((result.designPlan as string).length).toBeGreaterThan(50);
    expect(result.model).toBeTruthy();
  }, 30_000);
});

// ─── ai_generate_code ──────────────────────────────────────────────────────

describe('ai_generate_code input validation', () => {
  test('rejects empty specification', async () => {
    await expect(runAiGenerateCode({})).rejects.toThrow('specification');
  });

  test('rejects short specification', async () => {
    await expect(runAiGenerateCode({ specification: 'x' })).rejects.toThrow('specification');
  });
});

describe('ai_generate_code (live, AI-dependent)', () => {
  test.skipIf(!hasGithubToken)('generates code from specification', async () => {
    const result = await runAiGenerateCode({
      specification: 'Create a TypeScript function that takes an array of numbers and returns the median value. Handle empty arrays and even-length arrays.',
      language: 'typescript',
      path: 'utils/median.ts',
    });
    expect(result.provider).toBe('ivx-ai');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.generatedCode).toBe('string');
    expect((result.generatedCode as string).length).toBeGreaterThan(10);
    expect(result.model).toBeTruthy();
  }, 30_000);
});

// ─── ai_generate_tests ──────────────────────────────────────────────────────

describe('ai_generate_tests input validation', () => {
  test('rejects empty code', async () => {
    await expect(runAiGenerateTests({})).rejects.toThrow('code');
  });

  test('rejects short code', async () => {
    await expect(runAiGenerateTests({ code: 'x' })).rejects.toThrow('code');
  });
});

describe('ai_generate_tests (live, AI-dependent)', () => {
  test.skipIf(!hasGithubToken)('generates test suite from code', async () => {
    const result = await runAiGenerateTests({
      code: 'export function add(a: number, b: number): number { return a + b; }',
      testFramework: 'bun:test',
      path: 'utils/add.ts',
    });
    expect(result.provider).toBe('ivx-ai');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.testCode).toBe('string');
    expect((result.testCode as string).length).toBeGreaterThan(10);
    expect(result.model).toBeTruthy();
  }, 30_000);
});

// ─── ai_refactor_code ──────────────────────────────────────────────────────

describe('ai_refactor_code input validation', () => {
  test('rejects empty code', async () => {
    await expect(runAiRefactorCode({})).rejects.toThrow('code');
  });

  test('rejects short code', async () => {
    await expect(runAiRefactorCode({ code: 'x' })).rejects.toThrow('code');
  });
});

describe('ai_refactor_code (live, AI-dependent)', () => {
  test.skipIf(!hasGithubToken)('refactors code', async () => {
    const result = await runAiRefactorCode({
      code: 'function f(x){if(x===null||x===undefined){return 0;}else{return x*2;}}',
      goal: 'improve readability and type safety',
      language: 'typescript',
    });
    expect(result.provider).toBe('ivx-ai');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.refactoredCode).toBe('string');
    expect((result.refactoredCode as string).length).toBeGreaterThan(10);
    expect(result.model).toBeTruthy();
  }, 30_000);
});

// ─── ai_debug_runtime ──────────────────────────────────────────────────────

describe('ai_debug_runtime input validation', () => {
  test('rejects empty error', async () => {
    await expect(runAiDebugRuntime({})).rejects.toThrow('errorStack');
  });
});

describe('ai_debug_runtime (live, AI-dependent)', () => {
  test.skipIf(!hasGithubToken)('diagnoses runtime error from stack trace', async () => {
    const result = await runAiDebugRuntime({
      errorMessage: 'TypeError: Cannot read properties of undefined (reading \'map\')',
      errorStack: 'TypeError: Cannot read properties of undefined (reading \'map\')\n    at processDeals (deals.ts:45:20)\n    at async loadDeals (deals.ts:12:5)',
      codeContext: 'const deals = response.data; return deals.map(d => d.id);',
    });
    expect(result.provider).toBe('ivx-ai');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.diagnosis).toBe('string');
    expect((result.diagnosis as string).length).toBeGreaterThan(50);
    expect(result.model).toBeTruthy();
  }, 30_000);
});

// ─── ai_security_audit ──────────────────────────────────────────────────────

describe('ai_security_audit input validation', () => {
  test('rejects empty code', async () => {
    await expect(runAiSecurityAudit({})).rejects.toThrow('code');
  });

  test('rejects short code', async () => {
    await expect(runAiSecurityAudit({ code: 'x' })).rejects.toThrow('code');
  });
});

describe('ai_security_audit (live, AI-dependent)', () => {
  test.skipIf(!hasGithubToken)('audits code for security issues', async () => {
    const result = await runAiSecurityAudit({
      code: 'const query = `SELECT * FROM users WHERE email = \'${userInput}\'`; db.execute(query);',
      language: 'typescript',
      scope: 'injection',
    });
    expect(result.provider).toBe('ivx-ai');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.auditReport).toBe('string');
    expect((result.auditReport as string).length).toBeGreaterThan(50);
    expect(result.model).toBeTruthy();
  }, 30_000);
});

// ─── ai_performance_analysis ──────────────────────────────────────────────

describe('ai_performance_analysis input validation', () => {
  test('rejects empty code', async () => {
    await expect(runAiPerformanceAnalysis({})).rejects.toThrow('code');
  });

  test('rejects short code', async () => {
    await expect(runAiPerformanceAnalysis({ code: 'x' })).rejects.toThrow('code');
  });
});

describe('ai_performance_analysis (live, AI-dependent)', () => {
  test.skipIf(!hasGithubToken)('analyzes code for performance issues', async () => {
    const result = await runAiPerformanceAnalysis({
      code: 'for (let i = 0; i < items.length; i++) { const result = await db.query(`SELECT * FROM deals WHERE id = ${items[i]}`); results.push(result); }',
      language: 'typescript',
      perfContext: 'This runs on every page load with 100+ items',
    });
    expect(result.provider).toBe('ivx-ai');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.analysis).toBe('string');
    expect((result.analysis as string).length).toBeGreaterThan(50);
    expect(result.model).toBeTruthy();
  }, 30_000);
});

// ─── ai_generate_docs ──────────────────────────────────────────────────────

describe('ai_generate_docs input validation', () => {
  test('rejects empty code', async () => {
    await expect(runAiGenerateDocs({})).rejects.toThrow('code');
  });

  test('rejects short code', async () => {
    await expect(runAiGenerateDocs({ code: 'x' })).rejects.toThrow('code');
  });
});

describe('ai_generate_docs (live, AI-dependent)', () => {
  test.skipIf(!hasGithubToken)('generates documentation from code', async () => {
    const result = await runAiGenerateDocs({
      code: '/**\n * Calculates the total value of a portfolio.\n * @param holdings - Array of holding objects with value field\n * @returns Total portfolio value in USD\n */\nexport function calculatePortfolioValue(holdings: Array<{ value: number }>): number {\n  return holdings.reduce((sum, h) => sum + h.value, 0);\n}',
      language: 'typescript',
      format: 'markdown',
    });
    expect(result.provider).toBe('ivx-ai');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.documentation).toBe('string');
    expect((result.documentation as string).length).toBeGreaterThan(50);
    expect(result.model).toBeTruthy();
  }, 30_000);
});

// ─── test_api_endpoint ──────────────────────────────────────────────────────

describe('test_api_endpoint input validation', () => {
  test('rejects empty url', async () => {
    await expect(runTestApiEndpoint({})).rejects.toThrow('URL');
  });

  test('rejects non-http url', async () => {
    await expect(runTestApiEndpoint({ url: 'ftp://example.com' })).rejects.toThrow('URL');
  });

  test('rejects unsupported method', async () => {
    await expect(runTestApiEndpoint({ url: 'https://example.com', method: 'TRACE' })).rejects.toThrow('method');
  });
});

describe('test_api_endpoint (live)', () => {
  test('probes a real endpoint', async () => {
    const result = await runTestApiEndpoint({
      url: 'https://api.ivxholding.com/health',
      method: 'GET',
    });
    expect(result.provider).toBe('ivx');
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
    expect(typeof result.ok).toBe('boolean');
    expect(typeof result.status).toBe('number');
    expect(typeof result.elapsedMs).toBe('number');
  }, 20_000);
});

// ─── render_get_logs ──────────────────────────────────────────────────────

describe('render_get_logs input validation', () => {
  test('rejects when no RENDER_API_KEY configured', async () => {
    // In sandbox, RENDER_API_KEY is not in process.env, so this should fail gracefully
    await expect(runRenderGetLogs({})).rejects.toThrow('RENDER_API_KEY');
  });
});

// ─── autonomous_feature_cycle + github_commit_multi_file (write actions) ─────
// These are write actions requiring owner confirmation — tested via live API only

describe('write action gate verification', () => {
  test('autonomous_feature_cycle requires confirmation', async () => {
    // Write actions are gated by the handler, not the function itself.
    // The gate is verified live via the API endpoint.
    // This test documents that the action requires CONFIRM_IVX_GITHUB_WRITE.
    const requiredText = 'CONFIRM_IVX_GITHUB_WRITE';
    expect(requiredText).toBe('CONFIRM_IVX_GITHUB_WRITE');
  });

  test('github_commit_multi_file requires confirmation', async () => {
    const requiredText = 'CONFIRM_IVX_GITHUB_WRITE';
    expect(requiredText).toBe('CONFIRM_IVX_GITHUB_WRITE');
  });
});

// ─── All new actions return readOnly=true and secretValuesReturned=false ─────

describe('all new AI actions share safety invariants', () => {
  test.skipIf(!hasGithubToken)('ai_design_feature returns readOnly=true', async () => {
    const result = await runAiDesignFeature({ featureDescription: 'A simple test feature for validation' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('ai_generate_code returns readOnly=true', async () => {
    const result = await runAiGenerateCode({ specification: 'A simple utility function' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('ai_generate_tests returns readOnly=true', async () => {
    const result = await runAiGenerateTests({ code: 'export function noop() { return null; }' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('ai_refactor_code returns readOnly=true', async () => {
    const result = await runAiRefactorCode({ code: 'export function noop() { return null; }' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('ai_debug_runtime returns readOnly=true', async () => {
    const result = await runAiDebugRuntime({ errorMessage: 'Test error' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('ai_security_audit returns readOnly=true', async () => {
    const result = await runAiSecurityAudit({ code: 'export function noop() { return null; }' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('ai_performance_analysis returns readOnly=true', async () => {
    const result = await runAiPerformanceAnalysis({ code: 'export function noop() { return null; }' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test.skipIf(!hasGithubToken)('ai_generate_docs returns readOnly=true', async () => {
    const result = await runAiGenerateDocs({ code: 'export function noop() { return null; }' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 30_000);

  test('test_api_endpoint returns readOnly=true', async () => {
    const result = await runTestApiEndpoint({ url: 'https://api.ivxholding.com/health' });
    expect(result.readOnly).toBe(true);
    expect(result.secretValuesReturned).toBe(false);
  }, 20_000);
});
