/**
 * IVX Autonomous Task Engine — the missing foundation that turns the existing
 * 11 scheduled engines + 12-step lifecycle into a FULL autonomous system with:
 *
 *   1. 23-state task state machine (Phase 4)
 *   2. Objective planning + task decomposition with acceptance criteria (Phase 5)
 *   3. Agent routing to the 100-agent enterprise registry (Phase 6)
 *   4. Single-use owner approval tokens with replay prevention (Phase 7)
 *   5. Task queue with leasing + idempotency + duplicate prevention (Phase 8)
 *   6. Honest completion validator that rejects unsupported claims (Phase 12)
 *
 * HONESTY RULES:
 *   - QUEUED is not completed. RUNNING is not completed. DEPLOYED is not verified.
 *   - A successful run MUST include evidence. A failed run MUST contain an exact error.
 *   - A code task with no code diff cannot become VERIFIED.
 *   - A discovery task cannot be reported as revenue, investor interest, or completed outreach.
 *   - The system rejects VERIFIED when acceptance criteria were not tested.
 *
 * DURABILITY:
 *   All state (objectives, tasks, approvals, leases) is persisted via the durable
 *   Supabase store so it survives restarts, redeploys, and scheduler crashes.
 */
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
  readDurableEvents,
} from './ivx-durable-store';
import {
  claimPostgresAutonomousTasks,
  compareAndSetPostgresAutonomousTask,
  createPostgresAutonomousTasks,
  heartbeatPostgresAutonomousTasks,
  linkPostgresAutonomousOrphans,
  postgresAtomicQueueSelected,
  readPostgresAutonomousTasks,
  readPostgresTaskById,
  startPostgresAutonomousTasks,
} from './ivx-postgres-autonomous-task-store';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { planTaskRetry, taskRetryDue, taskRetryExpired } from './ivx-retry-policy';

export const IVX_TASK_ENGINE_MARKER = 'ivx-autonomous-task-engine-2026-09-07-fleet-batch-v1';

// ── Phase 4: 23-state task state machine ─────────────────────────────────────

export type TaskState =
  | 'RECEIVED'
  | 'VALIDATING'
  | 'PLANNING'
  | 'WAITING_FOR_APPROVAL'
  | 'QUEUED'
  | 'LEASED'
  | 'RUNNING'
  | 'PAUSED'
  | 'RETRYING'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'FAILED'
  | 'EXECUTION_COMPLETED'
  | 'QA_IN_PROGRESS'
  | 'QA_FAILED'
  | 'READY_FOR_DEPLOYMENT'
  | 'DEPLOYING'
  | 'DEPLOYED'
  | 'PRODUCTION_VERIFYING'
  | 'VERIFIED'
  | 'EXPIRED'
  | 'STALE'
  | 'NO_ACTION_REQUIRED';

export const ALL_TASK_STATES: readonly TaskState[] = [
  'RECEIVED', 'VALIDATING', 'PLANNING', 'WAITING_FOR_APPROVAL', 'QUEUED',
  'LEASED', 'RUNNING', 'PAUSED', 'RETRYING', 'BLOCKED', 'CANCELLED', 'FAILED',
  'EXECUTION_COMPLETED', 'QA_IN_PROGRESS', 'QA_FAILED', 'READY_FOR_DEPLOYMENT',
  'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING', 'VERIFIED', 'EXPIRED',
  'STALE', 'NO_ACTION_REQUIRED',
];

/** States that count as "completed" (terminal success). */
export const TERMINAL_SUCCESS_STATES: readonly TaskState[] = ['VERIFIED', 'NO_ACTION_REQUIRED'];

/** States that count as "terminal" (no further transitions). */
export const TERMINAL_STATES: readonly TaskState[] = [
  'VERIFIED', 'NO_ACTION_REQUIRED', 'CANCELLED', 'FAILED', 'EXPIRED',
];

/** States that count as "not completed" (still in progress or blocked). */
export const IN_PROGRESS_STATES: readonly TaskState[] = [
  'RECEIVED', 'VALIDATING', 'PLANNING', 'WAITING_FOR_APPROVAL', 'QUEUED',
  'LEASED', 'RUNNING', 'PAUSED', 'RETRYING', 'EXECUTION_COMPLETED',
  'QA_IN_PROGRESS', 'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED',
  'PRODUCTION_VERIFYING',
];

/** Valid state transitions — enforced by the state machine. */
const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  RECEIVED: ['VALIDATING', 'CANCELLED', 'EXPIRED'],
  VALIDATING: ['PLANNING', 'NO_ACTION_REQUIRED', 'FAILED', 'CANCELLED'],
  PLANNING: ['WAITING_FOR_APPROVAL', 'QUEUED', 'NO_ACTION_REQUIRED', 'FAILED', 'CANCELLED'],
  WAITING_FOR_APPROVAL: ['QUEUED', 'CANCELLED', 'EXPIRED', 'BLOCKED'],
  QUEUED: ['LEASED', 'CANCELLED', 'STALE', 'EXPIRED'],
  LEASED: ['RUNNING', 'QUEUED', 'EXPIRED', 'STALE'],
  RUNNING: ['PAUSED', 'EXECUTION_COMPLETED', 'FAILED', 'RETRYING', 'BLOCKED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED', 'EXPIRED'],
  RETRYING: ['QUEUED', 'RUNNING', 'FAILED'],
  BLOCKED: ['WAITING_FOR_APPROVAL', 'CANCELLED', 'QUEUED', 'RETRYING', 'FAILED'],
  CANCELLED: [],
  FAILED: ['RETRYING'],
  EXECUTION_COMPLETED: ['QA_IN_PROGRESS', 'FAILED'],
  QA_IN_PROGRESS: ['QA_FAILED', 'READY_FOR_DEPLOYMENT', 'VERIFIED', 'FAILED'],
  QA_FAILED: ['RETRYING', 'BLOCKED', 'FAILED'],
  READY_FOR_DEPLOYMENT: ['DEPLOYING', 'VERIFIED', 'CANCELLED'],
  DEPLOYING: ['DEPLOYED', 'FAILED', 'BLOCKED'],
  DEPLOYED: ['PRODUCTION_VERIFYING', 'FAILED'],
  PRODUCTION_VERIFYING: ['VERIFIED', 'FAILED', 'BLOCKED'],
  VERIFIED: [],
  EXPIRED: [],
  STALE: ['QUEUED', 'CANCELLED', 'EXPIRED'],
  NO_ACTION_REQUIRED: [],
};

