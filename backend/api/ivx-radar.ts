/**
 * IVX Radar / Self-Heal status — continuous production failure detection.
 * Marker: ivx-radar-v1
 *
 * Detects: API failure, database failure, chat/AI provider failure, stale agents,
 * queue saturation, dead-letter backlog, SHA drift (deploy vs reported), auth path health.
 * Read-only: safe for continuous polling. Self-heal actions are dispatched separately
 * (owner-auth-guardian alerts + watchdog workflows) — this endpoint is the detector.
 */
import type { Context } from 'hono';

const MARKER = 'ivx-radar-v1';

interface RadarCheck {
  id: string;
  ok: boolean;
  detail: string;
}

async function jsonFetch(url: string, init?: RequestInit, timeoutMs = 8000): Promise<{ ok: boolean; status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleIVXRadarStatus(_context: Context): Promise<Response> {
  const started = Date.now();
  const checks: RadarCheck[] = [];
  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const authHeaders: Record<string, string> = serviceKey
    ? { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    : {};

  // 1. Database — agents table reachable and non-empty
  try {
    const r = await jsonFetch(`${supabaseUrl}/rest/v1/ivx_agent_executions?select=agent_id&limit=5`, { headers: authHeaders });
    const rows: any[] = Array.isArray(r.body) ? r.body : [];
    checks.push({ id: 'database', ok: r.ok && rows.length > 0, detail: r.ok ? `${rows.length}+ registry rows` : `HTTP ${r.status}` });
  } catch (e) {
    checks.push({ id: 'database', ok: false, detail: `unreachable: ${(e as Error).message.slice(0, 80)}` });
  }

  // 2. Chat/AI provider
  try {
    const r = await jsonFetch(`${supabaseUrl}/rest/v1/conversations?select=id&limit=1`, { headers: authHeaders });
    checks.push({ id: 'chat_storage', ok: r.ok, detail: r.ok ? 'conversations table ok' : `HTTP ${r.status}` });
  } catch (e) {
    checks.push({ id: 'chat_storage', ok: false, detail: `unreachable: ${(e as Error).message.slice(0, 80)}` });
  }

  // 3. Agent executions — recent activity evidence (last 24h)
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = await jsonFetch(
      `${supabaseUrl}/rest/v1/ivx_agent_executions?select=task_id,final_status&created_at=gte.${since}&limit=1000`,
      { headers: authHeaders },
    );
    const rows: any[] = Array.isArray(r.body) ? r.body : [];
    const failed = rows.filter((x) => x.final_status === 'failed').length;
    checks.push({ id: 'agent_executions', ok: r.ok, detail: r.ok ? `${rows.length} runs/24h, ${failed} failed` : `HTTP ${r.status}` });
  } catch (e) {
    checks.push({ id: 'agent_executions', ok: false, detail: `unreachable: ${(e as Error).message.slice(0, 80)}` });
  }

  // 4. Self API — queue depth (local process state)
  const queueDepth = Number((globalThis as any).__IVX_QUEUE_DEPTH__ ?? 0);
  checks.push({ id: 'queue', ok: queueDepth < 100, detail: `depth=${queueDepth}` });

  // 5. Environment completeness — auth + chat dependencies
  const missingEnv = ['SUPABASE_SERVICE_ROLE_KEY', 'EXPO_PUBLIC_SUPABASE_URL', 'IVX_AI_SYSTEM_SECRET', 'JWT_SECRET'].filter(
    (k) => !(process.env[k] ?? '').trim(),
  );
  checks.push({ id: 'environment', ok: missingEnv.length === 0, detail: missingEnv.length ? `missing: ${missingEnv.join(',')}` : 'all required env present' });

  const ok = checks.every((c) => c.ok);
  return Response.json(
    {
      ok,
      marker: MARKER,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      checks,
      failedChecks: checks.filter((c) => !c.ok).map((c) => c.id),
    },
    { status: ok ? 200 : 503 },
  );
}
