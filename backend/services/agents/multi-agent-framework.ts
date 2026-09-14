/**
 * IVX: API histórica conservada + ejecutor PostgreSQL de 112 identidades.
 *
 * NUEVO PUNTO DE ENTRADA: MultiAgentFleet (arranque explícito en el worker).
 * Instalar FLEET_INSTALL_SQL mediante migración revisada antes de start().
 * El dispatcher/recovery anterior debe excluir executor=ivx-fleet-v1.
 * Se reutiliza ../ivx-database-pools: URL :6543, pools globales y TLS verificado.
 * QA/GitHub/Vercel incluidos son SIMULACIONES; producción exige FleetPipeline real.
 * La simulación termina NO_ACTION_REQUIRED y certified=false.
 * Un snapshot del registro no demuestra inferencia real ni operación 24/7.
 */
import { createHash as fleetHash, randomUUID as fleetUUID } from 'node:crypto';
import { execFile as fleetExecFile } from 'node:child_process';
import { promisify as fleetPromisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, posix, resolve as fleetResolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as fleetDelay } from 'node:timers/promises';
import type { Pool as FleetPool, PoolClient as FleetClient } from 'pg';
import { getWorkerPool as fleetWorkerPool } from '../ivx-database-pools';
import { FLEET_CONFIG, fleetPathConcurrency } from '../ivx-fleet-operating-policy';
export { FLEET_CONFIG } from '../ivx-fleet-operating-policy';

/**
 * IVX Block 25 — Multi-Agent Framework.
 *
 * Specialized internal agents coordinated by a CTO Orchestrator.
 * Each agent has: role, allowed tools, memory namespace, risk limits.
 *
 * Storage: in-process registry (status, audit, handoffs) with optional
 * persistence to operational memory (Block 23) under category=note and
 * metadata.kind="agent_*". This keeps the framework safe and additive —
 * it never deploys, mutates files, or bypasses Block 24 deploy gates.
 */
import { OPERATIONAL_MEMORY_MARKER } from '../operational-memory/memory-types';
import { appendAgentEvent, loadAgentState, persistAgentState } from './agent-durable-store';

// ---------- Types ----------

export type AgentId =
  | 'cto_orchestrator'
  | 'ceo_executive'
  | 'backend_developer'
  | 'frontend_developer'
  | 'infrastructure_sre'
  | 'supabase_database'
  | 'investor_relations'
  | 'analytics'
  | 'operations'
  | 'crm'
  | 'investment';

/**
 * Explicit owner-controlled autonomy levels (Phase 1).
 *   1 — read-only analysis / report only.
 *   2 — create recommendations.
 *   3 — draft pull requests / migrations (nothing goes live).
 *   4 — deploy, but only after explicit owner approval.
 *   5 — fully autonomous for a short pre-approved low-risk action list.
 * Anything high-risk always stops and waits for the owner regardless of level.
 */
export type ApprovalLevel = 1 | 2 | 3 | 4 | 5;

export type AgentRiskLevel = 'low' | 'medium' | 'high';

export type AgentExecutionStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export type AgentDefinition = {
  id: AgentId;
  name: string;
  role: string;
  allowedTools: readonly string[];
  memoryNamespace: string;
  /** Maximum risk this agent is permitted to take without owner approval. */
  riskLimit: AgentRiskLevel;
  /** Domain keywords used by the orchestrator for routing. */
  routingKeywords: readonly string[];
  /** Default owner-controlled autonomy level for this agent (1–5). */
  approvalLevel: ApprovalLevel;
};

export type AgentHandoffRecord = {
  id: string;
  fromAgent: AgentId;
  toAgent: AgentId;
  reason: string;
  taskId: string;
  at: string;
};

export type AgentAuditEntry = {
  id: string;
  agentId: AgentId;
  taskId: string | null;
  action: string;
  detail: string;
  metadata: Record<string, unknown>;
  at: string;
};

export type AgentMemoryEntry = {
  id: string;
  agentId: AgentId;
  namespace: string;
  key: string;
  value: string;
  metadata: Record<string, unknown>;
  at: string;
};

export type AgentTaskRecord = {
  id: string;
  goal: string;
  assignedAgent: AgentId;
  status: AgentExecutionStatus;
  risk: AgentRiskLevel;
  approvalRequired: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  blockedReason: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  handoffs: AgentHandoffRecord[];
  steps: AgentTaskStep[];
  createdAt: string;
  updatedAt: string;
};

export type AgentTaskStep = {
  agentId: AgentId;
  action: string;
  status: AgentExecutionStatus;
  detail: string;
  at: string;
};

// ---------- Agent Registry ----------

