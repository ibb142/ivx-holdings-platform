/**
 * IVX 112-Agent App Completion Campaign
 *
 * Distributes the REAL pending app items (audited 2026-08-21 from CI logs,
 * production probes and QA evidence — never invented) across all 112 agents
 * in 4 phases, and derives every status from the live agent runtime.
 *
 * HARD HONESTY RULES:
 *   - Audit items are backed by verifiable evidence (CI run IDs, live probes).
 *   - Fix items show QUEUED/PENDING_OWNER until real work exists — no fake progress.
 *   - No agent certifies its own fix: every IMPLEMENT agent has an independent QA agent.
 *   - Verification statuses derive from real runtime execution state.
 */
import { ALL_ENTERPRISE_AGENTS } from './ivx-enterprise-master-registry';
import { getAllExecutionStates } from './ivx-agent-runtime';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';

export const IVX_APP_COMPLETION_MARKER = 'ivx-app-completion-campaign-2026-08-21';

const STATE_KEY = 'logs/audit/app-completion/campaign-state.json';
const EVENTS_KEY = 'logs/audit/app-completion/campaign-events.jsonl';

export type CompletionPhase = 'PHASE_1_MOBILE_CORE' | 'PHASE_2_BUSINESS' | 'PHASE_3_BACKEND' | 'PHASE_4_PRODUCTION';

export type ItemStatus =
  | 'QUEUED'
  | 'PENDING_OWNER'
  | 'RUNNING'
  | 'FIXING'
  | 'TESTING'
  | 'DEPLOYING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED';

/** A real, evidence-backed pending app item from the 2026-08-21 audit. */
export type AuditItem = {
  id: string;
  phase: CompletionPhase;
  module: string;
  fileOrRoute: string;
  problem: string;
  expectedResult: string;
  /** Where this item's existence is proven (CI run id, live endpoint, log line). */
  evidence: string;
  /** Requires explicit owner authorization (secrets, AWS, auth architecture). */
  ownerGate: boolean;
  priority: 'P0' | 'P1' | 'P2';
};

