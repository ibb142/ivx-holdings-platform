import { describe, expect, it } from 'vitest';
import {
  classifyContinuityResult,
  getContinuityMaxConcurrency,
  IVX_AUTONOMOUS_FLEET_SIZE,
  IVX_AUTONOMOUS_REFILL_INTERVAL_MS,
} from './ivx-autonomous-runtime-enforcer';

describe('IVX Autonomous 112 continuity invariants', () => {
  it('keeps the production fleet at exactly 112 lanes even when env drifts lower', () => {
    const previous = process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY;
    process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY = '12';
    try {
      expect(IVX_AUTONOMOUS_FLEET_SIZE).toBe(112);
      expect(getContinuityMaxConcurrency()).toBe(112);
    } finally {
      if (previous == null) delete process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY;
      else process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY = previous;
    }
  });

  it('has a dedicated fleet refill cadence no slower than five seconds', () => {
    expect(IVX_AUTONOMOUS_REFILL_INTERVAL_MS).toBeLessThanOrEqual(5_000);
  });

  it('returns a completed lane to refill and does not count external blocking as completion', () => {
    expect(classifyContinuityResult({ ok: true, action: 'TASK_COMPLETED', taskId: 'task-1', states: [] })).toBe('completed');
    expect(classifyContinuityResult({ ok: true, action: 'TASK_BLOCKED', taskId: 'task-2', states: ['BLOCKED'] })).toBe('blocked');
    expect(classifyContinuityResult({ ok: true, action: 'PATROL_SESSION_ENDED', taskId: 'task-3', states: ['QUEUED'] })).toBe('idle');
  });
});
