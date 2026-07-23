/**
 * Auth rate limiter — counts only real invalid credential responses.
 * Network failures, HTTP 5xx, and timeouts do NOT count against the user.
 * Lockout is 15 minutes (matches the login screen UX message).
 * Successful login clears all attempts immediately.
 */
const AUTH_ATTEMPTS: Map<string, { count: number; firstAttempt: number; lockedUntil: number }> = new Map();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes (was 60s — fixed to match UX)

export function checkAuthRateLimit(identifier: string): { allowed: boolean; remainingAttempts: number; lockedUntilMs: number } {
  const now = Date.now();
  const entry = AUTH_ATTEMPTS.get(identifier);

  if (!entry) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, lockedUntilMs: 0 };
  }

  if (entry.lockedUntil > now) {
    const remainingSec = Math.ceil((entry.lockedUntil - now) / 1000);
    console.log(`[RateLimit] ${identifier} locked for ${remainingSec} more seconds`);
    return { allowed: false, remainingAttempts: 0, lockedUntilMs: entry.lockedUntil };
  }

  if (now - entry.firstAttempt > WINDOW_MS) {
    AUTH_ATTEMPTS.delete(identifier);
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, lockedUntilMs: 0 };
  }

  const remaining = MAX_ATTEMPTS - entry.count;
  return { allowed: remaining > 0, remainingAttempts: Math.max(0, remaining), lockedUntilMs: entry.lockedUntil };
}

/**
 * Record an auth attempt. Only real invalid credential responses (HTTP 401)
 * should call this with success=false. Network failures, timeouts, and HTTP 5xx
 * should NOT call this at all — they are not credential failures.
 */
export function recordAuthAttempt(identifier: string, success: boolean) {
  if (success) {
    AUTH_ATTEMPTS.delete(identifier);
    console.log(`[RateLimit] ${identifier} cleared on success`);
    return;
  }

  const now = Date.now();
  const entry = AUTH_ATTEMPTS.get(identifier);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    AUTH_ATTEMPTS.set(identifier, { count: 1, firstAttempt: now, lockedUntil: 0 });
    console.log(`[RateLimit] ${identifier} attempt 1/${MAX_ATTEMPTS}`);
    return;
  }

  entry.count++;
  console.log(`[RateLimit] ${identifier} attempt ${entry.count}/${MAX_ATTEMPTS}`);

  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
    const lockoutMin = LOCKOUT_MS / 60000;
    console.log(`[RateLimit] ${identifier} LOCKED for ${lockoutMin} minutes`);
  }

  AUTH_ATTEMPTS.set(identifier, entry);
}

/**
 * Record a non-credential failure (network error, timeout, HTTP 5xx).
 * This does NOT count against the user's attempt limit.
 */
export function recordAuthNetworkFailure(identifier: string) {
  console.log(`[RateLimit] ${identifier} network failure — NOT counted against attempt limit`);
}

export function clearAuthAttempts(identifier: string): boolean {
  const existed = AUTH_ATTEMPTS.has(identifier);
  AUTH_ATTEMPTS.delete(identifier);
  if (existed) {
    console.log(`[RateLimit] ${identifier} cooldown cleared manually`);
  }
  return existed;
}

export function getRateLimitMessage(lockedUntilMs: number): string {
  const remainingSec = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 1000));
  if (remainingSec >= 60) {
    const minutes = Math.ceil(remainingSec / 60);
    return `Too many failed attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  return `Too many failed attempts. Please try again in ${remainingSec} second${remainingSec === 1 ? '' : 's'}.`;
}
