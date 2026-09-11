import { expect, test } from 'bun:test';
import { isTaskWithinMissionScope } from './ivx-autonomous-task-engine';

const sha = 'a'.repeat(40);
const oldSha = 'b'.repeat(40);
const families = ['landing-p0:', 'landing-p0-repair:', 'landing-p0-patrol:'];
const scope = { familyPrefixes: families, activePrefixes: families.map(p => `${p}${sha}:`), inspectionSourceSha: sha };

test('obsolete queued inspections cannot enter a newer mission through the non-Landing fallback', () => {
  for (const family of ['module-audit:', 'autonomous-secondary:']) {
    expect(isTaskWithinMissionScope({ idempotencyKey: `${family}${oldSha}:file` }, scope)).toBe(false);
  }
});

test('current inspections and independent repairs remain eligible', () => {
  for (const key of [`module-audit:${sha}:file`, `autonomous-secondary:${sha}:file`, `repair:${oldSha}:defect`]) {
    expect(isTaskWithinMissionScope({ idempotencyKey: key }, scope)).toBe(true);
  }
});

test('inspection scope does not reopen old Landing or disabled patrol work', () => {
  expect(isTaskWithinMissionScope({ idempotencyKey: `landing-p0:${oldSha}:unit` }, scope)).toBe(false);
  expect(isTaskWithinMissionScope({ idempotencyKey: `landing-p0:${sha}:unit` }, scope)).toBe(true);
  expect(isTaskWithinMissionScope({ idempotencyKey: `landing-p0:${sha}:unit` }, { ...scope, activePrefixes: [] })).toBe(false);
});

test('invalid full revision excludes inspections while independent owner work can continue', () => {
  expect(isTaskWithinMissionScope({ idempotencyKey: `module-audit:${sha}:file` }, { ...scope, inspectionSourceSha: sha.slice(0, 7) })).toBe(false);
  expect(isTaskWithinMissionScope({ idempotencyKey: 'owner-repair:urgent' }, { ...scope, inspectionSourceSha: 'unknown' })).toBe(true);
});
