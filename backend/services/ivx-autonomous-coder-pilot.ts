/**
 * IVX Autonomous Coder — PILOT SENTINEL.
 *
 * A single visible label that the first controlled pilot test targets. The
 * autonomous coder is asked to change this from AUTONOMOUS-CODER-PILOT-1 to
 * AUTONOMOUS-CODER-PILOT-2. Because this file exists in the repository, the
 * coder's inspection phase can locate it via a real grep, generate a real
 * replace_exact patch, apply it, run targeted tests, typecheck, and commit —
 * proving the full loop end-to-end.
 *
 * This is intentionally a tiny, side-effect-free module so the pilot is safe.
 */
// IVX autonomous coder pilot sentinel
// IVX convergence proof 2026-07-21
// IVX convergence proof 2026-07-21
// IVX convergence proof 2026-07-21
// IVX convergence proof 2026-07-21
// IVX convergence proof 2026-07-21
// IVX convergence proof 2026-07-21
// IVX convergence proof 2026-07-21 final
export const PILOT_LABEL = 'AUTONOMOUS-CODER-PILOT-3';
export const PILOT_LABEL_TARGET = 'AUTONOMOUS-CODER-PILOT-2';

export type PilotSentinel = {
  label: typeof PILOT_LABEL;
  target: typeof PILOT_LABEL_TARGET;
  file: string;
};

export function describePilotSentinel(): PilotSentinel {
  return {
    label: PILOT_LABEL,
    target: PILOT_LABEL_TARGET,
    file: 'backend/services/ivx-autonomous-coder-pilot.ts',
  };
}
