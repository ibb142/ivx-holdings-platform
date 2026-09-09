/**
 * Owner priority switch for an exclusive Landing fleet mission.
 *
 * IMPORTANT CONTINUITY INVARIANT (2026-09-08):
 * `IVX_LANDING_P0_MISSION` means "prioritize Landing", NOT "stop Autonomous".
 * The 112-agent continuity runtime, QA scheduler, and worker execution plane must
 * keep running unless the owner explicitly enables the separate emergency-only
 * exclusivity flag `IVX_LANDING_P0_EXCLUSIVE`.
 *
 * This prevents the production failure where all 112 agents kept emitting fresh
 * heartbeats and many remained marked `busy`, while no new real executions were
 * being started. Heartbeat/liveness must never be treated as proof of productive
 * execution.
 */
export const IVX_LANDING_FLEET_FOCUS_MARKER = 'ivx-landing-fleet-focus-2026-09-08-v2-continuity-safe';

export const IVX_AUTONOMOUS_CONTINUITY_INVARIANT = [
  'Landing priority must never silently disable the 112-agent autonomous execution plane.',
  'Heartbeat or busy state is not proof of work; real execution requires a current leased task and execution evidence.',
  'If heartbeats continue but executions stop, treat it as a dispatcher/queue continuity fault and keep or restart the autonomous schedulers.',
  'Exclusive fleet mode is emergency-only and requires IVX_LANDING_P0_EXCLUSIVE=true in addition to IVX_LANDING_P0_MISSION=true.',
].join(' ');

function enabled(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'on' || normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * Returns true only for an explicitly requested EXCLUSIVE landing mission.
 * A normal Landing P0 mission no longer shuts down unrelated autonomous
 * schedulers. This is intentionally fail-open for continuity: missing or
 * malformed exclusivity configuration keeps Autonomous running.
 */
export function landingFleetFocusEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabled(env.IVX_LANDING_P0_MISSION) && enabled(env.IVX_LANDING_P0_EXCLUSIVE);
}
