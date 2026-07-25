/**
 * IVX 12-IA ORCHESTRATOR — owner-only API over the persistent 12-IA operating
 * model (owner mandate 2026-07-18: "ACTIVATE IVX 12-IA OPERATING MODEL").
 *
 * Persistent state lives in Supabase (survives Render/worker restarts):
 *   - public.ivx_ia_agents          IA-01…IA-12 roster (mission, permissions, KPIs)
 *   - public.ivx_ia_tasks           persistent task queue, one permanent owner per task
 *   - public.ivx_ia_file_locks      critical-file locks (prevents concurrent edits)
 *   - public.ivx_ia_factory_agents  AI-Factory templates + created agents (IA-02/IA-03)
 *
 * Routes (registered in backend/hono-extended.ts):
 *   GET  /api/ivx/autonomous/ia          — roster + queue + factory + locks + acquisition counts
 *   POST /api/ivx/autonomous/ia/task     — create/update a task (owner bearer)
 *   POST /api/ivx/autonomous/ia/lock     — acquire/release a critical-file lock (owner bearer)
 *
 * HONESTY RULES: no fake leads, no fabricated activity; every count comes from
 * live Supabase rows; agents report ACTIVE only with execution logs behind them.
 *
 * Marker: ivx-ia-orchestrator-2026-07-18
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const IVX_IA_ORCHESTRATOR_MARKER = 'ivx-ia-orchestrator-2026-07-18';

const TIMEOUT_MS = 12_000;
const TASK_STATUSES = ['QUEUED', 'RUNNING', 'BLOCKED', 'OWNER_ACTION_REQUIRED', 'DONE', 'VERIFIED'] as const;
type IATaskStatus = (typeof TASK_STATUSES)[number];

type IAAgentRow = {
  agent_id: string;
  name: string;
  mission: string;
  permissions: unknown;
  kpis: unknown;
  status: string;
  updated_at: string;
};

type IATaskRow = {
  task_id: string;
  agent_id: string;
  title: string;
  detail: string | null;
  priority: string;
  status: IATaskStatus;
  evidence: string | null;
  blocker: string | null;
  updated_at: string;
};

type IAFactoryRow = {
  factory_agent_id: string;
  kind: string;
  name: string;
  version: number;
  qa_status: string;
  activation_status: string;
  created_by: string;
};

type IALockRow = {
  file_path: string;
  agent_id: string;
  task_id: string | null;
  acquired_at: string;
  expires_at: string;
};

function supabaseUrl(): string {
  for (const name of ['IVX_SUPABASE_URL', 'SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL']) {
    const value = (process.env[name] ?? '').trim();
    if (value.startsWith('https://')) return value.replace(/\/$/, '');
  }
  return '';
}

function serviceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
}

async function restCall(
  path: string,
  init: RequestInit & { preferCount?: boolean } = {},
): Promise<{ status: number | null; body: string; contentRange: string | null }> {
  const base = supabaseUrl();
  const key = serviceRoleKey();
  if (!base || !key) return { status: null, body: 'supabase service credentials missing in runtime', contentRange: null };
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: init.preferCount ? 'count=exact' : 'return=representation',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      status: response.status,
      body: (await response.text()).slice(0, 60_000),
      contentRange: response.headers.get('content-range'),
    };
  } catch (error: unknown) {
    return { status: null, body: error instanceof Error ? error.message.slice(0, 200) : 'fetch failed', contentRange: null };
  }
}

function parseRows<T>(body: string): T[] {
  try {
    const parsed = JSON.parse(body) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Exact row count via PostgREST content-range header (no row transfer). */
async function countRows(pathWithFilters: string): Promise<number | null> {
  const result = await restCall(`${pathWithFilters}${pathWithFilters.includes('?') ? '&' : '?'}select=id&limit=1`, {
    method: 'GET',
    preferCount: true,
  });
  const range = result.contentRange ?? '';
  const total = range.includes('/') ? Number(range.split('/')[1]) : NaN;
  return Number.isFinite(total) ? total : null;
}

/** Live acquisition/CRM counts from real production rows — never fabricated. */
export async function getAcquisitionCounts(): Promise<Record<string, number | null>> {
  const [investorsTotal, investorsWithEmail, tokenizedProspects, buyers, deals] = await Promise.all([
    countRows('/rest/v1/investors?deleted_at=is.null'),
    countRows('/rest/v1/investors?deleted_at=is.null&email=not.is.null'),
    countRows('/rest/v1/investors?deleted_at=is.null&investment_tier=ilike.*token*'),
    countRows('/rest/v1/buyers'),
    countRows('/rest/v1/jv_deals'),
  ]);
  return { investorsTotal, investorsWithEmail, tokenizedProspects, buyers, deals };
}

