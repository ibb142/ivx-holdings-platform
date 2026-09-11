import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('IVX autonomous truth control enterprise invariants', () => {
  const source = readFileSync(path.join(import.meta.dir, 'ivx-autonomous-truth-control.ts'), 'utf8');
  const enforcerSource = readFileSync(path.join(import.meta.dir, 'ivx-autonomous-runtime-enforcer.ts'), 'utf8');

  test('WORKING proof never falls back to task-engine updatedAt', () => {
    expect(source).toContain('noInferenceFromTaskUpdatedAt: true');
    expect(source).not.toContain("task?.lastHeartbeatAt ?? task?.updatedAt");
  });

  test('slow JSON document is excluded and indexed atomic lease rows are canonical', () => {
    expect(source).toContain('durableJsonTaskStoreRemovedFromHotTruthPath: true');
    expect(source).toContain('atomicTaskRowsAreCanonicalFleetProof: true');
    expect(source).toContain("boundedDependency('postgres_atomic_leases', readPostgresFleetLeaseRows(), 30_000)");
    expect(source).toContain("'postgres_atomic task + distinct leaseHolder + workerInstanceId + heartbeat <=60s'");
  });

  test('truth remains fail-closed for the full 112 worker certificate', () => {
    expect(source).toContain('evaluateFleetActivationEvidence');
    expect(source).toContain('fleetActivationGate.certified');
    expect(source).toContain('const knownWorkerIdentities = new Set(');
    expect(source).toContain('queueBackend: provenQueueBackend');
    expect(source).toContain('counts.unknown === 0');
    expect(source).toContain('ok: continuousRuntimeCertified');
    expect(source).toContain("if (!row.leaseHolder.startsWith('agent:')) return null");
    expect(source).toContain('row.assignedAgentNumber !== runtimeState.agentNumber');
    expect(source).toContain('if (!row.workerInstanceId || !leaseFresh(row)) return false');
    expect(source).toContain('const actuallyWorking = !blocked &&');
    expect(source).toContain('eligibleAgentNumbers.has(agentNumber)');
  });

  test('a read-only truth snapshot cannot start or resume the dispatcher', () => {
    const snapshotBody = source.slice(
      source.indexOf('export async function getAutonomousTruthSnapshot()'),
      source.indexOf('export async function enforceAutonomous112RuntimeTruth()'),
    );
    expect(snapshotBody).not.toContain('startCampaignDispatcher()');
    expect(snapshotBody).not.toContain("campaignDispatcherControl('resume_all')");
  });

  test('logical identities stay at 112 while admission respects configured capacity', () => {
    expect(enforcerSource).toContain('export const IVX_AUTONOMOUS_FLEET_SIZE = 112');
    expect(enforcerSource).toContain('return autonomousContinuityCapacity()');
    expect(enforcerSource).toContain('continuityRuns.size >= getContinuityMaxConcurrency()');
    expect(enforcerSource).toContain('continuityMaxConcurrency: getContinuityMaxConcurrency()');
    expect(enforcerSource).toContain('canonicalFleetSize: IVX_AUTONOMOUS_FLEET_SIZE');
    expect(enforcerSource.match(/continuityRuns\.set\(agentId, promise\);\s*void runLeaseMirror\(\);/g)).toHaveLength(1);
  });

  test('the actual runtime honors reduced, zero and malformed admission settings', async () => {
    const { getContinuityMaxConcurrency } = await import('./ivx-autonomous-runtime-enforcer');
    const previous = process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY;
    try {
      for (const [value, expected] of [['12', 12], ['0', 0], ['bad', 0], ['112', 112]] as const) {
        process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY = value;
        expect(getContinuityMaxConcurrency()).toBe(expected);
      }
    } finally {
      if (previous === undefined) delete process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY;
      else process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY = previous;
    }
  });
});