/** Real audit items — every one traceable to CI/production evidence. */
export const APP_COMPLETION_AUDIT_ITEMS: readonly AuditItem[] = [
  {
    id: 'p3-agent-cycle-401',
    phase: 'PHASE_3_BACKEND',
    module: '112-agent runtime',
    fileOrRoute: '.github/workflows/ivx-112-24x7-watchdog.yml + backend owner auth',
    problem: 'All 112 watchdog agent runs rejected (cycle_total=112 success=0 failed=112). The CI secret IVX_AI_SYSTEM_SECRET does not match the runtime owner key, so POST /api/ivx/agents/:id/run returns 401 and no execution is persisted.',
    expectedResult: 'Watchdog cycle reaches 112/112 ok=true with persisted execution evidence.',
    evidence: 'CI run 32537173864 (Fleet Watchdog): cycle_total=112 success=0 failed=112 evidence=0; live /api/ivx/agents/real-status shows failed=0 — watchdog runs never reached persistence.',
    ownerGate: true,
    priority: 'P0',
  },
  {
    id: 'p3-owner-binding-15min',
    phase: 'PHASE_3_BACKEND',
    module: 'Autonomous control',
    fileOrRoute: '.github/workflows/ivx-112-15-minute-agent-control.yml',
    problem: '15-Minute Agent Control workflow fails at "Resolve owner/system binding" — same CI/runtime owner-key mismatch root cause as the watchdog.',
    expectedResult: 'Owner binding resolves and the 15-minute control cycle succeeds.',
    evidence: 'CI run 32537686027 failure at step "Resolve owner/system binding without exposing values".',
    ownerGate: true,
    priority: 'P0',
  },
  {
    id: 'p4-cloudfront-invalidation',
    phase: 'PHASE_4_PRODUCTION',
    module: 'Landing deploy / AWS',
    fileOrRoute: '.github/workflows/landing-s3-production-deploy.yml',
    problem: 'Landing S3 production deploy fails: IAM user Rork1 is not authorized for cloudfront:CreateInvalidation on distribution E1C0DEI0VKCUYN, so deployments cannot be certified.',
    expectedResult: 'CloudFront invalidation succeeds and the landing deploy workflow passes.',
    evidence: 'CI run 32537438005: "CloudFront invalidation FAILED: AccessDenied ... no identity-based policy allows the cloudfront:CreateInvalidation action".',
    ownerGate: true,
    priority: 'P0',
  },
  {
    id: 'p4-apk-artifact-drift',
    phase: 'PHASE_4_PRODUCTION',
    module: 'Android release',
    fileOrRoute: '.github/workflows/landing-s3-production-deploy.yml',
    problem: 'APK upload skipped because the expected artifact /tmp/ivx-holdings-1.10.14.apk is not found — version drift between the workflow expectation and the built release APK.',
    expectedResult: 'Workflow locates the current release APK (version-synced path) and uploads it.',
    evidence: 'CI run 32537438005: "APK not found at /tmp/ivx-holdings-1.10.14.apk — skipping APK upload".',
    ownerGate: false,
    priority: 'P1',
  },
  {
    id: 'p4-s3-headbucket',
    phase: 'PHASE_4_PRODUCTION',
    module: 'Landing deploy / AWS S3',
    fileOrRoute: '.github/workflows/landing-s3-production-deploy.yml',
    problem: 'HeadBucket check fails with Unknown UnknownError — S3 credential/region binding issue in the deploy workflow.',
    expectedResult: 'HeadBucket check passes against the production bucket.',
    evidence: 'CI run 32537438005: "HeadBucket check failed: Unknown UnknownError".',
    ownerGate: true,
    priority: 'P1',
  },
  {
    id: 'p4-playwright-forgot-password',
    phase: 'PHASE_4_PRODUCTION',
    module: 'Landing / Playwright E2E',
    fileOrRoute: 'expo/ivxholding-landing + Playwright web suite',
    problem: 'Playwright web E2E hard gate fails on the live landing: "Sign In view exposes Forgot password and toggles both ways" — the forgot-password affordance is not visible/toggleable on the live portal.',
    expectedResult: 'Playwright web E2E hard gate passes on the live landing.',
    evidence: 'PR #201 check-run "Playwright E2E (web surface) — HARD GATE" failure; identical failure on PR #197 head a47a576ce (pre-existing on main).',
    ownerGate: false,
    priority: 'P1',
  },
  {
    id: 'p4-netlify-rules',
    phase: 'PHASE_4_PRODUCTION',
    module: 'Landing / Netlify',
    fileOrRoute: 'Netlify deploy context (redirects, headers, pages-changed)',
    problem: 'Netlify checks "Redirect rules - ivxholding", "Header rules - ivxholding" and "Pages changed - ivxholding" fail in CI PR context.',
    expectedResult: 'Netlify checks pass or are reconciled with the S3/CloudFront production landing.',
    evidence: 'PR #201 check-runs: three ivxholding Netlify checks completed with failure.',
    ownerGate: false,
    priority: 'P2',
  },
  {
    id: 'p1-owner-login-fastpath',
    phase: 'PHASE_1_MOBILE_CORE',
    module: 'Auth / owner login',
    fileOrRoute: 'expo/lib/auth-context.tsx',
    problem: 'Owner login critical path is blocking; the prepared remediation (IVX_OWNER_POST_LOGIN_FAST_PATH_V1 / IVX_OWNER_REPAIR_BACKGROUND_V1) never landed because the fix-once workflow pushes directly to a protected branch (GH006).',
    expectedResult: 'Owner login critical path nonblocking; fastpath markers present in expo/lib/auth-context.tsx on main.',
    evidence: 'CI run 32537972693 (Owner Auth Fix Once): "remote: error: GH006: Protected branch update failed for refs/heads/main".',
    ownerGate: false,
    priority: 'P0',
  },
];

