import {
  SPECIALISTS,
  type IVXSpecialistRole,
} from './ivx-specialist-router';
import {
  ALL_ENTERPRISE_AGENTS,
  getDivisionA_Agents,
  getDivisionB_Agents,
  validateEnterpriseMasterRegistry,
  type EnterpriseMasterAgent,
} from './ivx-enterprise-master-registry';
import {
  enqueueOrAttachSeniorDeveloperJob,
  getSeniorDeveloperJob,
} from './ivx-senior-developer-worker';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';

export const IVX_COMPLETION_CAMPAIGN_MARKER = 'ivx-autonomous-12x100-campaign-2026-08-11';

const STATE_KEY = 'logs/audit/autonomous-completion/campaign-state.json';
const EVENTS_KEY = 'logs/audit/autonomous-completion/campaign-events.jsonl';

export type CompletionPhase =
  | 'specialists_12'
  | 'division_a_50'
  | 'division_b_50'
  | 'continuous_24x7'
  | 'complete';

export type CampaignItemStatus = 'pending' | 'queued' | 'running' | 'verified' | 'blocked' | 'failed';

export type CampaignItem = {
  id: string;
  name: string;
  phase: CompletionPhase;
  supervisor: IVXSpecialistRole;
  status: CampaignItemStatus;
  jobId: string | null;
  evidence: string[];
  lastError: string | null;
  updatedAt: string;
};

export type CompletionCampaignState = {
  marker: string;
  enabled: boolean;
  phase: CompletionPhase;
  startedAt: string;
  updatedAt: string;
  specialists: CampaignItem[];
  divisionA: CampaignItem[];
  divisionB: CampaignItem[];
  totals: {
    verifiedSpecialists: number;
    verifiedDivisionA: number;
    verifiedDivisionB: number;
  };
  paidSpendRequiresOwnerApproval: true;
  destructiveActionsRequireOwnerApproval: true;
  productionClaimsRequireProof: true;
};

function nowIso(): string {
  return new Date().toISOString();
}

function pickSupervisor(agent: EnterpriseMasterAgent): IVXSpecialistRole {
  const haystack = `${agent.name} ${agent.role} ${agent.capabilities.join(' ')} ${agent.responsibilities.join(' ')}`.toLowerCase();
  if (/security|auth|secret|compliance/.test(haystack)) return 'security_engineer';
  if (/database|sql|schema|migration|supabase|rls|data engineer/.test(haystack)) return 'database_engineer';
  if (/deploy|devops|render|infrastructure|ci\/cd|release|store submission/.test(haystack)) return 'devops_engineer';
  if (/mobile|react native|expo|android|ios/.test(haystack)) return 'mobile_engineer';
  if (/backend|api|webhook|integration/.test(haystack)) return 'backend_engineer';
  if (/qa|test|quality|verification/.test(haystack)) return 'qa_engineer';
  if (/investor|buyer|deal|jv|capital|tokenization|real estate/.test(haystack)) return 'investor_analyst';
  if (/product|marketing|growth|customer|support|research|innovation/.test(haystack)) return 'product_analyst';
  if (/architecture|lead|principal|system design/.test(haystack)) return 'architect';
  return 'senior_developer';
}

function specialistItem(role: IVXSpecialistRole): CampaignItem {
  const specialist = SPECIALISTS[role];
  return {
    id: `specialist:${role}`,
    name: specialist.name,
    phase: 'specialists_12',
    supervisor: role,
    status: 'pending',
    jobId: null,
    evidence: [],
    lastError: null,
    updatedAt: nowIso(),
  };
}

function enterpriseItem(agent: EnterpriseMasterAgent): CampaignItem {
  return {
    id: `agent:${agent.agentNumber}`,
    name: agent.name,
    phase: agent.division === 'A' ? 'division_a_50' : 'division_b_50',
    supervisor: pickSupervisor(agent),
    status: 'pending',
    jobId: null,
    evidence: [
      `registryId:${agent.id}`,
      `division:${agent.division}`,
      `company:${agent.company}`,
      `role:${agent.role}`,
    ],
    lastError: null,
    updatedAt: nowIso(),
  };
}

