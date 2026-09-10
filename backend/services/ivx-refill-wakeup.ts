/** Coalesce fleet-wide wakeups from independent lanes; the earliest deadline wins. */
export function createRefillWakeup<T>(deps: {
  now: () => number;
  schedule: (callback: () => void, delay: number) => T;
  cancel: (timer: T) => void;
  run: () => void;
}) {
  let pending: { timer: T; due: number; generation: number } | null = null;
  let generation = 0;
  return {
    request(delay: number) {
      const due = deps.now() + Math.max(0, delay);
      if (pending && pending.due <= due) return;
      if (pending) deps.cancel(pending.timer);
      const id = ++generation;
      const timer = deps.schedule(() => {
        if (pending?.generation !== id) return;
        pending = null;
        deps.run();
      }, Math.max(0, delay));
      pending = { timer, due, generation: id };
    },
    clear() {
      if (pending) deps.cancel(pending.timer);
      pending = null;
      generation++;
    },
  };
}