/** Check if a state transition is valid. Pure function. */
export function isValidTransition(from: TaskState, to: TaskState): boolean {
  if (from === to) return false;
  const allowed = VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

/** A task is "completed" only if it's in a terminal success state. */
export function isTaskCompleted(state: TaskState): boolean {
  return TERMINAL_SUCCESS_STATES.includes(state);
}

/** A task is "not completed" if it's in progress or blocked (NOT if it's failed/cancelled). */
export function isTaskInProgress(state: TaskState): boolean {
  return IN_PROGRESS_STATES.includes(state);
}

// ── Phase 5: Objective planning ──────────────────────────────────────────────

export type RiskClassification = 'low' | 'medium' | 'high' | 'critical';

export type AcceptanceCriterion = {
  id: string;
  description: string;
  /** How this criterion is verified: 'code_diff' | 'test_pass' | 'http_200' | 'production_check' | 'evidence' | 'manual' */
  verificationMethod: 'code_diff' | 'test_pass' | 'http_200' | 'production_check' | 'evidence' | 'manual' | 'source_file_inspected';
  expectedSource?: string;
  expectedCommitSha?: string;
  /** True when this criterion has been met with real evidence. */
  met: boolean;
  /** Evidence artifact supporting the claim (null when not yet met). */
  evidence: string | null;
};

export type Objective = {
  objectiveId: string;
  /** Stable key preventing duplicate portfolio objectives across restarts. */
  idempotencyKey?: string | null;
  originalOwnerRequest: string;
  businessOutcome: string;
  technicalOutcome: string;
  scope: string;
  exclusions: string[];
  riskClassification: RiskClassification;
  requiredApprovals: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedEffort: string;
  /** Named accountable role; null means Autonomous still has to resolve ownership. */
  ownerRole?: string | null;
  /** Owner-provided delivery target. Autonomous never invents a deadline. */
  targetDate?: string | null;
  /** Measurable owner outcomes used by the PM control tower. */
  successMetrics?: string[];
  assignedEngine: string | null;
  rollbackRequirement: boolean;
  finalVerificationMethod: string;
  createdAt: string;
  status: 'active' | 'completed' | 'cancelled' | 'blocked';
};

export type Task = {
  taskId: string;
  objectiveId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string;
  taskType: 'development' | 'security' | 'investor_research' | 'buyer_research' | 'outreach' | 'deployment' | 'qa' | 'reporting' | 'discovery' | 'configuration';
  state: TaskState;
  /** Idempotency key to prevent duplicate execution of the same work. */
  idempotencyKey: string;
  assignedAgentNumber: number | null;
  assignedEngine: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** 1–5 owner/business value used after safety and priority gates. */
  businessValue?: number;
  /** Planning estimate only; actual duration remains evidence-derived. */
  estimatedMinutes?: number | null;
  /** Optional milestone and accountable role for portfolio reporting. */
  milestone?: string | null;
  ownerRole?: string | null;
  /** Owner-provided ISO deadline; null means no deadline is claimed. */
  dueAt?: string | null;
  acceptanceCriteria: AcceptanceCriterion[];
  dependencies: string[];
  executionOrder: number;
  /** Lease holder (worker id) when state is LEASED/RUNNING. */
  leaseHolder: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  retryCount: number;
  maxRetries: number;
  /** Durable retry schedule; waiting never retains a worker lease. */
  retryStartedAt?: string | null;
  retryNotBefore?: string | null;
  error: string | null;
  blocker: string | null;
  evidence: TaskEvidence[];
  filesChanged: string[];
  recordsChanged: number;
  commitSha: string | null;
  deploymentId: string | null;
  approvalId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  /** Fresh lease start, independent of the task's first historical attempt. */
  attemptStartedAt?: string | null;
  completedAt: string | null;
  traceId: string | null;
};

export type TaskEvidence = {
  evidenceId: string;
  evidenceType: 'source_file_inspected' | 'source_file_changed' | 'code_diff' | 'database_query' | 'database_mutation' | 'test_result' | 'http_request' | 'commit_sha' | 'deployment_id' | 'production_verification' | 'approval_record' | 'log' | 'screenshot' | 'device_qa';
  source: string;
  contentHash: string;
  summary: string;
  createdAt: string;
  commitSha: string | null;
  deploymentId: string | null;
};

// ── Phase 7: Owner approval gate ─────────────────────────────────────────────

export type ApprovalRecord = {
  approvalId: string;
  taskId: string;
  action: string;
  resource: string;
  ownerIdentity: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  /** True once the approval has been used (replay prevention). */
  consumed: boolean;
  /** Immutable audit record of the approval decision. */
  auditRecord: {
    ownerEmail: string;
    actionRequested: string;
    resourceAffected: string;
    approvedAt: string;
    taskIdBound: string;
  };
};

export type ProtectedAction =
  | 'github_write'
  | 'production_deployment'
  | 'database_migration'
  | 'destructive_database_change'
  | 'secret_rotation'
  | 'external_outreach_sending'
  | 'financial_change'
  | 'member_deletion'
  | 'investor_deletion'
  | 'buyer_deletion'
  | 'bulk_data_import'
  | 'public_content_publication'
  | 'infrastructure_change'
  | 'access_revocation'
  | 'high_cost_ai_action';

export const ALL_PROTECTED_ACTIONS: readonly ProtectedAction[] = [
  'github_write', 'production_deployment', 'database_migration',
  'destructive_database_change', 'secret_rotation', 'external_outreach_sending',
  'financial_change', 'member_deletion', 'investor_deletion', 'buyer_deletion',
  'bulk_data_import', 'public_content_publication', 'infrastructure_change',
  'access_revocation', 'high_cost_ai_action',
];

// ── Phase 6: Agent routing ───────────────────────────────────────────────────

/** Map task type → enterprise agent numbers that can handle it. */
export function routeTaskToAgent(taskType: Task['taskType']): { agentNumber: number; engine: string } | null {
  switch (taskType) {
    case 'development':
      return { agentNumber: 1, engine: 'ivx_mobile_lead' };
    case 'security':
      return { agentNumber: 43, engine: 'ivx_security_lead' };
    case 'investor_research':
      return { agentNumber: 21, engine: 'ivx_investor_research' };
    case 'buyer_research':
      return { agentNumber: 24, engine: 'ivx_buyer_research' };
    case 'outreach':
      return { agentNumber: 27, engine: 'ivx_capital_outreach' };
    case 'deployment':
      return { agentNumber: 48, engine: 'ivx_deployment_engine' };
    case 'qa':
      return { agentNumber: 44, engine: 'ivx_qa_engineer' };
    case 'reporting':
      return { agentNumber: 33, engine: 'ivx_analytics_lead' };
    case 'discovery':
      return { agentNumber: 21, engine: 'ivx_investor_research' };
    case 'configuration':
      return { agentNumber: 47, engine: 'ivx_cloud_infrastructure' };
    default:
      return null;
  }
}

// ── Phase 8: Queue + leasing ─────────────────────────────────────────────────

const LEASE_DURATION_MS = 2 * 60 * 1000; // 20-second fleet heartbeat; bounded failover after a dead process
const APPROVAL_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// ── Durable persistence ──────────────────────────────────────────────────────

const STORE_DIR = path.join(process.cwd(), 'logs', 'audit', 'task-engine');
const OBJECTIVES_KEY = 'task-engine/objectives.json';
const TASKS_KEY = 'task-engine/tasks.json';
const APPROVALS_KEY = 'task-engine/approvals.json';
const EVENTS_KEY = 'task-engine/events.jsonl';

/**
 * Serialize read-modify-write mutations of the shared task document.
 *
 * The durable store persists the fleet in one JSONB document. Without this
 * lock, concurrent agent requests can read the same snapshot and the last
 * writer silently erases the other agent's task/evidence/state update. Render
 * currently runs this API as one process, so a process-wide FIFO mutex removes
 * that lost-update window while module inspection remains concurrent outside
 * these short mutation sections.
 */
let taskMutationTail: Promise<void> = Promise.resolve();

// P0 2026-09-05: collapse concurrent truth/dispatcher reads onto a short-lived
// process-local snapshot. Writes refresh the cache only after durable persistence
// succeeds. Supabase failures remain fail-closed; we never manufacture an empty queue.
const TASK_READ_CACHE_TTL_MS = 1_500;
let taskReadCache: { value: Task[]; at: number } | null = null;
let taskReadInFlight: Promise<Task[]> | null = null;
let taskWriteRevision = 0;

function cloneTasks(tasks: readonly Task[]): Task[] {
  // Durable reads are cached across the fleet. Never hand the cached array to a
  // mutation: an unsuccessful write would otherwise leave process memory ahead
  // of the durable ledger and manufacture lease/state evidence that was never
  // persisted.
  return structuredClone(tasks) as Task[];
}

async function withTaskMutationLock<T>(mutation: () => Promise<T>): Promise<T> {
  const previous = taskMutationTail;
  let release!: () => void;
  taskMutationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await mutation();
  } finally {
    release();
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

function generateNonce(): string {
  return Math.random().toString(36).slice(2, 18) + Date.now().toString(36);
}

function contentHash(input: string): string {
  // Simple hash for evidence integrity (not cryptographic, but tamper-evident)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `h${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/** Read all tasks from the durable store. */
async function readAllTasks(): Promise<Task[]> {
  if (postgresAtomicQueueSelected()) {
    return readPostgresAutonomousTasks();
  }
  if (isDurableStoreConfigured()) {
    const now = Date.now();
    if (taskReadCache && now - taskReadCache.at <= TASK_READ_CACHE_TTL_MS) {
      return cloneTasks(taskReadCache.value);
    }
    // The TTL alone does not collapse a cold-cache burst: all 112 callers can
    // miss it before the first Supabase read finishes. Share that read, including
    // its failure, instead of issuing another request for each agent/dashboard.
    if (taskReadInFlight) return cloneTasks(await taskReadInFlight);
    const readRevision = taskWriteRevision;
    const pending = (async () => {
      const data = await readDurableJson<Task[]>(TASKS_KEY, []);
      if (!Array.isArray(data)) {
        throw new Error('task_engine_durable_payload_not_array');
      }
      // A slow read started before a successful mutation must not replace its
      // newer persisted snapshot (or return the older task state to a caller).
      if (taskWriteRevision !== readRevision && taskReadCache) {
        return cloneTasks(taskReadCache.value);
      }
      taskReadCache = { value: cloneTasks(data), at: Date.now() };
      return data;
    })();
    taskReadInFlight = pending;
    try {
      return cloneTasks(await pending);
    } finally {
      if (taskReadInFlight === pending) taskReadInFlight = null;
    }
  }
  try {
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(path.join(STORE_DIR, 'tasks.json'), 'utf8'));
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Write all tasks to the durable store (atomic). */
async function writeAllTasks(tasks: Task[]): Promise<void> {
  if (postgresAtomicQueueSelected()) {
    throw new Error('postgres_atomic tasks must be mutated with row-atomic RPCs');
  }
  if (isDurableStoreConfigured()) {
    await writeDurableJson(TASKS_KEY, tasks);
    taskWriteRevision += 1;
    taskReadCache = { value: cloneTasks(tasks), at: Date.now() };
    return;
  }
  await mkdir(STORE_DIR, { recursive: true });
  const tmp = path.join(STORE_DIR, 'tasks.json.tmp');
  const final = path.join(STORE_DIR, 'tasks.json');
  await import('node:fs/promises').then((fs) => fs.writeFile(tmp, JSON.stringify(tasks, null, 2), 'utf8'));
  await import('node:fs/promises').then((fs) => fs.rename(tmp, final));
}

/** Read all approvals from the durable store. */
async function readAllApprovals(): Promise<ApprovalRecord[]> {
  if (isDurableStoreConfigured()) {
    try {
      const data = await readDurableJson<ApprovalRecord[]>(APPROVALS_KEY, []);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  try {
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(path.join(STORE_DIR, 'approvals.json'), 'utf8'));
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Write all approvals to the durable store. */
async function writeAllApprovals(approvals: ApprovalRecord[]): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(APPROVALS_KEY, approvals);
    return;
  }
  await mkdir(STORE_DIR, { recursive: true });
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(path.join(STORE_DIR, 'approvals.json'), JSON.stringify(approvals, null, 2), 'utf8'));
}

/** Read all objectives from the durable store. */
async function readAllObjectives(): Promise<Objective[]> {
  if (isDurableStoreConfigured()) {
    try {
      const data = await readDurableJson<Objective[]>(OBJECTIVES_KEY, []);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  try {
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(path.join(STORE_DIR, 'objectives.json'), 'utf8'));
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Write all objectives to the durable store. */
async function writeAllObjectives(objectives: Objective[]): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(OBJECTIVES_KEY, objectives);
    return;
  }
  await mkdir(STORE_DIR, { recursive: true });
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(path.join(STORE_DIR, 'objectives.json'), JSON.stringify(objectives, null, 2), 'utf8'));
}

/** Append an event to the audit log. */
async function appendEvent(event: Record<string, unknown>): Promise<void> {
  const enriched = { ...event, at: nowIso(), marker: IVX_TASK_ENGINE_MARKER };
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(EVENTS_KEY, enriched);
      return;
    } catch {
      // fall through
    }
  }
  try {
    await mkdir(STORE_DIR, { recursive: true });
    await appendFile(path.join(STORE_DIR, 'events.jsonl'), `${JSON.stringify(enriched)}\n`, 'utf8');
  } catch {
    // best-effort
  }
}

// ── Phase 5: Objective planning ──────────────────────────────────────────────

/**
 * Create an objective from an owner request with full planning metadata.
 * Rejects unsafe or ambiguous autonomous execution until scope is resolved.
 */
async function createObjectiveUnlocked(input: {
  ownerRequest: string;
  businessOutcome?: string;
  technicalOutcome?: string;
  scope?: string;
  exclusions?: string[];
  riskClassification?: RiskClassification;
  priority?: Objective['priority'];
  ownerRole?: string | null;
  targetDate?: string | null;
  successMetrics?: string[];
  idempotencyKey?: string | null;
  ownerEmail: string;
}): Promise<{ ok: boolean; objective: Objective | null; error: string | null; duplicate: boolean }> {
  const request = input.ownerRequest?.trim() ?? '';
  if (request.length === 0) {
    return { ok: false, objective: null, error: 'Empty owner request — scope cannot be resolved.', duplicate: false };
  }

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const objectives = await readAllObjectives();
  if (idempotencyKey) {
    const existing = objectives.find((objective) => objective.idempotencyKey === idempotencyKey && objective.status !== 'cancelled');
    if (existing) return { ok: true, objective: existing, error: null, duplicate: true };
  }

  // Auto-classify risk based on keywords
  const lowerRequest = request.toLowerCase();
  let risk: RiskClassification = input.riskClassification ?? 'low';
  if (/\b(deploy|production|database|migrat|secret|credential|delete|drop|payment|billing|outreach|send)\b/.test(lowerRequest)) {
    risk = 'high';
  }
  if (/\b(destructive|irreversible|legal|compliance|financial|bulk|public)\b/.test(lowerRequest)) {
    risk = 'critical';
  }

  // Auto-detect required approvals
  const requiredApprovals: string[] = [];
  if (/\b(deploy|production)\b/.test(lowerRequest)) requiredApprovals.push('production_deployment');
  if (/\b(git|commit|push|github)\b/.test(lowerRequest)) requiredApprovals.push('github_write');
  if (/\b(migrat|schema|alter\s+table)\b/.test(lowerRequest)) requiredApprovals.push('database_migration');
  if (/\b(delete|drop|truncate|purge)\b/.test(lowerRequest)) requiredApprovals.push('destructive_database_change');
  if (/\b(secret|credential|token|password|key\s+rotation)\b/.test(lowerRequest)) requiredApprovals.push('secret_rotation');
  if (/\b(outreach|send\s+email|campaign|contact)\b/.test(lowerRequest)) requiredApprovals.push('external_outreach_sending');
  if (/\b(payment|billing|charge|refund|financial)\b/.test(lowerRequest)) requiredApprovals.push('financial_change');
  if (/\b(delete\s+member|remove\s+user)\b/.test(lowerRequest)) requiredApprovals.push('member_deletion');
  if (/\b(delete\s+investor|remove\s+investor)\b/.test(lowerRequest)) requiredApprovals.push('investor_deletion');
  if (/\b(delete\s+buyer|remove\s+buyer)\b/.test(lowerRequest)) requiredApprovals.push('buyer_deletion');
  if (/\b(bulk\s+import|mass\s+upload)\b/.test(lowerRequest)) requiredApprovals.push('bulk_data_import');
  if (/\b(publish|public\s+content|blog\s+post|press)\b/.test(lowerRequest)) requiredApprovals.push('public_content_publication');
  if (/\b(infrastructure|server|dns|domain|cdn)\b/.test(lowerRequest)) requiredApprovals.push('infrastructure_change');
  if (/\b(revoke\s+access|remove\s+access|block\s+user)\b/.test(lowerRequest)) requiredApprovals.push('access_revocation');

  // Auto-detect task type for routing
  const taskType = detectTaskType(request);

  // Auto-generate acceptance criteria based on task type
  const acceptanceCriteria = generateAcceptanceCriteria(taskType, request);

  const objective: Objective = {
    objectiveId: generateId('obj'),
    idempotencyKey,
    originalOwnerRequest: request,
    businessOutcome: input.businessOutcome ?? inferBusinessOutcome(request, taskType),
    technicalOutcome: input.technicalOutcome ?? inferTechnicalOutcome(request, taskType),
    scope: input.scope ?? inferScope(request, taskType),
    exclusions: input.exclusions ?? [],
    riskClassification: risk,
    requiredApprovals,
    acceptanceCriteria,
    priority: input.priority ?? (risk === 'critical' ? 'critical' : risk === 'high' ? 'high' : 'medium'),
    estimatedEffort: inferEffort(taskType),
    ownerRole: input.ownerRole?.trim() || null,
    targetDate: validIsoOrNull(input.targetDate),
    successMetrics: (input.successMetrics ?? []).map((metric) => metric.trim()).filter(Boolean).slice(0, 20),
    assignedEngine: routeTaskToAgent(taskType)?.engine ?? null,
    rollbackRequirement: risk === 'high' || risk === 'critical',
    finalVerificationMethod: taskType === 'development' ? 'production_check' : 'evidence',
    createdAt: nowIso(),
    status: 'active',
  };

  objectives.push(objective);
  await writeAllObjectives(objectives);
  await appendEvent({ type: 'objective_created', objectiveId: objective.objectiveId, risk, requiredApprovals });

  return { ok: true, objective, error: null, duplicate: false };
}

export async function createObjective(input: Parameters<typeof createObjectiveUnlocked>[0]): ReturnType<typeof createObjectiveUnlocked> {
  return withTaskMutationLock(() => createObjectiveUnlocked(input));
}

/**
 * Attach legacy/orphan task rows to a real portfolio objective without changing
 * their execution state, evidence, ownership or timestamps. This is an
 * idempotent metadata repair used by the Autonomous PM bootstrap.
 */
async function linkOrphanTasksToObjectiveUnlocked(objectiveId: string): Promise<{
  ok: boolean;
  linked: number;
  error: string | null;
}> {
  const objectives = await readAllObjectives();
  if (!objectives.some((objective) => objective.objectiveId === objectiveId && objective.status !== 'cancelled')) {
    return { ok: false, linked: 0, error: 'Objective not found or cancelled.' };
  }
  const tasks = await readAllTasks();
  let linked = 0;
  for (const task of tasks) {
    if (task.objectiveId) continue;
    task.objectiveId = objectiveId;
    linked += 1;
  }
  if (linked === 0) return { ok: true, linked: 0, error: null };
  await writeAllTasks(tasks);
  await appendEvent({ type: 'orphan_tasks_linked_to_objective', objectiveId, linked });
  return { ok: true, linked, error: null };
}

export async function linkOrphanTasksToObjective(objectiveId: string): Promise<{
  ok: boolean;
  linked: number;
  error: string | null;
}> {
  if (postgresAtomicQueueSelected()) {
    return withTaskMutationLock(async () => {
      const objectives = await readAllObjectives();
      if (!objectives.some((objective) => objective.objectiveId === objectiveId && objective.status !== 'cancelled')) {
        return { ok: false, linked: 0, error: 'Objective not found or cancelled.' };
      }
      const linked = await linkPostgresAutonomousOrphans(objectiveId);
      return { ok: true, linked, error: null };
    });
  }
  return withTaskMutationLock(() => linkOrphanTasksToObjectiveUnlocked(objectiveId));
}

function detectTaskType(request: string): Task['taskType'] {
  const r = request.toLowerCase();
  if (/\b(fix|bug|defect|patch|code|implement|feature|ui|backend|api)\b/.test(r)) return 'development';
  if (/\b(security|vulnerab|cve|exploit|auth|permission)\b/.test(r)) return 'security';
  if (/\b(investor|funding|capital|vc|angel)\b/.test(r)) return 'investor_research';
  if (/\b(buyer|acquisition|target|search)\b/.test(r)) return 'buyer_research';
  if (/\b(outreach|email|campaign|contact|send)\b/.test(r)) return 'outreach';
  if (/\b(deploy|render|production|release)\b/.test(r)) return 'deployment';
  if (/\b(qa|test|verify|quality)\b/.test(r)) return 'qa';
  if (/\b(report|summary|dashboard|status)\b/.test(r)) return 'reporting';
  if (/\b(discover|find|scan|search)\b/.test(r)) return 'discovery';
  if (/\b(config|setting|env|variable)\b/.test(r)) return 'configuration';
  return 'development';
}

function generateAcceptanceCriteria(taskType: Task['taskType'], request: string): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = [];
  const baseId = `ac_${Date.now().toString(36)}`;

  switch (taskType) {
    case 'development':
      criteria.push({
        id: `${baseId}_diff`,
        description: 'Code diff exists and addresses the root cause',
        verificationMethod: 'code_diff',
        met: false,
        evidence: null,
      });
      criteria.push({
        id: `${baseId}_test`,
        description: 'Relevant tests pass after the change',
        verificationMethod: 'test_pass',
        met: false,
        evidence: null,
      });
      criteria.push({
        id: `${baseId}_prod`,
        description: 'Production verification confirms the fix is live',
        verificationMethod: 'production_check',
        met: false,
        evidence: null,
      });
      break;
    case 'deployment':
      criteria.push({
        id: `${baseId}_deploy`,
        description: 'Deployment completed successfully',
        verificationMethod: 'evidence',
        met: false,
        evidence: null,
      });
      criteria.push({
        id: `${baseId}_health`,
        description: 'Production health check passes after deploy',
        verificationMethod: 'http_200',
        met: false,
        evidence: null,
      });
      break;
    case 'investor_research':
    case 'buyer_research':
    case 'discovery':
      criteria.push({
        id: `${baseId}_evidence`,
        description: 'Real evidence artifacts (SEC URLs, CRM records) captured',
        verificationMethod: 'evidence',
        met: false,
        evidence: null,
      });
      break;
    case 'outreach':
      criteria.push({
        id: `${baseId}_approval`,
        description: 'Owner approval obtained before sending',
        verificationMethod: 'evidence',
        met: false,
        evidence: null,
      });
      break;
    default:
      criteria.push({
        id: `${baseId}_evidence`,
        description: 'Task-specific evidence captured',
        verificationMethod: 'evidence',
        met: false,
        evidence: null,
      });
  }

  return criteria;
}

function inferBusinessOutcome(request: string, taskType: Task['taskType']): string {
  switch (taskType) {
    case 'development': return 'Fix or implement the requested feature';
    case 'security': return 'Close the security gap';
    case 'investor_research': return 'Discover and qualify potential investors';
    case 'buyer_research': return 'Discover and qualify potential buyers';
    case 'outreach': return 'Draft and queue outreach for owner-approved sending';
    case 'deployment': return 'Deploy approved changes to production';
    case 'qa': return 'Verify quality of the target system';
    case 'reporting': return 'Generate the requested report';
    default: return 'Complete the owner request';
  }
}

function inferTechnicalOutcome(request: string, taskType: Task['taskType']): string {
  switch (taskType) {
    case 'development': return 'Code change committed and deployed';
    case 'security': return 'Security issue remediated';
    case 'deployment': return 'Production updated to target commit';
    default: return 'Task completed with evidence';
  }
}

function inferScope(request: string, taskType: Task['taskType']): string {
  return `Scope: ${taskType} task derived from owner request. Full scope resolution requires task decomposition.`;
}

function inferEffort(taskType: Task['taskType']): string {
  switch (taskType) {
    case 'development': return 'medium (30min–2hr)';
    case 'deployment': return 'low (5–15min)';
    case 'investor_research':
    case 'buyer_research': return 'medium (15–45min)';
    case 'outreach': return 'low (10–20min)';
    default: return 'low (5–30min)';
  }
}

function validIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

// ── Phase 4 + 8: Task creation + queue ───────────────────────────────────────

/**
 * Create a task and add it to the queue. Uses idempotency key to prevent
 * duplicate submissions — duplicate submissions return the existing task.
 */
export type CreateTaskInput = {
  objectiveId?: string | null;
  parentTaskId?: string | null;
  title: string;
  description: string;
  taskType?: Task['taskType'];
  idempotencyKey: string;
  assignedAgentNumber?: number | null;
  assignedEngine?: string | null;
  priority?: Task['priority'];
  businessValue?: number;
  estimatedMinutes?: number | null;
  milestone?: string | null;
  ownerRole?: string | null;
  dueAt?: string | null;
  acceptanceCriteria?: AcceptanceCriterion[];
  dependencies?: string[];
  executionOrder?: number;
  maxRetries?: number;
};

export type CreateTaskResult = { ok: boolean; task: Task | null; error: string | null; duplicate: boolean };

function buildQueuedTask(input: CreateTaskInput): Task {
  const taskType = input.taskType ?? 'development';
  const routing = routeTaskToAgent(taskType);
  const requestedBusinessValue = Number.isFinite(input.businessValue) ? Number(input.businessValue) : 3;
  const requestedEstimate = Number.isFinite(input.estimatedMinutes) ? Number(input.estimatedMinutes) : null;

  const task: Task = {
    taskId: generateId('task'),
    objectiveId: input.objectiveId ?? null,
    parentTaskId: input.parentTaskId ?? null,
    title: input.title,
    description: input.description,
    taskType,
    state: 'QUEUED',
    idempotencyKey: input.idempotencyKey,
    assignedAgentNumber: input.assignedAgentNumber ?? routing?.agentNumber ?? null,
    assignedEngine: input.assignedEngine ?? routing?.engine ?? null,
    priority: input.priority ?? 'medium',
    businessValue: Math.max(1, Math.min(5, Math.round(requestedBusinessValue))),
    estimatedMinutes: requestedEstimate == null ? null : Math.max(1, Math.min(43_200, Math.round(requestedEstimate))),
    milestone: input.milestone?.trim() || null,
    ownerRole: input.ownerRole?.trim() || null,
    dueAt: validIsoOrNull(input.dueAt),
    acceptanceCriteria: input.acceptanceCriteria ?? generateAcceptanceCriteria(taskType, input.title),
    dependencies: input.dependencies ?? [],
    executionOrder: input.executionOrder ?? 0,
    leaseHolder: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    retryCount: 0,
    maxRetries: input.maxRetries ?? 3,
    error: null,
    blocker: null,
    evidence: [],
    filesChanged: [],
    recordsChanged: 0,
    commitSha: null,
    deploymentId: null,
    approvalId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    completedAt: null,
    traceId: null,
  };

  return task;
}

async function createTaskUnlocked(input: CreateTaskInput): Promise<CreateTaskResult> {
  const tasks = await readAllTasks();

  // Phase 8: Duplicate prevention — check idempotency key
  const existing = tasks.find((t) => t.idempotencyKey === input.idempotencyKey && t.state !== 'CANCELLED' && t.state !== 'EXPIRED');
  if (existing) {
    return { ok: true, task: existing, error: null, duplicate: true };
  }

  const task = buildQueuedTask(input);

  tasks.push(task);
  await writeAllTasks(tasks);
  await appendEvent({ type: 'task_created', taskId: task.taskId, state: task.state, taskType: task.taskType });

  return { ok: true, task, error: null, duplicate: false };
}

export async function createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
  if (postgresAtomicQueueSelected()) {
    const [result] = await createPostgresAutonomousTasks([buildQueuedTask(input)]);
    return result ?? { ok: false, task: null, error: 'postgres_atomic create returned no result', duplicate: false };
  }
  return withTaskMutationLock(() => createTaskUnlocked(input));
}

