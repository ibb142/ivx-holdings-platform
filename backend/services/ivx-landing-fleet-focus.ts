/**
 * Owner priority switch for an exclusive Landing fleet mission.
 *
 * While enabled, the API keeps serving normal requests but starts only the
 * durable 112-lane Landing runtime. Unrelated autonomous schedulers stay
 * dormant so they cannot compete with fleet leases, heartbeats, or Supabase.
 */
export const IVX_LANDING_FLEET_FOCUS_MARKER = 'ivx-landing-fleet-focus-2026-09-07-v1';

export function landingFleetFocusEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.IVX_LANDING_P0_MISSION ?? '').trim().toLowerCase();
  return value === 'on' || value === 'true' || value === '1' || value === 'yes';
}
