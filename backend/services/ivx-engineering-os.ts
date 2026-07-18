/**
 * IVX ENGINEERING OPERATING SYSTEM — 24/7 autonomous engineering mapping.
 *
 * Implements the owner-mandated structure:
 *   OWNER (Ivan Cifuentes) → IVX Senior Developer (master AI) → 12 engineering
 *   teams working the continuous loop:
 *     Collect Bugs → Analyze → Generate Tasks → Assign → Develop → Code Review
 *     → Automated Tests → Security Review → Performance Review → Owner Approval
 *     → Production Deploy → Health Verification → Proof Ledger → Monitor → repeat.
 *
 * HARD RULES enforced in code (not prose):
 *   - Only TEAM-12 (Release Manager AI) may merge / tag / deploy.
 *   - No task enters PRODUCTION_DEPLOY without recorded owner approval.
 *   - No task is VERIFIED without commit SHA + deploy id + test results +
 *     live health verification (owner rule 5).
 *   - Emergency stop blocks the deploy stage.
 *   - A 2-hour engineering report is generated and posted to the owner chat.
 *
 * The pure state machine (`evaluateStageTransition`, `evaluateVerifiedEvidence`)
 * has no I/O so it is fully unit-testable; persistence goes through Supabase
 * REST with the server-only service-role key.
 */
import { checkEmergencyStop } from './ivx-emergency-stop-gate';

export const IVX_ENGINEERING_OS_MARKER = 'ivx-engineering-os-2026-07-18';

// ---------------------------------------------------------------------------
// Team registry
// ---------------------------------------------------------------------------

export type IVXEngineeringTeamId =
  | 'TEAM-01' | 'TEAM-02' | 'TEAM-03' | 'TEAM-04' | 'TEAM-05' | 'TEAM-06'
  | 'TEAM-07' | 'TEAM-08' | 'TEAM-09' | 'TEAM-10' | 'TEAM-11' | 'TEAM-12';

export type IVXEngineeringTeam = {
  teamId: IVXEngineeringTeamId;
  name: string;
  mission: string;
  focus: string[];
  /** Teams that run 24/7 rather than per-task. */
  continuous: boolean;
  canMerge: boolean;
  canTag: boolean;
  canDeploy: boolean;
  /** Honest initial state — no team is "verified working" until it has proof. */
  status: 'REGISTERED_STANDBY';
};

export const IVX_RELEASE_MANAGER_TEAM_ID: IVXEngineeringTeamId = 'TEAM-12';

const team = (
  teamId: IVXEngineeringTeamId,
  name: string,
  mission: string,
  focus: string[],
  continuous: boolean,
  isReleaseManager: boolean,
): IVXEngineeringTeam => ({
  teamId,
  name,
  mission,
  focus,
  continuous,
  canMerge: isReleaseManager,
  canTag: isReleaseManager,
  canDeploy: isReleaseManager,
  status: 'REGISTERED_STANDBY',
});

/** The 12 owner-mandated engineering teams. Only TEAM-12 can merge/tag/deploy. */
export const IVX_ENGINEERING_TEAMS: readonly IVXEngineeringTeam[] = [
  team('TEAM-01', 'Architecture AI', 'System design, scalability, security posture, technical roadmap.', ['system design', 'scalability', 'security', 'technical roadmap'], false, false),
  team('TEAM-02', 'Frontend AI', 'Expo, Android, iOS, Web surfaces, UX and animations.', ['expo', 'android', 'ios', 'web', 'ux', 'animations'], false, false),
  team('TEAM-03', 'Backend AI', 'APIs, business logic, authentication, queues.', ['apis', 'business logic', 'authentication', 'queues'], false, false),
  team('TEAM-04', 'Database AI', 'Supabase, migrations, RLS, indexes, backups.', ['supabase', 'migrations', 'rls', 'indexes', 'backups'], false, false),
  team('TEAM-05', 'Media AI', 'Reels, video, uploads, compression, streaming.', ['reels', 'video', 'uploads', 'compression', 'streaming'], false, false),
  team('TEAM-06', 'QA AI', 'Continuous regression, integration, stress and device testing.', ['regression', 'integration', 'stress', 'device testing'], true, false),
  team('TEAM-07', 'Security AI', 'Permissions, secrets, vulnerabilities, audit.', ['permissions', 'secrets', 'vulnerabilities', 'audit'], false, false),
  team('TEAM-08', 'Performance AI', 'Caching, optimization, memory, CPU, network.', ['caching', 'optimization', 'memory', 'cpu', 'network'], false, false),
  team('TEAM-09', 'DevOps AI', 'GitHub, Render, EAS, deployments, rollback.', ['github', 'render', 'eas', 'deployments', 'rollback'], false, false),
  team('TEAM-10', 'Monitoring AI', '24/7 logs, alerts, incidents, health, uptime.', ['logs', 'alerts', 'incidents', 'health', 'uptime'], true, false),
  team('TEAM-11', 'Business AI', 'Investors, buyers, CRM, tokenization, analytics.', ['investors', 'buyers', 'crm', 'tokenization', 'analytics'], false, false),
  team('TEAM-12', 'Release Manager AI', 'ONLY AI allowed to merge, tag and deploy — always after owner approval.', ['merge', 'tag', 'deploy'], false, true),
];