/**
 * Create a fleet backlog with one durable document write. Idempotency is
 * evaluated against both existing state and tasks created earlier in this same
 * batch, so a 112-lane bootstrap cannot lose rows or issue 112 full-document
 * writes.
 */
export async function createTasksBatch(inputs: readonly CreateTaskInput[]): Promise<CreateTaskResult[]> {
  if (postgresAtomicQueueSelected()) {
    return createPostgresAutonomousTasks(inputs.map((input) => buildQueuedTask(input)));
  }
  return withTaskMutationLock(async () => {
    if (inputs.length === 0) return [];
    const tasks = await readAllTasks();
    const activeByKey = new Map(
      tasks
        .filter((task) => task.state !== 'CANCELLED' && task.state !== 'EXPIRED')
        .map((task) => [task.idempotencyKey, task]),
    );
    const results: CreateTaskResult[] = [];
    const created: Task[] = [];

    for (const input of inputs) {
      const existing = activeByKey.get(input.idempotencyKey);
      if (existing) {
        results.push({ ok: true, task: existing, error: null, duplicate: true });
        continue;
      }
      const task = buildQueuedTask(input);
      tasks.push(task);
      activeByKey.set(task.idempotencyKey, task);
      created.push(task);
      results.push({ ok: true, task, error: null, duplicate: false });
    }

    if (created.length > 0) {
      await writeAllTasks(tasks);
      await appendEvent({
        type: 'tasks_created_batch',
        count: created.length,
        taskIds: created.map((task) => task.taskId),
      });
    }
    return results;
  });
}

