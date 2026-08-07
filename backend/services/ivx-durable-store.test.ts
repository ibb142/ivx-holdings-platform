import { describe, expect, it } from 'bun:test';
import { REST_TIMEOUT_MS, durableKeyForFile, isDurableStoreConfigured } from './ivx-durable-store';

describe('ivx-durable-store', () => {
  it('exports a 30s REST timeout constant to prevent AI chat TimeoutError', () => {
    // Regression guard: the durable-store REST abort timeout must be at least 30s.
    // Prior value 8000ms caused "AbortSignal.timeout" to fire during live AI chat
    // on slow durable-document reads, surfacing as the error in the screenshot
    // at /app/backend/services/ivx-durable-store.ts:182:22.
    expect(REST_TIMEOUT_MS).toBe(30000);
    expect(REST_TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
    expect(REST_TIMEOUT_MS).toBeGreaterThan(8000);
  });

  it('durableKeyForFile falls back to the last two path segments', () => {
    const key = durableKeyForFile('/app/data/logs/audit/lead-capture/leads.json');
    expect(key).toBe('lead-capture/leads.json');
  });

  it('durableKeyForFile handles arbitrary paths outside logs/audit', () => {
    const key = durableKeyForFile('/some/random/path/my-state.json');
    expect(key).toBe('path/my-state.json');
  });

  it('isDurableStoreConfigured returns false without Supabase credentials', () => {
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      expect(isDurableStoreConfigured()).toBe(false);
    } finally {
      if (originalUrl) process.env.SUPABASE_URL = originalUrl;
      if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });
});