export function buildFreshCompletionCampaignState(): CompletionCampaignState {
  const registry = validateEnterpriseMasterRegistry();
  if (!registry.valid) {
    throw new Error(`Enterprise registry invalid: ${registry.issues.join('; ')}`);
  }
  const roles = Object.keys(SPECIALISTS) as IVXSpecialistRole[];
  if (roles.length !== 12) throw new Error(`Expected 12 specialists, found ${roles.length}.`);
  const divisionA = getDivisionA_Agents();
  const divisionB = getDivisionB_Agents();
  if (divisionA.length !== 50 || divisionB.length !== 50 || ALL_ENTERPRISE_AGENTS.length !== 100) {
    throw new Error(`Expected 50/50/100 agent split, found ${divisionA.length}/${divisionB.length}/${ALL_ENTERPRISE_AGENTS.length}.`);
  }
  const startedAt = nowIso();
  return {
    marker: IVX_COMPLETION_CAMPAIGN_MARKER,
    enabled: true,
    phase: 'specialists_12',
    startedAt,
    updatedAt: startedAt,
    specialists: roles.map(specialistItem),
    divisionA: divisionA.map(enterpriseItem),
    divisionB: divisionB.map(enterpriseItem),
    totals: { verifiedSpecialists: 0, verifiedDivisionA: 0, verifiedDivisionB: 0 },
    paidSpendRequiresOwnerApproval: true,
    destructiveActionsRequireOwnerApproval: true,
    productionClaimsRequireProof: true,
  };
}

async function readState(): Promise<CompletionCampaignState> {
  if (!isDurableStoreConfigured()) return buildFreshCompletionCampaignState();
  const existing = await readDurableJson<CompletionCampaignState | null>(STATE_KEY, null);
  return existing?.marker === IVX_COMPLETION_CAMPAIGN_MARKER ? existing : buildFreshCompletionCampaignState();
}

async function persistState(state: CompletionCampaignState): Promise<void> {
  state.updatedAt = nowIso();
  if (isDurableStoreConfigured()) await writeDurableJson(STATE_KEY, state);
}

async function logEvent(event: Record<string, unknown>): Promise<void> {
  if (!isDurableStoreConfigured()) return;
  await appendDurableEvent(EVENTS_KEY, { marker: IVX_COMPLETION_CAMPAIGN_MARKER, at: nowIso(), ...event });
}

function campaignGoal(item: CampaignItem): string {
  if (item.phase === 'specialists_12') {
    return [
      `IVX 12x100 completion campaign: complete and verify ${item.name} (${item.supervisor}) to senior-enterprise readiness.`,
      'Inspect its routing, permissions, real tool bindings, runtime integration, tests, security boundaries, and evidence path.',
      'Fix code gaps that are safe and necessary. Run focused tests. Do not fabricate PASS. Do not deploy production in this task.',
      'Return exact files changed, tests executed, blockers, and proof.',
    ].join(' ');
  }
  const workforce = item.phase === 'division_a_50'
    ? 'Division A IVX operations workforce; this agent works on IVX Holdings only.'
    : 'Division B Factory workforce; this agent builds new products and must not modify IVX unless explicitly assigned.';
  return [
    `IVX 12x100 completion campaign: complete runtime readiness for ${item.name}.`,
    workforce,
    `Supervisor: ${item.supervisor}.`,
    'Verify role contract, tools, permissions, heartbeat, scheduler/orchestrator routing, QA/security gates, and evidence recording.',
    'Fix safe code gaps required for the agent to execute a real task. Do not fabricate evidence and do not deploy production in this task.',
  ].join(' ');
}

async function enqueueItem(item: CampaignItem): Promise<void> {
  const { job } = await enqueueOrAttachSeniorDeveloperJob({
    goal: campaignGoal(item),
    ownerApproved: true,
    approvePatch: false,
    approveGitDeploy: false,
    validationMode: 'focused',
    systemMode: true,
    ownerApprovedAction: {
      proposedPlan: `Autonomous completion/verification for ${item.name}`,
      filesAffected: [],
      riskLevel: 'low',
      rollbackOption: 'Revert any autonomous completion commit produced by the worker.',
      rollbackAvailable: true,
      auditLog: [IVX_COMPLETION_CAMPAIGN_MARKER, item.id, `supervisor:${item.supervisor}`],
      secretValuesReturned: false,
    },
    ownerId: `completion-campaign:${item.id}`,
    executionMode: 'code_change',
  });
  item.jobId = job.jobId;
  item.status = job.status === 'completed' ? 'verified' : 'queued';
  item.updatedAt = nowIso();
  await logEvent({ type: 'item_enqueued', itemId: item.id, jobId: job.jobId });
}

