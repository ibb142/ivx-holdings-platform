import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('IVX autonomous truth control enterprise invariants', () => {
  const source = readFileSync(path.join(import.meta.dir, 'ivx-autonomous-truth-control.ts'), 'utf8');

  test('task-engine WORKING proof never falls back to updatedAt', () => {
    expect(source).toContain("function taskHeartbeat(task: Task | undefined): string | null { return task?.lastHeartbeatAt ?? null; }");
    expect(source).toContain('noInferenceFromTaskUpdatedAt:true');
    expect(source).not.toContain("task?.lastHeartbeatAt ?? task?.updatedAt");
  });

  test('task-engine WORKING requires a lease holder and fresh heartbeat', () => {
    expect(source).toContain("const taskEngineWorking=Boolean(taskRecord?.taskId&&taskRecord?.leaseHolder&&taskEngineHeartbeatFresh);");
  });

  test('truth remains fail-closed for the full 112 worker certificate', () => {
    expect(source).toContain('counts.working===112');
    expect(source).toContain('counts.freshHeartbeat===112');
    expect(source).toContain('counts.stale===0');
    expect(source).toContain('counts.blocked===0');
    expect(source).toContain('counts.unknown===0');
  });
});
