import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('IVX autonomous truth control enterprise invariants', () => {
  const source = readFileSync(path.join(import.meta.dir, 'ivx-autonomous-truth-control.ts'), 'utf8');
  const enforcerSource = readFileSync(path.join(import.meta.dir, 'ivx-autonomous-runtime-enforcer.ts'), 'utf8');

  test('WORKING proof never falls back to task-engine updatedAt', () => {
    expect(source).toContain('noInferenceFromTaskUpdatedAt:true');
    expect(source).not.toContain("task?.lastHeartbeatAt ?? task?.updatedAt");
  });

  test('slow durable task storage is excluded from the live truth hot path', () => {
    expect(source).toContain('durableTaskStoreRemovedFromHotTruthPath:true');
    expect(source).toContain('taskEngineRunning:null');
    expect(source).toContain('taskEngineHeartbeat:null');
    expect(source).toContain("workingRequiresOneOf:['agent runtime busy + activeTaskId + heartbeat <=60s','dispatcher RUNNING + real workerJobId + dispatcher heartbeat <=60s']");
  });

  test('truth remains fail-closed for the full 112 worker certificate', () => {
    expect(source).toContain('counts.working===112');
    expect(source).toContain('counts.freshHeartbeat===112');
    expect(source).toContain('counts.stale===0');
    expect(source).toContain('counts.blocked===0');
    expect(source).toContain('counts.unknown===0');
  });

  test('continuity load is bounded to real deployed capacity', () => {
    expect(enforcerSource).toContain('const DEFAULT_CONTINUITY_MAX_CONCURRENCY = 12');
    expect(enforcerSource).toContain('process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY');
    expect(enforcerSource).toContain('continuityRuns.size >= getContinuityMaxConcurrency()');
    expect(enforcerSource.match(/continuityRuns\.set\(agentId, promise\);\s*void runLeaseMirror\(\);/g)).toHaveLength(1);
  });
});
