import { describe, expect, it } from 'bun:test';
import { withOwnerAIRequestTimeout } from './ivx-owner-ai-timeout';

describe('withOwnerAIRequestTimeout', () => {
  it('returns the resolved value when the promise finishes before the timeout', async () => {
    const result = await withOwnerAIRequestTimeout(
      Promise.resolve('fast_value'),
      1000,
      () => 'timeout_fallback',
    );
    expect(result).toBe('fast_value');
  });

  it('returns the fallback when the promise exceeds the timeout', async () => {
    const result = await withOwnerAIRequestTimeout(
      new Promise<string>((resolve) => setTimeout(() => resolve('slow_value'), 200)),
      50,
      () => 'timeout_fallback',
    );
    expect(result).toBe('timeout_fallback');
  });

  it('returns the fallback when the promise never resolves within the budget', async () => {
    const result = await withOwnerAIRequestTimeout(
      new Promise<string>(() => { /* intentionally never resolves */ }),
      25,
      () => 'timeout_fallback',
    );
    expect(result).toBe('timeout_fallback');
  });
});
