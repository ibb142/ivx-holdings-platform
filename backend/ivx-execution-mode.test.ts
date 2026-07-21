/**
 * FINAL IVX IA CHAT EXECUTION MODE — backend tests
 *
 * Owner mandate 2026-07-19:
 *   - The 10 execution categories (fix/build/deploy/audit/QA/refactor/
 *     migration/create module/create app/senior developer) MUST classify
 *     as execution-mode and create a persistent worker job.
 *   - No narrative planning responses ("I'll inspect…", "Here is my plan").
 *   - Every response contains the 9 required fields: taskId, status, stage,
 *     live progress, files changed, tests, commit SHA, deployment id,
 *     verified evidence.
 */
import { describe, expect, test } from 'bun:test';
import {
  classifyExecutionModeIntent,
  listExecutionModeCategories,
} from './services/ivx-execution-mode-classifier';
import {
  buildExecutionStatusPayload,
  findForbiddenNarrativePhrases,
  hasForbiddenNarrative,
  FORBIDDEN_EXECUTION_NARRATIVE_PHRASES,
} from './services/ivx-execution-status-schema';
import type { IVXWorkerJob } from './services/ivx-senior-developer-worker';

describe('FINAL IVX IA CHAT EXECUTION MODE', () => {
  describe('classifyExecutionModeIntent — the 10 owner-mandated categories', () => {
    test('fix', () => {
      const c = classifyExecutionModeIntent('fix the chat routing bug now');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('fix');
    });

    test('build', () => {
      const c = classifyExecutionModeIntent('build the APK v1.4.14 and upload it');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('build');
    });

    test('deploy', () => {
      const c = classifyExecutionModeIntent('deploy live to production after the patch');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('deploy');
    });

    test('audit', () => {
      const c = classifyExecutionModeIntent('audit end to end why my chats disappeared');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('audit');
    });

    test('qa', () => {
      const c = classifyExecutionModeIntent('run QA — typecheck and the full test suite');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('qa');
    });

    test('refactor', () => {
      const c = classifyExecutionModeIntent('refactor the chat intent router module');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('refactor');
    });

    test('migration', () => {
      const c = classifyExecutionModeIntent('run a supabase migration for the new ledger table');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('migration');
    });

    test('create module', () => {
      const c = classifyExecutionModeIntent('create a new module for investor onboarding');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('create_module');
    });

    test('create app', () => {
      const c = classifyExecutionModeIntent('create an app for investor deal tracking');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('create_app');
    });

    test('senior developer', () => {
      const c = classifyExecutionModeIntent('act as an enterprise senior developer and fix this');
      expect(c.isExecutionMode).toBe(true);
      expect(c.category).toBe('senior_developer');
    });

    test('exposes the 10 categories via listExecutionModeCategories', () => {
      const cats = listExecutionModeCategories();
      expect(cats).toHaveLength(10);
      const labels = cats.map((c) => c.category).sort();
      expect(labels).toEqual(
        [
          'audit',
          'build',
          'create_app',
          'create_module',
          'deploy',
          'fix',
          'migration',
          'qa',
          'refactor',
          'senior_developer',
        ].sort(),
      );
    });
  });

  describe('narrative planning is NOT classified as execution mode', () => {
    test('pure explanation request', () => {
      const c = classifyExecutionModeIntent('explain how the chat intent router works');
      expect(c.isExecutionMode).toBe(false);
    });

    test('what-is question', () => {
      const c = classifyExecutionModeIntent('what is the difference between fix and build?');
      expect(c.isExecutionMode).toBe(false);
    });

    test('describe request', () => {
      const c = classifyExecutionModeIntent('describe the architecture of the worker queue');
      expect(c.isExecutionMode).toBe(false);
    });

    test('empty prompt', () => {
      const c = classifyExecutionModeIntent('');
      expect(c.isExecutionMode).toBe(false);
    });

    test('casual greeting', () => {
      const c = classifyExecutionModeIntent('hey, how are you?');
      expect(c.isExecutionMode).toBe(false);
    });
  });

  describe('buildExecutionStatusPayload — the 9 owner-required fields', () => {
    function makeJob(overrides: Partial<IVXWorkerJob> = {}): IVXWorkerJob {
      return {
        jobId: 'ivx-worker-test-001',
        status: 'running',
        stage: 'PATCHING',
        progressPercent: 25,
        stageDetail: 'Safe code diff prepared.',
        input: {
          goal: 'fix the chat routing bug',
          ownerApproved: true,
          approvePatch: true,
          approveGitDeploy: true,
          validationMode: 'focused',
          systemMode: false,
          ownerApprovedAction: null,
          ownerId: 'owner',
        },
        ownerId: 'owner',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
        cancelledAt: null,
        attempts: 1,
        result: null,
        error: null,
        ...overrides,
      };
    }

    test('running job → HTTP 202 with all 9 fields populated', () => {
      const job = makeJob();
      const payload = buildExecutionStatusPayload(job, 'fix', 'live progress block');
      expect(payload.httpStatus).toBe(202);
      // 9 owner-required fields:
      expect(payload.taskId).toBe(job.jobId);
      expect(payload.status).toBe('running');
      expect(payload.stage).toBe('PATCHING');
      expect(payload.liveProgress).toBe(25);
      expect(payload.filesChanged).toEqual([]);
      expect(payload.tests).toEqual({ run: false, passed: false, command: null });
      expect(payload.commitSha).toBeNull();
      expect(payload.deploymentId).toBeNull();
      expect(payload.evidence).toBeNull();
      // category + statusUrl present
      expect(payload.category).toBe('fix');
      expect(payload.statusUrl).toBe(`/api/ivx/senior-developer/worker/jobs/${job.jobId}`);
    });

    test('terminal completed job → HTTP 200 with verified evidence', () => {
      const job = makeJob({
        status: 'completed',
        stage: 'COMPLETED',
        progressPercent: 100,
        result: {
          jobId: 'ivx-worker-test-001',
          goal: 'fix the chat routing bug',
          ok: true,
          endToEndProductionComplete: true,
          changedFiles: ['backend/api/ivx-owner-ai.ts', 'expo/app/ivx/chat.tsx'],
          testsRun: true,
          testsPassed: true,
          typecheckRun: true,
          typecheckPassed: true,
          buildRun: true,
          commitCreated: true,
          commitSha: 'abc123def456',
          commitUrl: 'https://github.com/ibb142/rork-global-real-estate-invest/commit/abc123def456',
          pushed: true,
          branch: 'main',
          deployId: 'dep-d7t9ivreo5us73ftose0',
          deployStatus: 'live',
          deployVerified: true,
          deployRequested: true,
          liveCommit: 'abc123def456',
          commitMatch: true,
          healthOk: true,
          healthStatus: 200,
          versionEndpoint: null,
          generatedFeatureSlug: null,
          auditFiles: { json: 'logs/audit/ivx-worker-test-001.json', jsonl: 'logs/audit/ivx-worker-test-001.jsonl' },
          finalStatus: 'COMPLETE',
          error: null,
          durable: true,
          generatedAt: new Date().toISOString(),
        },
      });
      const payload = buildExecutionStatusPayload(job, 'fix', 'final verified block');
      expect(payload.httpStatus).toBe(200);
      expect(payload.filesChanged).toEqual(['backend/api/ivx-owner-ai.ts', 'expo/app/ivx/chat.tsx']);
      expect(payload.tests).toEqual({ run: true, passed: true, command: 'bun test backend/' });
      expect(payload.commitSha).toBe('abc123def456');
      expect(payload.deploymentId).toBe('dep-d7t9ivreo5us73ftose0');
      expect(payload.evidence).not.toBeNull();
      expect(payload.evidence?.deployedToProduction).toBe(true);
      expect(payload.evidence?.commitMatch).toBe(true);
      expect(payload.evidence?.healthOk).toBe(true);
      expect(payload.evidence?.finalStatus).toBe('COMPLETE');
      expect(payload.evidence?.answerBlock).toBe('final verified block');
    });

    test('terminal failed job → HTTP 200 with evidence but deployedToProduction=false', () => {
      const job = makeJob({
        status: 'failed',
        stage: 'FAILED',
        progressPercent: 0,
        result: {
          jobId: 'ivx-worker-test-001',
          goal: 'fix the chat routing bug',
          ok: false,
          endToEndProductionComplete: false,
          changedFiles: [],
          testsRun: false,
          testsPassed: false,
          typecheckRun: false,
          typecheckPassed: false,
          buildRun: false,
          commitCreated: false,
          commitSha: null,
          commitUrl: null,
          pushed: false,
          branch: null,
          deployId: null,
          deployStatus: null,
          deployVerified: false,
          deployRequested: false,
          liveCommit: null,
          commitMatch: false,
          healthOk: false,
          healthStatus: null,
          versionEndpoint: null,
          generatedFeatureSlug: null,
          auditFiles: { json: '', jsonl: '' },
          finalStatus: 'FAILED',
          error: 'patch gate refused',
          durable: true,
          generatedAt: new Date().toISOString(),
        },
      });
      const payload = buildExecutionStatusPayload(job, 'fix', 'failed block');
      expect(payload.httpStatus).toBe(200);
      expect(payload.evidence).not.toBeNull();
      expect(payload.evidence?.deployedToProduction).toBe(false);
      expect(payload.evidence?.finalStatus).toBe('FAILED');
      expect(payload.evidence?.error).toBe('patch gate refused');
    });
  });

  describe('forbidden narrative phrases — acceptance criteria', () => {
    test('detects "I\'ll inspect..." — explicitly banned by owner', () => {
      expect(hasForbiddenNarrative("I'll inspect the chat files and report back.")).toBe(true);
      expect(findForbiddenNarrativePhrases("I'll inspect the chat files")).toContain("I'll inspect");
    });

    test('detects "I\'ll update..." — explicitly banned', () => {
      expect(hasForbiddenNarrative("I'll update the file once I review it.")).toBe(true);
    });

    test('detects "I\'ll deploy..." — explicitly banned', () => {
      expect(hasForbiddenNarrative("I'll deploy the patch after the tests pass.")).toBe(true);
    });

    test('detects "Here is my plan" — narrative implementation plan banned', () => {
      expect(hasForbiddenNarrative('Here is my plan: 1. inspect 2. patch 3. deploy.')).toBe(true);
    });

    test('detects "Hold on" / "Stand by" / "Please wait" — deferral phrases banned', () => {
      expect(hasForbiddenNarrative('Hold on, let me check.')).toBe(true);
      expect(hasForbiddenNarrative('Stand by, executing now.')).toBe(true);
      expect(hasForbiddenNarrative('Please wait a moment.')).toBe(true);
    });

    test('clean execution answer passes', () => {
      const clean = [
        'TASK UNDERSTOOD:',
        'fix the chat routing bug',
        'FILES CHANGED:',
        'backend/api/ivx-owner-ai.ts',
        'TEST RESULT:',
        'PASS — 1495 tests passed.',
        'STATUS:',
        'DEPLOYED',
      ].join('\n');
      expect(hasForbiddenNarrative(clean)).toBe(false);
    });

    test('FORBIDDEN_EXECUTION_NARRATIVE_PHRASES is non-empty', () => {
      expect(FORBIDDEN_EXECUTION_NARRATIVE_PHRASES.length).toBeGreaterThan(20);
    });
  });
});
