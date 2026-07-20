/**
 * Phase 8: Context pipeline — retrieval + token budget.
 */
import { describe, expect, test } from 'bun:test';
import { buildContextPipeline, extractKeywords, renderContextPipeline } from './ivx-context-pipeline';

describe('IVX Context Pipeline', () => {
  test('extractKeywords pulls technical terms', () => {
    const kws = extractKeywords('Fix the chat loading in expo/app/ivx/chat.tsx');
    expect(kws).toContain('chat');
    expect(kws).toContain('loading');
    expect(kws).toContain('expo/app/ivx/chat.tsx');
    expect(kws).not.toContain('the');
  });

  test('buildContextPipeline always includes user request', () => {
    const result = buildContextPipeline({ userRequest: 'Fix chat loading' });
    expect(result.entries[0].kind).toBe('user_request');
    expect(result.entries[0].content).toBe('Fix chat loading');
  });

  test('buildContextPipeline sorts by relevance and truncates to token budget', () => {
    const result = buildContextPipeline({
      userRequest: 'Fix chat loading',
      acceptanceCriteria: ['Opens on latest'],
      sourceFiles: Array.from({ length: 50 }, (_, i) => ({ path: `file-${i}.ts`, content: 'x'.repeat(1000) })),
    });
    expect(result.totalTokenEstimate).toBeLessThanOrEqual(12000);
    expect(result.truncated).toBe(true);
  });

  test('buildContextPipeline scores source files by keyword match', () => {
    const result = buildContextPipeline({
      userRequest: 'Fix chat loading scroll',
      sourceFiles: [
        { path: 'chat.ts', content: 'chat scroll loading flatlist' },
        { path: 'wallet.ts', content: 'wallet balance deposit' },
      ],
    });
    const chatEntry = result.entries.find((e) => e.label === 'chat.ts');
    const walletEntry = result.entries.find((e) => e.label === 'wallet.ts');
    expect(chatEntry!.relevanceScore).toBeGreaterThan(walletEntry!.relevanceScore);
  });

  test('renderContextPipeline produces a text block', () => {
    const result = buildContextPipeline({ userRequest: 'Fix chat' });
    const text = renderContextPipeline(result);
    expect(text).toContain('IVX CONTEXT PIPELINE');
    expect(text).toContain('Current user request');
  });
});
