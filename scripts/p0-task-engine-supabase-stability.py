from pathlib import Path

# Validation trigger: rerun the deterministic P0 patch after global TypeScript blockers were repaired.

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f'{label} anchor not found')
    return text.replace(old, new, 1)


task = Path('backend/services/ivx-autonomous-task-engine.ts')
s = task.read_text()

anchor = "let taskMutationTail: Promise<void> = Promise.resolve();\n"
insert = """let taskMutationTail: Promise<void> = Promise.resolve();

// P0 2026-09-05: collapse concurrent truth/dispatcher reads onto a short-lived
// process-local snapshot. Writes refresh the cache only after durable persistence
// succeeds. Supabase failures remain fail-closed; we never manufacture an empty queue.
const TASK_READ_CACHE_TTL_MS = 1_500;
let taskReadCache: { value: Task[]; at: number } | null = null;
"""
if 'TASK_READ_CACHE_TTL_MS' not in s:
    s = replace_once(s, anchor, insert, 'task cache')

old_read = """async function readAllTasks(): Promise<Task[]> {
  if (isDurableStoreConfigured()) {
    try {
      const data = await readDurableJson<Task[]>(TASKS_KEY, []);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
"""
new_read = """async function readAllTasks(): Promise<Task[]> {
  if (isDurableStoreConfigured()) {
    const now = Date.now();
    if (taskReadCache && now - taskReadCache.at <= TASK_READ_CACHE_TTL_MS) {
      return taskReadCache.value;
    }
    const data = await readDurableJson<Task[]>(TASKS_KEY, []);
    if (!Array.isArray(data)) {
      throw new Error('task_engine_durable_payload_not_array');
    }
    taskReadCache = { value: data, at: Date.now() };
    return data;
  }
"""
if old_read in s:
    s = s.replace(old_read, new_read, 1)
elif 'task_engine_durable_payload_not_array' not in s:
    raise SystemExit('readAllTasks fail-open block not found')

old_write = """  if (isDurableStoreConfigured()) {
    await writeDurableJson(TASKS_KEY, tasks);
    return;
  }
"""
new_write = """  if (isDurableStoreConfigured()) {
    await writeDurableJson(TASKS_KEY, tasks);
    taskReadCache = { value: tasks, at: Date.now() };
    return;
  }
"""
if old_write in s:
    s = s.replace(old_write, new_write, 1)
elif 'taskReadCache = { value: tasks' not in s:
    raise SystemExit('writeAllTasks durable block not found')

task.write_text(s)

truth = Path('backend/services/ivx-autonomous-truth-control.ts')
t = truth.read_text()
t = t.replace('ivx-autonomous-truth-control-2026-09-05-v11-owner-24x7', 'ivx-autonomous-truth-control-2026-09-05-v12-supabase-stability')
t = t.replace('export const IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS = 2_500;', 'export const IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS = 12_000;')
if 'IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS = 12_000' not in t:
    raise SystemExit('truth timeout replacement failed')
truth.write_text(t)

# Static invariants: fail closed, bounded cache, aligned timeout.
check = task.read_text()
fail_open = "const data = await readDurableJson<Task[]>(TASKS_KEY, []);\n      return Array.isArray(data) ? data : [];\n    } catch {\n      return [];"
if fail_open in check:
    raise SystemExit('FAIL: task engine still converts Supabase failure to []')
assert 'task_engine_durable_payload_not_array' in check
assert 'TASK_READ_CACHE_TTL_MS = 1_500' in check
assert 'taskReadCache = { value: tasks, at: Date.now() }' in check
assert 'IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS = 12_000' in truth.read_text()
print('P0_TASK_ENGINE_STABILITY_PATCH_APPLIED')