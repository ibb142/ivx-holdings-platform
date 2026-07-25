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