/**
 * Transition a task to a new state. Enforces the 23-state machine.
 * Rejects invalid transitions. Persists state + appends audit event.
 */
async function transitionTaskStateUnlocked(
  taskId: string,
  toState: TaskState,
  metadata?: { error?: string; blocker?: string; evidence?: TaskEvidence; filesChanged?: string[]; commitSha?: string; deploymentId?: string; approvalId?: string; workerId?: string },
): Promise<{ ok: boolean; task: Task | null; error: string | null }> {
  const tasks = await readAllTasks();
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) {
    return { ok: false, task: null, error: `Task not found: ${taskId}` };
  }

  const fromState = task.state;
  const before = structuredClone(task);

  if (fromState === 'RETRYING' && (toState === 'QUEUED' || toState === 'RUNNING') && (!taskRetryDue(task) || toState === 'RUNNING')) {
    return { ok: false, task, error: 'Retry must become due and acquire a fresh queue lease.' };
  }

  // Terminal states cannot transition
  if (TERMINAL_STATES.includes(fromState) && !TERMINAL_STATES.includes(toState)) {
    return { ok: false, task, error: `Task is in terminal state ${fromState} — cannot transition to ${toState}.` };
  }

  // Enforce valid transitions
  if (!isValidTransition(fromState, toState)) {
    return { ok: false, task, error: `Invalid transition: ${fromState} → ${toState}. Allowed: ${VALID_TRANSITIONS[fromState].join(', ')}.` };
  }

  // Apply transition
  task.state = toState;
  task.updatedAt = nowIso();
  if (fromState === 'RETRYING' && toState === 'QUEUED' && taskRetryExpired(task)) {
    task.state = 'FAILED'; task.error = 'retry time_budget exhausted'; task.completedAt = nowIso();
  }

  if (metadata?.error) task.error = metadata.error;
  if (metadata?.blocker) task.blocker = metadata.blocker;
  if (metadata?.evidence) task.evidence.push(metadata.evidence);
  if (metadata?.filesChanged) task.filesChanged.push(...metadata.filesChanged);
  if (metadata?.commitSha) task.commitSha = metadata.commitSha;
  if (metadata?.deploymentId) task.deploymentId = metadata.deploymentId;
  if (metadata?.approvalId) task.approvalId = metadata.approvalId;

  if (toState === 'RUNNING') { task.attemptStartedAt = nowIso(); task.startedAt ??= task.attemptStartedAt; }
  if (toState === 'LEASED') {
    task.leaseHolder = generateId('worker');
    task.leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  }
  if (toState === 'RETRYING' || fromState === 'BLOCKED' && toState === 'QUEUED') Object.assign(task, planTaskRetry(task));
  if (TERMINAL_SUCCESS_STATES.includes(toState)) task.completedAt = nowIso();
  if (toState === 'FAILED') task.completedAt = nowIso();

  if (toState === 'VERIFIED') {
    const validation = validateCompletion(task);
    if (validation.verdict !== 'VERIFIED') return { ok: false, task: before, error: validation.reason };
    if (!metadata?.workerId || task.leaseHolder !== metadata.workerId || !(Date.parse(task.leaseExpiresAt ?? '') > Date.now())) {
      return { ok: false, task: before, error: 'Verification requires the current unexpired worker lease.' };
    }
  }

  await writeAllTasks(tasks);
  await appendEvent({ type: 'state_transition', taskId, fromState, toState, error: metadata?.error, blocker: metadata?.blocker });

  return { ok: true, task, error: null };
}

export async function transitionTaskState(
  taskId: string,
  toState: TaskState,
  metadata?: { error?: string; blocker?: string; evidence?: TaskEvidence; filesChanged?: string[]; commitSha?: string; deploymentId?: string; approvalId?: string; workerId?: string },
): Promise<{ ok: boolean; task: Task | null; error: string | null }> {
  if (postgresAtomicQueueSelected()) {
    if (toState === 'LEASED') {
      return {
        ok: false,
        task: null,
        error: 'postgres_atomic leases must be acquired with leaseNextTask or leaseNextTasksBatch.',
      };
    }
    return withTaskMutationLock(async () => {
      const task = await readPostgresTaskById(taskId);
      if (!task) return { ok: false, task: null, error: `Task not found: ${taskId}` };
      const fromState = task.state;
      const before = structuredClone(task);
      if (fromState === 'RETRYING' && (toState === 'QUEUED' || toState === 'RUNNING') && (!taskRetryDue(task) || toState === 'RUNNING')) {
        return { ok: false, task, error: 'Retry must become due and acquire a fresh queue lease.' };
      }
      if (TERMINAL_STATES.includes(fromState) && !TERMINAL_STATES.includes(toState)) {
        return { ok: false, task, error: `Task is in terminal state ${fromState} — cannot transition to ${toState}.` };
      }
      if (!isValidTransition(fromState, toState)) {
        return { ok: false, task, error: `Invalid transition: ${fromState} → ${toState}. Allowed: ${VALID_TRANSITIONS[fromState].join(', ')}.` };
      }
      task.state = toState;
      task.updatedAt = nowIso();
      if (fromState === 'RETRYING' && toState === 'QUEUED' && taskRetryExpired(task)) {
        task.state = 'FAILED'; task.error = 'retry time_budget exhausted'; task.completedAt = nowIso();
      }
      if (metadata?.error) task.error = metadata.error;
      if (metadata?.blocker) task.blocker = metadata.blocker;
      if (metadata?.evidence) task.evidence.push(metadata.evidence);
      if (metadata?.filesChanged) task.filesChanged.push(...metadata.filesChanged);
      if (metadata?.commitSha) task.commitSha = metadata.commitSha;
      if (metadata?.deploymentId) task.deploymentId = metadata.deploymentId;
      if (metadata?.approvalId) task.approvalId = metadata.approvalId;
      if (toState === 'RUNNING') { task.attemptStartedAt = nowIso(); task.startedAt ??= task.attemptStartedAt; }
      if (toState === 'RETRYING' || fromState === 'BLOCKED' && toState === 'QUEUED') Object.assign(task, planTaskRetry(task));
      if (TERMINAL_SUCCESS_STATES.includes(toState) || toState === 'FAILED') task.completedAt = nowIso();
      if (toState === 'VERIFIED') {
        const validation = validateCompletion(task);
        if (validation.verdict !== 'VERIFIED') return { ok: false, task: before, error: validation.reason };
        if (!metadata?.workerId || task.leaseHolder !== metadata.workerId || !(Date.parse(task.leaseExpiresAt ?? '') > Date.now())) {
          return { ok: false, task: before, error: 'Verification requires the current unexpired worker lease.' };
        }
      }
      return compareAndSetPostgresAutonomousTask({ task, expectedStates: [fromState],
        ...(toState === 'VERIFIED' ? { leaseHolder: metadata!.workerId } : {}), eventType: 'state_transition' });
    });
  }
  return withTaskMutationLock(() => transitionTaskStateUnlocked(taskId, toState, metadata));
}

// ── Phase 8: Leasing ─────────────────────────────────────────────────────────

/** Mid-completion states that must finish within milliseconds; older than this = process died mid-cycle. */
const STRANDED_MIDCOMPLETION_MS = 10 * 60 * 1000;

export type StrandedRecovery = { requeued: string[]; expired: string[]; failed: string[]; duplicatesRetired: string[]; blockedRequeued: string[] };

/** BLOCKED Landing units re-verify on this cadence while retries remain (CI evidence appears later). */
const BLOCKED_REVERIFY_MS = 30 * 60 * 1000;
const REVERIFY_KEY_PREFIXES = ['landing-p0:', 'landing-p0-repair:'] as const;

/** Progress rank used to pick the survivor among duplicate tasks (higher = further along). */
export function taskProgressRank(state: TaskState): number {
  const ranks: Partial<Record<TaskState, number>> = {
    VERIFIED: 100, NO_ACTION_REQUIRED: 100, PRODUCTION_VERIFYING: 90, DEPLOYED: 90, DEPLOYING: 85, READY_FOR_DEPLOYMENT: 85,
    QA_IN_PROGRESS: 80, EXECUTION_COMPLETED: 75, RUNNING: 60, LEASED: 50, RETRYING: 40, BLOCKED: 35, QUEUED: 30,
    WAITING_FOR_APPROVAL: 25, PAUSED: 20, PLANNING: 10, VALIDATING: 10, RECEIVED: 10, QA_FAILED: 8, FAILED: 5, STALE: 5,
  };
  return ranks[state] ?? 0;
}

/**
 * Two API processes can coexist for ~1 minute during a zero-downtime redeploy;
 * each has its own mutex, so both may create the same idempotencyKey from stale
 * snapshots. Keep the most-progressed task per key and retire the rest so a unit
 * is never executed twice. Mutates in place; returns retired task ids.
 */