/** Real verification duties for agents without a fix item — executable via the runtime. */
export type VerificationDuty = {
  id: string;
  phase: CompletionPhase;
  module: string;
  target: string;
  check: string;
};

export const VERIFICATION_DUTIES: readonly VerificationDuty[] = [
  { id: 'v-auth-owner-login', phase: 'PHASE_1_MOBILE_CORE', module: 'Auth', target: 'expo owner login flow', check: 'Owner can sign in; session persists; no black screen after login.' },
  { id: 'v-auth-member-login', phase: 'PHASE_1_MOBILE_CORE', module: 'Auth', target: 'expo member login flow', check: 'Member can sign in and reach Home.' },
  { id: 'v-auth-registration', phase: 'PHASE_1_MOBILE_CORE', module: 'Auth', target: 'expo registration flow', check: 'Registration completes and lands on onboarding/Home.' },
  { id: 'v-auth-forgot-password', phase: 'PHASE_1_MOBILE_CORE', module: 'Auth', target: 'expo forgot/reset password', check: 'Forgot-password email sends; reset flow completes.' },
  { id: 'v-home-navigation', phase: 'PHASE_1_MOBILE_CORE', module: 'Home / navigation', target: 'expo tab navigation', check: 'All tabs navigate without black screens or crashes.' },
  { id: 'v-deep-links', phase: 'PHASE_1_MOBILE_CORE', module: 'Deep links', target: 'expo deep-link focus handling', check: 'Deep links focus the correct screen after the 2026-08-21 reels fix.' },
  { id: 'v-reels-ios', phase: 'PHASE_1_MOBILE_CORE', module: 'Reels', target: 'expo/app/videos.tsx', check: 'Reels feed loads real videos; demo video absent from feed data (fixed 2026-08-21).' },
  { id: 'v-reels-android', phase: 'PHASE_1_MOBILE_CORE', module: 'Reels', target: 'android ReelsScreen.kt', check: 'Android reels uses ExoPlayer with corrected API shapes (fixed 2026-08-21).' },
  { id: 'v-chat', phase: 'PHASE_1_MOBILE_CORE', module: 'IVX IA Chat', target: 'expo chat surface', check: 'Chat renders, sends and persists conversations.' },
  { id: 'v-profile-session', phase: 'PHASE_1_MOBILE_CORE', module: 'Profile / session', target: 'expo profile + session', check: 'Profile loads; session survives reload; sign-out works.' },
  { id: 'v-market', phase: 'PHASE_2_BUSINESS', module: 'Market', target: 'expo market screen', check: 'Market listings render with live data.' },
  { id: 'v-portfolio', phase: 'PHASE_2_BUSINESS', module: 'Portfolio', target: 'expo portfolio screen', check: 'Portfolio totals and holdings render.' },
  { id: 'v-investments', phase: 'PHASE_2_BUSINESS', module: 'Investments', target: 'expo investments + deals', check: 'Investment opportunities list and detail render.' },
  { id: 'v-crm', phase: 'PHASE_2_BUSINESS', module: 'CRM', target: 'expo CRM surface', check: 'CRM contacts/pipeline load.' },
  { id: 'v-kyc', phase: 'PHASE_2_BUSINESS', module: 'KYC', target: 'expo KYC flow', check: 'KYC steps render and submit.' },
  { id: 'v-admin-access', phase: 'PHASE_2_BUSINESS', module: 'Admin / access control', target: 'admin console + access control', check: 'Admin console restricted to owner; access control enforced.' },
  { id: 'v-audit-log', phase: 'PHASE_2_BUSINESS', module: 'Audit log / broadcast', target: 'backend audit endpoints', check: 'Audit log records agent actions; broadcast reaches agents.' },
  { id: 'v-analytics', phase: 'PHASE_2_BUSINESS', module: 'Analytics', target: 'analytics dashboards', check: 'Analytics data present for active modules.' },
  { id: 'v-backend-health', phase: 'PHASE_3_BACKEND', module: 'Backend', target: 'GET /health', check: 'Health endpoint returns ok with current commit.' },
  { id: 'v-backend-version', phase: 'PHASE_3_BACKEND', module: 'Backend', target: 'GET /version', check: 'Version reports main commit and fresh bootTime.' },
  { id: 'v-registry-112', phase: 'PHASE_3_BACKEND', module: '112-agent runtime', target: 'GET /api/ivx/agents', check: '112 unique agents registered, none paused/disabled.' },
  { id: 'v-agent-persistence', phase: 'PHASE_3_BACKEND', module: 'Supabase persistence', target: 'GET /api/ivx/agents/real-status', check: 'Persistence configured; dedicated tables active.' },
  { id: 'v-agent-contracts', phase: 'PHASE_3_BACKEND', module: 'Agent contracts', target: 'GET /api/ivx/agents/contracts/audit', check: 'Contract instruction uniqueness audit passes.' },
  { id: 'v-owner-gates', phase: 'PHASE_3_BACKEND', module: 'Owner gates', target: 'mutating agent endpoints', check: 'Mutations without owner key return 401.' },
  { id: 'v-chat-persistence', phase: 'PHASE_3_BACKEND', module: 'Chat persistence', target: 'chat storage tables', check: 'Chat messages persist across sessions.' },
  { id: 'v-queues-watchdog', phase: 'PHASE_3_BACKEND', module: 'Queues / watchdog', target: 'watchdog cycle evidence', check: 'Watchdog cycles persist execution evidence (blocked until p3-agent-cycle-401 is resolved).' },
  { id: 'v-landing-home', phase: 'PHASE_4_PRODUCTION', module: 'Landing', target: 'https://ivxholding.com', check: 'Landing loads with truthful content.' },
  { id: 'v-landing-registration', phase: 'PHASE_4_PRODUCTION', module: 'Landing registration', target: 'landing registration portal', check: 'Registration entry works from landing.' },
  { id: 'v-landing-forgot', phase: 'PHASE_4_PRODUCTION', module: 'Landing forgot password', target: 'landing sign-in portal', check: 'Forgot-password link visible and toggleable (linked to p4-playwright-forgot-password).' },
  { id: 'v-sha-parity', phase: 'PHASE_4_PRODUCTION', module: 'SHA parity', target: 'GitHub main vs runtime commit', check: 'Runtime commit equals GitHub main head (0ffb2b461 verified 2026-08-21).' },
  { id: 'v-android-release', phase: 'PHASE_4_PRODUCTION', module: 'Android', target: 'Android release build', check: 'Release APK builds reproducibly.' },
  { id: 'v-ios-maestro', phase: 'PHASE_4_PRODUCTION', module: 'iOS / Maestro', target: 'Maestro launch smoke test', check: 'Maestro E2E passes on simulator (passed on PR #201, 2026-08-21).' },
  { id: 'v-production-smoke', phase: 'PHASE_4_PRODUCTION', module: 'Production smoke', target: 'api.ivxholding.com core routes', check: 'Core API routes respond 200.' },
];

