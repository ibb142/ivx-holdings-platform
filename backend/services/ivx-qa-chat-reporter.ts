/**
 * IVX QA Chat Reporter — posts the 2-hour autonomous verification report
 * into the IVX Owner AI chat room ('ivx-owner-room') so the owner sees
 * live QA + database evidence directly in the app.
 *
 * Writes through Supabase REST with the service-role key (server-only).
 * Never throws: reporting must not break the QA scheduler.
 */

const REPORT_SENDER_LABEL = 'IVX Autonomous QA (W6/W9)';
const OWNER_ROOM_SLUG = 'ivx-owner-room';
const TIMEOUT_MS = 10_000;

export type QAChatReportInput = {
  runId: string;
  healthOk: boolean | null;
  authOk: boolean | null;
  probesSummary: string;
  migrations: { total: number; applied: number; pending: number; drifted: number } | null;
  extraLines?: string[];
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

async function restCall(path: string, init: RequestInit): Promise<{ status: number | null; body: string }> {
  const base = supabaseUrl();
  const key = serviceRoleKey();
  if (!base || !key) return { status: null, body: 'supabase service credentials missing in runtime' };
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: (await response.text()).slice(0, 1000) };
  } catch (error: unknown) {
    return { status: null, body: error instanceof Error ? error.message.slice(0, 200) : 'fetch failed' };
  }
}

async function findOwnerRoomId(): Promise<string | null> {
  const bySlug = await restCall(`/rest/v1/ivx_conversations?slug=eq.${OWNER_ROOM_SLUG}&select=id&limit=1`, { method: 'GET' });
  if (bySlug.status === 200) {
    try {
      const rows = JSON.parse(bySlug.body) as Array<{ id: string }>;
      if (rows[0]?.id) return rows[0].id;
    } catch { /* fall through */ }
  }
  const latest = await restCall('/rest/v1/ivx_conversations?select=id&order=updated_at.desc&limit=1', { method: 'GET' });
  if (latest.status === 200) {
    try {
      const rows = JSON.parse(latest.body) as Array<{ id: string }>;
      if (rows[0]?.id) return rows[0].id;
    } catch { /* fall through */ }
  }
  return null;
}

function buildReportBody(input: QAChatReportInput): string {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const lines = [
    `IVX AUTONOMOUS VERIFICATION REPORT — ${stamp} UTC`,
    `Run: ${input.runId} (2h matrix cadence)`,
    `API health: ${input.healthOk === false ? 'FAIL' : input.healthOk ? 'OK' : 'n/a'}`,
    `Auth + protected routes: ${input.authOk === false ? 'FAIL' : input.authOk ? 'OK' : 'n/a'} — ${input.probesSummary}`,
  ];
  if (input.migrations) {
    const m = input.migrations;
    lines.push(`DB migrations: ${m.applied}/${m.total} applied${m.pending > 0 ? `, ${m.pending} PENDING` : ''}${m.drifted > 0 ? `, ${m.drifted} DRIFTED` : ''}`);
  } else {
    lines.push('DB migrations: status unavailable this run');
  }
  for (const extra of input.extraLines ?? []) lines.push(extra);
  lines.push('Source: in-process QA scheduler on api.ivxholding.com (no manual step).');
  return lines.join('\n');
}

/**
 * Post a 2-hour verification report into the owner AI chat.
 * Returns true only when the message row was actually created (HTTP 201).
 */
export async function postQAReportToOwnerChat(input: QAChatReportInput): Promise<boolean> {
  try {
    const roomId = await findOwnerRoomId();
    if (!roomId) {
      console.error('[ivx-qa-chat-reporter] owner room not found — report skipped');
      return false;
    }
    const insert = await restCall('/rest/v1/ivx_messages', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: roomId,
        sender_role: 'assistant',
        sender_label: REPORT_SENDER_LABEL,
        body: buildReportBody(input),
        attachment_kind: 'text',
        source: 'ivx-qa-scheduler',
      }),
    });
    if (insert.status !== 201) {
      console.error(`[ivx-qa-chat-reporter] insert failed HTTP ${insert.status ?? 'ERR'}: ${insert.body.slice(0, 160)}`);
      return false;
    }
    return true;
  } catch (error: unknown) {
    console.error('[ivx-qa-chat-reporter] report failed:', error instanceof Error ? error.message : error);
    return false;
  }
}