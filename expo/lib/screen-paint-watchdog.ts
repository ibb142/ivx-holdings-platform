/**
 * Screen paint watchdog — detects a route tree that renders NOTHING.
 *
 * The black screen this app suffered was not a crash. No exception was thrown,
 * so every error boundary, the global fatal shield and the crash log all stayed
 * silent: there was simply no screen resolved to render, and the user saw the
 * root view's dark background.
 *
 * Errors are loud and already handled. "Rendered nothing" is silent, and that is
 * the failure mode this module makes impossible to ship undetected.
 *
 * IMPORTANT — paint is LIVENESS, not a timestamp.
 *
 * v1.10.23 tracked paint per route as a timestamp and asked
 * `paintedAt < enteredAt` — "did this route paint since we navigated to it".
 * That question is unanswerable in a tab navigator, and it produced a
 * DETERMINISTIC FALSE POSITIVE that covered a working Home screen:
 *
 *   1. Expo Router keeps tab screens MOUNTED. `app/(tabs)/home.tsx` reports its
 *      paint from a `useEffect(..., [])`, so it fires exactly ONCE per mount.
 *   2. The watchdog re-armed `enteredAt = Date.now()` on EVERY pathname change.
 *   3. Returning to an already-mounted Home therefore compared an old paint
 *      against a new entry stamp — `paintedAt < enteredAt` — and concluded the
 *      screen was blank while it was fully rendered and visible.
 *
 * The device recording proved it: the overlay printed `Route: /home` and
 * `Last painted: /home` on the same screen — the app accusing a route it
 * simultaneously reported as the last thing that painted.
 *
 * React effect ordering makes this worse: child effects run BEFORE parent
 * effects, so a screen's paint stamp is ALWAYS <= the watchdog's entry stamp.
 * The comparison could only ever produce false accusations.
 *
 * Paint is now a liveness record: a screen registers when it paints and
 * deregisters when it unmounts. A route is judged blank only when it holds NO
 * live paint record at all. A mounted, painted screen is never accused, and a
 * re-entry that renders nothing has no record (the previous visit cleared it on
 * unmount) so it is still caught.
 */

let lastPaintedScreen: string | null = null;
let lastPaintedAt: number | null = null;

/**
 * Live paint records, keyed by normalised route.
 *
 * An entry exists for exactly as long as that screen is mounted. Presence means
 * "this route currently has a screen that rendered content".
 */
const paintedRoutes = new Map<string, number>();

/**
 * Routes that are instrumented with `markScreenPainted`.
 *
 * The watchdog only arms for these paths. A screen that never reports a paint
 * must never be accused of being blank — a false "Screen failed to load"
 * overlay on a working screen is a worse defect than the one being guarded
 * against, and is exactly what shipped in v1.10.23.
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

/**
 * Called from the screen's effect cleanup when it unmounts.
 *
 * This is what keeps liveness honest: without it a route that painted once
 * would look alive forever, and a genuinely blank re-entry would be masked.
 */
export function markScreenUnmounted(screen: string): void {
  paintedRoutes.delete(normalizeRoute(screen));
}

/** True when this route currently has a mounted screen that painted content. */
export function isRoutePainted(route: string): boolean {
  return paintedRoutes.has(normalizeRoute(route));
}

/** Name of the most recent screen that reported a successful paint. */
export function getLastPaintedScreen(): string | null {
  return lastPaintedScreen;
}

/** Timestamp (ms) of the most recent successful paint, or null if none. */
export function getLastPaintedAt(): number | null {
  return lastPaintedAt;
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

/** Timestamp of the live paint held by a route, or null when it holds none. */
export function getRoutePaintedAt(route: string): number | null {
  return paintedRoutes.get(normalizeRoute(route)) ?? null;
}

/**
 * True when an instrumented route is showing no painted screen.
 *
 * Deliberately NOT time-based. A live paint record means a screen is mounted
 * and has rendered content, which is conclusive regardless of when it happened
 * — comparing paint age against entry age is what falsely accused a working
 * Home screen in v1.10.23.
 */
export function hasRouteFailedToPaint(route: string): boolean {
  if (!isRouteInstrumented(route)) return false;
  return !isRoutePainted(route);
}

/** Test-only reset. */
export function resetPaintTracking(): void {
  lastPaintedScreen = null;
  lastPaintedAt = null;
  paintedRoutes.clear();
}
