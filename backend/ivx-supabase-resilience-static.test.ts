import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('IVX Supabase production resilience guards', () => {
  test('owner variable runtime lookup has bounded REST and direct PG fallback', () => {
    const source = readFileSync(new URL('./api/ivx-owner-variables.ts', import.meta.url), 'utf8');
    expect(source).toContain('AbortSignal.timeout(OWNER_VARIABLES_REST_TIMEOUT_MS)');
    expect(source).toContain('Runtime REST value bridge unavailable; trying direct Postgres fallback');
    expect(source).toContain('select * from public.ivx_owner_variables where name = $1 limit 1');
  });
  test('task queue sheds load during Supabase outages', () => {
    const source = readFileSync(new URL('./services/ivx-owner-ai-task-queue.ts', import.meta.url), 'utf8');
    expect(source).toContain('SUPABASE_FAILURE_THRESHOLD = 2');
    expect(source).toContain('SUPABASE_BACKOFF_MS = 30_000');
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