async function refreshItem(item: CampaignItem): Promise<void> {
  if (!item.jobId) return;

  // If the item was already verified with commit evidence, preserve that status.
  // The worker queue may have been cleared (jobs removed after completion),
  // but the evidence (commitSha, testsRun, testsPassed) is still valid.
  const hasExistingProof = item.status === 'verified'
    && item.evidence.some((e) => e.startsWith('commitSha:') && !e.includes('commitSha:none'));
  if (hasExistingProof) return;

  const job = await getSeniorDeveloperJob(item.jobId);
  if (!job) {
    // Don't overwrite a verified item if the job was already completed and cleared.
    if (item.status === 'verified') return;
    item.status = 'blocked';
    item.lastError = 'Worker job not found.';
    return;
  }
  item.updatedAt = nowIso();
  if (job.status === 'completed') {
    const result = job.result;
    const hasProof = !!result && result.testsRun === true && result.testsPassed === true && !!result.commitSha;
    item.status = hasProof ? 'verified' : 'blocked';
    item.evidence = [
      ...item.evidence,
      `jobId:${job.jobId}`,
      `testsRun:${result?.testsRun ?? false}`,
      `testsPassed:${result?.testsPassed ?? false}`,
      `commitSha:${result?.commitSha ?? 'none'}`,
      `finalStatus:${result?.finalStatus ?? 'unknown'}`,
    ];
    item.lastError = hasProof ? null : 'Completion job ended without test+commit proof.';
  } else if (job.status === 'failed' || job.status === 'cancelled') {
    item.status = 'failed';
    item.lastError = job.error ?? resultError(job.result) ?? 'Worker job failed.';
  } else if (job.status === 'blocked') {
    item.status = 'blocked';
    item.lastError = job.error ?? resultError(job.result) ?? 'Worker job blocked.';
  } else {
    item.status = 'running';
  }
}

function resultError(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const value = (result as { error?: unknown }).error;
  return typeof value === 'string' ? value : null;
}

function allVerified(items: CampaignItem[]): boolean {
  return items.length > 0 && items.every((item) => item.status === 'verified');
}

function currentItems(state: CompletionCampaignState): CampaignItem[] {
  if (state.phase === 'specialists_12') return state.specialists;
  if (state.phase === 'division_a_50') return state.divisionA;
  if (state.phase === 'division_b_50') return state.divisionB;
  return [];
}

function advancePhase(state: CompletionCampaignState): void {
  if (state.phase === 'specialists_12' && allVerified(state.specialists)) state.phase = 'division_a_50';
  else if (state.phase === 'division_a_50' && allVerified(state.divisionA)) state.phase = 'division_b_50';
  else if (state.phase === 'division_b_50' && allVerified(state.divisionB)) state.phase = 'continuous_24x7';
}

export async function getCompletionCampaignState(): Promise<CompletionCampaignState> {
  const state = await readState();
  state.totals = {
    verifiedSpecialists: state.specialists.filter((x) => x.status === 'verified').length,
    verifiedDivisionA: state.divisionA.filter((x) => x.status === 'verified').length,
    verifiedDivisionB: state.divisionB.filter((x) => x.status === 'verified').length,
  };
  return state;
}

export async function runCompletionCampaignCycle(maxNewJobs = 4): Promise<CompletionCampaignState> {
  const state = await readState();
  if (!state.enabled || state.phase === 'complete') return state;

  if (state.phase === 'continuous_24x7') {
    state.phase = 'complete';
    await logEvent({ type: 'campaign_ready_for_continuous_operations' });
    await persistState(state);
    return getCompletionCampaignState();
  }

  const items = currentItems(state);
  for (const item of items) {
    if (item.jobId) await refreshItem(item);
  }

  advancePhase(state);
  const active = currentItems(state);
  let submitted = 0;
  for (const item of active) {
    if (submitted >= Math.max(1, maxNewJobs)) break;
    if (item.status !== 'pending' || item.jobId) continue;
    try {
      await enqueueItem(item);
      submitted += 1;
    } catch (error) {
      item.status = 'blocked';
      item.lastError = error instanceof Error ? error.message : 'Unable to enqueue completion job.';
      item.updatedAt = nowIso();
    }
  }

  state.totals = {
    verifiedSpecialists: state.specialists.filter((x) => x.status === 'verified').length,
    verifiedDivisionA: state.divisionA.filter((x) => x.status === 'verified').length,
    verifiedDivisionB: state.divisionB.filter((x) => x.status === 'verified').length,
  };
  await persistState(state);
  await logEvent({ type: 'campaign_cycle', phase: state.phase, submitted, totals: state.totals });
  return state;
}

export function getSupervisorDistribution(): Record<IVXSpecialistRole, number> {
  const result = Object.fromEntries((Object.keys(SPECIALISTS) as IVXSpecialistRole[]).map((role) => [role, 0])) as Record<IVXSpecialistRole, number>;
  for (const agent of ALL_ENTERPRISE_AGENTS) result[pickSupervisor(agent)] += 1;
  return result;
}
