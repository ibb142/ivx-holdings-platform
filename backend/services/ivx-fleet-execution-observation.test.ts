import { expect, test } from 'bun:test';
import { fleetControlObservation, fleetExecutionObservation } from './ivx-fleet-execution-observation';
import { visibleFleetControl } from '../../expo/shared/ivx/fleet-signals';
import { createFleetDashboardReader } from './ivx-fleet-dashboard-signals';
import type { FleetProcessObservation } from './ivx-postgres-autonomous-task-store';
import type { FleetInstance } from '../../expo/shared/ivx/fleet-signals';
const sha = 'a'.repeat(40), now = Date.parse('2026-09-11T00:00:00Z');
const expected: FleetInstance[] = ['api', 'worker'].map((role, i) => ({ role: role as 'api' | 'worker', instanceId: `process-${i}`,
  serviceId: `service-${i}`, commitSha: sha, lastSeenAt: new Date(now - 1000).toISOString() }));
function fixture(): FleetProcessObservation {
  return { measuredAt: new Date(now).toISOString(), instances: expected.map(row => ({ ...row, processRole: row.role,
    sharedState: true, sharedWorkerQueue: true, draining: false, capacity: { scope: 'process',
      modelRuntime: { scope: 'process', short: { active: 1, waiting: 3, maxConcurrent: 8 }, long: { active: 0, waiting: 0, maxConcurrent: 2 } },
      senior: { activeRepairs: 1, configuredSlots: 12 } } })) };
}
test('physical model and repair samples are separate from the 112 logical identities', () => {
  expect(fleetExecutionObservation(fixture(), expected, sha, now)).toMatchObject({ processCount: 2,
    modelRequestsActive: 2, modelRequestsWaiting: 6, configuredModelSlots: 20, repairsActive: 1, configuredRepairSlots: 12 });
});
test('each identity retains paused and disabled controls and exposes process disagreement', () => {
  const sample = fixture();
  for (const row of sample.instances) (row.capacity as any).controls = { identitiesVerified: true, paused: [7], disabled: [8] };
  let controls = fleetControlObservation(sample, expected, sha, now);
  expect(controls.size).toBe(112);
  expect(controls.get(7)).toMatchObject({ paused: true, disabled: false, consistent: true });
  expect(controls.get(8)?.disabled).toBe(true);
  expect(controls.get(112)?.paused).toBe(false);
  (sample.instances[0].capacity as any).controls.paused = [];
  controls = fleetControlObservation(sample, expected, sha, now);
  expect(controls.get(7)?.consistent).toBe(false);
  expect(visibleFleetControl({ control: controls.get(7) } as any, now + 60_001)).toBeNull();
  (sample.instances[0].capacity as any).controls = null;
  expect(fleetControlObservation(sample, expected, sha, now).size).toBe(0);
});
test('partial, duplicate, old, unknown and other-SHA process samples cannot become zero or 112', () => {
  for (const mutate of [
    (s: FleetProcessObservation) => s.instances.pop(),
    (s: FleetProcessObservation) => { s.instances[1] = s.instances[0]; },
    (s: FleetProcessObservation) => { s.instances[0].capacity = null; },
    (s: FleetProcessObservation) => { s.instances[0].commitSha = 'b'.repeat(40); },
    (s: FleetProcessObservation) => { s.instances[0].lastSeenAt = new Date(now - 60_001).toISOString(); },
  ]) { const sample = fixture(); mutate(sample); expect(fleetExecutionObservation(sample, expected, sha, now)).toBeNull(); }
});
test('a stalled process read cannot block the dashboard and does not fan out per identity', async () => {
  let calls = 0;
  const read = createFleetDashboardReader({ base: async () => ({ measuredAt: new Date(now).toISOString(), states: [], assignments: [], activeTasks: [], instances: expected }),
    patrol: async () => [], processes: () => { calls++; return new Promise(() => {}); }, sha: () => sha, now: () => now });
  const samples = await Promise.all(Array.from({ length: 112 }, read));
  expect(calls).toBe(1);
  expect(samples.every(s => s.status === 'AVAILABLE' && s.execution === null)).toBe(true);
});