// ---------------------------------------------------------------------------
// Continuous-loop pipeline state machine (pure — no I/O)
// ---------------------------------------------------------------------------

export const IVX_ENGINEERING_PIPELINE = [
  'COLLECT_BUGS',
  'ANALYZE',
  'GENERATE_TASKS',
  'ASSIGN',
  'DEVELOP',
  'CODE_REVIEW',
  'AUTOMATED_TESTS',
  'SECURITY_REVIEW',
  'PERFORMANCE_REVIEW',
  'OWNER_APPROVAL',
  'PRODUCTION_DEPLOY',
  'HEALTH_VERIFICATION',
  'PROOF_LEDGER',
  'MONITOR',
] as const;

export type IVXEngineeringStage = (typeof IVX_ENGINEERING_PIPELINE)[number];

export type IVXEngineeringTaskStatus =
  | 'QUEUED' | 'RUNNING' | 'WAITING_APPROVAL' | 'RETRYING'
  | 'VERIFIED' | 'FAILED' | 'BLOCKED';

/** Owner rule 5 — the four mandatory proof fields for VERIFIED. */
export type IVXEngineeringEvidence = {
  commitSha: string | null;
  renderDeployId: string | null;
  testResults: string | null;
  healthVerification: string | null;
};

export const EMPTY_ENGINEERING_EVIDENCE: IVXEngineeringEvidence = {
  commitSha: null,
  renderDeployId: null,
  testResults: null,
  healthVerification: null,
};

export function evaluateVerifiedEvidence(
  evidence: Partial<IVXEngineeringEvidence> | null | undefined,
): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  const has = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
  if (!has(evidence?.commitSha)) missing.push('commitSha');
  if (!has(evidence?.renderDeployId)) missing.push('renderDeployId');
  if (!has(evidence?.testResults)) missing.push('testResults');
  if (!has(evidence?.healthVerification)) missing.push('healthVerification');
  return { complete: missing.length === 0, missing };
}

export type IVXStageTransitionInput = {
  fromStage: IVXEngineeringStage;
  toStage: IVXEngineeringStage;
  actorTeamId: string;
  ownerApproved: boolean;
  evidence: Partial<IVXEngineeringEvidence> | null;
};

export type IVXStageTransitionResult = {
  allowed: boolean;
  blocker:
    | 'PIPELINE_ORDER_VIOLATION'
    | 'OWNER_APPROVAL_REQUIRED'
    | 'RELEASE_MANAGER_ONLY'
    | 'VERIFIED_EVIDENCE_INCOMPLETE'
    | null;
  detail: string | null;
  missingEvidence: string[];
};

/**
 * Enforces the owner's continuous-loop rules for a single stage transition.
 * Deterministic and side-effect free (the emergency-stop check happens in the
 * persistence layer where async I/O is allowed).
 */