/** One-line 12-IA summary for the 2-hour consolidated owner-chat report. */
export async function getIAOperatingSummary(): Promise<string[]> {
  try {
    const [agentsRes, tasksRes, factoryRes] = await Promise.all([
      restCall('/rest/v1/ivx_ia_agents?select=agent_id,status', { method: 'GET' }),
      restCall('/rest/v1/ivx_ia_tasks?select=task_id,status,priority,blocker', { method: 'GET' }),
      restCall('/rest/v1/ivx_ia_factory_agents?select=factory_agent_id,kind,activation_status', { method: 'GET' }),
    ]);
    const agents = parseRows<{ agent_id: string; status: string }>(agentsRes.body);
    const tasks = parseRows<{ task_id: string; status: IATaskStatus; priority: string; blocker: string | null }>(tasksRes.body);
    const factory = parseRows<{ factory_agent_id: string; kind: string; activation_status: string }>(factoryRes.body);
    const active = agents.filter((a) => a.status === 'ACTIVE').length;
    const byStatus = (s: IATaskStatus) => tasks.filter((t) => t.status === s).length;
    const blocked = tasks.filter((t) => t.blocker);
    const pendingAgents = factory.filter((f) => f.kind === 'AGENT' && f.activation_status === 'PENDING_OWNER_APPROVAL').length;
    const counts = await getAcquisitionCounts();
    const lines = [
      `12-IA model: ${active}/${agents.length} agents active — tasks ${tasks.length} (running ${byStatus('RUNNING')}, queued ${byStatus('QUEUED')}, done ${byStatus('DONE') + byStatus('VERIFIED')}, blocked ${byStatus('BLOCKED')})`,
      `AI Factory: ${factory.filter((f) => f.kind === 'TEMPLATE').length} template(s), ${factory.filter((f) => f.kind === 'AGENT').length} agent(s), ${pendingAgents} pending owner approval`,
      `Pipelines (real rows): investors ${counts.investorsTotal ?? 'n/a'} (with email ${counts.investorsWithEmail ?? 'n/a'}), tokenized ${counts.tokenizedProspects ?? 'n/a'}, buyers ${counts.buyers ?? 'n/a'}, deals ${counts.deals ?? 'n/a'}`,
    ];
    if (blocked.length > 0) {
      lines.push(`IA blockers: ${blocked.map((t) => t.task_id).join(', ')}`);
    }
    return lines;
  } catch (error: unknown) {
    return [`12-IA summary unavailable this run: ${error instanceof Error ? error.message.slice(0, 120) : 'error'}`];
  }
}

export function iaOrchestratorOptions(): Response {
  return ownerOnlyOptions();
}

/** GET /api/ivx/autonomous/ia — full 12-IA operating state (owner-only). */
export async function handleIAStatusGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401);
  }
  try {
    const [agentsRes, tasksRes, factoryRes, locksRes] = await Promise.all([
      restCall('/rest/v1/ivx_ia_agents?select=agent_id,name,mission,permissions,kpis,status,updated_at&order=agent_id.asc', { method: 'GET' }),
      restCall('/rest/v1/ivx_ia_tasks?select=task_id,agent_id,title,detail,priority,status,evidence,blocker,updated_at&order=task_id.asc', { method: 'GET' }),
      restCall('/rest/v1/ivx_ia_factory_agents?select=factory_agent_id,kind,name,version,qa_status,activation_status,created_by&order=factory_agent_id.asc', { method: 'GET' }),
      restCall('/rest/v1/ivx_ia_file_locks?select=file_path,agent_id,task_id,acquired_at,expires_at', { method: 'GET' }),
    ]);
    const agents = parseRows<IAAgentRow>(agentsRes.body);
    const tasks = parseRows<IATaskRow>(tasksRes.body);
    const factory = parseRows<IAFactoryRow>(factoryRes.body);
    const locks = parseRows<IALockRow>(locksRes.body).filter((lock) => new Date(lock.expires_at).getTime() > Date.now());
    const acquisition = await getAcquisitionCounts();

    const roster = agents.map((agent) => ({
      ...agent,
      tasks: tasks.filter((task) => task.agent_id === agent.agent_id).map((task) => task.task_id),
      running: tasks.filter((task) => task.agent_id === agent.agent_id && task.status === 'RUNNING').length,
    }));

    return ownerOnlyJson({
      ok: true,
      marker: IVX_IA_ORCHESTRATOR_MARKER,
      generatedAt: new Date().toISOString(),
      source: 'supabase_live',
      counts: {
        agents: agents.length,
        agentsActive: agents.filter((agent) => agent.status === 'ACTIVE').length,
        tasks: tasks.length,
        running: tasks.filter((task) => task.status === 'RUNNING').length,
        queued: tasks.filter((task) => task.status === 'QUEUED').length,
        blocked: tasks.filter((task) => task.status === 'BLOCKED').length,
        verified: tasks.filter((task) => task.status === 'VERIFIED' || task.status === 'DONE').length,
        activeLocks: locks.length,
        factoryPendingApproval: factory.filter((row) => row.kind === 'AGENT' && row.activation_status === 'PENDING_OWNER_APPROVAL').length,
      },
      acquisition,
      agents: roster,
      tasks,
      factory,
      locks,
    } as unknown as Record<string, unknown>);
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_IA_ORCHESTRATOR_MARKER, error: error instanceof Error ? error.message : 'ia status failed' }, 500);
  }
}

