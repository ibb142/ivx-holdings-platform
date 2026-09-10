import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

/** Supabase notifies listeners while holding its session lock. */
export function createDeferredAuthListener(
  handle: (event: AuthChangeEvent, session: Session | null, isCurrent: () => boolean) => void | Promise<void>,
  onError: (error: unknown) => void,
) {
  let disposed = false;
  let revision = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  return {
    listener(event: AuthChangeEvent, session: Session | null): void {
      if (disposed) return;
      const current = ++revision;
      const isCurrent = () => !disposed && current === revision;
      // A macrotask lets the SDK release its lock before MFA/profile/API reads.
      // Do not return the work promise to onAuthStateChange.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!isCurrent()) return;
        void Promise.resolve().then(() => handle(event, session, isCurrent)).catch(error => {
          if (isCurrent()) onError(error);
        });
      }, 0);
      timers.add(timer);
    },
    dispose(): void {
      disposed = true;
      revision += 1;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