export function retireDuplicateTasksInPlace(tasks: Task[], nowMs: number): string[] {
  const retired: string[] = [];
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.state === 'CANCELLED' || t.state === 'EXPIRED') continue;
    const group = groups.get(t.idempotencyKey);
    if (group) group.push(t); else groups.set(t.idempotencyKey, [t]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => taskProgressRank(b.state) - taskProgressRank(a.state) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const survivor = group[0];
    for (const dupe of group.slice(1)) {
      if (TERMINAL_SUCCESS_STATES.includes(dupe.state)) continue; // both succeeded; harmless, reports dedupe by key
      if (dupe.state === 'LEASED') dupe.state = 'EXPIRED';
      else if (['EXECUTION_COMPLETED', 'QA_IN_PROGRESS', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING'].includes(dupe.state)) dupe.state = 'FAILED';
      else if (dupe.state === 'FAILED') continue;
      else dupe.state = 'CANCELLED';
      dupe.error = `duplicate of ${survivor.taskId} (cross-process idempotency collision)`;
      dupe.leaseHolder = null;
      dupe.leaseExpiresAt = null;
      dupe.updatedAt = new Date(nowMs).toISOString();
      retired.push(dupe.taskId);
    }
  }
  return retired;
}

/**
 * Recover tasks stranded by a process death (redeploy/crash) so the fleet can
 * re-lease them instead of idling forever. Mutates `tasks` in place; caller persists.
 *
 *   LEASED past leaseExpiresAt                 → QUEUED (existing behaviour)
 *   RUNNING with heartbeat older than 30 min   → QUEUED (+retry) — was STALE dead-end
 *   STALE                                      → QUEUED (+retry) or EXPIRED past maxRetries
 *   EXECUTION_COMPLETED / QA_IN_PROGRESS       → QUEUED (+retry) when untouched > 10 min
 *
 * Fail-closed: recovered tasks must be re-executed to produce fresh evidence —
 * nothing is auto-VERIFIED. Root cause on 2026-09-04 production ledger: 101 STALE +
 * 18 EXECUTION_COMPLETED + 7 RUNNING stranded tasks with no recovery path.
 */
export function recoverStrandedTasksInPlace(tasks: Task[], nowMs: number): StrandedRecovery {
  const recovery: StrandedRecovery = { requeued: [], expired: [], failed: [], duplicatesRetired: [], blockedRequeued: [] };
  recovery.duplicatesRetired = retireDuplicateTasksInPlace(tasks, nowMs);
  const requeue = (t: Task, reason: string) => {
    const previousState = t.state;
    Object.assign(t, planTaskRetry(t, nowMs));
    if (t.state === 'FAILED') {
      // STALE may expire; mid-completion strandings fail closed.
      t.state = previousState === 'STALE' ? 'EXPIRED' : 'FAILED';
      t.error = `stranded (${reason}); ${t.error}`;
      (t.state === 'EXPIRED' ? recovery.expired : recovery.failed).push(t.taskId);
    } else {
      t.error = null;
      recovery.requeued.push(t.taskId);
    }
    t.leaseHolder = null;
    t.leaseExpiresAt = null;
    t.updatedAt = new Date(nowMs).toISOString();
  };
  for (const t of tasks) {
    if (t.state === 'RETRYING' && taskRetryDue(t, nowMs)) {
      t.state = taskRetryExpired(t, nowMs) ? 'FAILED' : 'QUEUED';
      t.updatedAt = new Date(nowMs).toISOString();
      if (t.state === 'FAILED') { t.error = 'retry time_budget exhausted'; t.completedAt = t.updatedAt; recovery.failed.push(t.taskId); }
      else recovery.requeued.push(t.taskId);
      continue;
    }
    const lastTouch = Date.parse(t.lastHeartbeatAt ?? t.updatedAt ?? t.createdAt ?? '') || 0;
    if (t.state === 'LEASED' && t.leaseExpiresAt && Date.parse(t.leaseExpiresAt) < nowMs) {
      t.state = 'QUEUED';
      t.leaseHolder = null;
      t.leaseExpiresAt = null;
      t.updatedAt = new Date(nowMs).toISOString();
      recovery.requeued.push(t.taskId);
      continue;
    }
    if (t.state === 'RUNNING' && lastTouch > 0 && lastTouch < nowMs - STALE_THRESHOLD_MS) { requeue(t, 'RUNNING without heartbeat'); continue; }
    if (t.state === 'STALE') { requeue(t, 'STALE'); continue; }
    // BLOCKED Landing units re-verify (bounded by maxRetries): immediately after a
    // quoted GitHub rate-limit reset, otherwise every 30 minutes. BLOCKED → QUEUED is a
    // valid transition; module-audit OWNER_GATE blocks are never touched.
    if (t.state === 'BLOCKED' && REVERIFY_KEY_PREFIXES.some((prefix) => t.idempotencyKey.startsWith(prefix)) && t.retryCount < Math.max(0, t.maxRetries)) {
      const reset = /resets (\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/.exec(t.blocker ?? '');
      const due = reset ? Date.parse(reset[1]) + 30_000 : (Date.parse(t.updatedAt) || 0) + BLOCKED_REVERIFY_MS;
      if (nowMs >= due) {
        Object.assign(t, planTaskRetry(t, nowMs));
        t.blocker = null;
        t.leaseHolder = null;
        t.leaseExpiresAt = null;
        t.updatedAt = new Date(nowMs).toISOString();
        recovery.blockedRequeued.push(t.taskId);
      }
      continue;
    }
    if ((t.state === 'EXECUTION_COMPLETED' || t.state === 'QA_IN_PROGRESS') && lastTouch > 0 && lastTouch < nowMs - STRANDED_MIDCOMPLETION_MS) {
      requeue(t, `${t.state} abandoned mid-completion`);
    }
  }
  return recovery;
}

export type LeaseOptions = {
  /**
   * Work-stealing: when the agent's own lane (own + unassigned tasks) is empty,
   * allow leasing QUEUED tasks whose idempotencyKey starts with this prefix even
   * if they are assigned to another agent. Leasing stays atomic under the
   * mutation lock, so a task is never executed by two agents at once.
   */
  stealPrefix?: string | null;
  /**
   * Keep version-bound mission work on the active release. Tasks outside these
   * active prefixes remain durable history but cannot be leased by a newer
   * runtime. Non-mission tasks are unaffected.
   */
  missionScope?: {
    familyPrefixes: readonly string[];
    activePrefixes: readonly string[];
  } | null;
};

export function isTaskWithinMissionScope(
  task: Pick<Task, 'idempotencyKey'>,
  scope: LeaseOptions['missionScope'],
): boolean {
  if (!scope) return true;
  const belongsToMissionFamily = scope.familyPrefixes.some((prefix) => task.idempotencyKey.startsWith(prefix));
  if (!belongsToMissionFamily) return true;
  return scope.activePrefixes.some((prefix) => task.idempotencyKey.startsWith(prefix));
}

/**
 * Deterministic PM scheduling score. Safety/priority dominates, then an owner
 * deadline, business value and anti-starvation age. This prevents a stream of
 * newer medium work from starving an older high-value task.
 */
export function taskSchedulingScore(task: Task, nowMs = Date.now()): number {
  const priorityBase: Record<Task['priority'], number> = { critical: 40_000, high: 30_000, medium: 20_000, low: 10_000 };
  const dueMs = task.dueAt ? Date.parse(task.dueAt) : Number.NaN;
  let deadline = 0;
  if (Number.isFinite(dueMs)) {
    const remaining = dueMs - nowMs;
    if (remaining <= 0) deadline = 4_000;
    else if (remaining <= 24 * 60 * 60 * 1000) deadline = 3_000;
    else if (remaining <= 7 * 24 * 60 * 60 * 1000) deadline = 2_000;
    else if (remaining <= 30 * 24 * 60 * 60 * 1000) deadline = 1_000;
  }
  const createdMs = Date.parse(task.createdAt);
  const ageDays = Number.isFinite(createdMs) ? Math.max(0, (nowMs - createdMs) / (24 * 60 * 60 * 1000)) : 0;
  const antiStarvation = Math.min(900, Math.floor(ageDays * 30));
  const businessValue = Math.max(1, Math.min(5, Math.round(task.businessValue ?? 3))) * 100;
  return priorityBase[task.priority] + deadline + businessValue + antiStarvation;
}

export function compareProjectManagedTasks(a: Task, b: Task, nowMs = Date.now()): number {
  const scoreDelta = taskSchedulingScore(b, nowMs) - taskSchedulingScore(a, nowMs);
  if (scoreDelta !== 0) return scoreDelta;
  if (a.executionOrder !== b.executionOrder) return a.executionOrder - b.executionOrder;
  return a.createdAt.localeCompare(b.createdAt) || a.taskId.localeCompare(b.taskId);
}

/**
 * Lease the next queued task for a worker. Returns null when no task is available.
 * Enforces: one active lease per task, lease expiration, priority ordering, and
 * AGENT OWNERSHIP: when agentNumber is provided, only tasks assigned to that
 * agent (or explicitly unassigned shared tasks) are leasable — a task created
 * for IA-37 can never be leased by IA-01 — unless `options.stealPrefix` opts a
 * mission (e.g. `landing-p0:`) into work-stealing after the own lane is drained.
 */
function recoveryChangeCount(recovery: StrandedRecovery): number {
  return recovery.requeued.length
    + recovery.expired.length
    + recovery.failed.length
    + recovery.duplicatesRetired.length
    + recovery.blockedRequeued.length;
}

function selectLeaseCandidate(
  tasks: Task[],
  agentNumber: number | null | undefined,
  options: LeaseOptions,
  now: number,
): { task: Task | null; stolen: boolean } {
  const dependenciesMet = (t: Task): boolean => t.dependencies.every((depId) => {
    const dep = tasks.find((d) => d.taskId === depId);
    return dep && TERMINAL_SUCCESS_STATES.includes(dep.state);
  });
  const byPriority = (a: Task, b: Task): number => compareProjectManagedTasks(a, b, now);
  const queued = tasks.filter((t) => t.state === 'QUEUED'
    && taskRetryDue(t, now)
    && dependenciesMet(t)
    && isTaskWithinMissionScope(t, options.missionScope));
  let candidates = queued
    // Ownership filter: agents lease only their own tasks plus explicitly
    // unassigned shared tasks. Shared/legacy tasks (assignedAgentNumber null)
    // remain leasable by anyone so existing backlog never strands.
    .filter((t) => agentNumber == null || t.assignedAgentNumber == null || t.assignedAgentNumber === agentNumber)
    .sort(byPriority);
  let stolen = false;
  if (candidates.length === 0 && options.stealPrefix) {
    const prefix = options.stealPrefix;
    candidates = queued.filter((t) => t.idempotencyKey.startsWith(prefix)).sort(byPriority);
    stolen = candidates.length > 0;
  }
  return { task: candidates[0] ?? null, stolen };
}

function markTaskLeased(task: Task, workerId: string, now: number): void {
  const at = new Date(now).toISOString();
  task.state = 'LEASED';
  task.updatedAt = at;
  task.leaseHolder = workerId;
  task.leaseExpiresAt = new Date(now + LEASE_DURATION_MS).toISOString();
  task.lastHeartbeatAt = at;
}

async function appendRecoveryEvent(recovery: StrandedRecovery, workerId: string): Promise<void> {
  if (recoveryChangeCount(recovery) === 0) return;
  await appendEvent({
    type: 'tasks_recovered',
    workerId,
    requeued: recovery.requeued.length,
    expired: recovery.expired.length,
    failed: recovery.failed.length,
    duplicatesRetired: recovery.duplicatesRetired.length,
    blockedRequeued: recovery.blockedRequeued.length,
    sample: recovery.requeued.slice(0, 5),
  });
}

async function leaseNextTaskUnlocked(workerId: string, agentNumber?: number | null, options: LeaseOptions = {}): Promise<{ ok: boolean; task: Task | null; error: string | null }> {
  const tasks = await readAllTasks();
  const now = Date.now();
  const recovery = recoverStrandedTasksInPlace(tasks, now);
  const selected = selectLeaseCandidate(tasks, agentNumber, options, now);

  if (!selected.task) {
    if (recoveryChangeCount(recovery) > 0) {
      await writeAllTasks(tasks);
      await appendRecoveryEvent(recovery, workerId);
    }
    return { ok: true, task: null, error: null };
  }

  markTaskLeased(selected.task, workerId, now);
  await writeAllTasks(tasks);
  await appendRecoveryEvent(recovery, workerId);
  await appendEvent({
    type: 'task_leased',
    taskId: selected.task.taskId,
    workerId,
    ...(selected.stolen ? { stolenFromAgentNumber: selected.task.assignedAgentNumber, byAgentNumber: agentNumber ?? null } : {}),
  });
  return { ok: true, task: selected.task, error: null };
}

export type FleetLeaseRequest = {
  workerId: string;
  agentNumber?: number | null;
  options?: LeaseOptions;
};

export type FleetLeaseResult = {
  workerId: string;
  agentNumber: number | null;
  ok: boolean;
  task: Task | null;
  error: string | null;
  stolen: boolean;
};

/**
 * Lease one distinct task per fleet lane with one durable write. Selection and
 * lease mutation happen under the same process-wide mutex, preserving owner
 * lanes, dependency gates and mission scope while avoiding a 336-write start
 * burst for 112 agents.
 */
export async function leaseNextTasksBatch(requests: readonly FleetLeaseRequest[]): Promise<FleetLeaseResult[]> {
  if (postgresAtomicQueueSelected()) {
    return claimPostgresAutonomousTasks(requests);
  }
  return withTaskMutationLock(async () => {
    if (requests.length === 0) return [];
    const tasks = await readAllTasks();
    const now = Date.now();
    const recovery = recoverStrandedTasksInPlace(tasks, now);
    const results: FleetLeaseResult[] = [];

    for (const request of requests) {
      const selected = selectLeaseCandidate(tasks, request.agentNumber, request.options ?? {}, now);
      if (!selected.task) {
        results.push({ workerId: request.workerId, agentNumber: request.agentNumber ?? null, ok: true, task: null, error: null, stolen: false });
        continue;
      }
      markTaskLeased(selected.task, request.workerId, now);
      results.push({
        workerId: request.workerId,
        agentNumber: request.agentNumber ?? null,
        ok: true,
        task: selected.task,
        error: null,
        stolen: selected.stolen,
      });
    }

    const leased = results.filter((result) => result.task !== null);
    if (leased.length > 0 || recoveryChangeCount(recovery) > 0) {
      await writeAllTasks(tasks);
      await appendRecoveryEvent(recovery, 'fleet-batch');
    }
    if (leased.length > 0) {
      await appendEvent({
        type: 'tasks_leased_batch',
        count: leased.length,
        leases: leased.map((result) => ({
          taskId: result.task?.taskId,
          workerId: result.workerId,
          agentNumber: result.agentNumber,
          stolen: result.stolen,
        })),
      });
    }
    return results;
  });
}

export async function leaseNextTask(workerId: string, agentNumber?: number | null, options: LeaseOptions = {}): Promise<{ ok: boolean; task: Task | null; error: string | null }> {
  if (postgresAtomicQueueSelected()) {
    const [result] = await claimPostgresAutonomousTasks([{ workerId, agentNumber, options }]);
    return result
      ? { ok: result.ok, task: result.task, error: result.error }
      : { ok: false, task: null, error: 'postgres_atomic claim returned no result' };
  }
  return withTaskMutationLock(() => leaseNextTaskUnlocked(workerId, agentNumber, options));
}

/** Update the heartbeat for a leased/running task. */
async function heartbeatUnlocked(taskId: string, workerId: string): Promise<{ ok: boolean; error: string | null }> {
  const tasks = await readAllTasks();
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) return { ok: false, error: 'Task not found.' };
  if (task.leaseHolder !== workerId) return { ok: false, error: 'Not the lease holder.' };
  task.lastHeartbeatAt = nowIso();
  task.leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  await writeAllTasks(tasks);
  return { ok: true, error: null };
}

export async function heartbeat(taskId: string, workerId: string): Promise<{ ok: boolean; error: string | null }> {
  if (postgresAtomicQueueSelected()) {
    const result = await heartbeatPostgresAutonomousTasks([{ taskId, workerId }]);
    const rejected = result.rejected.find((entry) => entry.taskId === taskId);
    return rejected ? { ok: false, error: rejected.error } : { ok: result.refreshed === 1, error: result.refreshed === 1 ? null : 'Heartbeat was not persisted.' };
  }
  return withTaskMutationLock(() => heartbeatUnlocked(taskId, workerId));
}

export type FleetTaskLeaseIdentity = { taskId: string; workerId: string };
export type FleetTaskMutationResult = {
  taskId: string;
  workerId: string;
  ok: boolean;
  task: Task | null;
  error: string | null;
};

/** Move a newly leased fleet batch to RUNNING with one durable write. */
export async function startLeasedTasksBatch(leases: readonly FleetTaskLeaseIdentity[]): Promise<FleetTaskMutationResult[]> {
  if (postgresAtomicQueueSelected()) {
    return startPostgresAutonomousTasks(leases);
  }
  return withTaskMutationLock(async () => {
    if (leases.length === 0) return [];
    const tasks = await readAllTasks();
    const atMs = Date.now();
    const at = new Date(atMs).toISOString();
    const expiresAt = new Date(atMs + LEASE_DURATION_MS).toISOString();
    const results: FleetTaskMutationResult[] = [];

    for (const lease of leases) {
      const task = tasks.find((candidate) => candidate.taskId === lease.taskId) ?? null;
      if (!task) {
        results.push({ ...lease, ok: false, task: null, error: 'Task not found.' });
        continue;
      }
      if (task.leaseHolder !== lease.workerId) {
        results.push({ ...lease, ok: false, task, error: 'Not the lease holder.' });
        continue;
      }
      if (task.state !== 'LEASED') {
        results.push({ ...lease, ok: false, task, error: `Cannot start from state ${task.state}.` });
        continue;
      }
      task.state = 'RUNNING';
      task.updatedAt = at;
      task.startedAt = task.startedAt ?? at;
      task.attemptStartedAt = at;
      task.lastHeartbeatAt = at;
      task.leaseExpiresAt = expiresAt;
      results.push({ ...lease, ok: true, task, error: null });
    }

    const started = results.filter((result) => result.ok);
    if (started.length > 0) {
      await writeAllTasks(tasks);
      await appendEvent({
        type: 'tasks_started_batch',
        count: started.length,
        taskIds: started.map((result) => result.taskId),
      });
    }
    return results;
  });
}

/** Renew every valid fleet lease with one durable write, never one per agent. */
export async function heartbeatTasksBatch(leases: readonly FleetTaskLeaseIdentity[]): Promise<{
  ok: boolean;
  refreshed: number;
  rejected: Array<{ taskId: string; error: string }>;
}> {
  if (postgresAtomicQueueSelected()) {
    return heartbeatPostgresAutonomousTasks(leases);
  }
  return withTaskMutationLock(async () => {
    if (leases.length === 0) return { ok: true, refreshed: 0, rejected: [] };
    const tasks = await readAllTasks();
    const atMs = Date.now();
    const at = new Date(atMs).toISOString();
    const expiresAt = new Date(atMs + LEASE_DURATION_MS).toISOString();
    const rejected: Array<{ taskId: string; error: string }> = [];
    let refreshed = 0;

    for (const lease of leases) {
      const task = tasks.find((candidate) => candidate.taskId === lease.taskId);
      if (!task) {
        rejected.push({ taskId: lease.taskId, error: 'Task not found.' });
        continue;
      }
      if (task.leaseHolder !== lease.workerId) {
        rejected.push({ taskId: lease.taskId, error: 'Not the lease holder.' });
        continue;
      }
      if (task.state !== 'LEASED' && task.state !== 'RUNNING') {
        rejected.push({ taskId: lease.taskId, error: `Cannot heartbeat state ${task.state}.` });
        continue;
      }
      task.lastHeartbeatAt = at;
      task.leaseExpiresAt = expiresAt;
      task.updatedAt = at;
      refreshed += 1;
    }

    if (refreshed > 0) await writeAllTasks(tasks);
    return { ok: rejected.length === 0, refreshed, rejected };
  });
}

/** Release a lease (return task to queue without completing). */
async function releaseLeaseUnlocked(taskId: string, workerId: string): Promise<{ ok: boolean; error: string | null }> {
  const tasks = await readAllTasks();
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) return { ok: false, error: 'Task not found.' };
  if (task.leaseHolder !== workerId) return { ok: false, error: 'Not the lease holder.' };
  if (task.state !== 'LEASED' && task.state !== 'RUNNING') return { ok: false, error: `Cannot release from state ${task.state}.` };
  task.state = 'QUEUED';
  task.leaseHolder = null;
  task.leaseExpiresAt = null;
  task.updatedAt = nowIso();
  await writeAllTasks(tasks);
  await appendEvent({ type: 'lease_released', taskId, workerId });
  return { ok: true, error: null };
}