export const AGENTS: Record<AgentId, AgentDefinition> = {
  cto_orchestrator: {
    id: 'cto_orchestrator',
    name: 'CTO Orchestrator',
    role: 'Routes incoming tasks to specialist agents, coordinates handoffs, enforces risk policy, and can patch code when needed.',
    allowedTools: ['route', 'plan', 'handoff', 'audit_read', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:cto',
    riskLimit: 'high',
    routingKeywords: ['route', 'orchestrate', 'plan', 'coordinate', 'architecture', 'technology', 'tech debt', 'upgrade'],
    approvalLevel: 3,
  },
  ceo_executive: {
    id: 'ceo_executive',
    name: 'CEO Agent',
    role: 'Sets cross-business priorities, turns owner goals into ranked initiatives, reviews proposals, and can execute senior-developer tasks end-to-end.',
    allowedTools: ['memory_read', 'memory_write', 'plan', 'priority_rank', 'review_proposal', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:ceo',
    riskLimit: 'low',
    routingKeywords: ['ceo', 'strategy', 'priority', 'priorities', 'initiative', 'goal', 'objective', 'okr', 'vision', 'roadmap', 'business'],
    approvalLevel: 3,
  },
  backend_developer: {
    id: 'backend_developer',
    name: 'Senior Engineer Agent',
    role: 'Analyzes code, detects bugs, proposes fixes, drafts pull requests and tests, and deploys across the Hono/Node backend.',
    allowedTools: ['code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'aws_identity_check', 'supabase_inspect', 'sql_proposal', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:backend',
    riskLimit: 'medium',
    routingKeywords: ['backend', 'hono', 'api', 'route', 'server', 'endpoint', 'node', 'code', 'bug', 'fix', 'patch', 'developer', 'senior developer', 'engineer', 'implementation', 'test', 'build', 'refactor'],
    approvalLevel: 3,
  },
  frontend_developer: {
    id: 'frontend_developer',
    name: 'Frontend Developer Agent',
    role: 'Designs, patches, tests, and deploys Expo/React Native and web UI code.',
    allowedTools: ['code_read', 'code_patch_proposal', 'run_tests', 'lint', 'screenshot_review', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:frontend',
    riskLimit: 'medium',
    routingKeywords: ['frontend', 'expo', 'react', 'native', 'ui', 'screen', 'component', 'web'],
    approvalLevel: 3,
  },
  infrastructure_sre: {
    id: 'infrastructure_sre',
    name: 'Infrastructure / SRE Agent',
    role: 'Owns Render, AWS, DNS, deploys, rollbacks, runtime health, and can patch infrastructure code.',
    allowedTools: ['render_status', 'aws_identity_check', 'deploy_gate_eval', 'rollback_propose', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'supabase_inspect', 'sql_proposal', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:sre',
    riskLimit: 'medium',
    routingKeywords: ['render', 'aws', 'deploy', 'rollback', 'dns', 'sre', 'infrastructure', 'cloudfront', 's3'],
    approvalLevel: 4,
  },
  supabase_database: {
    id: 'supabase_database',
    name: 'Supabase Database Agent',
    role: 'Owns Supabase schema, RLS, migrations, pgvector memory, and can patch code that touches the database.',
    allowedTools: ['supabase_inspect', 'supabase_readiness_check', 'sql_proposal', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:supabase',
    riskLimit: 'medium',
    routingKeywords: ['supabase', 'sql', 'rls', 'pgvector', 'schema', 'migration', 'postgres', 'database'],
    approvalLevel: 3,
  },
  investor_relations: {
    id: 'investor_relations',
    name: 'Investor Relations Agent',
    role: 'Manages investor workflows, reports, and outreach drafts, and can build and deploy owner-facing features.',
    allowedTools: ['memory_read', 'draft_report', 'workflow_status', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:investor',
    riskLimit: 'low',
    routingKeywords: ['investor', 'pitch', 'report', 'fundraise', 'cap table', 'ir'],
    approvalLevel: 3,
  },
  analytics: {
    id: 'analytics',
    name: 'Analytics Agent',
    role: 'Aggregates telemetry, KPIs, and product metrics, and can implement and deploy analytics features.',
    allowedTools: ['telemetry_query', 'memory_read', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:analytics',
    riskLimit: 'low',
    routingKeywords: ['analytics', 'metrics', 'kpi', 'telemetry', 'dashboard', 'stats'],
    approvalLevel: 3,
  },
  operations: {
    id: 'operations',
    name: 'Operations Agent',
    role: 'Handles non-technical ops and can patch, test, and deploy operational tools and runbooks.',
    allowedTools: ['memory_read', 'incident_read', 'runbook_emit', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:ops',
    riskLimit: 'low',
    routingKeywords: ['ops', 'operations', 'incident', 'runbook', 'triage', 'owner'],
    approvalLevel: 3,
  },
  crm: {
    id: 'crm',
    name: 'CRM Agent',
    role: 'Keeps contacts and deals healthy, flags follow-ups, drafts relationship updates, and can build and deploy CRM features.',
    allowedTools: ['memory_read', 'memory_write', 'crm_read', 'draft_update', 'workflow_status', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:crm',
    riskLimit: 'low',
    routingKeywords: ['crm', 'contact', 'contacts', 'lead', 'leads', 'deal', 'deals', 'pipeline', 'follow up', 'follow-up', 'outreach'],
    approvalLevel: 3,
  },
  investment: {
    id: 'investment',
    name: 'Investment Agent',
    role: 'Watches the portfolio and market, surfaces opportunities and risks, and can implement and deploy investment features.',
    allowedTools: ['memory_read', 'memory_write', 'portfolio_read', 'market_read', 'opportunity_rank', 'code_read', 'code_patch_proposal', 'run_tests', 'lint', 'deploy_gate_eval', 'rollback_propose', 'render_status', 'auth_audit', 'branch_create', 'commit', 'push', 'test_fix_loop'],
    memoryNamespace: 'agent:investment',
    riskLimit: 'low',
    routingKeywords: ['investment', 'portfolio', 'market', 'asset', 'allocation', 'opportunity', 'risk', 'return', 'valuation'],
    approvalLevel: 3,
  },
};

/** Owner-facing description of each autonomy level. */
export const APPROVAL_LEVELS: Record<ApprovalLevel, string> = {
  1: 'Read-only analysis / report only.',
  2: 'Create recommendations.',
  3: 'Draft pull requests / migrations (nothing goes live).',
  4: 'Deploy, but only after explicit owner approval.',
  5: 'Fully autonomous for a short pre-approved low-risk action list.',
};

/** Returns the configured autonomy level for an agent. */
export function getApprovalLevel(agentId: AgentId): ApprovalLevel {
  return AGENTS[agentId]?.approvalLevel ?? 2;
}

const ALL_AGENT_IDS = Object.keys(AGENTS) as AgentId[];

// ---------- In-process stores ----------

const tasks = new Map<string, AgentTaskRecord>();
const audit: AgentAuditEntry[] = [];
const memory: AgentMemoryEntry[] = [];
const handoffs: AgentHandoffRecord[] = [];

const MAX_AUDIT = 500;
const MAX_MEMORY = 500;
const MAX_HANDOFFS = 500;

// ---------- Durable persistence (Phase 1) ----------
// The framework remains the runtime source of truth; this layer snapshots it to
// disk after every mutation and rehydrates it on boot so tasks/audit/memory/
// handoffs survive server restarts and deploys.

let rehydrated = false;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

function snapshotNow(): void {
  void persistAgentState({
    tasks: Array.from(tasks.values()),
    audit,
    memory,
    handoffs,
  });
}

/** Debounced snapshot so a burst of mutations writes once, not N times. */
function scheduleSnapshot(): void {
  if (!rehydrated) return;
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    snapshotNow();
  }, 250);
  if (typeof snapshotTimer === 'object' && typeof (snapshotTimer as { unref?: () => void }).unref === 'function') {
    (snapshotTimer as { unref: () => void }).unref();
  }
}

/** Rehydrate in-process state from the durable snapshot. Safe + idempotent. */
export async function rehydrateAgentState(): Promise<{ rehydrated: boolean; tasks: number; audit: number; memory: number; handoffs: number }> {
  const snapshot = await loadAgentState();
  if (snapshot) {
    for (const t of snapshot.tasks as AgentTaskRecord[]) {
      if (t && typeof t.id === 'string' && !tasks.has(t.id)) tasks.set(t.id, t);
    }
    if (audit.length === 0 && snapshot.audit.length > 0) audit.push(...(snapshot.audit as AgentAuditEntry[]));
    if (memory.length === 0 && snapshot.memory.length > 0) memory.push(...(snapshot.memory as AgentMemoryEntry[]));
    if (handoffs.length === 0 && snapshot.handoffs.length > 0) handoffs.push(...(snapshot.handoffs as AgentHandoffRecord[]));
  }
  rehydrated = true;
  return { rehydrated: Boolean(snapshot), tasks: tasks.size, audit: audit.length, memory: memory.length, handoffs: handoffs.length };
}

// Kick off rehydration once at module load; mark rehydrated even if it fails so
// snapshots resume normally and a missing file never blocks the framework.
void rehydrateAgentState().catch(() => {
  rehydrated = true;
});

function nowIso(): string { return new Date().toISOString(); }
function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function pushBounded<T>(arr: T[], item: T, max: number): void {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

// ---------- Audit ----------

export function recordAudit(
  agentId: AgentId,
  action: string,
  detail: string,
  taskId: string | null = null,
  metadata: Record<string, unknown> = {},
): AgentAuditEntry {
  const entry: AgentAuditEntry = {
    id: uid('audit'),
    agentId,
    taskId,
    action,
    detail: detail.slice(0, 600),
    metadata,
    at: nowIso(),
  };
  pushBounded(audit, entry, MAX_AUDIT);
  void appendAgentEvent({ type: 'audit', agentId, action, taskId, at: entry.at });
  scheduleSnapshot();
  return entry;
}

export function listAudit(limit: number = 100, agentId?: AgentId): AgentAuditEntry[] {
  const filtered = agentId ? audit.filter((a) => a.agentId === agentId) : audit;
  return filtered.slice(-Math.max(1, Math.min(500, limit))).reverse();
}

// ---------- Memory (namespaced) ----------

export function writeAgentMemory(
  agentId: AgentId,
  key: string,
  value: string,
  metadata: Record<string, unknown> = {},
): AgentMemoryEntry {
  const def = AGENTS[agentId];
  const entry: AgentMemoryEntry = {
    id: uid('mem'),
    agentId,
    namespace: def.memoryNamespace,
    key: key.slice(0, 120),
    value: value.slice(0, 4000),
    metadata,
    at: nowIso(),
  };
  pushBounded(memory, entry, MAX_MEMORY);
  recordAudit(agentId, 'memory.write', `key=${entry.key}`, null, { namespace: entry.namespace });
  return entry;
}

export function readAgentMemory(agentId: AgentId, key?: string): AgentMemoryEntry[] {
  const ns = AGENTS[agentId].memoryNamespace;
  return memory
    .filter((m) => m.namespace === ns && (key ? m.key === key : true))
    .slice(-100)
    .reverse();
}

// ---------- Risk policy ----------

const RISK_RANK: Record<AgentRiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function classifyTaskRisk(goal: string): AgentRiskLevel {
  const lower = goal.toLowerCase();
  if (/(drop|delete|truncate|rollback|prod\b|production|wipe|destroy|migrate|force push|mainnet)/.test(lower)) {
    return 'high';
  }
  if (/(deploy|patch|migration|release|publish|hotfix|env|secret)/.test(lower)) {
    return 'medium';
  }
  return 'low';
}

export function isActionAllowed(agentId: AgentId, risk: AgentRiskLevel): { allowed: boolean; reason: string } {
  const def = AGENTS[agentId];
  if (RISK_RANK[risk] > RISK_RANK[def.riskLimit]) {
    return {
      allowed: false,
      reason: `Risk ${risk} exceeds ${def.name} limit (${def.riskLimit}). Owner approval required.`,
    };
  }
  return { allowed: true, reason: 'within risk limit' };
}

// ---------- Routing ----------

export function routeTaskToAgent(goal: string): AgentId {
  const lower = goal.toLowerCase();
  let bestAgent: AgentId = 'operations';
  let bestScore = 0;
  for (const id of ALL_AGENT_IDS) {
    if (id === 'cto_orchestrator') continue;
    const def = AGENTS[id];
    let score = 0;
    for (const kw of def.routingKeywords) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestAgent = id;
    }
  }
  return bestAgent;
}

// ---------- Handoffs ----------

export function recordHandoff(
  fromAgent: AgentId,
  toAgent: AgentId,
  taskId: string,
  reason: string,
): AgentHandoffRecord {
  const handoff: AgentHandoffRecord = {
    id: uid('handoff'),
    fromAgent,
    toAgent,
    taskId,
    reason: reason.slice(0, 400),
    at: nowIso(),
  };
  pushBounded(handoffs, handoff, MAX_HANDOFFS);
  const task = tasks.get(taskId);
  if (task) {
    task.handoffs.push(handoff);
    task.assignedAgent = toAgent;
    task.updatedAt = handoff.at;
  }
  recordAudit(fromAgent, 'handoff.send', `to=${toAgent} reason=${reason}`, taskId);
  recordAudit(toAgent, 'handoff.receive', `from=${fromAgent}`, taskId);
  return handoff;
}

export function listHandoffs(limit: number = 100): AgentHandoffRecord[] {
  return handoffs.slice(-Math.max(1, Math.min(500, limit))).reverse();
}

// ---------- Tasks ----------

export type DispatchOptions = {
  goal: string;
  approverEmail?: string;
  forceAgent?: AgentId;
  metadata?: Record<string, unknown>;
};

export type DispatchResult = {
  task: AgentTaskRecord;
  audit: AgentAuditEntry[];
};

export function dispatchTask(opts: DispatchOptions): DispatchResult {
  const goal = opts.goal.trim();
  if (!goal) throw new Error('Task goal is required.');
  const auditBatch: AgentAuditEntry[] = [];

  const cto: AgentId = 'cto_orchestrator';
  auditBatch.push(recordAudit(cto, 'task.received', `goal="${goal.slice(0, 120)}"`));

  const routedAgent = opts.forceAgent ?? routeTaskToAgent(goal);
  auditBatch.push(recordAudit(cto, 'task.routed', `to=${routedAgent}`));

  const risk = classifyTaskRisk(goal);
  const policy = isActionAllowed(routedAgent, risk);
  const approvalRequired = !policy.allowed;
  const isApproved = approvalRequired && Boolean(opts.approverEmail);

  const taskId = uid('task');
  const task: AgentTaskRecord = {
    id: taskId,
    goal,
    assignedAgent: routedAgent,
    status: 'pending',
    risk,
    approvalRequired,
    approvedBy: isApproved ? (opts.approverEmail ?? null) : null,
    approvedAt: isApproved ? nowIso() : null,
    blockedReason: null,
    result: null,
    error: null,
    handoffs: [],
    steps: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  // Record the implicit handoff CTO -> specialist
  const handoff = recordHandoff(cto, routedAgent, taskId, 'cto routing');
  task.handoffs.push(handoff);

  if (approvalRequired && !isApproved) {
    task.status = 'blocked';
    task.blockedReason = policy.reason;
    task.steps.push({
      agentId: routedAgent,
      action: 'risk_gate',
      status: 'blocked',
      detail: policy.reason,
      at: nowIso(),
    });
    auditBatch.push(recordAudit(routedAgent, 'task.blocked', policy.reason, taskId, { risk }));
  } else {
    task.status = 'running';
    task.steps.push({
      agentId: routedAgent,
      action: 'analyze',
      status: 'running',
      detail: `Agent ${AGENTS[routedAgent].name} accepted task at risk=${risk}.`,
      at: nowIso(),
    });
    auditBatch.push(recordAudit(routedAgent, 'task.accepted', `risk=${risk}`, taskId, isApproved ? { approvedBy: opts.approverEmail } : {}));
  }

  tasks.set(taskId, task);
  return { task, audit: auditBatch };
}

export function completeTask(taskId: string, result: Record<string, unknown>): AgentTaskRecord {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  task.status = 'completed';
  task.result = result;
  task.updatedAt = nowIso();
  task.steps.push({
    agentId: task.assignedAgent,
    action: 'complete',
    status: 'completed',
    detail: 'Task completed successfully.',
    at: task.updatedAt,
  });
  recordAudit(task.assignedAgent, 'task.completed', 'ok', taskId);
  return task;
}

export function failTask(taskId: string, error: string): AgentTaskRecord {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  task.status = 'failed';
  task.error = error.slice(0, 600);
  task.updatedAt = nowIso();
  task.steps.push({
    agentId: task.assignedAgent,
    action: 'fail',
    status: 'failed',
    detail: task.error,
    at: task.updatedAt,
  });
  recordAudit(task.assignedAgent, 'task.failed', task.error, taskId);
  return task;
}

export function cancelTask(taskId: string, reason: string = 'cancelled by owner'): AgentTaskRecord {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    return task;
  }
  task.status = 'cancelled';
  task.updatedAt = nowIso();
  task.steps.push({ agentId: task.assignedAgent, action: 'cancel', status: 'cancelled', detail: reason.slice(0, 400), at: task.updatedAt });
  recordAudit(task.assignedAgent, 'task.cancelled', reason.slice(0, 400), taskId);
  return task;
}

export function pauseTask(taskId: string, reason: string = 'paused by owner'): AgentTaskRecord {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  if (task.status !== 'running' && task.status !== 'pending') {
    return task;
  }
  task.status = 'paused';
  task.updatedAt = nowIso();
  task.steps.push({ agentId: task.assignedAgent, action: 'pause', status: 'paused', detail: reason.slice(0, 400), at: task.updatedAt });
  recordAudit(task.assignedAgent, 'task.paused', reason.slice(0, 400), taskId);
  return task;
}

export function resumeTask(taskId: string): AgentTaskRecord {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  if (task.status !== 'paused') return task;
  task.status = 'running';
  task.updatedAt = nowIso();
  task.steps.push({ agentId: task.assignedAgent, action: 'resume', status: 'running', detail: 'resumed by owner', at: task.updatedAt });
  recordAudit(task.assignedAgent, 'task.resumed', 'resumed by owner', taskId);
  return task;
}

export function retryTask(taskId: string): AgentTaskRecord {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  if (task.status !== 'failed' && task.status !== 'cancelled') {
    return task;
  }
  task.status = 'running';
  task.error = null;
  task.updatedAt = nowIso();
  task.steps.push({ agentId: task.assignedAgent, action: 'retry', status: 'running', detail: 'retried by owner', at: task.updatedAt });
  recordAudit(task.assignedAgent, 'task.retried', 'retried by owner', taskId);
  return task;
}

export function approveTask(taskId: string, approverEmail: string): AgentTaskRecord {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  if (!task.approvalRequired) return task;
  if (task.risk === 'high') {
    throw new Error('High-risk tasks cannot be approved through the dashboard. Use the CLI approval flow.');
  }
  task.approvedBy = approverEmail.slice(0, 200);
  task.approvedAt = nowIso();
  if (task.status === 'blocked') {
    task.status = 'running';
    task.blockedReason = null;
  }
  task.updatedAt = nowIso();
  recordAudit(task.assignedAgent, 'task.approved', `approver=${task.approvedBy}`, taskId, { risk: task.risk });
  return task;
}

export function listTasks(limit: number = 50): AgentTaskRecord[] {
  return Array.from(tasks.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, Math.max(1, Math.min(200, limit)));
}

export function getTask(taskId: string): AgentTaskRecord | null {
  return tasks.get(taskId) ?? null;
}

export function listActiveAgents(): Array<AgentDefinition & { activeTaskCount: number }> {
  const counts = new Map<AgentId, number>();
  for (const t of tasks.values()) {
    if (t.status === 'running' || t.status === 'pending') {
      counts.set(t.assignedAgent, (counts.get(t.assignedAgent) ?? 0) + 1);
    }
  }
  return ALL_AGENT_IDS.map((id) => ({
    ...AGENTS[id],
    activeTaskCount: counts.get(id) ?? 0,
  }));
}

// ---------- Validation suite ----------

export type ValidationCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export function runFrameworkValidation(): { ok: boolean; checks: ValidationCheck[]; marker: string } {
  const checks: ValidationCheck[] = [];

  // 0. HONESTY FIX: Zero agents → FAIL immediately
  const agentCount = Object.keys(AGENTS).length;
  checks.push({
    name: 'registry.non_empty',
    ok: agentCount > 0,
    detail: `agents registered: ${agentCount}`,
  });
  if (agentCount === 0) {
    return { ok: false, checks, marker: OPERATIONAL_MEMORY_MARKER };
  }

  // 0b. HONESTY FIX: Every agent must have a unique ID
  const agentIds = Object.keys(AGENTS);
  const uniqueIds = new Set(agentIds);
  checks.push({
    name: 'registry.unique_ids',
    ok: uniqueIds.size === agentIds.length,
    detail: `ids=${agentIds.length} unique=${uniqueIds.size}`,
  });

  // 0c. HONESTY FIX: Every agent must have at least one tool (non-placeholder)
  const placeholderAgents = agentIds.filter((id) => AGENTS[id as AgentId].allowedTools.length === 0);
  checks.push({
    name: 'registry.no_placeholder_tools',
    ok: placeholderAgents.length === 0,
    detail: placeholderAgents.length > 0 ? `placeholder agents: ${placeholderAgents.join(', ')}` : 'all agents have tools',
  });

  // 1. Routing
  const backendRoute = routeTaskToAgent('Patch the Hono backend api endpoint for owner-ai');
  checks.push({
    name: 'routing.backend',
    ok: backendRoute === 'backend_developer',
    detail: `routed=${backendRoute}`,
  });
  const supabaseRoute = routeTaskToAgent('Add pgvector index to supabase schema migration');
  checks.push({
    name: 'routing.supabase',
    ok: supabaseRoute === 'supabase_database',
    detail: `routed=${supabaseRoute}`,
  });
  const sreRoute = routeTaskToAgent('Investigate render deploy failure and rollback');
  checks.push({
    name: 'routing.sre',
    ok: sreRoute === 'infrastructure_sre',
    detail: `routed=${sreRoute}`,
  });
  const investorRoute = routeTaskToAgent('Draft investor monthly report');
  checks.push({
    name: 'routing.investor',
    ok: investorRoute === 'investor_relations',
    detail: `routed=${investorRoute}`,
  });

  // 2. Handoff
  const dispatched = dispatchTask({ goal: 'analyze frontend expo screen render performance' });
  const hasInitialHandoff = dispatched.task.handoffs.length === 1
    && dispatched.task.handoffs[0]?.fromAgent === 'cto_orchestrator';
  checks.push({
    name: 'handoff.initial',
    ok: hasInitialHandoff,
    detail: `handoffs=${dispatched.task.handoffs.length}`,
  });
  const secondary = recordHandoff(dispatched.task.assignedAgent, 'analytics', dispatched.task.id, 'need metrics');
  checks.push({
    name: 'handoff.secondary',
    ok: secondary.toAgent === 'analytics' && getTask(dispatched.task.id)?.assignedAgent === 'analytics',
    detail: `current=${getTask(dispatched.task.id)?.assignedAgent}`,
  });

  // 3. Memory namespacing
  writeAgentMemory('backend_developer', 'last_patch', 'fixed owner-ai stream lock');
  writeAgentMemory('frontend_developer', 'last_patch', 'updated chat screen scroll');
  const backendMem = readAgentMemory('backend_developer', 'last_patch');
  const frontendMem = readAgentMemory('frontend_developer', 'last_patch');
  checks.push({
    name: 'memory.namespaced',
    ok: backendMem.length === 1 && frontendMem.length === 1
      && backendMem[0]?.namespace !== frontendMem[0]?.namespace,
    detail: `backendNs=${backendMem[0]?.namespace} frontendNs=${frontendMem[0]?.namespace}`,
  });

  // 4. Risk gating: high-risk task must be blocked without approver
  const blocked = dispatchTask({ goal: 'DROP supabase production table and migrate schema' });
  checks.push({
    name: 'risk.block_high_without_approval',
    ok: blocked.task.status === 'blocked' && blocked.task.approvalRequired === true,
    detail: `status=${blocked.task.status} reason=${blocked.task.blockedReason ?? ''}`,
  });

  // 5. Risk gating: with approver, high-risk runs (still recorded)
  const approved = dispatchTask({
    goal: 'DROP supabase production table and migrate schema',
    approverEmail: 'owner@ivxholding.com',
  });
  checks.push({
    name: 'risk.allow_with_approval',
    ok: approved.task.status === 'running' && approved.task.approvedBy === 'owner@ivxholding.com',
    detail: `status=${approved.task.status} approver=${approved.task.approvedBy ?? ''}`,
  });

  // 6. Audit log present
  const auditTail = listAudit(20);
  checks.push({
    name: 'audit.recorded',
    ok: auditTail.length > 0,
    detail: `entries=${auditTail.length}`,
  });

  // Cleanup: complete validation tasks so they don't pollute active list
  completeTask(dispatched.task.id, { validation: true });
  completeTask(approved.task.id, { validation: true });

  // 7. HONESTY FIX: Framework validation does NOT prove agents are real runtimes.
  // It only validates routing, handoffs, memory, and risk gates.
  // A PASS here means the framework LOGIC works, NOT that 12 independent agents exist.
  checks.push({
    name: 'honesty.framework_limit',
    ok: true,
    detail: 'Framework validation confirms routing/handoff/memory/risk logic only. It does NOT certify independent agent runtimes. Use validateAgentRegistry() for runtime certification.',
  });

  const ok = checks.every((c) => c.ok);
  return { ok, checks, marker: OPERATIONAL_MEMORY_MARKER };
}

export const MULTI_AGENT_MARKER = 'ivx-multi-agent-2026-05-17t-block25';



// ============================================================================
// IVX FLEET V1 — durable executor, additive to the legacy routing API above.
// Node.js 22+, pg 8.x. Start ONCE in the Render worker entrypoint, never per HTTP
// request. The legacy registry above is not proof of 112 active model runtimes.
// ============================================================================

const fleetExec = fleetPromisify(fleetExecFile);
export const FLEET_SIZE = 112;
const FLEET_EXECUTOR = 'ivx-fleet-v1';
const FLEET_LIVE_STATES = ['RUNNING', 'DEPLOYING'];
type FleetMode = 'simulation' | 'production';
type FleetEndState = 'NO_ACTION_REQUIRED' | 'VERIFIED' | 'FAILED' | 'QA_FAILED' | 'BLOCKED' | 'WAITING_FOR_APPROVAL' | 'RECEIVED';

/** Apply through the normal reviewed migration pipeline, NOT on worker boot.
 * The 112 capacity rows impose one GLOBAL limit across this executor's replicas.
 * Existing eight-slot installations expand only through an explicit call to
 * unlockFullFleetCapacity. Never reset live leases or durable fencing counters.
 * Use an online index migration separately if the task table is already large.
 * Existing workers must route these executor-tagged jobs to this implementation.
 * RECEIVED is the ready state here; the legacy QUEUED dispatcher must not adopt
 * these jobs or recover their leases. All shared writers must honor this protocol.
 */
export const FLEET_INSTALL_SQL = String.raw`
CREATE SCHEMA IF NOT EXISTS ivx_fleet;
REVOKE ALL ON SCHEMA ivx_fleet FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS ivx_fleet.resources (
  resource_key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('capacity','agent','file')),
  token uuid,
  task_id text,
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  expires_at timestamptz NOT NULL DEFAULT 'epoch',
  used_at timestamptz NOT NULL DEFAULT 'epoch'
);
ALTER TABLE ivx_fleet.resources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ivx_fleet.resources FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ivx_fleet TO service_role;
GRANT SELECT, INSERT, UPDATE ON ivx_fleet.resources TO service_role;
INSERT INTO ivx_fleet.resources(resource_key,kind)
SELECT 'capacity/' || lpad(n::text,3,'0'), 'capacity' FROM generate_series(1,112) n
ON CONFLICT DO NOTHING;
INSERT INTO ivx_fleet.resources(resource_key,kind)
SELECT 'agent/' || lpad(n::text,3,'0'), 'agent' FROM generate_series(1,112) n
ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS ivx_fleet_resources_available_idx
  ON ivx_fleet.resources(kind,used_at,resource_key) WHERE kind <> 'file';
CREATE INDEX IF NOT EXISTS ivx_fleet_tasks_ready_idx
  ON public.ivx_autonomous_tasks(
    (CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END),
    created_at,task_id)
  WHERE payload->>'executor' = 'ivx-fleet-v1' AND state IN ('RECEIVED','RUNNING');
CREATE INDEX IF NOT EXISTS ivx_fleet_tasks_reconcile_idx
  ON public.ivx_autonomous_tasks(lease_expires_at,task_id)
  WHERE payload->>'executor' = 'ivx-fleet-v1' AND state = 'DEPLOYING';
`;

export interface FleetFilePatch {
  /** Canonical, case-sensitive repository-relative POSIX path; no symlinks. */
  path: string;
  /** SHA-256 of the expected old bytes; null means the file must not exist. */
  beforeSha256: string | null;
  content: string;
}
export interface FleetMission {
  idempotencyKey: string;
  baseCommit: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  files: readonly FleetFilePatch[];
  assignedAgentNumber?: number;
}
interface FleetTaskRow {
  task_id: string;
  idempotency_key: string;
  state: string;
  priority: FleetMission['priority'];
  assigned_agent_number: number | null;
  payload: unknown;
}
export interface FleetLease {
  taskId: string;
  agentNumber: number;
  token: string;
  /** bigint is serialized as a decimal string to avoid JS precision loss. */
  fences: Readonly<Record<string, string>>;
  resourceKeys: readonly string[];
  mission: FleetMission;
  attempt: number;
}
export interface FleetWorkspace {
  directory: string;
  commitSha: string;
  baseCommit: string;
  changedFiles: readonly string[];
}
export const FLEET_QA_CHECKS = [
  'typescript', 'lint', 'unit', 'integration', 'auth', 'secrets',
  'build', 'landing-http', 'landing-browser', 'accessibility', 'assets',
] as const;
export type FleetQAName = typeof FLEET_QA_CHECKS[number];
export interface FleetQAReport {
  simulated: boolean;
  commitSha: string;
  checks: readonly { name: FleetQAName; passed: boolean; evidence: string }[];
}
export interface FleetPublication {
  simulated: boolean;
  commitSha: string;
  reference: string;
}
export interface FleetDeployment {
  simulated: boolean;
  commitSha: string;
  deploymentId: string;
  status: 'READY';
  url: string | null;
  checks: FleetQAReport;
}
export interface FleetPipelineContext {
  /** Explicit remote destination: a private clone's origin is LOCAL. Never
   * `git push origin` from it; a real adapter must use this configured repo. */
  repository: string;
  lease: FleetLease;
  signal: AbortSignal;
  /** Stable across lease attempts. External sinks MUST persist deduplication. */
  idempotencyKey: string;
  assertLease: () => Promise<void>;
}
/** Production adapters are trusted infrastructure, never model-generated tools.
 * QA must run in a credential-isolated sandbox and attest this exact commit.
 * Publication must enforce fences at the shared writer, deduplicate by task,
 * and use Git compare-and-swap/fast-forward checks against the approved base.
 * An AbortSignal or a check immediately before an HTTP request alone cannot
 * fence a paused process. Never let agents write to one shared checkout.
 * GitHub/Vercel are not one DB transaction: uncertain publication is BLOCKED
 * for reconciliation, not automatically reissued. Do not force-push main.
 */
export interface FleetPipeline {
  mode: FleetMode;
  qaCheck(workspace: FleetWorkspace, context: FleetPipelineContext): Promise<FleetQAReport>;
  /** Consult the authenticated owner gate; payload/email is NOT authorization. */
  authorizePublication(workspace: FleetWorkspace, context: FleetPipelineContext): Promise<boolean>;
  pushToGitHub(workspace: FleetWorkspace, context: FleetPipelineContext): Promise<FleetPublication>;
  triggerVercelPipeline(publication: FleetPublication, context: FleetPipelineContext): Promise<FleetDeployment>;
}

function fleetObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fleetErrorCode(error: unknown): string {
  if (fleetObject(error) && typeof error.code === 'string') return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)) return error.message;
  return error instanceof Error ? error.name : 'UNKNOWN';
}
class FleetLeaseLost extends Error { constructor() { super('FLEET_LEASE_LOST'); this.name = 'FleetLeaseLost'; } }
class FleetBusy extends Error { constructor() { super('FLEET_RESOURCE_BUSY'); this.name = 'FleetBusy'; } }
class FleetCommitUnknown extends Error { constructor() { super('FLEET_COMMIT_OUTCOME_UNKNOWN'); this.name = 'FleetCommitUnknown'; } }
const fleetTransientCodes = new Set(['40001','40P01','55P03','53300','53400','57P01','57P02','57P03','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','EAI_AGAIN']);
function fleetTransient(error: unknown): boolean {
  const code = fleetErrorCode(error);
  return fleetTransientCodes.has(code) || code.startsWith('08') ||
    (error instanceof Error && /timeout exceeded when trying to connect|connection terminated|connection timeout/i.test(error.message));
}
function fleetBackoff(attempt: number, base = 250): number {
  const ceiling = Math.min(10_000, base * 2 ** Math.min(attempt, 6));
  return Math.floor(ceiling / 2 + Math.random() * ceiling / 2);
}
function fleetAbortable<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((accept, reject) => {
    const abort = (): void => reject(signal.reason instanceof Error ? signal.reason : new Error('ABORTED'));
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(
      result => { signal.removeEventListener('abort',abort); accept(result); },
      error => { signal.removeEventListener('abort',abort); reject(error); },
    );
  });
}
function fleetNumber(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  const value = raw === undefined ? fallback : Number(raw);
  if ((raw !== undefined && !/^\d+$/.test(raw)) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`INVALID_${key}`);
  }
  return value;
}
export interface FleetConfig {
  mode: FleetMode;
  repository: string;
  localConcurrency: number;
  leaseMs: number;
  heartbeatMs: number;
  pollMs: number;
  taskTimeoutMs: number;
  maxAttempts: number;
}
export function readFleetConfig(env: NodeJS.ProcessEnv = process.env): FleetConfig {
  // Same precedence as the project's shared pool factory: reject a wrong first
  // URL rather than silently using a different DB than the rest of the worker.
  const raw = (env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_POOLER_URL || '').trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('SUPABASE_TRANSACTION_POOLER_URL_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.port !== '6543' || !url.hostname || !url.username || !url.password) {
    throw new Error('SUPABASE_TRANSACTION_POOLER_PORT_6543_REQUIRED');
  }
  const mode = env.IVX_FLEET_MODE ?? 'simulation';
  if (mode !== 'simulation' && mode !== 'production') throw new Error('INVALID_IVX_FLEET_MODE');
  const repository = (env.IVX_FLEET_REPOSITORY ?? 'ibb142/ivx-holdings-platform').toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repository)) throw new Error('INVALID_FLEET_REPOSITORY');
  const leaseMs = fleetNumber(env, 'IVX_FLEET_LEASE_MS', FLEET_CONFIG.LEASE_EXPIRY_TIMEOUT_MS, 30_000, 600_000);
  const heartbeatMs = fleetNumber(env, 'IVX_FLEET_HEARTBEAT_MS', FLEET_CONFIG.LEASE_RENEWAL_INTERVAL_MS, 5_000, 60_000);
  if (heartbeatMs * 3 > leaseMs) throw new Error('HEARTBEAT_MUST_NOT_EXCEED_ONE_THIRD_OF_LEASE');
  const localConcurrency = fleetPathConcurrency(env, 'IVX_FLEET_CONCURRENCY', FLEET_SIZE);
  if (localConcurrency < 1) throw new Error('FLEET_ADMISSION_DISABLED');
  return {
    mode, repository, leaseMs, heartbeatMs,
    localConcurrency,
    pollMs: fleetNumber(env, 'IVX_FLEET_POLL_MS', 5_000, 1_000, 60_000),
    taskTimeoutMs: fleetNumber(env, 'IVX_FLEET_TASK_TIMEOUT_MS', 600_000, 30_000, 3_600_000),
    maxAttempts: fleetNumber(env, 'IVX_FLEET_MAX_ATTEMPTS', 3, 1, 10),
  };
}

export function validateFleetMission(value: unknown): FleetMission {
  if (!fleetObject(value) || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200 ||
      typeof value.baseCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.baseCommit) ||
      !['critical','high','medium','low'].includes(String(value.priority)) ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 50) throw new Error('INVALID_FLEET_MISSION');
  const paths = new Set<string>();
  const files: FleetFilePatch[] = value.files.map((entry: unknown) => {
    if (!fleetObject(entry) || typeof entry.path !== 'string' || typeof entry.content !== 'string' ||
        !(entry.beforeSha256 === null || (typeof entry.beforeSha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.beforeSha256)))) throw new Error('INVALID_FILE_PATCH');
    const path = entry.path;
    if (!path || path.length > 240 || /[\x00-\x1f\\]/.test(path) || path.startsWith('/') ||
        path.endsWith('/') || path.startsWith('-') || posix.normalize(path) !== path ||
        path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git') || paths.has(path)) throw new Error('UNSAFE_OR_DUPLICATE_FILE_PATH');
    paths.add(path);
    return { path, content: entry.content, beforeSha256: entry.beforeSha256 };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  // Parent/child targets (e.g. a and a/b) are invalid even when one is new.
  for (const path of paths) for (const other of paths) {
    if (other.startsWith(`${path}/`)) throw new Error('OVERLAPPING_FILE_TARGETS');
  }
  if (Buffer.byteLength(JSON.stringify(files), 'utf8') > 1_048_576) throw new Error('PATCH_EXCEEDS_1_MIB');
  const mission: FleetMission = {
    idempotencyKey: value.idempotencyKey,
    baseCommit: value.baseCommit,
    priority: value.priority as FleetMission['priority'], files,
  };
  if (value.assignedAgentNumber !== undefined) {
    if (typeof value.assignedAgentNumber !== 'number' || !Number.isInteger(value.assignedAgentNumber) || value.assignedAgentNumber < 1 || value.assignedAgentNumber > FLEET_SIZE) throw new Error('INVALID_AGENT_NUMBER');
    mission.assignedAgentNumber = value.assignedAgentNumber;
  }
  return mission;
}

type FleetLog = (event: string, fields: Readonly<Record<string, string | number | boolean>>) => void;
export class FleetDatabase {
  constructor(private readonly pool: FleetPool, private readonly log: FleetLog) {}
  /** DB-only callbacks. NEVER put Git, filesystem, model calls or HTTP here.
   * One checked-out client per short transaction; backoff happens after release.
   * No named prepared statements, session SET, LISTEN or session advisory locks.
   */
  async transaction<T>(work: (client: FleetClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let client: FleetClient | undefined;
      let committing = false;
      let destroy = false;
      let connectionError: Error | null = null;
      const onError = (error: Error): void => { connectionError = error; destroy = true; };
      const requireConnection = (): void => { if (connectionError) throw connectionError; };
      try {
        client = await this.pool.connect();
        client.on('error', onError);
        signal?.throwIfAborted();
        requireConnection();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        requireConnection();
        await client.query(`SELECT set_config('statement_timeout','2500',true),
          set_config('lock_timeout','750',true),
          set_config('idle_in_transaction_session_timeout','10000',true)`);
        requireConnection();
        const result = await work(client);
        requireConnection();
        signal?.throwIfAborted();
        committing = true;
        await client.query('COMMIT');
        requireConnection();
        return result;
      } catch (error: unknown) {
        const code = fleetErrorCode(error);
        const serverAborted = ['40001','40P01','55P03','57014'].includes(code);
        // Losing the COMMIT response does not imply rollback. Abandon/reconcile.
        const ambiguous = committing && !serverAborted;
        if (client) {
          // An unanswered query still owns the pg protocol queue. Destroy the
          // uncertain socket instead of adding ROLLBACK behind it and waiting
          // through another timeout. Server-rejected or local failures can
          // rollback normally; only a healthy connection returns to the pool.
          const uncertainConnection = Boolean(connectionError) || ambiguous ||
            (fleetTransient(error) && !serverAborted) ||
            (error instanceof Error && /query read timeout/i.test(error.message));
          if (uncertainConnection) destroy = true;
          else { try { await client.query('ROLLBACK'); } catch { destroy = true; } }
        }
        if (ambiguous) throw new FleetCommitUnknown();
        if (attempt >= 4 || !fleetTransient(error) || signal?.aborted) throw error;
        this.log('fleet.db.retry', { code, attempt: attempt + 1 });
      } finally {
        if (client) {
          // Keep the listener installed until release/destroy has completed.
          try { client.release(destroy); }
          finally { client.removeListener('error', onError); }
        }
      }
      await fleetDelay(fleetBackoff(attempt), undefined, signal ? { signal } : undefined);
    }
  }
}

export class FleetTaskStore {
  constructor(
    private readonly db: FleetDatabase,
    private readonly heartbeatDb: FleetDatabase,
    private readonly config: FleetConfig,
    private readonly instanceId: string,
  ) {}

  /** Explicit, monotonic capacity expansion; no boot DDL or lease reclamation. */
  async optimizeConcurrencyBoundaries(capacity: number, signal?: AbortSignal): Promise<void> {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > FLEET_SIZE) {
      throw new Error('INVALID_FLEET_CAPACITY');
    }
    await this.db.transaction(async client => {
      const current = await client.query<{ resource_key: string }>(
        "SELECT resource_key FROM ivx_fleet.resources WHERE kind='capacity' ORDER BY resource_key FOR UPDATE");
      if (current.rows.some(row => !/^capacity\/\d{3}$/.test(row.resource_key)
        || Number(row.resource_key.slice(9)) < 1 || Number(row.resource_key.slice(9)) > capacity)) {
        throw new Error('FLEET_CAPACITY_SHRINK_REQUIRES_DRAIN');
      }
      await client.query(`INSERT INTO ivx_fleet.resources(resource_key,kind)
        SELECT 'capacity/' || lpad(n::text,3,'0'), 'capacity' FROM generate_series(1,$1::int) n
        ON CONFLICT DO NOTHING`, [capacity]);
      const result = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM ivx_fleet.resources WHERE kind='capacity'");
      if (result.rows[0]?.count !== capacity) throw new Error('FLEET_CAPACITY_NOT_CONFIRMED');
    }, signal);
  }

  async verifySchema(signal?: AbortSignal): Promise<void> {
    await this.db.transaction(async client => {
      // Read-only startup preflight. Missing columns/migration/permissions fail
      // startup clearly; the worker never issues automatic production DDL.
      await client.query(`SELECT task_id,idempotency_key,state,priority,payload,
        assigned_agent_number,lease_holder,worker_instance_id,lease_expires_at,
        last_heartbeat_at,version,created_at,updated_at
        FROM public.ivx_autonomous_tasks LIMIT 0`);
      const { rows } = await client.query<{ agents: number; capacity: number }>(`
        SELECT count(*) FILTER (WHERE kind='agent')::int AS agents,
          count(*) FILTER (WHERE kind='capacity')::int AS capacity
        FROM ivx_fleet.resources WHERE kind IN ('agent','capacity')`);
      if (rows[0]?.agents !== FLEET_SIZE || !rows[0].capacity) throw new Error('FLEET_INSTALL_SQL_REQUIRED');
    }, signal);
  }

  async enqueue(input: FleetMission, signal?: AbortSignal): Promise<string> {
    const mission = validateFleetMission(input);
    const key = `${FLEET_EXECUTOR}:${this.config.mode}:${this.config.repository}:${mission.idempotencyKey}`;
    const id = `fleet-${fleetHash('sha256').update(key).digest('hex')}`;
    const digest = fleetHash('sha256').update(JSON.stringify(mission)).digest('hex');
    return this.db.transaction(async client => {
      const payload = {
        taskId: id, idempotencyKey: key, state: 'RECEIVED',
        executor: FLEET_EXECUTOR, fleetMode: this.config.mode,
        repository: this.config.repository, mission, missionDigest: digest,
        fleetAttempts: 0, priority: mission.priority,
        assignedAgentNumber: mission.assignedAgentNumber ?? null,
      };
      const inserted = await client.query(`INSERT INTO public.ivx_autonomous_tasks
        (task_id,idempotency_key,state,priority,assigned_agent_number,payload)
        VALUES ($1,$2,'RECEIVED',$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`,
      [id,key,mission.priority,mission.assignedAgentNumber ?? null,JSON.stringify(payload)]);
      const { rows } = await client.query<{ payload: unknown }>(
        'SELECT payload FROM public.ivx_autonomous_tasks WHERE task_id=$1', [id]);
      if (!fleetObject(rows[0]?.payload) || rows[0].payload.missionDigest !== digest) throw new Error('IDEMPOTENCY_KEY_CONTENT_CONFLICT');
      if (inserted.rowCount) await this.event(client, id, 'fleet_enqueued', { mode: this.config.mode });
      return id;
    }, signal);
  }

  async claim(signal?: AbortSignal): Promise<FleetLease | null> {
    // The token survives transaction retries. A lost COMMIT response is NEVER
    // blindly retried by FleetDatabase; that abandoned lease expires normally.
    const token = fleetUUID();
    try {
      return await this.db.transaction(async client => {
        const { rows } = await client.query<FleetTaskRow>(`
          SELECT t.task_id,t.idempotency_key,t.state,t.priority,t.assigned_agent_number,t.payload
          FROM public.ivx_autonomous_tasks t
          WHERE t.payload->>'executor'=$1 AND t.payload->>'fleetMode'=$2
            AND t.payload->>'repository'=$3
            AND (t.state='RECEIVED' OR
              (t.state='RUNNING' AND t.lease_expires_at <= clock_timestamp()))
            AND NOT EXISTS (SELECT 1 FROM ivx_fleet.resources a
              WHERE a.resource_key='agent/' || lpad(t.assigned_agent_number::text,3,'0')
                AND a.expires_at>clock_timestamp())
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(CASE
                WHEN jsonb_typeof(t.payload#>'{mission,files}')='array'
                THEN t.payload#>'{mission,files}' ELSE '[]'::jsonb END) f
              JOIN ivx_fleet.resources r
                ON r.resource_key = 'file/' || $3 || '/' || (f->>'path')
              WHERE r.expires_at > clock_timestamp())
          ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
            WHEN 'medium' THEN 2 ELSE 3 END, t.created_at,t.task_id
          LIMIT 1 FOR UPDATE OF t SKIP LOCKED`,
        [FLEET_EXECUTOR,this.config.mode,this.config.repository]);
        const row = rows[0];
        if (!row) return null;
        let mission: FleetMission;
        let attempts: number;
        try {
          if (!fleetObject(row.payload) || row.payload.taskId !== row.task_id ||
              row.payload.idempotencyKey !== row.idempotency_key) throw new Error('PAYLOAD_ID_MISMATCH');
          mission = validateFleetMission(row.payload.mission);
          attempts = Number(row.payload.fleetAttempts);
          if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts >= this.config.maxAttempts) throw new Error('MAX_ATTEMPTS_OR_INVALID_COUNTER');
        } catch {
          await client.query(`UPDATE public.ivx_autonomous_tasks SET state='BLOCKED',
            lease_holder=NULL,worker_instance_id=NULL,lease_expires_at=NULL,
            updated_at=clock_timestamp(),version=version+1,
            payload=payload || jsonb_build_object('taskId',task_id,'state','BLOCKED',
              'leaseHolder',null,'workerInstanceId',null,'leaseExpiresAt',null,
              'error','INVALID_MISSION_OR_MAX_ATTEMPTS','updatedAt',clock_timestamp())
            WHERE task_id=$1`, [row.task_id]);
          await this.event(client, row.task_id, 'fleet_blocked', { reason: 'INVALID_MISSION_OR_MAX_ATTEMPTS' });
          return null;
        }
        const capacity = await this.availableResource(client, 'capacity', null);
        const assigned = row.assigned_agent_number ?? mission.assignedAgentNumber ?? null;
        const agent = await this.availableResource(client, 'agent', assigned === null ? null : `agent/${String(assigned).padStart(3,'0')}`);
        if (!capacity || !agent) return null;
        const agentNumber = Number(agent.slice('agent/'.length));
        const resourceKeys = [capacity,agent,...mission.files.map(file => `file/${this.config.repository}/${file.path}`)].sort();
        const acquired = await client.query<{ resource_key: string; fence: string }>(`
          INSERT INTO ivx_fleet.resources(resource_key,kind,token,task_id,fence,expires_at,used_at)
          SELECT key,split_part(key,'/',1),$2::uuid,$3,1,
            clock_timestamp()+($4::int * interval '1 millisecond'),clock_timestamp()
          FROM unnest($1::text[]) key ORDER BY key
          ON CONFLICT(resource_key) DO UPDATE SET token=EXCLUDED.token,
            task_id=EXCLUDED.task_id,fence=ivx_fleet.resources.fence+1,
            expires_at=EXCLUDED.expires_at,used_at=EXCLUDED.used_at
          WHERE ivx_fleet.resources.expires_at <= clock_timestamp()
          RETURNING resource_key,fence::text`, [resourceKeys,token,row.task_id,this.config.leaseMs]);
        if (acquired.rowCount !== resourceKeys.length) throw new FleetBusy();
        await client.query(`UPDATE public.ivx_autonomous_tasks SET state='RUNNING',
          assigned_agent_number=$2,lease_holder=$3,worker_instance_id=$4,
          lease_expires_at=clock_timestamp()+($5::int * interval '1 millisecond'),
          last_heartbeat_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,
          payload=payload || jsonb_build_object('taskId',task_id,'state','RUNNING',
            'assignedAgentNumber',$2::int,'leaseHolder',$3::text,'workerInstanceId',$4::text,
            'leaseExpiresAt',clock_timestamp()+($5::int * interval '1 millisecond'),
            'lastHeartbeatAt',clock_timestamp(),'updatedAt',clock_timestamp(),
            'fleetAttempts',$6::int,'fleetPhase','working','error',null)
          WHERE task_id=$1`, [row.task_id,agentNumber,token,this.instanceId,this.config.leaseMs,attempts+1]);
        await this.event(client, row.task_id, 'fleet_claimed', { token, agentNumber, attempt: attempts+1 });
        return { taskId: row.task_id, token, agentNumber, resourceKeys,
          fences: Object.fromEntries(acquired.rows.map(resource => [resource.resource_key,resource.fence])),
          mission, attempt: attempts+1 };
      }, signal);
    } catch (error: unknown) {
      if (error instanceof FleetBusy) return null;
      throw error;
    }
  }

  private async availableResource(client: FleetClient, kind: 'capacity' | 'agent', key: string | null): Promise<string | null> {
    const { rows } = await client.query<{ resource_key: string }>(`
      SELECT resource_key FROM ivx_fleet.resources
      WHERE kind=$1 AND expires_at<=clock_timestamp() AND ($2::text IS NULL OR resource_key=$2)
      ORDER BY used_at,resource_key LIMIT 1 FOR UPDATE SKIP LOCKED`, [kind,key]);
    return rows[0]?.resource_key ?? null;
  }

  private async owned(client: FleetClient, lease: FleetLease): Promise<void> {
    const task = await client.query(`SELECT task_id FROM public.ivx_autonomous_tasks
      WHERE task_id=$1 AND lease_holder=$2 AND worker_instance_id=$3
      AND state=ANY($4::text[]) AND assigned_agent_number=$5
      AND lease_expires_at>clock_timestamp() FOR UPDATE`,
    [lease.taskId,lease.token,this.instanceId,FLEET_LIVE_STATES,lease.agentNumber]);
    if (task.rowCount !== 1) throw new FleetLeaseLost();
    const resources = await client.query<{ resource_key: string; fence: string }>(`
      SELECT resource_key,fence::text FROM ivx_fleet.resources
      WHERE resource_key=ANY($1::text[]) AND token=$2::uuid AND task_id=$3
      AND expires_at>clock_timestamp() ORDER BY resource_key FOR UPDATE`,
    [lease.resourceKeys,lease.token,lease.taskId]);
    if (resources.rowCount !== lease.resourceKeys.length ||
        resources.rows.some(row => lease.fences[row.resource_key] !== row.fence)) throw new FleetLeaseLost();
  }

  async assertLease(lease: FleetLease, signal?: AbortSignal): Promise<void> {
    await this.heartbeatDb.transaction(client => this.owned(client, lease), signal);
  }

  async heartbeat(lease: FleetLease, signal?: AbortSignal): Promise<void> {
    await this.heartbeatDb.transaction(async client => {
      await this.owned(client,lease);
      const resources = await client.query(`UPDATE ivx_fleet.resources
        SET expires_at=clock_timestamp()+($3::int * interval '1 millisecond')
        WHERE resource_key=ANY($1::text[]) AND token=$2::uuid AND expires_at>clock_timestamp()`,
      [lease.resourceKeys,lease.token,this.config.leaseMs]);
      const task = await client.query(`UPDATE public.ivx_autonomous_tasks SET
        lease_expires_at=clock_timestamp()+($3::int * interval '1 millisecond'),
        last_heartbeat_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,
        payload=payload || jsonb_build_object('taskId',task_id,'lastHeartbeatAt',clock_timestamp(),
          'updatedAt',clock_timestamp(),'leaseExpiresAt',clock_timestamp()+($3::int * interval '1 millisecond'))
        WHERE task_id=$1 AND lease_holder=$2 AND lease_expires_at>clock_timestamp()`,
      [lease.taskId,lease.token,this.config.leaseMs]);
      if (resources.rowCount !== lease.resourceKeys.length || task.rowCount !== 1) throw new FleetLeaseLost();
    }, signal);
  }

  async beginPublication(lease: FleetLease, workspace: FleetWorkspace, signal?: AbortSignal): Promise<void> {
    await this.db.transaction(async client => {
      await this.owned(client,lease);
      const changed = await client.query(`UPDATE public.ivx_autonomous_tasks
        SET state='DEPLOYING',version=version+1,updated_at=clock_timestamp(),
          payload=payload || jsonb_build_object('taskId',task_id,'state','DEPLOYING',
            'fleetPhase','publication_started','publicationCommitSha',$3::text,
            'publicationIdempotencyKey',task_id,'updatedAt',clock_timestamp())
        WHERE task_id=$1 AND lease_holder=$2 AND state='RUNNING' AND lease_expires_at>clock_timestamp()`,
      [lease.taskId,lease.token,workspace.commitSha]);
      if (changed.rowCount !== 1) throw new FleetLeaseLost();
      await this.event(client,lease.taskId,'fleet_publication_started',{ commitSha: workspace.commitSha });
    }, signal);
  }

  async finish(lease: FleetLease, state: FleetEndState, result: Readonly<Record<string, unknown>>): Promise<void> {
    await this.db.transaction(async client => {
      await this.owned(client,lease);
      const changed = await client.query(`UPDATE public.ivx_autonomous_tasks SET
        state=$3,lease_holder=NULL,worker_instance_id=NULL,lease_expires_at=NULL,
        updated_at=clock_timestamp(),version=version+1,
        payload=payload || jsonb_build_object('taskId',task_id,'state',$3::text,
          'leaseHolder',null,'workerInstanceId',null,'leaseExpiresAt',null,
          'updatedAt',clock_timestamp(),'fleetResult',$4::jsonb,
          'completedAt',CASE WHEN $3 IN ('VERIFIED','NO_ACTION_REQUIRED','FAILED','QA_FAILED')
            THEN clock_timestamp() ELSE NULL END)
        WHERE task_id=$1 AND lease_holder=$2 AND lease_expires_at>clock_timestamp()`,
      [lease.taskId,lease.token,state,JSON.stringify(result)]);
      if (changed.rowCount !== 1) throw new FleetLeaseLost();
      await client.query(`UPDATE ivx_fleet.resources SET token=NULL,task_id=NULL,expires_at='epoch'
        WHERE resource_key=ANY($1::text[]) AND token=$2::uuid`, [lease.resourceKeys,lease.token]);
      await this.event(client,lease.taskId,'fleet_finished',{ state, ...result });
    });
  }

  /** Publication may already exist. Preserve its SHA/key for read-only recovery. */
  async blockExpiredPublications(signal?: AbortSignal): Promise<number> {
    return this.db.transaction(async client => {
      const result = await client.query(`WITH expired AS (
        SELECT task_id FROM public.ivx_autonomous_tasks
        WHERE payload->>'executor'=$1 AND payload->>'fleetMode'=$2
          AND payload->>'repository'=$3 AND state='DEPLOYING'
          AND lease_expires_at<=clock_timestamp()
        ORDER BY lease_expires_at LIMIT 32 FOR UPDATE SKIP LOCKED
      ) UPDATE public.ivx_autonomous_tasks t SET state='BLOCKED',
        lease_holder=NULL,worker_instance_id=NULL,lease_expires_at=NULL,
        updated_at=clock_timestamp(),version=version+1,
        payload=t.payload || jsonb_build_object('taskId',t.task_id,'state','BLOCKED',
          'leaseHolder',null,'workerInstanceId',null,'leaseExpiresAt',null,
          'updatedAt',clock_timestamp(),'error','PUBLICATION_RECONCILIATION_REQUIRED')
        FROM expired e WHERE t.task_id=e.task_id`,
      [FLEET_EXECUTOR,this.config.mode,this.config.repository]);
      return result.rowCount ?? 0;
    }, signal);
  }

  private async event(client: FleetClient, taskId: string, type: string, event: Readonly<Record<string, unknown>>): Promise<void> {
    await client.query(`INSERT INTO public.ivx_autonomous_task_events(event_type,task_id,worker_instance_id,event)
      VALUES($1,$2,$3,$4::jsonb)`, [type,taskId,this.instanceId,JSON.stringify(event)]);
  }
}

/** Prepares durable capacity only; starting an executor still requires its
 * installed schema and a real production pipeline adapter. */
export async function unlockFullFleetCapacity(store: FleetTaskStore, signal?: AbortSignal): Promise<void> {
  await store.optimizeConcurrencyBoundaries(FLEET_CONFIG.GLOBAL_CONCURRENCY_LIMIT, signal);
}

async function fleetGit(args: readonly string[], cwd: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const result = await fleetExec('git', ['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args], {
    cwd, signal, timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  return result.stdout.trim();
}

/** Every attempt owns a private clone, including .git; never a shared worktree.
 * This protects local files even if a paused/expired worker resumes execution.
 * Only the fenced publication adapter may update a shared GitHub reference.
 */
export async function prepareFleetPatch(
  sourceDirectory: string, lease: FleetLease, signal: AbortSignal,
): Promise<FleetWorkspace> {
  const mission = validateFleetMission(lease.mission);
  const source = await realpath(fleetResolve(sourceDirectory));
  const directory = await mkdtemp(join(tmpdir(),'ivx-fleet-'));
  try {
    await fleetGit(['clone','--no-hardlinks','--no-checkout','--',source,directory], source, signal);
    await fleetGit(['checkout','--detach',mission.baseCommit],directory,signal);
    for (const patch of mission.files) {
      signal.throwIfAborted();
      const segments = patch.path.split('/');
      let cursor = directory;
      for (const [index, segment] of segments.entries()) {
        cursor = join(cursor,segment);
        try {
          const stat = await lstat(cursor);
          if (stat.isSymbolicLink() || (index < segments.length-1 ? !stat.isDirectory() : !stat.isFile())) throw new Error('UNSAFE_PATCH_TARGET');
        } catch (error: unknown) {
          if (fleetErrorCode(error) !== 'ENOENT') throw error;
          if (index < segments.length-1) await mkdir(cursor);
        }
      }
      const target = join(directory,patch.path);
      let before: Buffer | null = null;
      try { before = await readFile(target); } catch (error: unknown) {
        if (fleetErrorCode(error) !== 'ENOENT') throw error;
      }
      const actual = before === null ? null : fleetHash('sha256').update(before).digest('hex');
      if (actual !== patch.beforeSha256) throw new Error('PATCH_BASE_CONTENT_CONFLICT');
      const temp = `${target}.ivx-${lease.token}.tmp`;
      // Preserve executable bits on existing scripts, and use a private temp file.
      const mode = before === null ? 0o644 : (await lstat(target)).mode & 0o777;
      await writeFile(temp,patch.content,{ encoding: 'utf8', flag: 'wx', mode });
      signal.throwIfAborted();
      await rename(temp,target);
    }
    await fleetGit(['diff','--check'],directory,signal);
    await fleetGit(['add','--',...mission.files.map(file => file.path)],directory,signal);
    const staged = await fleetGit(['diff','--cached','--name-only','-z'],directory,signal);
    const changed = staged.split('\0').filter(Boolean);
    if (!changed.length || changed.some(path => !mission.files.some(file => file.path === path))) throw new Error('EMPTY_OR_UNDECLARED_PATCH');
    await fleetGit(['-c','user.name=IVX Fleet','-c','user.email=fleet@ivxholding.com',
      'commit','-m',`IVX mission ${lease.taskId}`],directory,signal);
    const commitSha = await fleetGit(['rev-parse','HEAD'],directory,signal);
    return { directory, commitSha, baseCommit: mission.baseCommit, changedFiles: changed };
  } catch (error: unknown) {
    await rm(directory,{recursive:true,force:true});
    throw error;
  }
}

function assertFleetQA(report: FleetQAReport, sha: string, mode: FleetMode): void {
  if (report.commitSha !== sha || report.simulated !== (mode === 'simulation') ||
      report.checks.length !== FLEET_QA_CHECKS.length ||
      new Set(report.checks.map(check => check.name)).size !== FLEET_QA_CHECKS.length ||
      FLEET_QA_CHECKS.some(name => !report.checks.some(check => check.name === name && check.passed && check.evidence.trim()))) {
    throw new Error('EXACT_COMMIT_11_OF_11_QA_REQUIRED');
  }
}

/** Complete simulations requested by the owner. They never call GitHub/Vercel,
 * never claim a real check passed, and cannot be used in production mode.
 * The eleven names form a proposed contract, not discovered existing CI jobs.
 */
export class SimulatedFleetPipeline implements FleetPipeline {
  readonly mode = 'simulation' as const;
  async qaCheck(workspace: FleetWorkspace, context: FleetPipelineContext): Promise<FleetQAReport> {
    context.signal.throwIfAborted();
    return this.report(workspace.commitSha);
  }
  async authorizePublication(_workspace: FleetWorkspace, context: FleetPipelineContext): Promise<boolean> {
    context.signal.throwIfAborted();
    return true; // Only authorization to simulate; mode mismatch fails startup.
  }
  async pushToGitHub(workspace: FleetWorkspace, context: FleetPipelineContext): Promise<FleetPublication> {
    await context.assertLease();
    context.signal.throwIfAborted();
    return { simulated:true,commitSha:workspace.commitSha,reference:`simulation:github:${context.idempotencyKey}` };
  }
  async triggerVercelPipeline(publication: FleetPublication, context: FleetPipelineContext): Promise<FleetDeployment> {
    await context.assertLease();
    context.signal.throwIfAborted();
    if (!publication.simulated) throw new Error('SIMULATOR_REQUIRES_SIMULATED_PUBLICATION');
    return { simulated:true,commitSha:publication.commitSha,
      deploymentId:`simulation:vercel:${context.idempotencyKey}`,status:'READY',url:null,
      checks:this.report(publication.commitSha) };
  }
  private report(commitSha: string): FleetQAReport {
    return { simulated:true,commitSha,checks:FLEET_QA_CHECKS.map(name => ({
      name,passed:true,evidence:`SIMULATED ${name}; no real CI or production test executed`,
    })) };
  }
}

export interface MultiAgentFleetOptions {
  /** Local trusted read-only clone; patch bytes must reference a full base SHA. */
  repositoryDirectory: string;
  pipeline?: FleetPipeline;
  env?: NodeJS.ProcessEnv;
  log?: FleetLog;
}
export class MultiAgentFleet {
  readonly config: FleetConfig;
  readonly instanceId = `ivx-fleet:${fleetUUID()}`;
  private readonly controller = new AbortController();
  private readonly pipeline: FleetPipeline;
  private readonly log: FleetLog;
  private readonly store: FleetTaskStore;
  private runners: Promise<void>[] = [];
  private startPromise: Promise<void> | undefined;
  private started = false;
  private readonly agents = Array.from({length:FLEET_SIZE},(_, index) => ({
    agentNumber:index+1,taskId:null as string | null,
  }));

  constructor(private readonly options: MultiAgentFleetOptions) {
    const env = options.env ?? process.env;
    this.config = readFleetConfig(env);
    this.pipeline = options.pipeline ?? new SimulatedFleetPipeline();
    if (this.pipeline.mode !== this.config.mode) throw new Error('PRODUCTION_REQUIRES_REAL_PIPELINE_ADAPTER');
    this.log = (event, fields) => {
      try { (options.log ?? ((name, data) => console.info(name,data)))(event,fields); }
      catch { /* Logging must never terminate a lease keeper. */ }
    };
    // Reuse existing process-global pools and TLS CA verification. Default task
    // pool max=5; the dedicated heartbeat lane max=1 protects renewals. Their
    // process budget already includes API/observer lanes and needs replica sizing.
    // Neither one pool per agent nor a new connection per polling iteration.
    this.store = new FleetTaskStore(
      new FleetDatabase(fleetWorkerPool(env,'tasks'),this.log),
      new FleetDatabase(fleetWorkerPool(env,'heartbeat'),this.log),this.config,this.instanceId,
    );
  }

  start(): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(new Error('STOPPED_FLEET_CANNOT_RESTART'));
    this.startPromise ??= this.initialize();
    return this.startPromise;
  }
  private async initialize(): Promise<void> {
    for (let attempt=0;;attempt++) {
      try { await this.store.verifySchema(this.controller.signal); break; }
      catch (error: unknown) {
        if (!fleetTransient(error) || this.controller.signal.aborted) throw error;
        this.log('fleet.start_waiting_for_database',{code:fleetErrorCode(error)});
        await fleetDelay(fleetBackoff(attempt,1000),undefined,{signal:this.controller.signal});
      }
    }
    this.controller.signal.throwIfAborted();
    this.started = true;
    this.runners = Array.from({length:this.config.localConcurrency},(_, index) => this.runLoop(index));
    this.log('fleet.started',{ registered:FLEET_SIZE,localConcurrency:this.config.localConcurrency,mode:this.config.mode });
  }
  async enqueue(mission: FleetMission): Promise<string> {
    this.controller.signal.throwIfAborted();
    if (!this.started) throw new Error('FLEET_NOT_STARTED');
    return this.store.enqueue(mission,this.controller.signal);
  }
  status(): Readonly<Record<string, unknown>> {
    return { started:this.started,mode:this.config.mode,registered:FLEET_SIZE,
      scope:'this_process',running:this.agents.filter(agent => agent.taskId !== null).length,
      agents:this.agents.map(agent => ({...agent})),
      certified:false }; // A runtime snapshot is not production certification.
  }
  async stop(): Promise<void> {
    this.controller.abort(new Error('FLEET_STOPPED'));
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    await Promise.allSettled(this.runners);
    this.started = false;
    // Pools are borrowed from the application. Close them only in its central
    // shutdown coordinator after the API and all consumers have also stopped.
  }

  private async runLoop(index: number): Promise<void> {
    const signal = this.controller.signal;
    let failures = 0;
    let nextRecovery = 0;
    try {
      await fleetDelay(Math.floor(Math.random()*this.config.pollMs),undefined,{signal});
      while (!signal.aborted) {
        try {
          if (index === 0 && Date.now() >= nextRecovery) {
            const blocked = await this.store.blockExpiredPublications(signal);
            if (blocked) this.log('fleet.reconciliation_required',{count:blocked});
            nextRecovery = Date.now()+30_000;
          }
          const lease = await this.store.claim(signal);
          failures = 0;
          if (lease) await this.execute(lease);
          else await fleetDelay(this.config.pollMs+Math.floor(Math.random()*1000),undefined,{signal});
        } catch (error: unknown) {
          if (signal.aborted) break;
          this.log('fleet.loop_error',{code:fleetErrorCode(error),lane:index});
          await fleetDelay(fleetBackoff(failures++,1000),undefined,{signal});
        }
      }
    } catch (error: unknown) {
      if (!signal.aborted) this.log('fleet.loop_stopped',{code:fleetErrorCode(error),lane:index});
    }
  }

  private async execute(lease: FleetLease): Promise<void> {
    const localAgent = this.agents[lease.agentNumber-1];
    if (!localAgent) throw new Error('INVALID_LEASE_AGENT');
    localAgent.taskId = lease.taskId;
    const leaseController = new AbortController();
    const keeperController = new AbortController();
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(new Error('MISSION_TIMEOUT')),this.config.taskTimeoutMs);
    const signal = AbortSignal.any([this.controller.signal,leaseController.signal,timeoutController.signal]);
    const keeperSignal = AbortSignal.any([signal,keeperController.signal]);
    const keeper = (async (): Promise<void> => {
      try {
        while (!keeperSignal.aborted) {
          await fleetDelay(this.config.heartbeatMs,undefined,{signal:keeperSignal});
          if (!await emitFleetHeartbeat(this.store,lease,keeperSignal)) throw new FleetLeaseLost();
        }
      } catch (error: unknown) {
        if (!keeperSignal.aborted) {
          leaseController.abort(new FleetLeaseLost());
          this.log('fleet.lease_lost',{taskId:lease.taskId,code:fleetErrorCode(error)});
        }
      }
    })();
    let workspace: FleetWorkspace | undefined;
    let publicationStarted = false;
    try {
      const context: FleetPipelineContext = { repository:this.config.repository,lease,signal,idempotencyKey:lease.taskId,
        assertLease:() => this.store.assertLease(lease,signal) };
      await context.assertLease();
      workspace = await prepareFleetPatch(this.options.repositoryDirectory,lease,signal);
      const currentWorkspace = workspace;
      const qa = await fleetAbortable(signal,() => this.pipeline.qaCheck(currentWorkspace,context));
      signal.throwIfAborted();
      assertFleetQA(qa,workspace.commitSha,this.config.mode);
      if (!(await fleetAbortable(signal,() => this.pipeline.authorizePublication(currentWorkspace,context)))) throw new Error('OWNER_APPROVAL_REQUIRED');
      // A test runner may create build output, but must not modify the reviewed
      // commit or tracked source. External adapters receive the immutable SHA.
      if (await fleetGit(['rev-parse','HEAD'],workspace.directory,signal) !== workspace.commitSha) throw new Error('QA_CHANGED_COMMIT');
      await fleetGit(['diff','--exit-code','HEAD','--'],workspace.directory,signal);
      await context.assertLease();
      publicationStarted = true;
      await this.store.beginPublication(lease,workspace,signal);
      const publication = await fleetAbortable(signal,() => this.pipeline.pushToGitHub(currentWorkspace,context));
      signal.throwIfAborted();
      if (publication.commitSha !== workspace.commitSha || publication.simulated !== (this.config.mode==='simulation') || !publication.reference) throw new Error('PUBLICATION_PROOF_MISMATCH');
      await context.assertLease();
      const deployment = await fleetAbortable(signal,() => this.pipeline.triggerVercelPipeline(publication,context));
      signal.throwIfAborted();
      assertFleetQA(deployment.checks,workspace.commitSha,this.config.mode);
      if (deployment.commitSha !== workspace.commitSha || deployment.status !== 'READY' ||
          !deployment.deploymentId || deployment.simulated !== (this.config.mode==='simulation') ||
          (this.config.mode==='production' && (!deployment.url || new URL(deployment.url).protocol !== 'https:'))) throw new Error('DEPLOYMENT_PROOF_MISMATCH');
      // Stop the keeper before a terminal transition, avoiding a spurious
      // lease-lost warning after this transaction deliberately releases it.
      keeperController.abort();
      await keeper;
      await this.store.finish(lease,this.config.mode==='simulation'?'NO_ACTION_REQUIRED':'VERIFIED',{
        simulated:deployment.simulated,certified:!deployment.simulated,
        summary:deployment.simulated?'SIMULATED 11/11 Green':'11/11 Green',
        commitSha:workspace.commitSha,publication,qa,deployment,
      });
      this.log('fleet.finished',{taskId:lease.taskId,agentNumber:lease.agentNumber,simulated:deployment.simulated});
    } catch (error: unknown) {
      keeperController.abort();
      await keeper;
      const lost = leaseController.signal.aborted || error instanceof FleetLeaseLost;
      if (!lost && !(error instanceof FleetCommitUnknown)) {
        const retry = !publicationStarted && lease.attempt < this.config.maxAttempts &&
          (this.controller.signal.aborted || fleetTransient(error));
        const code = fleetErrorCode(error);
        const state: FleetEndState = publicationStarted?'BLOCKED':retry?'RECEIVED':
          code==='OWNER_APPROVAL_REQUIRED'?'WAITING_FOR_APPROVAL':
          code==='EXACT_COMMIT_11_OF_11_QA_REQUIRED'?'QA_FAILED':'FAILED';
        try {
          await this.store.finish(lease,state,{ code:fleetErrorCode(error),
            reason:publicationStarted?'PUBLICATION_RECONCILIATION_REQUIRED':'EXECUTION_FAILED',
            certified:false,simulated:this.config.mode==='simulation' });
        } catch (finishError: unknown) {
          this.log('fleet.finish_pending',{taskId:lease.taskId,code:fleetErrorCode(finishError)});
        }
      }
      this.log('fleet.execution_error',{taskId:lease.taskId,code:fleetErrorCode(error),publicationStarted});
    } finally {
      clearTimeout(timer);
      keeperController.abort();
      await keeper;
      if (workspace) {
        try { await rm(workspace.directory,{recursive:true,force:true}); }
        catch { this.log('fleet.workspace_cleanup_failed',{taskId:lease.taskId}); }
      }
      localAgent.taskId = null;
    }
  }
}

// ---------- Owned lease renewal and evidence-based CI ----------

/** Renew one live lease through the existing transactional ownership checks.
 * Never extends expired leases, creates ownership, or changes task state.
 * RUNNING recovery belongs to claim(); uncertain DEPLOYING work belongs to
 * blockExpiredPublications(). Keep the configured lease/statement timeouts.
 */
export async function renewOwnedFleetLease(
  store: FleetTaskStore, lease: FleetLease, signal?: AbortSignal,
): Promise<void> {
  if (!store || !lease || !lease.taskId || !lease.token ||
      !Array.isArray(lease.resourceKeys) || lease.resourceKeys.length === 0) {
    throw new Error('OWNED_FLEET_LEASE_REQUIRED');
  }
  signal?.throwIfAborted();
  await store.heartbeat(lease, signal);
}

/** A heartbeat needs the claimed token, agent, resource fences and live expiry.
 * Agent/task IDs alone are not authority. Use the existing dedicated heartbeat
 * pool and transaction-local deadlines. Confirmed ownership loss returns false;
 * transport, cancellation and uncertain COMMIT errors reject so the keeper stops
 * and retains the actual failure reason. Never manufacture observation evidence.
 */
export async function emitFleetHeartbeat(
  store: FleetTaskStore, lease: FleetLease, signal?: AbortSignal,
): Promise<boolean> {
  try {
    await renewOwnedFleetLease(store, lease, signal);
    return true;
  } catch (error) {
    if (error instanceof FleetLeaseLost) return false;
    throw error;
  }
}

/** @deprecated Use renewOwnedFleetLease. The old no-argument bulk renewal
 * is deliberately unsupported: it could revive terminal tasks or dead owners.
 */
export async function clearReclamationTimeout(
  store: FleetTaskStore, lease: FleetLease, signal?: AbortSignal,
): Promise<void> {
  await renewOwnedFleetLease(store, lease, signal);
}

/** Load these requirements from the trusted repository/owner policy. An empty
 * policy never passes. Pin the producer as well as its name to prevent a check
 * from a different app or status publisher satisfying the requirement.
 */
export type FleetRequiredGitHubCheck =
  | { source: 'check_run'; name: string; appId: number }
  | { source: 'commit_status'; name: string; creatorLogin: string };

export interface FleetGitHubCheckOptions {
  repository: string;
  prNumber: number;
  expectedHeadSha: string;
  required: readonly FleetRequiredGitHubCheck[];
  /** Server-side credential only; never include in a mission payload or logs. */
  token?: string;
  signal?: AbortSignal;
  /** Total time budget across all requests, including pagination. */
  timeoutMs?: number;
  /** Dependency injection for an isolated test; production uses native fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface FleetGitHubCIReport {
  ok: boolean;
  repository: string;
  prNumber: number;
  headSha: string;
  checkedAt: string;
  blockers: string[];
  checks: {
    name: string;
    source: FleetRequiredGitHubCheck['source'];
    ok: boolean;
    reason: string;
    evidence: string[];
  }[];
}

/** Read-only verification of required CI for the PR's exact current head.
 * Does not rerun jobs, manufacture statuses, approve a PR, merge, or deploy.
 * Missing/skipped/neutral/pending/failed results and unavailable evidence block.
 * This is an observation, not a merge lock: the publisher must also enforce
 * GitHub protections and expected-head compare-and-swap at merge time.
 * Docs: https://docs.github.com/en/rest/checks/runs
 *       https://docs.github.com/en/rest/commits/statuses
 */
export async function verifyRequiredGitHubChecks(options: FleetGitHubCheckOptions): Promise<FleetGitHubCIReport> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  if (!options || typeof options.repository !== 'string' ||
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(options.repository) ||
      !Number.isSafeInteger(options.prNumber) || options.prNumber < 1 ||
      typeof options.expectedHeadSha !== 'string' || !/^[a-f0-9]{40}$/.test(options.expectedHeadSha) ||
      !Array.isArray(options.required) || options.required.length === 0 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('VALID_PR_SHA_AND_NONEMPTY_CI_POLICY_REQUIRED');
  }
  // Snapshot caller-owned values before awaiting remote requests.
  const required = options.required.map(rule => ({ ...rule }));
  const names = new Set<string>();
  for (const rule of required) {
    if (!rule || typeof rule.name !== 'string' || !rule.name.trim() ||
        rule.name !== rule.name.trim() || names.has(`${rule.source}:${rule.name}`) ||
        (rule.source !== 'check_run' && rule.source !== 'commit_status') ||
        (rule.source === 'check_run' && (!Number.isSafeInteger(rule.appId) || rule.appId < 1)) ||
        (rule.source === 'commit_status' && (typeof rule.creatorLogin !== 'string' ||
          !/^[a-zA-Z0-9-]+(?:\[bot\])?$/.test(rule.creatorLogin)))) {
      throw new Error('INVALID_OR_DUPLICATE_CI_REQUIREMENT');
    }
    names.add(`${rule.source}:${rule.name}`);
  }
  const repository = options.repository;
  const prNumber = options.prNumber;
  const sha = options.expectedHeadSha;
  const request = options.fetch ?? globalThis.fetch;
  const token = options.token;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const report: FleetGitHubCIReport = {
    ok: false, repository, prNumber, headSha: sha,
    checkedAt: new Date().toISOString(), blockers: [], checks: [],
  };
  const root = `https://api.github.com/repos/${repository}`;
  const get = async (path: string): Promise<Record<string, unknown>> => {
    signal.throwIfAborted();
    const response = await request(`${root}${path}`, {
      method: 'GET', redirect: 'error', cache: 'no-store', signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
    const data: unknown = await response.json();
    if (!fleetObject(data)) throw new Error('INVALID_GITHUB_EVIDENCE');
    return data;
  };
  const readPR = async (): Promise<string> => {
    const data = await get(`/pulls/${prNumber}`);
    if (data.number !== prNumber || data.state !== 'open' || data.merged === true ||
        !fleetObject(data.head) || data.head.sha !== sha || !fleetObject(data.base) ||
        typeof data.base.sha !== 'string' || !fleetObject(data.base.repo) ||
        typeof data.base.repo.full_name !== 'string' ||
        data.base.repo.full_name.toLowerCase() !== repository.toLowerCase()) {
      throw new Error('PR_STATE_OR_HEAD_MISMATCH');
    }
    return data.base.sha;
  };
  const readPages = async (source: 'check_runs' | 'statuses'): Promise<Record<string, unknown>[]> => {
    const items: Record<string, unknown>[] = [];
    let total: number | undefined;
    for (let page = 1; page <= 10; page++) {
      const path = source === 'check_runs'
        ? `/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`
        : `/commits/${sha}/status?per_page=100&page=${page}`;
      const data = await get(path);
      const rows = data[source];
      if (typeof data.total_count !== 'number' || !Number.isSafeInteger(data.total_count) ||
          data.total_count < 0 || data.total_count > 1000 || !Array.isArray(rows) ||
          !rows.every(fleetObject) || (source === 'statuses' && data.sha !== sha) ||
          (total !== undefined && total !== data.total_count)) throw new Error('INCOMPLETE_GITHUB_EVIDENCE');
      total = data.total_count;
      items.push(...rows);
      if (items.length === total) {
        if (new Set(items.map(row => row.id)).size !== items.length ||
            items.some(row => typeof row.id !== 'number' || !Number.isSafeInteger(row.id))) {
          throw new Error('DUPLICATE_OR_INVALID_GITHUB_EVIDENCE');
        }
        return items;
      }
      if (rows.length === 0 || items.length > total) throw new Error('INCOMPLETE_GITHUB_EVIDENCE');
    }
    throw new Error('GITHUB_EVIDENCE_PAGE_LIMIT');
  };
  try {
    const baseSha = await readPR();
    const checkRuns = required.some(rule => rule.source === 'check_run') ? await readPages('check_runs') : [];
    const statuses = required.some(rule => rule.source === 'commit_status') ? await readPages('statuses') : [];
    for (const rule of required) {
      const matches = rule.source === 'check_run'
        ? checkRuns.filter(row => row.name === rule.name && fleetObject(row.app) && row.app.id === rule.appId)
        : statuses.filter(row => row.context === rule.name && fleetObject(row.creator) &&
          typeof row.creator.login === 'string' && row.creator.login.toLowerCase() === rule.creatorLogin.toLowerCase());
      const ok = matches.length > 0 && matches.every(row => rule.source === 'check_run'
        ? row.head_sha === sha && row.status === 'completed' && row.conclusion === 'success'
        : row.state === 'success');
      report.checks.push({ name: rule.name, source: rule.source, ok,
        reason: ok ? 'VERIFIED_SUCCESS' : matches.length ? 'REQUIRED_CHECK_NOT_SUCCESSFUL' : 'REQUIRED_CHECK_MISSING',
        evidence: matches.map(row => rule.source === 'check_run'
          ? `${root}/check-runs/${row.id}` : `${root}/statuses/${sha}`),
      });
    }
    if (await readPR() !== baseSha) throw new Error('PR_BASE_CHANGED_DURING_VERIFICATION');
    for (const check of report.checks) if (!check.ok) report.blockers.push(`${check.name}:${check.reason}`);
    report.ok = report.blockers.length === 0 && report.checks.length === required.length;
  } catch (error: unknown) {
    report.ok = false;
    // Preserve actionable codes, never tokens or untrusted response bodies.
    report.blockers.push(signal.aborted ? 'CI_VERIFICATION_ABORTED_OR_TIMED_OUT' : fleetErrorCode(error));
  }
  report.checkedAt = new Date().toISOString();
  return report;
}

/** @deprecated Use verifyRequiredGitHubChecks for detailed blockers. This name
 * is retained only for migration: it verifies evidence and cannot force green.
 */
export async function forceOmittedChecks(options: FleetGitHubCheckOptions): Promise<boolean> {
  return (await verifyRequiredGitHubChecks(options)).ok;
}

/** Worker bootstrap example (the Hono API can keep serving independently):
 *
 * const fleet = new MultiAgentFleet({ repositoryDirectory: '/opt/ivx/repository' });
 * await fleet.start();
 * const taskId = await fleet.enqueue({
 *   idempotencyKey: 'owner-order-UNIQUE-ID', priority: 'critical',
 *   baseCommit: '<full real 40-character Git SHA>',
 *   files: [{ path: 'landing/src/example.ts', beforeSha256: null, content: 'export {};\n' }],
 * });
 * process.once('SIGTERM', () => { void fleet.stop().catch(console.error); });
 *
 * ENV: SUPABASE_DB_URL=<exact transaction pooler URL copied from Connect, :6543>
 * IVX_FLEET_MODE=simulation   IVX_FLEET_CONCURRENCY=8
 * IVX_FLEET_LEASE_MS=90000    IVX_FLEET_HEARTBEAT_MS=20000
 * IVX_FLEET_POLL_MS=5000      IVX_FLEET_MAX_ATTEMPTS=3
 * IVX_FLEET_TASK_TIMEOUT_MS=600000
 * Shared pool limits/TLS remain owned by services/ivx-database-pools.ts.
 * For production supply a real FleetPipeline and IVX_FLEET_MODE=production.
 * Installing this file alone neither wires the old dispatcher nor deploys a site.
 */
