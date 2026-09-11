import { expect, test } from 'bun:test';
import { configuredAdmissionLimit, createFleetAdmissionRotation } from './ivx-fleet-admission-policy';

test('explicit admission limits never expand to the logical inventory', () => {
  expect(configuredAdmissionLimit(undefined, 12)).toBe(12);
  for (const n of [0, 1, 8, 12, 112]) expect(configuredAdmissionLimit(String(n), 12)).toBe(n);
  expect(configuredAdmissionLimit('999', 12)).toBe(112);
  for (const value of ['', '-1', '1.5', '12jobs', 'NaN', 'Infinity', '1e2']) {
    expect(configuredAdmissionLimit(value, 12)).toBe(0);
  }
});

test('twelve available slots eventually admit all 112 eligible identities', () => {
  const take = createFleetAdmissionRotation();
  const agents = Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1 }));
  const seen = new Set<number>();
  for (let cycle = 0; cycle < 10; cycle++) {
    const batch = take(agents, 12);
    expect(batch.length).toBe(12);
    batch.forEach(a => seen.add(a.agentNumber));
  }
  expect(seen.size).toBe(112);
});

test('rotation handles removed, resumed and occupied identities without exceeding capacity', () => {
  const take = createFleetAdmissionRotation();
  expect(take([{ agentNumber: 1 }, { agentNumber: 99 }], 1).map(a => a.agentNumber)).toEqual([1]);
  expect(take([{ agentNumber: 1 }, { agentNumber: 2 }, { agentNumber: 99 }], 1).map(a => a.agentNumber)).toEqual([2]);
  expect(take([{ agentNumber: 1 }, { agentNumber: 99 }], 1).map(a => a.agentNumber)).toEqual([99]);
  expect(take([{ agentNumber: 1 }], 0)).toEqual([]);
  expect(() => take([{ agentNumber: 1 }, { agentNumber: 1 }], 2)).toThrow('Ambiguous');
});
