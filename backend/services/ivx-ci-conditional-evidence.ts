type Run = { name: string; status: string; conclusion: string | null };
export const MOBILE_CHECK = 'Maestro E2E (mobile surface) — HARD GATE';
/** ivx-e2e.yml skips mobile only when its classifier says this PR has no
 * mobile impact. Both dependencies must succeed; missing/failed dependencies
 * cannot authorize a skip. Keep the original skipped conclusion as evidence.
 */
export function verifiedMobileSkip(runs: readonly Run[]): boolean {
  const passed = (name: string) => { const r = runs.find(row => row.name === name); return r?.status === 'completed' && r.conclusion === 'success'; };
  const mobile = runs.find(r => r.name === MOBILE_CHECK);
  return mobile?.status === 'completed' && mobile.conclusion === 'skipped'
    && passed('Mobile impact classifier')
    && passed('TypeScript typecheck — HARD GATE');
}