export type AgentRole = 'IMPLEMENT' | 'QA' | 'VERIFY';

export type AgentAssignment = {
  agentNumber: number;
  agentId: string;
  agentName: string;
  phase: CompletionPhase;
  role: AgentRole;
  dutyId: string;
  module: string;
  fileOrRoute: string;
  problem: string;
  assignedTask: string;
  expectedResult: string;
  ownerGate: boolean;
  /** Independent QA agent for IMPLEMENT roles — never the implementing agent itself. */
  qaAgentNumber: number | null;
  status: ItemStatus;
  progress: number;
  currentStep: string;
  lastActivity: string | null;
  evidenceSource: string;
};

export type CampaignControlState = {
  paused: boolean;
  stopped: boolean;
  pausedAgents: number[];
  stoppedAgents: number[];
};

export type AppCompletionCampaign = {
  marker: string;
  generatedAt: string;
  auditSource: string;
  control: CampaignControlState;
  totals: {
    agentsTotal: number;
    agentsAssigned: number;
    auditItems: number;
    verificationDuties: number;
    idleAgents: number;
  };
  counts: Record<ItemStatus, number>;
  pendingAppItems: number;
  p0Open: number;
  assignments: AgentAssignment[];
};

const PHASE_BOUNDS: Record<CompletionPhase, [number, number]> = {
  PHASE_1_MOBILE_CORE: [1, 28],
  PHASE_2_BUSINESS: [29, 56],
  PHASE_3_BACKEND: [57, 84],
  PHASE_4_PRODUCTION: [85, 112],
};