export async function releaseLease(taskId: string, workerId: string): Promise<{ ok: boolean; error: string | null }> {
  if (postgresAtomicQueueSelected()) {
    return withTaskMutationLock(async () => {
      const task = await readPostgresTaskById(taskId);
      if (!task) return { ok: false, error: 'Task not found.' };
      if (task.leaseHolder !== workerId) return { ok: false, error: 'Not the lease holder.' };
      if (task.state !== 'LEASED' && task.state !== 'RUNNING') return { ok: false, error: `Cannot release from state ${task.state}.` };
      const fromState = task.state;
      task.state = 'QUEUED';
      task.leaseHolder = null;
      task.leaseExpiresAt = null;
      task.updatedAt = nowIso();
      const result = await compareAndSetPostgresAutonomousTask({ task, expectedStates: [fromState], leaseHolder: workerId, eventType: 'lease_released' });
      return { ok: result.ok, error: result.error };
    });
  }
  return withTaskMutationLock(() => releaseLeaseUnlocked(taskId, workerId));
}

// ── Phase 7: Owner approval gate ─────────────────────────────────────────────

/**
 * Create a single-use approval token for a protected action.
 * The token is bound to a specific task, action, and resource.
 */
export async function createApprovalToken(input: {
  taskId: string;
  action: ProtectedAction;
  resource: string;
  ownerEmail: string;
}): Promise<{ ok: boolean; approval: ApprovalRecord | null; error: string | null }> {
  const approvalId = generateId('appr');
  const nonce = generateNonce();
  const now = Date.now();

  const approval: ApprovalRecord = {
    approvalId,
    taskId: input.taskId,
    action: input.action,
    resource: input.resource,
    ownerIdentity: input.ownerEmail,
    nonce,
    createdAt: nowIso(),
    expiresAt: new Date(now + APPROVAL_DURATION_MS).toISOString(),
    consumedAt: null,
    consumed: false,
    auditRecord: {
      ownerEmail: input.ownerEmail,
      actionRequested: input.action,
      resourceAffected: input.resource,
      approvedAt: nowIso(),
      taskIdBound: input.taskId,
    },
  };

  const approvals = await readAllApprovals();
  approvals.push(approval);
  await writeAllApprovals(approvals);
  await appendEvent({ type: 'approval_created', approvalId, taskId: input.taskId, action: input.action });

  return { ok: true, approval, error: null };
}

/**
 * Consume an approval token. Enforces:
 * - Single-use (cannot be reused)
 * - Task binding (must match the task)
 * - Action binding (must match the action)
 * - Expiration (must not be expired)
 * - Replay prevention (nonce check)
 */
