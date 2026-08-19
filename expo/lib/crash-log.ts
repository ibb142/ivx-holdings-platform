/**
 * Persistent crash log.
 *
 * The Android black screen destroyed its own evidence: when the JS context is
 * torn down, every in-memory log dies with it and nothing is ever reported.
 * This module writes the last fatal error to device storage the moment it
 * happens, so the NEXT launch can display exactly what went wrong.
 *
 * This is what makes the failure diagnosable without a debugger attached.
 */

export interface CrashRecord {
  message: string;
  stack: string | null;
  isFatal: boolean;
  build: string;
  at: string;
}

const CRASH_KEY = 'ivx_last_fatal_crash';

/** Lazily loaded so the root layout keeps a minimal synchronous import surface. */
async function storage(): Promise<{
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
  removeItem: (k: string) => Promise<void>;
} | null> {
  try {
    const mod = await import('@react-native-async-storage/async-storage');
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * Persist a fatal error. Fire-and-forget and never throws — it runs from an
 * error handler, where a second failure must not cascade.
 */
export function recordCrash(input: {
  message: string;
  stack: string | null;
  isFatal: boolean;
  build: string;
}): void {
  const record: CrashRecord = {
    message: input.message.slice(0, 2000),
    stack: input.stack ? input.stack.slice(0, 4000) : null,
    isFatal: input.isFatal,
    build: input.build,
    at: new Date().toISOString(),
  };
  void (async () => {
    try {
      const store = await storage();
      await store?.setItem(CRASH_KEY, JSON.stringify(record));
    } catch {
      // storage failure must never escalate
    }
  })();
}

/** Read the crash recorded by a previous launch, if any. */
export async function readLastCrash(): Promise<CrashRecord | null> {
  try {
    const store = await storage();
    const raw = await store?.getItem(CRASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CrashRecord;
    return typeof parsed?.message === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Clear the stored crash once the owner has seen it. */
export async function clearLastCrash(): Promise<void> {
  try {
    const store = await storage();
    await store?.removeItem(CRASH_KEY);
  } catch {
    // ignore
  }
}
