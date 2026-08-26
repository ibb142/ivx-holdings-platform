import { describe, expect, it } from 'bun:test';
import {
  autonomousAgentNumber,
  autonomousAttribution,
  isIVXAutonomousJob,
} from '../src/modules/ivx-autonomous/autonomousJobAttribution';

describe('IVX autonomous dashboard attribution contract', () => {
  it('recognizes the legacy campaign-agent owner id', () => {
    const job = { ownerId: 'campaign-agent-12' };
    expect(autonomousAgentNumber(job)).toBe(12);
    expect(autonomousAttribution(job)).toBe('IVX AUTONOMOUS');
    expect(isIVXAutonomousJob(job)).toBe(true);
  });

  it('recognizes the real completion-campaign owner id used by the 112 campaign', () => {
    const job = { ownerId: 'completion-campaign:agent:112' };
    expect(autonomousAgentNumber(job)).toBe(112);
    expect(autonomousAttribution(job)).toBe('IVX AUTONOMOUS');
    expect(isIVXAutonomousJob(job)).toBe(true);
  });

  it('reads owner id from persisted input for historical jobs', () => {
    expect(autonomousAgentNumber({ input: { ownerId: 'completion-campaign:agent:7' } })).toBe(7);
  });

  it('does not misclassify owner or internal worker jobs', () => {
    expect(autonomousAttribution({ ownerId: 'worker:render-1' })).toBe('INTERNAL WORKER');
    expect(autonomousAttribution({ ownerId: 'owner-user-id' })).toBe('OWNER / EXTERNAL');
    expect(autonomousAgentNumber({ ownerId: 'completion-campaign:agent:113' })).toBeNull();
  });
});
