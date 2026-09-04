import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('IVX Supabase production resilience guards', () => {
  test('owner variable runtime lookup has bounded REST and direct PG fallback', () => {
    const source = readFileSync(new URL('./api/ivx-owner-variables.ts', import.meta.url), 'utf8');
    expect(source).toContain('AbortSignal.timeout(OWNER_VARIABLES_REST_TIMEOUT_MS)');
    expect(source).toContain('Runtime REST value bridge unavailable; trying direct Postgres fallback');
    expect(source).toContain('select * from public.ivx_owner_variables where name = $1 limit 1');
  });

  test('task queue sheds load during Supabase outages with recoverable bounded resilience', () => {
    const source = readFileSync(new URL('./services/ivx-owner-ai-task-queue.ts', import.meta.url), 'utf8');
    expect(source).toContain("IVX_SUPABASE_QUEUE_RESILIENCE_MARKER = 'ivx-supabase-rest-resilience-2026-09-04-v2'");
    expect(source).toContain("SUPABASE_REST_RETRY_ATTEMPTS = Math.min(3, Math.max(1, Number.parseInt(process.env.IVX_SUPABASE_REST_RETRY_ATTEMPTS ?? '2'");
    expect(source).toContain("SUPABASE_FAILURE_THRESHOLD = Math.max(3, Number.parseInt(process.env.IVX_SUPABASE_FAILURE_THRESHOLD ?? '5'");
    expect(source).toContain("SUPABASE_BACKOFF_MS = Math.max(1_000, Number.parseInt(process.env.IVX_SUPABASE_BACKOFF_MS ?? '5000'");
    expect(source).toContain('isSafeSupabaseRestRetry');
    expect(source).toContain('startOwnerAITaskWorker(intervalMs: number = 20_000)');
  });

  test('durable store probes before DDL without shortening normal durable reads', () => {
    const source = readFileSync(new URL('./services/ivx-durable-store.ts', import.meta.url), 'utf8');
    expect(source).toContain('Existing schema reachable; DDL bootstrap skipped');
    expect(source).toContain('DDL suppressed');
    expect(source).toContain('REST_TIMEOUT_MS = 30000');
    expect(source).toContain('SCHEMA_PROBE_TIMEOUT_MS = 8000');
    expect(source).toContain('AbortSignal.timeout(SCHEMA_PROBE_TIMEOUT_MS)');
  });

  test('senior developer worker no longer polls every five seconds', () => {
    const source = readFileSync(new URL('./services/ivx-senior-dev-worker.ts', import.meta.url), 'utf8');
    expect(source).toContain('TASK_POLL_INTERVAL_MS = 20_000');
  });
});
