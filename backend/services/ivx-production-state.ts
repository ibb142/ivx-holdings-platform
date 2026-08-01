/**
 * IVX Production State — In-process shared state for live context injection.
 *
 * Owner mandate 2026-07-30: The live context injector was making HTTP calls
 * to localhost which fail on Render. This module holds the production state
 * in-process so the context injector can read it without HTTP fetches.
 *
 * hono.ts calls setProductionState() on boot with the live values.
 * The context injector calls getProductionState() to read them.
 */

export type ProductionState = {
  commit: string;
  bootTime: string;
  environment: string;
  serviceName: string;
  status: string;
  schedulerRunning: boolean;
  processStartedAt: string;
  healthMarkers: Record<string, string>;
};

let currentState: ProductionState | null = null;

/**
 * Set the production state. Called by hono.ts on boot and health check.
 */
export function setProductionState(state: Partial<ProductionState>): void {
  currentState = {
    commit: state.commit ?? currentState?.commit ?? 'unknown',
    bootTime: state.bootTime ?? currentState?.bootTime ?? new Date().toISOString(),
    environment: state.environment ?? currentState?.environment ?? 'production',
    serviceName: state.serviceName ?? currentState?.serviceName ?? 'ivx-holdings-platform',
    status: state.status ?? currentState?.status ?? 'healthy',
    schedulerRunning: state.schedulerRunning ?? currentState?.schedulerRunning ?? true,
    processStartedAt: state.processStartedAt ?? currentState?.processStartedAt ?? new Date().toISOString(),
    healthMarkers: state.healthMarkers ?? currentState?.healthMarkers ?? {},
  };
}

/**
 * Get the current production state. Returns null if not yet set.
 */
export function getProductionState(): ProductionState | null {
  return currentState;
}

/**
 * Check if production state has been initialized.
 */
export function isProductionStateSet(): boolean {
  return currentState !== null;
}
