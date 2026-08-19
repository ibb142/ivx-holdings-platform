/**
 * Screen paint watchdog — detects a route tree that renders NOTHING.
 *
 * The black screen this app suffered was not a crash. No exception was thrown,
 * so every error boundary, the global fatal shield and the crash log all stayed
 * silent: there was simply no screen resolved to render, and the user saw the
 * root view's dark background.
 *
 * Errors are loud and already handled. "Rendered nothing" is silent, and that is
 * the failure mode this module makes impossible to ship undetected: screens
 * report that they painted, and if nothing reports within a bounded window the
 * app shows a diagnostic with real recovery actions instead of a black frame.
 */

let lastPaintedScreen: string | null = null;
let lastPaintedAt: number | null = null;

/**
 * Called by a screen once it has actually rendered visible content.
 * Cheap and idempotent — safe to call on every mount.
 */
export function markScreenPainted(screen: string): void {
  lastPaintedScreen = screen;
  lastPaintedAt = Date.now();
}

/** Name of the most recent screen that reported a successful paint. */
export function getLastPaintedScreen(): string | null {
  return lastPaintedScreen;
}

/** Timestamp (ms) of the most recent successful paint, or null if none. */
export function getLastPaintedAt(): number | null {
  return lastPaintedAt;
}

/** True when no screen has ever reported painting content. */
export function hasNeverPainted(): boolean {
  return lastPaintedAt === null;
}

/** Milliseconds since the last successful paint, or null if none. */
export function msSinceLastPaint(): number | null {
  if (lastPaintedAt === null) return null;
  return Date.now() - lastPaintedAt;
}

/** Test-only reset. */
export function resetPaintTracking(): void {
  lastPaintedScreen = null;
  lastPaintedAt = null;
}
