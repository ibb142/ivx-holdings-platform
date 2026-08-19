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
 *
 * IMPORTANT — why paint is tracked PER ROUTE.
 *
 * The first version of this module exposed only `hasNeverPainted()`, a single
 * global flag. The login screen calls `markScreenPainted('login')`, so that flag
 * flipped false during sign-in and stayed false for the rest of the process
 * lifetime. Every navigation AFTER login was therefore structurally invisible to
 * the watchdog: the owner could sit on a blank Home screen indefinitely and no
 * recovery UI could ever appear, because "something painted once" was being used
 * to mean "the current screen is fine".
 *
 * Paint is now recorded per route path and compared against the moment that
 * route was entered, so a blank screen is detected on EVERY navigation, not only
 * on cold launch.
 */

let lastPaintedScreen: string | null = null;
let lastPaintedAt: number | null = null;

/** Most recent paint timestamp for each route that has reported one. */
const paintedRoutes = new Map<string, number>();

/**
 * Routes that are instrumented with `markScreenPainted`.
 *
 * The watchdog only arms for these paths. A screen that never reports a paint
 * must never be accused of being blank — a false "Screen failed to load" overlay
 * on a working screen would be a worse defect than the one being guarded against.
 */
const INSTRUMENTED_ROUTES = new Set<string>(['/', '/home', '/login']);

/** Normalise a pathname so `/home` and `/home/` compare equal. */
function normalizeRoute(route: string): string {
  if (!route) return '/';
  const trimmed = route.trim();
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

/**
 * Called by a screen once it has actually rendered visible content.
 * Cheap and idempotent — safe to call on every mount.
 */
export function markScreenPainted(screen: string): void {
  const now = Date.now();
  lastPaintedScreen = screen;
  lastPaintedAt = now;
  paintedRoutes.set(normalizeRoute(screen), now);
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

/** True when the watchdog is allowed to judge this route. */
export function isRouteInstrumented(route: string): boolean {
  return INSTRUMENTED_ROUTES.has(normalizeRoute(route));
}

/** Timestamp of the last paint reported by a specific route, or null. */
export function getRoutePaintedAt(route: string): number | null {
  return paintedRoutes.get(normalizeRoute(route)) ?? null;
}

/**
 * True when an instrumented route was entered and never reported a paint.
 *
 * This is the check that makes a blank screen detectable after login, not just
 * on cold launch: it asks "did THIS route paint since we navigated to it",
 * never "has anything ever painted".
 */
export function hasRouteFailedToPaint(route: string, enteredAt: number): boolean {
  if (!isRouteInstrumented(route)) return false;
  const paintedAt = getRoutePaintedAt(route);
  if (paintedAt === null) return true;
  return paintedAt < enteredAt;
}

/** Test-only reset. */
export function resetPaintTracking(): void {
  lastPaintedScreen = null;
  lastPaintedAt = null;
  paintedRoutes.clear();
}