const PHASE_ORDER: CompletionPhase[] = ['PHASE_1_MOBILE_CORE', 'PHASE_2_BUSINESS', 'PHASE_3_BACKEND', 'PHASE_4_PRODUCTION'];

function nowIso(): string {
  return new Date().toISOString();
}

type LiveState = {
  health: string;
  availability: string;
  lastSuccessfulRun: string | null;
  successfulRuns: number;
  failedRuns: number;
};

function deriveStatus(
  role: AgentRole,
  ownerGate: boolean,
  control: CampaignControlState,
  agentNumber: number,
  live: LiveState,
): { status: ItemStatus; progress: number; currentStep: string } {
  if (control.stopped || control.stoppedAgents.includes(agentNumber)) {
    return { status: 'FAILED', progress: 0, currentStep: 'STOPPED BY OWNER' };
  }
  if (control.paused || control.pausedAgents.includes(agentNumber)) {
    return { status: 'QUEUED', progress: 0, currentStep: 'PAUSED BY OWNER' };
  }
  if (role === 'IMPLEMENT') {
    if (ownerGate) {
      return { status: 'PENDING_OWNER', progress: 0, currentStep: 'WAITING FOR OWNER AUTHORIZATION (SECRETS/AWS/AUTH)' };
    }
    return { status: 'QUEUED', progress: 0, currentStep: 'FIX QUEUED — AWAITING SENIOR-DEVELOPER WORKER JOB' };
  }
  if (role === 'QA') {
    return { status: 'QUEUED', progress: 0, currentStep: 'INDEPENDENT QA WAITING FOR IMPLEMENTATION TO LAND' };
  }
  // VERIFY agents: status derived from real runtime execution state.
  if (live.availability === 'busy') {
    return { status: 'RUNNING', progress: 50, currentStep: 'EXECUTING REAL TOOL RUN' };
  }
  const recentSuccess = live.lastSuccessfulRun !== null
    && Date.now() - Date.parse(live.lastSuccessfulRun) < 60 * 60 * 1000;
  if (recentSuccess) {
    return { status: 'VERIFYING', progress: 80, currentStep: 'MONITORING — LAST REAL RUN SUCCEEDED WITHIN 1H' };
  }
  if (live.successfulRuns > 0) {
    return { status: 'VERIFYING', progress: 60, currentStep: 'RE-RUN DUE — LAST SUCCESS OLDER THAN 1H' };
  }
  if (live.failedRuns > 0) {
    return { status: 'FAILED', progress: 0, currentStep: 'LAST RUN FAILED — RETRY REQUIRED' };
  }
  return { status: 'QUEUED', progress: 0, currentStep: 'FIRST REAL RUN QUEUED' };
}

let cachedControl: CampaignControlState | null = null;

const DEFAULT_CONTROL: CampaignControlState = { paused: false, stopped: false, pausedAgents: [], stoppedAgents: [] };

