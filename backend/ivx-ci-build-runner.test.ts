import { describe, expect, test, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  runVerifyUrlSha256,
  runGithubGetWorkflowRun,
  runGithubListWorkflowRuns,
} from './api/ivx-developer-deploy-control';

const TEST_REPO_URL = 'https://github.com/ibb142/ivx-holdings-platform';
const hasGithubToken = Boolean((process.env.GITHUB_TOKEN ?? '').trim());

describe('verify_url_sha256 (artifact verification)', () => {
  test('rejects non-https URLs', async () => {
    await expect(runVerifyUrlSha256({ url: 'http://ivxholding.com/apk/app.apk' })).rejects.toThrow('https://');
  });

  test('rejects hosts outside the verification allowlist', async () => {
    await expect(runVerifyUrlSha256({ url: 'https://evil.example.com/payload.bin' })).rejects.toThrow('allowlist');
  });

  test('rejects malformed URLs', async () => {
    await expect(runVerifyUrlSha256({ url: 'https://' })).rejects.toThrow();
  });

  test('streams multiple binary chunks and returns a matching SHA-256', async () => {
    const url = 'https://ivxholding.com/apk/test-fixture.apk';
    const bytes = new Uint8Array([0, 255, 80, 75, 3, 4, 128, 42]);
    const expected = createHash('sha256').update(bytes).digest('hex');
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    })));
    try {
      const result = await runVerifyUrlSha256({ url, expectedSha256: expected });
      expect(result.ok).toBe(true);
      expect(result.sha256).toBe(expected);
      expect(result.match).toBe(true);
      expect(result.bytes).toBe(bytes.byteLength);
      expect(result.readOnly).toBe(true);
      expect(result.secretValuesReturned).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test('reports mismatch when the expected hash differs', async () => {
    const url = 'https://ivxholding.com/apk/test-fixture.apk';
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([0, 255, 42])));
    try {
      const result = await runVerifyUrlSha256({ url, expectedSha256: 'deadbeef'.repeat(8) });
      expect(result.ok).toBe(true);
      expect(result.match).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('github_get_workflow_run input validation', () => {
  test('requires a numeric runId', async () => {
    await expect(runGithubGetWorkflowRun({ repoUrl: TEST_REPO_URL })).rejects.toThrow('runId');
  });

  test('rejects non-positive runId', async () => {
    await expect(runGithubGetWorkflowRun({ repoUrl: TEST_REPO_URL, runId: -5 })).rejects.toThrow('runId');
  });
});

describe('github_list_workflow_runs (live, token-dependent)', () => {
  test.skipIf(!hasGithubToken)('lists recent workflow runs with normalized fields', async () => {
    const result = await runGithubListWorkflowRuns({ repoUrl: TEST_REPO_URL, perPage: 3 });
    expect(result.provider).toBe('github');
    expect(result.readOnly).toBe(true);
    expect(Array.isArray(result.runs)).toBe(true);
    const runs = result.runs as Record<string, unknown>[];
    for (const run of runs) {
      expect(typeof run.id === 'number' || run.id === null).toBe(true);
      expect('status' in run).toBe(true);
      expect('conclusion' in run).toBe(true);
      expect('htmlUrl' in run).toBe(true);
    }
  }, 30_000);
});
