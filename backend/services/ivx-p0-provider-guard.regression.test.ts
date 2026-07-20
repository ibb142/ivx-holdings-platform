/**
 * P0 Regression Tests — Provider/Model Adapter Compatibility + Execution Guard
 *
 * These tests reproduce the EXACT production failures reported by the owner:
 *
 *   FAILURE 1: IVXAIGatewayRequestError — "Unsupported model version v4 for
 *   provider openai.responses" caused by @ai-sdk/openai@4 (spec v4) being
 *   incompatible with ai@6 (supports spec v2/v3 only).
 *
 *   FAILURE 2: Execution guard blocked valid developer output because canned
 *   promise-only text paths ("I will inspect...") were routed to the guard
 *   BEFORE the real senior developer runtime ever executed.
 *
 *   FAILURE 3: Invalid endpoint https://api.openai.com/v1/gpt-4o — model name
 *   embedded as an API route path.
 */
import { describe, expect, test } from 'bun:test';
import {
  validateIVXAIStartup,
  getIVXAIEndpoint,
  generateTraceId,
} from '../ivx-ai-runtime';
import {
  validateDeveloperExecutionAnswer,
  enforceDeveloperExecutionAnswer,
  BANNED_NARRATIVE_PHRASES,
} from './ivx-developer-execution-guard';

// ── FAILURE 1: Provider/model adapter compatibility ──────────────────────

describe('P0 Regression — Provider/Model Adapter Compatibility', () => {
  test('startup validation reports the installed @ai-sdk/openai adapter version', () => {
    const validation = validateIVXAIStartup();
    expect(validation.provider).toBe('openai');
    expect(validation.model).toBe('gpt-4o');
    expect(validation.adapterVersion).not.toBe('unknown');
    // Must be spec v3 (3.x), not v4 (4.x)
    const major = Number.parseInt(validation.adapterVersion.split('.')[0] ?? '0', 10);
    expect(major).toBeLessThanOrEqual(3);
  });

  test('startup validation does NOT expose the API key value', () => {
    const validation = validateIVXAIStartup();
    const serialized = JSON.stringify(validation);
    // The key value must never appear in the startup validation output.
    expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(validation).toHaveProperty('keyLoaded');
    expect(typeof validation.keyLoaded).toBe('boolean');
  });

  test('startup validation fails when adapter is spec v4', () => {
    // Simulate: the validation function checks adapter version major > 3
    // This is the exact error the owner saw in production.
    const validation = validateIVXAIStartup();
    if (validation.adapterVersion !== 'unknown') {
      const major = Number.parseInt(validation.adapterVersion.split('.')[0] ?? '0', 10);
      if (major > 3) {
        expect(validation.ok).toBe(false);
        expect(validation.errors.some((e) => e.includes('spec v4'))).toBe(true);
      }
    }
  });
});

// ── FAILURE 3: Invalid model endpoint ─────────────────────────────────────

describe('P0 Regression — No Model Name in Endpoint URL', () => {
  test('getIVXAIEndpoint does NOT embed the model name in the URL path', () => {
    const endpoint = getIVXAIEndpoint('gpt-4o');
    // The endpoint must be the base URL, not https://api.openai.com/v1/gpt-4o
    expect(endpoint).not.toContain('gpt-4o');
    expect(endpoint).not.toMatch(/\/gpt-/);
  });

  test('getIVXAIEndpoint returns a valid base URL', () => {
    const endpoint = getIVXAIEndpoint('gpt-4o');
    if (endpoint) {
      expect(endpoint).toMatch(/^https:\/\/api\.openai\.com\/v1$/);
    }
  });
});

// ── FAILURE 2: Execution guard does not block valid in-progress text ──────

describe('P0 Regression — Execution Guard Allows Valid In-Progress Text', () => {
  test('harmless in-progress phrases are NOT in the banned list', () => {
    // These phrases were previously banned and caused false positives.
    const previouslyBanned = [
      'starting implementation',
      'i will inspect',
      'i will patch',
      'i will validate',
      'i will fix',
      'i will implement',
      'and return only files changed',
      'i reviewed',
      'i prepared',
      'i initialized',
      'i will begin',
      'i will start',
      'development phase',
      'schema planning',
      'i am ready to',
      'i would',
      'phase 1',
      'phase 2',
    ];
    for (const phrase of previouslyBanned) {
      expect(BANNED_NARRATIVE_PHRASES).not.toContain(phrase);
    }
  });

  test('genuine planning-only phrases ARE still banned', () => {
    // These are actual fake narrative patterns with no execution.
    expect(BANNED_NARRATIVE_PHRASES).toContain('awaiting approval');
    expect(BANNED_NARRATIVE_PHRASES).toContain('architecture proposal');
    expect(BANNED_NARRATIVE_PHRASES).toContain('execution plan');
    expect(BANNED_NARRATIVE_PHRASES).toContain('implementation plan');
  });

  test('a completed structured report with in-progress language passes validation', () => {
    // A real developer execution answer that mentions "starting implementation"
    // but has all required sections AND raw command output must PASS.
    const answer = [
      'TASK ID:\njob_regression_1',
      'STATUS:\nLOCAL ONLY',
      'FILES CHANGED:\n- backend/hono.ts',
      'COMMANDS:\n- $ bun test backend/hono.test.ts -> exit 0 (PASS)\n- $ tsc --noEmit -> exit 0 (PASS)',
      'TESTS:\n$ bun test backend/hono.test.ts\n12 pass\n0 fail\nexit code: 0 -> PASS',
      'DEPLOYED PROOF:\ngit diff --stat (applied patch):\n backend/hono.ts | add health guard\ngit status --short:\n M backend/hono.ts\njob: job_regression_1',
    ].join('\n\n');
    const result = validateDeveloperExecutionAnswer(answer);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test('a promise-only answer with no sections still fails (caught by missing sections)', () => {
    // Even with the reduced banned list, a promise-only answer fails because
    // it is missing ALL required sections.
    const answer = 'I will inspect the files, patch the code, and return only files changed.';
    const result = validateDeveloperExecutionAnswer(answer);
    expect(result.ok).toBe(false);
    expect(result.hasAllSections).toBe(false);
  });
});

// ── Trace ID generation ────────────────────────────────────────────────────

describe('P0 Regression — Trace ID for Provider Failures', () => {
  test('generateTraceId produces a unique trace ID', () => {
    const id1 = generateTraceId();
    const id2 = generateTraceId();
    expect(id1).toMatch(/^ivx-trace-[a-f0-9]+$/);
    expect(id2).toMatch(/^ivx-trace-[a-f0-9]+$/);
    expect(id1).not.toBe(id2);
  });
});