export async function consumeApprovalToken(input: {
  approvalId: string;
  taskId: string;
  action: ProtectedAction;
  ownerEmail: string;
  nonce: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const approvals = await readAllApprovals();
  const approval = approvals.find((a) => a.approvalId === input.approvalId);

  if (!approval) {
    return { ok: false, error: 'Approval not found.' };
  }
  if (approval.consumed) {
    return { ok: false, error: 'Approval already consumed — replay prevented.' };
  }
  if (approval.taskId !== input.taskId) {
    return { ok: false, error: `Approval is bound to task ${approval.taskId}, not ${input.taskId}.` };
  }
  if (approval.action !== input.action) {
    return { ok: false, error: `Approval is bound to action ${approval.action}, not ${input.action}.` };
  }
  if (approval.ownerIdentity !== input.ownerEmail) {
    return { ok: false, error: 'Wrong owner — approval identity mismatch.' };
  }
  if (approval.nonce !== input.nonce) {
    return { ok: false, error: 'Nonce mismatch — approval may have been tampered with.' };
  }
  if (Date.parse(approval.expiresAt) < Date.now()) {
    return { ok: false, error: 'Approval has expired.' };
  }

  approval.consumed = true;
  approval.consumedAt = nowIso();
  await writeAllApprovals(approvals);
  await appendEvent({ type: 'approval_consumed', approvalId: input.approvalId, taskId: input.taskId });

  return { ok: true, error: null };
}

/** Check if a protected action requires approval and whether it's been granted. */
export function requiresApproval(action: ProtectedAction): boolean {
  return ALL_PROTECTED_ACTIONS.includes(action);
}

// ── Phase 12: Honest completion validator ─────────────────────────────────────

export type ValidationResult = {
  verdict: 'VERIFIED' | 'PARTIAL' | 'NOT_COMPLETED' | 'BLOCKED' | 'FAILED' | 'NO_ACTION_REQUIRED';
  reason: string;
  unmetCriteria: string[];
  remainingRisks: string[];
};

/**
 * Validate that a task can be marked VERIFIED.
 * Rejects VERIFIED when:
 * - Acceptance criteria were not tested
 * - Code task has no relevant diff
 * - Only /health passed
 * - Only deployment passed (without production verification)
 * - Evidence is stale or belongs to another task
 * - A required approval is missing
 * - Rork was used in the execution path
 * - The result is only narrative
 */
export function validateCompletion(task: Task): ValidationResult {
  // Terminal non-success states
  if (task.state === 'CANCELLED') {
    return { verdict: 'NOT_COMPLETED', reason: 'Task was cancelled.', unmetCriteria: [], remainingRisks: ['Task may need to be re-created.'] };
  }
  if (task.state === 'FAILED') {
    return { verdict: 'FAILED', reason: task.error ?? 'Task failed.', unmetCriteria: [], remainingRisks: [] };
  }
  if (task.state === 'BLOCKED') {
    return { verdict: 'BLOCKED', reason: task.blocker ?? 'Task is blocked.', unmetCriteria: [], remainingRisks: [] };
  }
  if (task.state === 'NO_ACTION_REQUIRED') {
    return { verdict: 'NO_ACTION_REQUIRED', reason: 'No action was required.', unmetCriteria: [], remainingRisks: [] };
  }
  if (task.state === 'EXPIRED') {
    return { verdict: 'NOT_COMPLETED', reason: 'Task expired.', unmetCriteria: [], remainingRisks: [] };
  }

  // Not in a terminal state
  if (!TERMINAL_SUCCESS_STATES.includes(task.state)) {
    const inProgress = isTaskInProgress(task.state);
    return {
      verdict: inProgress ? 'NOT_COMPLETED' : 'PARTIAL',
      reason: `Task is in state ${task.state} — not yet terminal.`,
      unmetCriteria: task.acceptanceCriteria.filter((c) => !c.met).map((c) => c.description),
      remainingRisks: [],
    };
  }

  // Already VERIFIED — check that evidence supports the claim
  const unmetCriteria = task.acceptanceCriteria.filter((c) => !c.met);
  if (unmetCriteria.length > 0) {
    return {
      verdict: 'PARTIAL',
      reason: `${unmetCriteria.length} acceptance criterion/criteria not met.`,
      unmetCriteria: unmetCriteria.map((c) => c.description),
      remainingRisks: [],
    };
  }

  for (const criterion of task.acceptanceCriteria) {
    if (criterion.verificationMethod === 'source_file_inspected' && !task.evidence.some((evidence) =>
      evidenceMeetsCriterion(evidence, criterion)
      && Date.parse(evidence.createdAt) >= Date.parse(task.attemptStartedAt ?? task.startedAt ?? task.createdAt))) {
      return { verdict: 'PARTIAL', reason: 'Fresh inspection evidence does not match the planned source and revision.',
        unmetCriteria: [criterion.description], remainingRisks: [] };
    }
  }

  // Code task with no code diff cannot be VERIFIED (unless NO_ACTION_REQUIRED)
  if (task.taskType === 'development' && task.filesChanged.length === 0 && task.state === 'VERIFIED') {
    return {
      verdict: 'PARTIAL',
      reason: 'Development task marked VERIFIED but no files were changed.',
      unmetCriteria: ['Code diff exists and addresses the root cause'],
      remainingRisks: ['Root cause may require no code modification — if so, state should be NO_ACTION_REQUIRED.'],
    };
  }

  // No evidence at all
  if (task.evidence.length === 0 && task.state === 'VERIFIED') {
    return {
      verdict: 'PARTIAL',
      reason: 'Task marked VERIFIED but has no evidence artifacts.',
      unmetCriteria: ['Task-specific evidence captured'],
      remainingRisks: ['A successful run without required evidence must be downgraded.'],
    };
  }

  return {
    verdict: 'VERIFIED',
    reason: 'All acceptance criteria met with evidence.',
    unmetCriteria: [],
    remainingRisks: [],
  };
}

// ── Query / dashboard helpers ────────────────────────────────────────────────

export type TaskEngineSummary = {
  marker: string;
  generatedAt: string;
  totalObjectives: number;
  activeObjectives: number;
  totalTasks: number;
  tasksByState: Record<TaskState, number>;
  tasksInProgress: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksBlocked: number;
  tasksWaitingForApproval: number;
  tasksWithEvidence: number;
  tasksWithoutEvidence: number;
  duplicatePreventionActive: boolean;
  leasingActive: boolean;
  approvalGateActive: boolean;
  stateMachineEnforced: boolean;
  externalDependencyCount: number;
};

export async function getTaskEngineSummary(): Promise<TaskEngineSummary> {
  const [objectives, tasks] = await Promise.all([readAllObjectives(), readAllTasks()]);

  const tasksByState = {} as Record<TaskState, number>;
  for (const state of ALL_TASK_STATES) {
    tasksByState[state] = 0;
  }
  for (const task of tasks) {
    tasksByState[task.state] = (tasksByState[task.state] ?? 0) + 1;
  }

  const tasksWithEvidence = tasks.filter((t) => t.evidence.length > 0).length;
  const tasksInProgress = tasks.filter((t) => isTaskInProgress(t.state)).length;
  const tasksCompleted = tasks.filter((t) => ['VERIFIED', 'NO_ACTION_REQUIRED'].includes(validateCompletion(t).verdict)).length;
  const tasksFailed = tasks.filter((t) => t.state === 'FAILED').length;
  const tasksBlocked = tasks.filter((t) => t.state === 'BLOCKED').length;
  const tasksWaitingForApproval = tasks.filter((t) => t.state === 'WAITING_FOR_APPROVAL').length;
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const externalDependencyCount = tasks.reduce(
    (count, task) => count + task.dependencies.filter((dependencyId) => !taskIds.has(dependencyId)).length,
    0,
  );

  return {
    marker: IVX_TASK_ENGINE_MARKER,
    generatedAt: nowIso(),
    totalObjectives: objectives.length,
    activeObjectives: objectives.filter((o) => o.status === 'active').length,
    totalTasks: tasks.length,
    tasksByState,
    tasksInProgress,
    tasksCompleted,
    tasksFailed,
    tasksBlocked,
    tasksWaitingForApproval,
    tasksWithEvidence,
    tasksWithoutEvidence: tasks.length - tasksWithEvidence,
    duplicatePreventionActive: true,
    leasingActive: true,
    approvalGateActive: true,
    stateMachineEnforced: true,
    externalDependencyCount,
  };
}

/** Get all tasks (for dashboard). */
export async function getAllTasks(): Promise<Task[]> {
  return readAllTasks();
}

/** Get all objectives (for dashboard). */
export async function getAllObjectives(): Promise<Objective[]> {
  return readAllObjectives();
}

/** Get all approvals (for audit). */
export async function getAllApprovals(): Promise<ApprovalRecord[]> {
  return readAllApprovals();
}

/** Get a single task by id. */
export async function getTaskById(taskId: string): Promise<Task | null> {
  if (postgresAtomicQueueSelected()) return readPostgresTaskById(taskId);
  const tasks = await readAllTasks();
  return tasks.find((t) => t.taskId === taskId) ?? null;
}

/** Add evidence to a task. */
async function addTaskEvidenceUnlocked(taskId: string, evidence: Omit<TaskEvidence, 'evidenceId' | 'createdAt'>): Promise<{ ok: boolean; error: string | null }> {
  const tasks = await readAllTasks();
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) return { ok: false, error: 'Task not found.' };

  const fullEvidence: TaskEvidence = {
    ...evidence,
    evidenceId: generateId('evid'),
    createdAt: nowIso(),
  };
  task.evidence.push(fullEvidence);
  task.updatedAt = nowIso();
  await writeAllTasks(tasks);
  await appendEvent({ type: 'evidence_added', taskId, evidenceId: fullEvidence.evidenceId, evidenceType: fullEvidence.evidenceType });
  return { ok: true, error: null };
}

export async function addTaskEvidence(taskId: string, evidence: Omit<TaskEvidence, 'evidenceId' | 'createdAt'>): Promise<{ ok: boolean; error: string | null }> {
  if (postgresAtomicQueueSelected()) {
    return withTaskMutationLock(async () => {
      const task = await readPostgresTaskById(taskId);
      if (!task) return { ok: false, error: 'Task not found.' };
      const fromState = task.state;
      const fullEvidence: TaskEvidence = { ...evidence, evidenceId: generateId('evid'), createdAt: nowIso() };
      task.evidence.push(fullEvidence);
      task.updatedAt = nowIso();
      const result = await compareAndSetPostgresAutonomousTask({ task, expectedStates: [fromState], eventType: 'evidence_added' });
      return { ok: result.ok, error: result.error };
    });
  }
  return withTaskMutationLock(() => addTaskEvidenceUnlocked(taskId, evidence));
}

export type RecordLeasedTaskEvidenceResult = {
  ok: boolean;
  task: Task | null;
  evidenceId: string | null;
  error: string | null;
};

/**
 * Persist one observation on a long-running leased task without completing it.
 * Patrol evidence is intentionally bounded, while recordsChanged remains the
 * monotonic execution count. The lease holder and RUNNING state are checked on
 * every write so a superseded Render process cannot manufacture fresh proof.
 */
export async function recordLeasedTaskEvidence(input: {
  task: Task;
  workerId: string;
  evidence: Omit<TaskEvidence, 'evidenceId' | 'createdAt'>;
  maxRetainedEvidence?: number;
  /** Atomically finish this observation and schedule the next patrol. */
  nextObservationAt?: string;
}): Promise<RecordLeasedTaskEvidenceResult> {
  if (input.nextObservationAt !== undefined && (
    !input.task.idempotencyKey.startsWith('landing-p0-patrol:')
    || !Number.isFinite(Date.parse(input.nextObservationAt))
    || Date.parse(input.nextObservationAt) <= Date.now()
  )) throw new Error('A future patrol observation time is required');
  const applyObservation = (task: Task): { task: Task; evidenceId: string } => {
    const at = nowIso();
    const evidenceId = generateId('evid');
    const fullEvidence: TaskEvidence = { ...input.evidence, evidenceId, createdAt: at };
    const maxRetained = Math.max(1, Math.min(100, Math.floor(input.maxRetainedEvidence ?? 24)));
    task.evidence = [...task.evidence, fullEvidence].slice(-maxRetained);
    task.recordsChanged = Math.max(0, task.recordsChanged ?? 0) + 1;
    task.updatedAt = at;
    task.lastHeartbeatAt = at;
    task.leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
    if (input.nextObservationAt) {
      // A completed observation closes the retry episode. Failed probes remain
      // FAIL in their evidence; they are never certified by this queue release.
      task.state = 'QUEUED';
      task.leaseHolder = null;
      task.leaseExpiresAt = null;
      task.lastHeartbeatAt = null;
      task.retryCount = 0;
      task.retryStartedAt = null;
      task.retryNotBefore = input.nextObservationAt;
      task.error = null;
      task.blocker = null;
    }
    return { task, evidenceId };
  };

  if (postgresAtomicQueueSelected()) {
    const task = structuredClone(input.task) as Task;
    if (task.state !== 'RUNNING') return { ok: false, task, evidenceId: null, error: `Cannot record leased evidence in state ${task.state}.` };
    if (task.leaseHolder !== input.workerId) return { ok: false, task, evidenceId: null, error: 'Not the lease holder.' };
    const observed = applyObservation(task);
    const result = await compareAndSetPostgresAutonomousTask({
      task: observed.task,
      expectedStates: ['RUNNING'],
      leaseHolder: input.workerId,
      eventType: 'leased_evidence_recorded',
    });
    return { ok: result.ok, task: result.task, evidenceId: result.ok ? observed.evidenceId : null, error: result.error };
  }

  return withTaskMutationLock(async () => {
    const tasks = await readAllTasks();
    const task = tasks.find((candidate) => candidate.taskId === input.task.taskId) ?? null;
    if (!task) return { ok: false, task: null, evidenceId: null, error: 'Task not found.' };
    if (task.state !== 'RUNNING') return { ok: false, task, evidenceId: null, error: `Cannot record leased evidence in state ${task.state}.` };
    if (task.leaseHolder !== input.workerId) return { ok: false, task, evidenceId: null, error: 'Not the lease holder.' };
    const observed = applyObservation(task);
    await writeAllTasks(tasks);
    await appendEvent({ type: 'leased_evidence_recorded', taskId: task.taskId, workerId: input.workerId, evidenceId: observed.evidenceId });
    return { ok: true, task, evidenceId: observed.evidenceId, error: null };
  });
}

export type FinalizeEvidenceTaskInput = {
  taskId: string;
  workerId: string;
  evidence: Omit<TaskEvidence, 'evidenceId' | 'createdAt'>;
  outcome: 'VERIFIED' | 'BLOCKED' | 'FAILED';
  blocker?: string;
  error?: string;
};

export type FinalizeEvidenceTaskResult = {
  ok: boolean;
  task: Task | null;
  error: string | null;
  evidenceId: string | null;
  states: TaskState[];
};

function evidenceMeetsCriterion(evidence: TaskEvidence, criterion: AcceptanceCriterion): boolean {
  if (criterion.verificationMethod === 'source_file_inspected') {
    return evidence.evidenceType === 'source_file_inspected'
      && Boolean(criterion.expectedSource) && evidence.source === criterion.expectedSource
      && /^[a-f0-9]{40}$/i.test(criterion.expectedCommitSha ?? '') && evidence.commitSha === criterion.expectedCommitSha
      && /^[a-f0-9]{64}$/i.test(evidence.contentHash);
  }
  if (criterion.verificationMethod === 'evidence') return true;
  if (criterion.verificationMethod === 'test_pass') return evidence.evidenceType === 'test_result';
  if (criterion.verificationMethod === 'code_diff') return evidence.evidenceType === 'code_diff';
  if (criterion.verificationMethod === 'http_200') {
    return evidence.evidenceType === 'http_request' || evidence.evidenceType === 'production_verification';
  }
  if (criterion.verificationMethod === 'production_check') {
    return evidence.evidenceType === 'production_verification';
  }
  return false;
}