/** POST /api/ivx/autonomous/ia/task — create or update a task (owner bearer). */
export async function handleIATaskPost(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim().toUpperCase() : '';
  const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
  if (!taskId || !/^IAT-\d{4}$/.test(taskId)) {
    return ownerOnlyJson({ ok: false, error: 'taskId matching IAT-xxxx is required.' }, 400);
  }
  if (status && !TASK_STATUSES.includes(status as IATaskStatus)) {
    return ownerOnlyJson({ ok: false, error: `Invalid status. Valid: ${TASK_STATUSES.join(', ')}` }, 400);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (typeof body.evidence === 'string' && body.evidence.trim()) patch.evidence = body.evidence.trim().slice(0, 1000);
  if (typeof body.blocker === 'string') patch.blocker = body.blocker.trim() ? body.blocker.trim().slice(0, 500) : null;

  const existing = await restCall(`/rest/v1/ivx_ia_tasks?task_id=eq.${taskId}&select=task_id`, { method: 'GET' });
  const exists = parseRows<{ task_id: string }>(existing.body).length > 0;

  if (!exists) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
    if (!agentId || !title) {
      return ownerOnlyJson({ ok: false, error: `Unknown taskId ${taskId}. To create, pass agentId (IA-xx) and title.` }, 404);
    }
    const insert = await restCall('/rest/v1/ivx_ia_tasks', {
      method: 'POST',
      body: JSON.stringify({
        task_id: taskId,
        agent_id: agentId,
        title,
        detail: typeof body.detail === 'string' ? body.detail.slice(0, 1000) : null,
        priority: typeof body.priority === 'string' && ['P0', 'P1', 'P2'].includes(body.priority.toUpperCase()) ? body.priority.toUpperCase() : 'P1',
        status: status || 'QUEUED',
        evidence: (patch.evidence as string | undefined) ?? null,
        blocker: (patch.blocker as string | null | undefined) ?? null,
      }),
    });
    if (insert.status !== 201) {
      return ownerOnlyJson({ ok: false, error: `Task create failed HTTP ${insert.status ?? 'ERR'}: ${insert.body.slice(0, 200)}` }, 500);
    }
    return ownerOnlyJson({ ok: true, action: 'created', taskId });
  }

  const update = await restCall(`/rest/v1/ivx_ia_tasks?task_id=eq.${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (update.status !== 200 && update.status !== 204) {
    return ownerOnlyJson({ ok: false, error: `Task update failed HTTP ${update.status ?? 'ERR'}: ${update.body.slice(0, 200)}` }, 500);
  }
  return ownerOnlyJson({ ok: true, action: 'updated', taskId, patch: patch as unknown as Record<string, unknown> });
}

/**
 * POST /api/ivx/autonomous/ia/lock — critical-file lock protocol.
 * body: { filePath, agentId, taskId?, release?: boolean, ttlMinutes? }
 * Prevents two agents from editing the same critical file simultaneously.
 */
export async function handleIALockPost(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : '';
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim().toUpperCase() : '';
  const release = body.release === true;
  if (!filePath || !agentId) {
    return ownerOnlyJson({ ok: false, error: 'filePath and agentId are required.' }, 400);
  }

  if (release) {
    const del = await restCall(`/rest/v1/ivx_ia_file_locks?file_path=eq.${encodeURIComponent(filePath)}&agent_id=eq.${agentId}`, { method: 'DELETE' });
    return ownerOnlyJson({ ok: del.status === 200 || del.status === 204, action: 'released', filePath, agentId });
  }

  const existingRes = await restCall(`/rest/v1/ivx_ia_file_locks?file_path=eq.${encodeURIComponent(filePath)}&select=file_path,agent_id,expires_at`, { method: 'GET' });
  const existing = parseRows<IALockRow>(existingRes.body)[0];
  if (existing && new Date(existing.expires_at).getTime() > Date.now() && existing.agent_id !== agentId) {
    return ownerOnlyJson({ ok: false, error: `Lock held by ${existing.agent_id} until ${existing.expires_at}.`, conflict: true }, 409);
  }

  const ttlMinutes = typeof body.ttlMinutes === 'number' && body.ttlMinutes > 0 && body.ttlMinutes <= 240 ? body.ttlMinutes : 30;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const upsert = await restCall('/rest/v1/ivx_ia_file_locks?on_conflict=file_path', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      file_path: filePath,
      agent_id: agentId,
      task_id: typeof body.taskId === 'string' ? body.taskId.trim() : null,
      acquired_at: new Date().toISOString(),
      expires_at: expiresAt,
    }),
  });
  if (upsert.status !== 201 && upsert.status !== 200) {
    return ownerOnlyJson({ ok: false, error: `Lock acquire failed HTTP ${upsert.status ?? 'ERR'}: ${upsert.body.slice(0, 200)}` }, 500);
  }
  return ownerOnlyJson({ ok: true, action: 'acquired', filePath, agentId, expiresAt });
}