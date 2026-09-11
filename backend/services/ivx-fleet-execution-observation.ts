import type { FleetProcessObservation } from './ivx-postgres-autonomous-task-store';
import type { FleetExecutionSample, FleetInstance } from '../../expo/shared/ivx/fleet-signals';
import type { AgentFleetSignal } from '../../expo/shared/ivx/fleet-signals';

/** Aggregate physical process samples only with complete, same-SHA coverage.
 * Samples describe admitted IVX model requests (including provider retry time),
 * not a claim about the provider's maximum capacity or instantaneous overlap.
 */
export function fleetExecutionObservation(observation: FleetProcessObservation | undefined,
  expected: FleetInstance[], sha: string, now: number): FleetExecutionSample | null {
  if (!observation || !expected.length || expected.length > 1000 || !Array.isArray(observation.instances)) return null;
  const rows = observation.instances;
  const ids = new Set(expected.map(i => i.instanceId));
  if (ids.size !== expected.length || rows.length !== ids.size || new Set(rows.map(i => i.instanceId)).size !== ids.size) return null;
  const sample: FleetExecutionSample = { oldestSampleAt: new Date(now).toISOString(), processCount: rows.length,
    modelRequestsActive: 0, modelRequestsWaiting: 0, configuredModelSlots: 0, repairsActive: 0, configuredRepairSlots: 0 };
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 112;
  for (const row of rows) {
    const age = now - Date.parse(row.lastSeenAt);
    if (!ids.has(row.instanceId) || row.commitSha !== sha || !['api', 'worker'].includes(row.role)
      || !Number.isFinite(age) || age < 0 || age > 60_000) return null;
    if (Date.parse(row.lastSeenAt) < Date.parse(sample.oldestSampleAt)) sample.oldestSampleAt = row.lastSeenAt;
    const c = row.capacity as ReturnType<typeof import('./ivx-fleet-execution-metrics').localFleetExecutionMetrics> | undefined;
    if (c?.scope !== 'process' || c.modelRuntime?.scope !== 'process') return null;
    for (const lane of [c.modelRuntime.short, c.modelRuntime.long]) {
      if (!lane || !count(lane.active) || !count(lane.waiting) || !count(lane.maxConcurrent)) return null;
      sample.modelRequestsActive += lane.active; sample.modelRequestsWaiting += lane.waiting;
      sample.configuredModelSlots += lane.maxConcurrent;
    }
    if (row.role === 'worker') {
      if (c.senior && count(c.senior.activeRepairs) && count(c.senior.configuredSlots)) {
        if (sample.repairsActive !== null) sample.repairsActive += c.senior.activeRepairs;
        if (sample.configuredRepairSlots !== null) sample.configuredRepairSlots += c.senior.configuredSlots;
      } else { sample.repairsActive = null; sample.configuredRepairSlots = null; }
    }
  }
  return sample;
}

export function fleetControlObservation(observation: FleetProcessObservation | undefined,
  expected: FleetInstance[], sha: string, now: number): Map<number, AgentFleetSignal['control']> {
  const sample = fleetExecutionObservation(observation, expected, sha, now), result = new Map<number, AgentFleetSignal['control']>();
  if (!sample || !observation) return result;
  const controls = observation.instances.map(i => (i.capacity as ReturnType<typeof import('./ivx-fleet-execution-metrics').localFleetExecutionMetrics>).controls);
  const validIds = (ids: unknown): ids is number[] => Array.isArray(ids) && ids.length <= 112
    && new Set(ids).size === ids.length && ids.every(n => Number.isInteger(n) && n >= 1 && n <= 112);
  if (controls.some(c => !c?.identitiesVerified || !validIds(c.paused) || !validIds(c.disabled))) return result;
  for (let agent = 1; agent <= 112; agent++) {
    const paused = controls.map(c => c!.paused.includes(agent)), disabled = controls.map(c => c!.disabled.includes(agent));
    result.set(agent, { paused: paused.some(Boolean), disabled: disabled.some(Boolean),
      consistent: new Set(paused).size === 1 && new Set(disabled).size === 1, oldestSampleAt: sample.oldestSampleAt });
  }
  return result;
}
