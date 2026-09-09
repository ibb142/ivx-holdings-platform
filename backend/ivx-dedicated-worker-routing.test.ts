import { afterEach, describe, expect, it } from 'bun:test';
import { shouldExecuteWorkerQueueInThisProcess } from './services/ivx-senior-developer-worker';

const savedRecovery = process.env.IVX_SUPABASE_RECOVERY_MODE;
const savedRole = process.env.IVX_PROCESS_ROLE;
const savedDedicated = process.env.IVX_DEDICATED_WORKER_ENABLED;
const savedWorkerMode = process.env.IVX_WORKER_MODE;

afterEach(() => {
  if (savedRecovery === undefined) delete process.env.IVX_SUPABASE_RECOVERY_MODE;
  else process.env.IVX_SUPABASE_RECOVERY_MODE = savedRecovery;
  if (savedRole === undefined) delete process.env.IVX_PROCESS_ROLE;
  else process.env.IVX_PROCESS_ROLE = savedRole;
  if (savedDedicated === undefined) delete process.env.IVX_DEDICATED_WORKER_ENABLED;
  else process.env.IVX_DEDICATED_WORKER_ENABLED = savedDedicated;
  if (savedWorkerMode === undefined) delete process.env.IVX_WORKER_MODE;
  else process.env.IVX_WORKER_MODE = savedWorkerMode;
});

describe('dedicated Senior Developer queue ownership', () => {
  it('suppresses auxiliary claims in recovery and resumes the dedicated worker afterward', () => {
    process.env.IVX_PROCESS_ROLE = 'worker';
    process.env.IVX_DEDICATED_WORKER_ENABLED = 'true';
    process.env.IVX_WORKER_MODE = 'true';
    process.env.IVX_SUPABASE_RECOVERY_MODE = ' TRUE ';
    expect(shouldExecuteWorkerQueueInThisProcess()).toBe(false);
    process.env.IVX_SUPABASE_RECOVERY_MODE = 'false';
    expect(shouldExecuteWorkerQueueInThisProcess()).toBe(true);
  });
  it('keeps the API out of queue execution even with worker flags enabled', () => {
    process.env.IVX_PROCESS_ROLE = 'api';
    process.env.IVX_DEDICATED_WORKER_ENABLED = 'true';
    process.env.IVX_WORKER_MODE = 'true';
    expect(shouldExecuteWorkerQueueInThisProcess()).toBe(false);
  });
  it('keeps backwards-compatible local execution when no dedicated worker is configured', () => {
    delete process.env.IVX_DEDICATED_WORKER_ENABLED;
    delete process.env.IVX_WORKER_MODE;
    expect(shouldExecuteWorkerQueueInThisProcess()).toBe(true);
  });

  it('prevents the production web process from claiming durable worker jobs', () => {
    process.env.IVX_DEDICATED_WORKER_ENABLED = 'true';
    delete process.env.IVX_WORKER_MODE;
    expect(shouldExecuteWorkerQueueInThisProcess()).toBe(false);
  });

  it('allows the dedicated worker process to drain the durable queue', () => {
    process.env.IVX_DEDICATED_WORKER_ENABLED = 'true';
    process.env.IVX_WORKER_MODE = 'true';
    expect(shouldExecuteWorkerQueueInThisProcess()).toBe(true);
  });
});