export function evaluateStageTransition(input: IVXStageTransitionInput): IVXStageTransitionResult {
  const fromIndex = IVX_ENGINEERING_PIPELINE.indexOf(input.fromStage);
  const toIndex = IVX_ENGINEERING_PIPELINE.indexOf(input.toStage);

  if (fromIndex < 0 || toIndex < 0 || toIndex !== fromIndex + 1) {
    return {
      allowed: false,
      blocker: 'PIPELINE_ORDER_VIOLATION',
      detail: `Tasks move one stage at a time in pipeline order; ${input.fromStage} → ${input.toStage} is not the next step.`,
      missingEvidence: [],
    };
  }

  if (input.toStage === 'PRODUCTION_DEPLOY') {
    if (!input.ownerApproved) {
      return {
        allowed: false,
        blocker: 'OWNER_APPROVAL_REQUIRED',
        detail: 'No production deployment without recorded owner approval (owner rule 6).',
        missingEvidence: [],
      };
    }
    if (input.actorTeamId !== IVX_RELEASE_MANAGER_TEAM_ID) {
      return {
        allowed: false,
        blocker: 'RELEASE_MANAGER_ONLY',
        detail: `Only ${IVX_RELEASE_MANAGER_TEAM_ID} (Release Manager AI) may merge, tag or deploy; actor was ${input.actorTeamId || 'unknown'}.`,
        missingEvidence: [],
      };
    }
  }

  if (input.toStage === 'PROOF_LEDGER' || input.toStage === 'MONITOR') {
    const proof = evaluateVerifiedEvidence(input.evidence);
    if (!proof.complete) {
      return {
        allowed: false,
        blocker: 'VERIFIED_EVIDENCE_INCOMPLETE',
        detail: `VERIFIED requires GitHub commit SHA, Render deployment id, automated test results and live health verification (owner rule 5). Missing: ${proof.missing.join(', ')}.`,
        missingEvidence: proof.missing,
      };
    }
  }

  return { allowed: true, blocker: null, detail: null, missingEvidence: [] };
}

/** The task status a stage implies (used when persisting an advance). */
export function statusForStage(
  stage: IVXEngineeringStage,
  evidence: Partial<IVXEngineeringEvidence> | null,
): IVXEngineeringTaskStatus {
  if (stage === 'OWNER_APPROVAL') return 'WAITING_APPROVAL';
  if (stage === 'MONITOR') {
    return evaluateVerifiedEvidence(evidence).complete ? 'VERIFIED' : 'BLOCKED';
  }
  return 'RUNNING';
}

// ---------------------------------------------------------------------------
// Persistence (Supabase REST, service-role — server-only)
// ---------------------------------------------------------------------------

const REST_TIMEOUT_MS = 12_000;

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
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    return { status: response.status, body: (await response.text()).slice(0, 20_000) };
  } catch (error: unknown) {
    return { status: null, body: error instanceof Error ? error.message.slice(0, 200) : 'fetch failed' };
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

export type IVXEngineeringTaskRow = {
  id: string;
  title: string;
  detail: string | null;
  team_id: string;
  stage: IVXEngineeringStage;
  status: IVXEngineeringTaskStatus;
  owner_approved: boolean;
  owner_approved_by: string | null;
  owner_approved_at: string | null;
  evidence: Partial<IVXEngineeringEvidence> | null;
  blocker: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Upserts the 12-team registry into ivx_engineering_teams. */
export async function syncEngineeringTeams(): Promise<{ ok: boolean; upserted: number; error: string | null }> {
  const rows = IVX_ENGINEERING_TEAMS.map((entry) => ({
    team_id: entry.teamId,
    name: entry.name,
    mission: entry.mission,
    focus: entry.focus,
    continuous: entry.continuous,
    can_merge: entry.canMerge,
    can_tag: entry.canTag,
    can_deploy: entry.canDeploy,
    status: entry.status,
  }));
  const result = await restCall('/rest/v1/ivx_engineering_teams?on_conflict=team_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
  if (result.status !== 201 && result.status !== 200) {
    return { ok: false, upserted: 0, error: `HTTP ${result.status ?? 'ERR'}: ${result.body.slice(0, 200)}` };
  }
  return { ok: true, upserted: parseRows(result.body).length, error: null };
}

export async function listEngineeringTeams(): Promise<Array<Record<string, unknown>>> {
  const result = await restCall('/rest/v1/ivx_engineering_teams?select=*&order=team_id.asc', { method: 'GET' });
  return result.status === 200 ? parseRows<Record<string, unknown>>(result.body) : [];
}

export async function listEngineeringTasks(limit: number = 100): Promise<IVXEngineeringTaskRow[]> {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const result = await restCall(`/rest/v1/ivx_engineering_tasks?select=*&order=updated_at.desc&limit=${safeLimit}`, { method: 'GET' });
  return result.status === 200 ? parseRows<IVXEngineeringTaskRow>(result.body) : [];
}

export async function getEngineeringTask(taskId: string): Promise<IVXEngineeringTaskRow | null> {
  const result = await restCall(`/rest/v1/ivx_engineering_tasks?id=eq.${encodeURIComponent(taskId)}&select=*&limit=1`, { method: 'GET' });
  return result.status === 200 ? parseRows<IVXEngineeringTaskRow>(result.body)[0] ?? null : null;
}

export async function createEngineeringTask(input: {
  title: string;
  detail?: string | null;
  teamId: string;
  createdBy?: string | null;
}): Promise<{ ok: boolean; task: IVXEngineeringTaskRow | null; error: string | null }> {
  const title = input.title.trim();
  if (!title) return { ok: false, task: null, error: 'A task title is required.' };
  const knownTeam = IVX_ENGINEERING_TEAMS.some((entry) => entry.teamId === input.teamId);
  if (!knownTeam) return { ok: false, task: null, error: `Unknown team '${input.teamId}'. Valid teams: TEAM-01..TEAM-12.` };

  const result = await restCall('/rest/v1/ivx_engineering_tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: title.slice(0, 500),
      detail: input.detail?.trim().slice(0, 8000) ?? null,
      team_id: input.teamId,
      stage: 'COLLECT_BUGS',
      status: 'QUEUED',
      evidence: {},
      created_by: input.createdBy ?? null,
    }),
  });
  if (result.status !== 201) {
    return { ok: false, task: null, error: `HTTP ${result.status ?? 'ERR'}: ${result.body.slice(0, 200)}` };
  }
  return { ok: true, task: parseRows<IVXEngineeringTaskRow>(result.body)[0] ?? null, error: null };
}