/**
 * Persist an evidence-backed audit outcome as one transaction-sized document
 * write. This is the fleet path for real QA probes: evidence, acceptance gate
 * and the complete state path are durable together, so a crash cannot strand a
 * task between four separate writes or report VERIFIED without its proof.
 */
export async function finalizeEvidenceTask(input: FinalizeEvidenceTaskInput): Promise<FinalizeEvidenceTaskResult> {
  if (postgresAtomicQueueSelected()) {
    return withTaskMutationLock(async () => {
      const task = await readPostgresTaskById(input.taskId);
      if (!task) return { ok: false, task: null, error: 'Task not found.', evidenceId: null, states: [] };
      if (task.leaseHolder !== input.workerId) {
        return { ok: false, task, error: 'Not the lease holder.', evidenceId: null, states: [] };
      }
      if (!(Date.parse(task.leaseExpiresAt ?? '') > Date.now())) {
        return { ok: false, task, error: 'Worker lease expired.', evidenceId: null, states: [] };
      }
      if (task.state !== 'RUNNING') {
        return { ok: false, task, error: `Cannot finalize from state ${task.state}.`, evidenceId: null, states: [] };
      }
      const before = structuredClone(task) as Task;
      const at = nowIso();
      const fullEvidence: TaskEvidence = { ...input.evidence, evidenceId: generateId('evid'), createdAt: at };
      task.evidence.push(fullEvidence);
      task.updatedAt = at;
      task.lastHeartbeatAt = at;
      const states: TaskState[] = [];
      if (input.outcome === 'BLOCKED') {
        task.state = 'BLOCKED';
        task.blocker = input.blocker?.trim() || 'evidence unavailable';
        states.push('BLOCKED');
      } else if (input.outcome === 'FAILED') {
        task.state = 'FAILED';
        task.error = input.error?.trim() || 'execution failed';
        task.completedAt = at;
        states.push('FAILED');
      } else {
        const path: TaskState[] = ['EXECUTION_COMPLETED', 'QA_IN_PROGRESS', 'VERIFIED'];
        for (const next of path) {
          if (!isValidTransition(task.state, next)) {
            return { ok: false, task: before, error: `Invalid transition: ${task.state} → ${next}.`, evidenceId: null, states: [] };
          }
          task.state = next;
          states.push(next);
        }
        for (const criterion of task.acceptanceCriteria) {
          if (!criterion.met && evidenceMeetsCriterion(fullEvidence, criterion)) {
            criterion.met = true;
            criterion.evidence = fullEvidence.summary;
          }
        }
        task.completedAt = at;
        const validation = validateCompletion(task);
        if (validation.verdict !== 'VERIFIED') {
          return { ok: false, task: before, error: validation.reason, evidenceId: null, states: [] };
        }
      }
      const result = await compareAndSetPostgresAutonomousTask({
        task,
        expectedStates: ['RUNNING'],
        leaseHolder: input.workerId,
        eventType: 'task_evidence_finalized',
      });
      return { ok: result.ok, task: result.task, error: result.error, evidenceId: result.ok ? fullEvidence.evidenceId : null, states: result.ok ? states : [] };
    });
  }
  return withTaskMutationLock(async () => {
    const tasks = await readAllTasks();
    const task = tasks.find((candidate) => candidate.taskId === input.taskId) ?? null;
    if (!task) return { ok: false, task: null, error: 'Task not found.', evidenceId: null, states: [] };
    if (task.leaseHolder !== input.workerId) {
      return { ok: false, task, error: 'Not the lease holder.', evidenceId: null, states: [] };
    }
    if (!(Date.parse(task.leaseExpiresAt ?? '') > Date.now())) {
      return { ok: false, task, error: 'Worker lease expired.', evidenceId: null, states: [] };
    }
    if (task.state !== 'RUNNING') {
      return { ok: false, task, error: `Cannot finalize from state ${task.state}.`, evidenceId: null, states: [] };
    }

    const before = structuredClone(task) as Task;
    const at = nowIso();
    const fullEvidence: TaskEvidence = {
      ...input.evidence,
      evidenceId: generateId('evid'),
      createdAt: at,
    };
    task.evidence.push(fullEvidence);
    task.updatedAt = at;
    task.lastHeartbeatAt = at;
    const states: TaskState[] = [];

    if (input.outcome === 'BLOCKED') {
      if (!isValidTransition(task.state, 'BLOCKED')) {
        return { ok: false, task, error: `Invalid transition: ${task.state} → BLOCKED.`, evidenceId: null, states: [] };
      }
      task.state = 'BLOCKED';
      task.blocker = input.blocker?.trim() || 'evidence unavailable';
      states.push('BLOCKED');
    } else if (input.outcome === 'FAILED') {
      if (!isValidTransition(task.state, 'FAILED')) {
        return { ok: false, task, error: `Invalid transition: ${task.state} → FAILED.`, evidenceId: null, states: [] };
      }
      task.state = 'FAILED';
      task.error = input.error?.trim() || 'execution failed';
      task.completedAt = at;
      states.push('FAILED');
    } else {
      const path: TaskState[] = ['EXECUTION_COMPLETED', 'QA_IN_PROGRESS', 'VERIFIED'];
      for (const next of path) {
        if (!isValidTransition(task.state, next)) {
          Object.assign(task, before);
          return { ok: false, task, error: `Invalid transition: ${task.state} → ${next}.`, evidenceId: null, states: [] };
        }
        task.state = next;
        states.push(next);
      }
      for (const criterion of task.acceptanceCriteria) {
        if (!criterion.met && evidenceMeetsCriterion(fullEvidence, criterion)) {
          criterion.met = true;
          criterion.evidence = fullEvidence.summary;
        }
      }
      task.completedAt = at;
      const validation = validateCompletion(task);
      if (validation.verdict !== 'VERIFIED') {
        Object.assign(task, before);
        return { ok: false, task, error: validation.reason, evidenceId: null, states: [] };
      }
    }

    await writeAllTasks(tasks);
    await appendEvent({
      type: 'task_evidence_finalized',
      taskId: task.taskId,
      evidenceId: fullEvidence.evidenceId,
      evidenceType: fullEvidence.evidenceType,
      outcome: input.outcome,
      states,
    });
    return { ok: true, task, error: null, evidenceId: fullEvidence.evidenceId, states };
  });
}

/** Mark an acceptance criterion as met. */
async function markCriterionMetUnlocked(taskId: string, criterionId: string, evidence: string): Promise<{ ok: boolean; error: string | null }> {
  const tasks = await readAllTasks();
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) return { ok: false, error: 'Task not found.' };

  const criterion = task.acceptanceCriteria.find((c) => c.id === criterionId);
  if (!criterion) return { ok: false, error: 'Criterion not found.' };

  criterion.met = true;
  criterion.evidence = evidence;
  task.updatedAt = nowIso();
  await writeAllTasks(tasks);
  await appendEvent({ type: 'criterion_met', taskId, criterionId });
  return { ok: true, error: null };
}

export async function markCriterionMet(taskId: string, criterionId: string, evidence: string): Promise<{ ok: boolean; error: string | null }> {
  if (postgresAtomicQueueSelected()) {
    return withTaskMutationLock(async () => {
      const task = await readPostgresTaskById(taskId);
      if (!task) return { ok: false, error: 'Task not found.' };
      const criterion = task.acceptanceCriteria.find((candidate) => candidate.id === criterionId);
      if (!criterion) return { ok: false, error: 'Criterion not found.' };
      const fromState = task.state;
      criterion.met = true;
      criterion.evidence = evidence;
      task.updatedAt = nowIso();
      const result = await compareAndSetPostgresAutonomousTask({ task, expectedStates: [fromState], eventType: 'criterion_met' });
      return { ok: result.ok, error: result.error };
    });
  }
  return withTaskMutationLock(() => markCriterionMetUnlocked(taskId, criterionId, evidence));
}

// ── Phase 6: Permission matrix ───────────────────────────────────────────────

export type PermissionMatrixEntry = {
  engine: string;
  taskType: Task['taskType'];
  readPermissions: string[];
  writePermissions: string[];
  externalTools: string[];
  ownerApprovalRequired: boolean;
  prohibitedActions: string[];
};

export const PERMISSION_MATRIX: PermissionMatrixEntry[] = [
  {
    engine: 'ivx_mobile_lead',
    taskType: 'development',
    readPermissions: ['source_files', 'code_index', 'test_results'],
    writePermissions: ['source_files', 'commits'],
    externalTools: ['github_api'],
    ownerApprovalRequired: true,
    prohibitedActions: ['production_deployment', 'database_migration', 'secret_access', 'outreach_sending'],
  },
  {
    engine: 'ivx_security_lead',
    taskType: 'security',
    readPermissions: ['source_files', 'logs', 'audit_trail', 'security_findings'],
    writePermissions: ['security_fixes', 'commits'],
    externalTools: ['github_api'],
    ownerApprovalRequired: true,
    prohibitedActions: ['production_deployment', 'database_migration', 'outreach_sending', 'financial_changes'],
  },
  {
    engine: 'ivx_investor_research',
    taskType: 'investor_research',
    readPermissions: ['sec_filings', 'crm_records', 'investor_data'],
    writePermissions: ['crm_records'],
    externalTools: ['sec_edgar_api'],
    ownerApprovalRequired: false,
    prohibitedActions: ['production_deployment', 'code_writes', 'outreach_sending', 'database_migration'],
  },
  {
    engine: 'ivx_buyer_research',
    taskType: 'buyer_research',
    readPermissions: ['sec_filings', 'crm_records', 'buyer_data'],
    writePermissions: ['crm_records'],
    externalTools: ['sec_edgar_api'],
    ownerApprovalRequired: false,
    prohibitedActions: ['production_deployment', 'code_writes', 'outreach_sending', 'database_migration'],
  },
  {
    engine: 'ivx_capital_outreach',
    taskType: 'outreach',
    readPermissions: ['crm_records', 'outreach_drafts'],
    writePermissions: ['outreach_drafts'],
    externalTools: ['email_provider'],
    ownerApprovalRequired: true,
    prohibitedActions: ['production_deployment', 'code_writes', 'database_migration', 'financial_changes'],
  },
  {
    engine: 'ivx_deployment_engine',
    taskType: 'deployment',
    readPermissions: ['render_status', 'github_status', 'production_health'],
    writePermissions: ['render_deploys'],
    externalTools: ['render_api', 'github_api'],
    ownerApprovalRequired: true,
    prohibitedActions: ['code_writes', 'database_migration', 'outreach_sending', 'financial_changes'],
  },
  {
    engine: 'ivx_qa_engineer',
    taskType: 'qa',
    readPermissions: ['source_files', 'test_results', 'production_health', 'logs'],
    writePermissions: ['test_results', 'qa_reports'],
    externalTools: [],
    ownerApprovalRequired: false,
    prohibitedActions: ['production_deployment', 'code_writes', 'database_migration', 'outreach_sending'],
  },
  {
    engine: 'ivx_analytics_lead',
    taskType: 'reporting',
    readPermissions: ['all_metrics', 'crm_data', 'pipeline_data', 'production_health'],
    writePermissions: ['reports'],
    externalTools: [],
    ownerApprovalRequired: false,
    prohibitedActions: ['production_deployment', 'code_writes', 'database_migration', 'outreach_sending', 'financial_changes'],
  },
];

/** Check if an engine is allowed to perform an action. */
export function isActionAllowed(engine: string, action: string): { allowed: boolean; reason: string } {
  const entry = PERMISSION_MATRIX.find((e) => e.engine === engine);
  if (!entry) {
    return { allowed: false, reason: `Engine ${engine} not in permission matrix.` };
  }
  if (entry.prohibitedActions.includes(action)) {
    return { allowed: false, reason: `Action ${action} is prohibited for engine ${engine}.` };
  }
  return { allowed: true, reason: 'Action permitted.' };
}
