export const IVX_TASK_PREFLIGHT_GATE_MARKER = 'ivx-task-preflight-gate-v1-2026-08-30';

export type TaskPreflightState = {
  marker: typeof IVX_TASK_PREFLIGHT_GATE_MARKER;
  checkedAt: string;
  open: boolean;
  mainSha: string | null;
  productionSha: string | null;
  productionHealthy: boolean;
  queueHealthy: boolean;
  supervisorHealthy: boolean;
  reasons: string[];
};

let state: TaskPreflightState = {
  marker: IVX_TASK_PREFLIGHT_GATE_MARKER,
  checkedAt: new Date(0).toISOString(),
  open: false,
  mainSha: null,
  productionSha: null,
  productionHealthy: false,
  queueHealthy: false,
  supervisorHealthy: false,
  reasons: ['preflight_not_initialized'],
};

export function updateTaskPreflightGate(next: Omit<TaskPreflightState, 'marker' | 'checkedAt' | 'open' | 'reasons'> & { reasons?: string[] }): TaskPreflightState {
  const reasons = [...(next.reasons || [])];
  if (!next.mainSha) reasons.push('main_sha_unknown');
  if (!next.productionSha) reasons.push('production_sha_unknown');
  if (next.mainSha && next.productionSha && next.mainSha !== next.productionSha) reasons.push('production_not_on_main_sha');
  if (!next.productionHealthy) reasons.push('production_unhealthy');
  if (!next.queueHealthy) reasons.push('github_queue_unhealthy');
  if (!next.supervisorHealthy) reasons.push('autonomous_supervisor_unhealthy');
  state = { marker: IVX_TASK_PREFLIGHT_GATE_MARKER, checkedAt: new Date().toISOString(), open: reasons.length === 0, mainSha: next.mainSha, productionSha: next.productionSha, productionHealthy: next.productionHealthy, queueHealthy: next.queueHealthy, supervisorHealthy: next.supervisorHealthy, reasons: [...new Set(reasons)] };
  return state;
}

export function getTaskPreflightGate(): TaskPreflightState { return state; }
export function requireTaskPreflightGate(taskName = 'autonomous_task'): { ok: true; state: TaskPreflightState } | { ok: false; state: TaskPreflightState; error: string } {
  if (state.open) return { ok: true, state };
  return { ok: false, state, error: `${taskName} blocked by IVX P0 preflight: ${state.reasons.join(', ') || 'unknown'}` };
}