export async function loadControlState(): Promise<CampaignControlState> {
  if (!isDurableStoreConfigured()) {
    cachedControl = { ...DEFAULT_CONTROL };
    return cachedControl;
  }
  const stored = await readDurableJson<{ control?: CampaignControlState } | null>(STATE_KEY, null);
  cachedControl = stored?.control ?? { ...DEFAULT_CONTROL };
  return cachedControl;
}

export async function updateControlState(
  action: 'pause_all' | 'resume_all' | 'stop_all' | 'stop_agent' | 'retry_agent' | 'reassign',
  agentNumber?: number,
): Promise<CampaignControlState> {
  const current = await loadControlState();
  const next: CampaignControlState = {
    ...current,
    pausedAgents: [...current.pausedAgents],
    stoppedAgents: [...current.stoppedAgents],
  };
  switch (action) {
    case 'pause_all':
      next.paused = true;
      break;
    case 'resume_all':
      next.paused = false;
      next.pausedAgents = [];
      break;
    case 'stop_all':
      next.stopped = true;
      break;
    case 'stop_agent':
      if (typeof agentNumber === 'number' && !next.stoppedAgents.includes(agentNumber)) {
        next.stoppedAgents.push(agentNumber);
      }
      break;
    case 'retry_agent':
      if (typeof agentNumber === 'number') {
        next.stoppedAgents = next.stoppedAgents.filter((n) => n !== agentNumber);
        next.pausedAgents = next.pausedAgents.filter((n) => n !== agentNumber);
      }
      break;
    case 'reassign':
      break;
  }
  cachedControl = next;
  if (isDurableStoreConfigured()) {
    await writeDurableJson(STATE_KEY, { marker: IVX_APP_COMPLETION_MARKER, control: next, updatedAt: nowIso() });
    await appendDurableEvent(EVENTS_KEY, {
      marker: IVX_APP_COMPLETION_MARKER,
      at: nowIso(),
      type: 'control',
      action,
      agentNumber: agentNumber ?? null,
    });
  }
  return next;
}

/**
 * Build the full 112-agent assignment from the real audit items.
 * Per phase: item k → agent (phaseStart + k) IMPLEMENT, agent (phaseStart + itemCount + k) QA,
 * remaining agents get verification duties round-robin. No agent is left without a real duty.
 */
