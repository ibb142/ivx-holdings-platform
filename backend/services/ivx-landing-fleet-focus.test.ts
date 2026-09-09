import { describe, expect, it } from 'bun:test';
import {
  IVX_AUTONOMOUS_CONTINUITY_INVARIANT,
  landingFleetFocusEnabled,
} from './ivx-landing-fleet-focus';

describe('landing fleet focus continuity safety', () => {
  it('does not disable Autonomous for a normal Landing P0 priority mission', () => {
    expect(landingFleetFocusEnabled({ IVX_LANDING_P0_MISSION: 'true' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('requires a second explicit emergency exclusivity flag', () => {
    expect(landingFleetFocusEnabled({
      IVX_LANDING_P0_MISSION: 'true',
      IVX_LANDING_P0_EXCLUSIVE: 'true',
    } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('fails open for autonomous continuity when exclusivity is malformed', () => {
    expect(landingFleetFocusEnabled({
      IVX_LANDING_P0_MISSION: 'on',
      IVX_LANDING_P0_EXCLUSIVE: 'accidental',
    } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('stores the permanent operational lesson in code', () => {
    expect(IVX_AUTONOMOUS_CONTINUITY_INVARIANT).toContain('Heartbeat or busy state is not proof of work');
    expect(IVX_AUTONOMOUS_CONTINUITY_INVARIANT).toContain('dispatcher/queue continuity fault');
  });
});