export async function recordEngineeringEvidence(input: {
  taskId: string;
  evidence: Partial<IVXEngineeringEvidence>;
}): Promise<{ ok: boolean; task: IVXEngineeringTaskRow | null; error: string | null }> {
  const existing = await getEngineeringTask(input.taskId);
  if (!existing) return { ok: false, task: null, error: 'Task not found.' };
  const merged: Partial<IVXEngineeringEvidence> = { ...(existing.evidence ?? {}), ...input.evidence };
  const result = await restCall(`/rest/v1/ivx_engineering_tasks?id=eq.${encodeURIComponent(input.taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ evidence: merged, updated_at: new Date().toISOString() }),
  });
  if (result.status !== 200) {
    return { ok: false, task: null, error: `HTTP ${result.status ?? 'ERR'}: ${result.body.slice(0, 200)}` };
  }
  return { ok: true, task: parseRows<IVXEngineeringTaskRow>(result.body)[0] ?? null, error: null };
}

export async function approveEngineeringTask(input: {
  taskId: string;
  approvedBy: string;
}): Promise<{ ok: boolean; task: IVXEngineeringTaskRow | null; error: string | null }> {
  const existing = await getEngineeringTask(input.taskId);
  if (!existing) return { ok: false, task: null, error: 'Task not found.' };
  if (existing.stage !== 'OWNER_APPROVAL') {
    return { ok: false, task: null, error: `Task is at stage ${existing.stage}; owner approval applies at OWNER_APPROVAL.` };
  }
  const result = await restCall(`/rest/v1/ivx_engineering_tasks?id=eq.${encodeURIComponent(input.taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      owner_approved: true,
      owner_approved_by: input.approvedBy,
      owner_approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (result.status !== 200) {
    return { ok: false, task: null, error: `HTTP ${result.status ?? 'ERR'}: ${result.body.slice(0, 200)}` };
  }
  return { ok: true, task: parseRows<IVXEngineeringTaskRow>(result.body)[0] ?? null, error: null };
}

export async function advanceEngineeringTask(input: {
  taskId: string;
  toStage: IVXEngineeringStage;
  actorTeamId: string;
}): Promise<{ ok: boolean; task: IVXEngineeringTaskRow | null; blocker: string | null; detail: string | null }> {
  const existing = await getEngineeringTask(input.taskId);
  if (!existing) return { ok: false, task: null, blocker: 'TASK_NOT_FOUND', detail: 'Task not found.' };

  const verdict = evaluateStageTransition({
    fromStage: existing.stage,
    toStage: input.toStage,
    actorTeamId: input.actorTeamId,
    ownerApproved: existing.owner_approved,
    evidence: existing.evidence,
  });
  if (!verdict.allowed) {
    return { ok: false, task: existing, blocker: verdict.blocker, detail: verdict.detail };
  }

  if (input.toStage === 'PRODUCTION_DEPLOY') {
    const stop = await checkEmergencyStop();
    if (stop.active) {
      return {
        ok: false,
        task: existing,
        blocker: 'EMERGENCY_STOP_ACTIVE',
        detail: 'The owner emergency stop is engaged — production deployment refused.',
      };
    }
  }

  const nextStatus = statusForStage(input.toStage, existing.evidence);
  const result = await restCall(`/rest/v1/ivx_engineering_tasks?id=eq.${encodeURIComponent(input.taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      stage: input.toStage,
      status: nextStatus,
      blocker: null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (result.status !== 200) {
    return { ok: false, task: existing, blocker: 'PERSISTENCE_FAILED', detail: `HTTP ${result.status ?? 'ERR'}: ${result.body.slice(0, 200)}` };
  }
  return { ok: true, task: parseRows<IVXEngineeringTaskRow>(result.body)[0] ?? existing, blocker: null, detail: null };
}

// ---------------------------------------------------------------------------
// 2-hour engineering report (owner rule 7)
// ---------------------------------------------------------------------------

export type IVXEngineeringReportStats = {
  completedTasks: number;
  activeTasks: number;
  waitingApproval: number;
  blockedTasks: number;
  healthOk: boolean;
  healthCommit: string | null;
};

function productionHealthUrl(): string {
  const configured = (process.env.IVX_PRODUCTION_HEALTH_URL ?? '').trim();
  return configured.startsWith('https://') ? configured : 'https://api.ivxholding.com/health';
}

async function fetchProductionHealth(): Promise<{ ok: boolean; commit: string | null; detail: string }> {
  try {
    const response = await fetch(productionHealthUrl(), { signal: AbortSignal.timeout(10_000) });
    const body = (await response.text()).slice(0, 5_000);
    let commit: string | null = null;
    try {
      const parsed = JSON.parse(body) as { commit?: unknown; status?: unknown };
      commit = typeof parsed.commit === 'string' ? parsed.commit.slice(0, 12) : null;
    } catch { /* non-JSON health body */ }
    return { ok: response.status === 200, commit, detail: `HTTP ${response.status}` };
  } catch (error: unknown) {
    return { ok: false, commit: null, detail: error instanceof Error ? error.message.slice(0, 120) : 'health fetch failed' };
  }
}

/** Pure formatter — testable without network. */
export function formatEngineeringReport(input: {
  generatedAt: string;
  completed: Array<{ title: string; team_id: string }>;
  active: Array<{ title: string; team_id: string; stage: string }>;
  blockers: Array<{ title: string; team_id: string; blocker: string | null; status: string }>;
  waitingApproval: Array<{ title: string; team_id: string }>;
  health: { ok: boolean; commit: string | null; detail: string };
  nextPriorities: string[];
}): string {
  const lines: string[] = [
    `IVX ENGINEERING OS — 2-HOUR REPORT (${input.generatedAt.replace('T', ' ').slice(0, 16)} UTC)`,
    '',
    `COMPLETED TASKS (${input.completed.length})`,
    ...(input.completed.length ? input.completed.slice(0, 10).map((t) => `  • [${t.team_id}] ${t.title}`) : ['  • none this window']),
    '',
    `ACTIVE TASKS (${input.active.length})`,
    ...(input.active.length ? input.active.slice(0, 10).map((t) => `  • [${t.team_id}] ${t.title} — ${t.stage}`) : ['  • none']),
    '',
    `WAITING OWNER APPROVAL (${input.waitingApproval.length})`,
    ...(input.waitingApproval.length ? input.waitingApproval.slice(0, 10).map((t) => `  • [${t.team_id}] ${t.title}`) : ['  • none']),
    '',
    `BLOCKERS (${input.blockers.length})`,
    ...(input.blockers.length ? input.blockers.slice(0, 10).map((t) => `  • [${t.team_id}] ${t.title} — ${t.blocker ?? t.status}`) : ['  • none']),
    '',
    'DEPLOYMENTS',
    `  • production runtime: ${input.health.commit ? `commit ${input.health.commit}` : 'commit unknown'} (${input.health.detail})`,
    '',
    `PRODUCTION HEALTH: ${input.health.ok ? 'OK' : 'FAIL'} — ${productionHealthUrl()}`,
    '',
    'NEXT PRIORITIES',
    ...(input.nextPriorities.length ? input.nextPriorities.slice(0, 5).map((p) => `  • ${p}`) : ['  • awaiting owner goals']),
    '',
    'Rules in force: RM-only deploys (TEAM-12), owner approval before production, VERIFIED requires commit SHA + deploy id + tests + live health.',
  ];
  return lines.join('\n');
}

async function findOwnerRoomId(): Promise<string | null> {
  const bySlug = await restCall('/rest/v1/ivx_conversations?slug=eq.ivx-owner-room&select=id&limit=1', { method: 'GET' });
  if (bySlug.status === 200) {
    const rows = parseRows<{ id: string }>(bySlug.body);
    if (rows[0]?.id) return rows[0].id;
  }
  const latest = await restCall('/rest/v1/ivx_conversations?select=id&order=updated_at.desc&limit=1', { method: 'GET' });
  if (latest.status === 200) {
    const rows = parseRows<{ id: string }>(latest.body);
    if (rows[0]?.id) return rows[0].id;
  }
  return null;
}

/**
 * Generates the 2-hour report from live task + health data, stores it in
 * ivx_engineering_reports and posts it into the owner chat.
 * Never throws — reporting must not break the runtime.
 */
export async function generateAndPostEngineeringReport(): Promise<{
  ok: boolean;
  reportId: string | null;
  postedToChat: boolean;
  body: string | null;
  error: string | null;
}> {
  try {
    const [tasks, health] = await Promise.all([listEngineeringTasks(200), fetchProductionHealth()]);
    const completed = tasks.filter((t) => t.status === 'VERIFIED');
    const active = tasks.filter((t) => t.status === 'RUNNING' || t.status === 'RETRYING');
    const waitingApproval = tasks.filter((t) => t.status === 'WAITING_APPROVAL');
    const blockers = tasks.filter((t) => t.status === 'BLOCKED' || t.status === 'FAILED');
    const queued = tasks.filter((t) => t.status === 'QUEUED');

    const body = formatEngineeringReport({
      generatedAt: new Date().toISOString(),
      completed,
      active,
      blockers,
      waitingApproval,
      health,
      nextPriorities: queued.slice(0, 5).map((t) => `[${t.team_id}] ${t.title}`),
    });

    const stats: IVXEngineeringReportStats = {
      completedTasks: completed.length,
      activeTasks: active.length,
      waitingApproval: waitingApproval.length,
      blockedTasks: blockers.length,
      healthOk: health.ok,
      healthCommit: health.commit,
    };

    const stored = await restCall('/rest/v1/ivx_engineering_reports', {
      method: 'POST',
      body: JSON.stringify({ body, stats, posted_to_chat: false }),
    });
    const reportId = stored.status === 201 ? parseRows<{ id: string }>(stored.body)[0]?.id ?? null : null;

    let postedToChat = false;
    const roomId = await findOwnerRoomId();
    if (roomId) {
      const insert = await restCall('/rest/v1/ivx_messages', {
        method: 'POST',
        body: JSON.stringify({
          conversation_id: roomId,
          sender_role: 'assistant',
          sender_label: 'IVX Engineering OS (2h report)',
          body,
          attachment_kind: 'text',
          source: 'ivx-engineering-os',
        }),
      });
      postedToChat = insert.status === 201;
    }
    if (reportId && postedToChat) {
      await restCall(`/rest/v1/ivx_engineering_reports?id=eq.${encodeURIComponent(reportId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ posted_to_chat: true }),
      });
    }
    return { ok: true, reportId, postedToChat, body, error: null };
  } catch (error: unknown) {
    return {
      ok: false,
      reportId: null,
      postedToChat: false,
      body: null,
      error: error instanceof Error ? error.message.slice(0, 200) : 'report generation failed',
    };
  }
}

export async function getLatestEngineeringReport(): Promise<Record<string, unknown> | null> {
  const result = await restCall('/rest/v1/ivx_engineering_reports?select=*&order=created_at.desc&limit=1', { method: 'GET' });
  return result.status === 200 ? parseRows<Record<string, unknown>>(result.body)[0] ?? null : null;
}

let _engineeringTicker: ReturnType<typeof setInterval> | null = null;

/** Starts the 2-hour report loop (idempotent; interval unref'd so it never blocks shutdown). */
export function startEngineeringReportTicker(intervalHours: number = 2): void {
  if (_engineeringTicker) return;
  const intervalMs = Math.max(0.25, intervalHours) * 60 * 60 * 1000;
  _engineeringTicker = setInterval(() => {
    void generateAndPostEngineeringReport().catch(() => {});
  }, intervalMs);
  _engineeringTicker.unref?.();
  console.log(`[ivx-engineering-os] 2-hour report ticker started (every ${intervalHours}h)`);
}

export function stopEngineeringReportTicker(): void {
  if (_engineeringTicker) {
    clearInterval(_engineeringTicker);
    _engineeringTicker = null;
  }
}