export function buildAppCompletionCampaign(control?: CampaignControlState): AppCompletionCampaign {
  const ctl = control ?? cachedControl ?? { ...DEFAULT_CONTROL };
  const liveStates = new Map(getAllExecutionStates().map((s) => [s.agentNumber, s]));
  const assignments: AgentAssignment[] = [];

  for (const phase of PHASE_ORDER) {
    const [lo] = PHASE_BOUNDS[phase];
    const items = APP_COMPLETION_AUDIT_ITEMS.filter((i) => i.phase === phase);
    const duties = VERIFICATION_DUTIES.filter((d) => d.phase === phase);
    const implementers = items.map((_, idx) => lo + idx);
    const qaAgents = items.map((_, idx) => lo + items.length + idx);

    let verifyCursor = 0;
    for (const agent of ALL_ENTERPRISE_AGENTS) {
      if (agent.agentNumber < lo || agent.agentNumber > PHASE_BOUNDS[phase][1]) continue;
      const live = liveStates.get(agent.agentNumber);
      const liveState: LiveState = {
        health: live?.health ?? 'unknown',
        availability: live?.availability ?? 'available',
        lastSuccessfulRun: live?.lastSuccessfulRun ?? null,
        successfulRuns: live?.successfulRuns ?? 0,
        failedRuns: live?.failedRuns ?? 0,
      };

      const implIdx = implementers.indexOf(agent.agentNumber);
      const qaIdx = qaAgents.indexOf(agent.agentNumber);

      if (implIdx >= 0 && items[implIdx]) {
        const item = items[implIdx];
        const qaAgent = qaAgents[implIdx] ?? null;
        const s = deriveStatus('IMPLEMENT', item.ownerGate, ctl, agent.agentNumber, liveState);
        assignments.push({
          agentNumber: agent.agentNumber,
          agentId: agent.id,
          agentName: agent.name,
          phase,
          role: 'IMPLEMENT',
          dutyId: item.id,
          module: item.module,
          fileOrRoute: item.fileOrRoute,
          problem: item.problem,
          assignedTask: `FIX (${item.priority}): ${item.problem}`,
          expectedResult: item.expectedResult,
          ownerGate: item.ownerGate,
          qaAgentNumber: qaAgent,
          status: s.status,
          progress: s.progress,
          currentStep: s.currentStep,
          lastActivity: liveState.lastSuccessfulRun,
          evidenceSource: item.evidence,
        });
      } else if (qaIdx >= 0 && items[qaIdx]) {
        const item = items[qaIdx];
        const implementer = implementers[qaIdx] ?? null;
        const s = deriveStatus('QA', false, ctl, agent.agentNumber, liveState);
        assignments.push({
          agentNumber: agent.agentNumber,
          agentId: agent.id,
          agentName: agent.name,
          phase,
          role: 'QA',
          dutyId: item.id,
          module: item.module,
          fileOrRoute: item.fileOrRoute,
          problem: item.problem,
          assignedTask: `INDEPENDENT QA for item ${item.id} (implemented by agent ${implementer}): run tests, verify evidence, confirm the fix works. An implementer never certifies its own fix.`,
          expectedResult: `QA PASS only when: ${item.expectedResult}`,
          ownerGate: false,
          qaAgentNumber: null,
          status: s.status,
          progress: s.progress,
          currentStep: s.currentStep,
          lastActivity: liveState.lastSuccessfulRun,
          evidenceSource: item.evidence,
        });
      } else {
        const duty = duties.length > 0
          ? duties[verifyCursor % duties.length]
          : { id: `v-fleet-${agent.agentNumber}`, phase, module: 'Fleet monitoring', target: '112-agent fleet', check: 'Monitor fleet health and report anomalies.' };
        verifyCursor += 1;
        const s = deriveStatus('VERIFY', false, ctl, agent.agentNumber, liveState);
        assignments.push({
          agentNumber: agent.agentNumber,
          agentId: agent.id,
          agentName: agent.name,
          phase,
          role: 'VERIFY',
          dutyId: duty.id,
          module: duty.module,
          fileOrRoute: duty.target,
          problem: duty.check,
          assignedTask: `VERIFY: ${duty.check}`,
          expectedResult: duty.check,
          ownerGate: false,
          qaAgentNumber: null,
          status: s.status,
          progress: s.progress,
          currentStep: s.currentStep,
          lastActivity: liveState.lastSuccessfulRun,
          evidenceSource: 'Live agent runtime execution state (getAllExecutionStates).',
        });
      }
    }
  }

  const counts = assignments.reduce<Record<ItemStatus, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {
    QUEUED: 0, PENDING_OWNER: 0, RUNNING: 0, FIXING: 0, TESTING: 0,
    DEPLOYING: 0, VERIFYING: 0, COMPLETED: 0, FAILED: 0,
  });

  return {
    marker: IVX_APP_COMPLETION_MARKER,
    generatedAt: nowIso(),
    auditSource: 'Real audit 2026-08-21: GitHub Actions runs 32537173864, 32537972693, 32537686027, 32537438005; PR #201 check-runs; live probes of api.ivxholding.com.',
    control: ctl,
    totals: {
      agentsTotal: assignments.length,
      agentsAssigned: assignments.length,
      auditItems: APP_COMPLETION_AUDIT_ITEMS.length,
      verificationDuties: VERIFICATION_DUTIES.length,
      idleAgents: 0,
    },
    counts,
    pendingAppItems: APP_COMPLETION_AUDIT_ITEMS.length,
    p0Open: APP_COMPLETION_AUDIT_ITEMS.filter((i) => i.priority === 'P0').length,
    assignments,
  };
}
