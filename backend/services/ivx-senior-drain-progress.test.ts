import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./ivx-senior-developer-worker.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function drainSeniorDeveloperQueue()');
const end = source.indexOf('\n// ─', start);
const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end).replace('export async', 'async'));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// Run the actual production drain with controlled execution completions. A
// held CI wait must not prevent another owner's ready work from taking a slot.
function fixture(limit = 2) {
  const queue: string[] = [];
  const started: string[] = [];
  const waiting = new Map<string, (result: object | null) => void>();
  let active = 0, peak = 0, polls = 0, maintenance = 0;
  const drain = new Function('expireStaleJobs', 'getWorkerMaxConcurrency', 'processNextSeniorDeveloperJob', 'MAX_QUEUE_RETAINED',
    `let draining = false, queueStopping = false; const activeDrainExecutions = new Set();\n${body}\nreturn { run: drainSeniorDeveloperQueue, stop: () => { queueStopping = true; } };`)(
      async () => { maintenance++; }, () => limit,
      async () => {
        polls++;
        const id = queue.shift();
        if (!id) return null;
        started.push(id); active++; peak = Math.max(peak, active);
        try { return await new Promise<object | null>(resolve => waiting.set(id, resolve)); }
        finally { active--; waiting.delete(id); }
      }, 200);
  return { ...drain, queue, started, finish: (id: string) => waiting.get(id)?.({ jobId: id }),
    read: () => ({ active, peak, polls, maintenance }),
    close: async () => { drain.stop(); for (const resolve of waiting.values()) resolve(null); await tick(); },
  };
}

test('a completed slot admits the supervisor while another owner still waits for CI', async () => {
  const f = fixture();
  f.queue.push('landing-ci-wait', 'scheduler', 'supervisor');
  const run = f.run();
  try {
    await tick();
    expect(f.started).toEqual(['landing-ci-wait', 'scheduler']);
    f.finish('scheduler');
    await tick(); await tick();
    expect(f.started).toEqual(['landing-ci-wait', 'scheduler', 'supervisor']);
    expect(f.read().active).toBe(2);
    expect(f.read().peak).toBe(2);
  } finally { await f.close(); await run; }
});

test('a periodic kick can admit newly queued work before a long-running job finishes', async () => {
  const f = fixture();
  f.queue.push('landing-ci-wait');
  const run = f.run();
  try {
    await tick();
    f.queue.push('supervisor');
    void f.run();
    await tick();
    expect(f.started).toEqual(['landing-ci-wait', 'supervisor']);
    expect(f.read().peak).toBe(2);
  } finally { await f.close(); await run; }
});

test('overlapping kicks cannot exceed configured slots or admit work after a stop', async () => {
  const f = fixture();
  f.queue.push('landing', 'scheduler', 'supervisor');
  const kicks = Array.from({ length: 112 }, () => f.run());
  try {
    await tick();
    expect(f.started).toEqual(['landing', 'scheduler']);
    expect(f.read().peak).toBe(2);
    f.stop(); f.finish('scheduler');
    await tick(); await tick();
    expect(f.started).toEqual(['landing', 'scheduler']);
  } finally { await f.close(); await Promise.all(kicks); }
});

test('an empty queue stops polling until another external kick', async () => {
  const f = fixture(3);
  try {
    await f.run(); await tick();
    const before = f.read();
    await tick(); await tick();
    expect(f.read().polls).toBe(before.polls);
    expect(before.polls).toBeLessThanOrEqual(3);
    expect(f.read().maintenance).toBe(1);
  } finally { await f.close(); }
});
