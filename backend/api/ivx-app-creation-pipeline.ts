/**
 * IVX New App Creation Pipeline — 30 agents (IA-63 to IA-92)
 *
 * End-to-end sequential pipeline where each agent receives the output of the
 * previous agent and produces a deliverable that feeds the next. Every agent
 * executes a real remote AI inference call through the IVX AI runtime.
 *
 * Phases:
 *   Discovery & Strategy  (IA-63 → IA-67)
 *   Engineering           (IA-68 → IA-77)
 *   Platform Delivery     (IA-78 → IA-85)
 *   Launch & Scale        (IA-86 → IA-92)
 *
 * Routes:
 *   POST /api/ivx/app-creation-pipeline/run   — execute the full 30-agent pipeline
 *   GET  /api/ivx/app-creation-pipeline/status — pipeline health + agent list
 *   GET  /api/ivx/app-creation-pipeline/agents — list all 30 pipeline agents
 */
import { requestIVXAIText, resolveIVXAIModel, isIVXAIConfigured, getIVXAIEndpoint } from '../ivx-ai-runtime';
import type { IVXAIProviderMetadata } from '../ivx-ai-runtime';

// ── Pipeline Agent Definitions ──────────────────────────────────────────────

export type PipelinePhase = 'discovery' | 'engineering' | 'delivery' | 'launch';

export type PipelineAgent = {
  number: number;
  agentId: string;
  name: string;
  mission: string;
  inputs: string;
  outputs: string;
  phase: PipelinePhase;
  /** The instruction given to the AI model for this agent step. */
  promptTemplate: (appName: string, priorOutput: string) => string;
};

const PHASE_DISCOVERY: PipelinePhase = 'discovery';
const PHASE_ENGINEERING: PipelinePhase = 'engineering';
const PHASE_DELIVERY: PipelinePhase = 'delivery';
const PHASE_LAUNCH: PipelinePhase = 'launch';

/**
 * The 30-agent pipeline definition. Each agent's promptTemplate receives the
 * app name and the output of the previous agent, creating a chain of context.
 */
export const APP_CREATION_PIPELINE_AGENTS: PipelineAgent[] = [
  // ── Phase 1: Discovery & Strategy (IA-63 to IA-67) ──
  {
    number: 63,
    agentId: 'ivx_holdings_63',
    name: 'IA-63 New App Discovery',
    mission: 'Discover app opportunities',
    inputs: 'User problems / market gaps',
    outputs: 'App concepts',
    phase: PHASE_DISCOVERY,
    promptTemplate: (appName, _prior) =>
      `You are IVX IA-63, the New App Discovery agent. An app concept called "${appName}" has been proposed. ` +
      `Analyze the market gap it fills, the target user problem, and why now is the right time. ` +
      `Output a concise app concept summary (max 200 words) with: problem statement, target audience, and core value proposition.`,
  },
  {
    number: 64,
    agentId: 'ivx_holdings_64',
    name: 'IA-64 New App Business Case',
    mission: 'Build business case',
    inputs: 'App concepts',
    outputs: 'GO / NO-GO decision',
    phase: PHASE_DISCOVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-64, the New App Business Case agent. Here is the app concept from IA-63:\n\n${prior}\n\n` +
      `Build a business case for "${appName}". Evaluate: market size, revenue model, competitive landscape, and estimated development cost. ` +
      `End with a clear GO or NO-GO recommendation with one-sentence justification.`,
  },
  {
    number: 65,
    agentId: 'ivx_holdings_65',
    name: 'IA-65 New App Product Strategy',
    mission: 'Define product direction',
    inputs: 'Validated concept',
    outputs: 'Product specification',
    phase: PHASE_DISCOVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-65, the New App Product Strategy agent. The business case from IA-64:\n\n${prior}\n\n` +
      `Define the product strategy for "${appName}". Output: core features list (5-7 items), MVP scope, ` +
      `target launch timeline, and key success metrics.`,
  },
  {
    number: 66,
    agentId: 'ivx_holdings_66',
    name: 'IA-66 New App UX Architecture',
    mission: 'Design user journey',
    inputs: 'Requirements',
    outputs: 'UX specification',
    phase: PHASE_DISCOVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-66, the New App UX Architecture agent. The product strategy from IA-65:\n\n${prior}\n\n` +
      `Design the UX architecture for "${appName}". Output: primary user flows (3-5 flows), ` +
      `information architecture hierarchy, and key screen states.`,
  },
  {
    number: 67,
    agentId: 'ivx_holdings_67',
    name: 'IA-67 New App UI Design',
    mission: 'Define interface',
    inputs: 'UX / brand',
    outputs: 'UI specification',
    phase: PHASE_DISCOVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-67, the New App UI Design agent. The UX architecture from IA-66:\n\n${prior}\n\n` +
      `Define the UI specification for "${appName}". Output: design system (colors, typography, spacing), ` +
      `component library list, and 3 key screen descriptions with layout details.`,
  },

  // ── Phase 2: Engineering (IA-68 to IA-77) ──
  {
    number: 68,
    agentId: 'ivx_holdings_68',
    name: 'IA-68 New App Frontend Architecture',
    mission: 'Frontend engineering',
    inputs: 'UI / requirements',
    outputs: 'Frontend build plan',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-68, the New App Frontend Architecture agent. The UI spec from IA-67:\n\n${prior}\n\n` +
      `Define the frontend architecture for "${appName}". Output: framework choice, state management approach, ` +
      `component structure, and build configuration.`,
  },
  {
    number: 69,
    agentId: 'ivx_holdings_69',
    name: 'IA-69 New App Backend Architecture',
    mission: 'Backend engineering',
    inputs: 'Product requirements',
    outputs: 'Backend build plan',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-69, the New App Backend Architecture agent. The frontend architecture from IA-68:\n\n${prior}\n\n` +
      `Define the backend architecture for "${appName}". Output: runtime/platform choice, API paradigm (REST/GraphQL/tRPC), ` +
      `service boundaries, and deployment target.`,
  },
  {
    number: 70,
    agentId: 'ivx_holdings_70',
    name: 'IA-70 New App Database Design',
    mission: 'Database architecture',
    inputs: 'Entities / workflows',
    outputs: 'Database schema',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-70, the New App Database Design agent. The backend architecture from IA-69:\n\n${prior}\n\n` +
      `Design the database schema for "${appName}". Output: 5-8 core tables with columns, primary keys, ` +
      `foreign keys, and indexing strategy.`,
  },
  {
    number: 71,
    agentId: 'ivx_holdings_71',
    name: 'IA-71 New App API Design',
    mission: 'API architecture',
    inputs: 'Services / clients',
    outputs: 'API contract',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-71, the New App API Design agent. The database schema from IA-70:\n\n${prior}\n\n` +
      `Design the API for "${appName}". Output: 6-10 endpoint definitions with method, path, ` +
      `request body, response shape, and auth requirement.`,
  },
  {
    number: 72,
    agentId: 'ivx_holdings_72',
    name: 'IA-72 New App AI Architecture',
    mission: 'AI system design',
    inputs: 'App use cases',
    outputs: 'AI architecture',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-72, the New App AI Architecture agent. The API design from IA-71:\n\n${prior}\n\n` +
      `Design the AI architecture for "${appName}". Output: model selection, prompt strategy, ` +
      `AI gateway integration approach, and cost guardrails.`,
  },
  {
    number: 73,
    agentId: 'ivx_holdings_73',
    name: 'IA-73 New App Security Architecture',
    mission: 'Security-by-design',
    inputs: 'App architecture',
    outputs: 'Security specification',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-73, the New App Security Architecture agent. The AI architecture from IA-72:\n\n${prior}\n\n` +
      `Define the security specification for "${appName}". Output: threat model (3-5 threats), ` +
      `security controls, data encryption approach, and compliance considerations.`,
  },
  {
    number: 74,
    agentId: 'ivx_holdings_74',
    name: 'IA-74 New App Authentication',
    mission: 'Identity/access implementation',
    inputs: 'Roles / users',
    outputs: 'Authentication system plan',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-74, the New App Authentication agent. The security spec from IA-73:\n\n${prior}\n\n` +
      `Design the authentication system for "${appName}". Output: auth provider choice, ` +
      `user roles and permissions, session management, and OAuth/social login options.`,
  },
  {
    number: 75,
    agentId: 'ivx_holdings_75',
    name: 'IA-75 New App Payments',
    mission: 'Payment architecture',
    inputs: 'Business model',
    outputs: 'Payment workflow',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-75, the New App Payments agent. The auth system from IA-74:\n\n${prior}\n\n` +
      `Design the payment architecture for "${appName}". Output: payment provider, pricing model, ` +
      `subscription tiers, webhook handling, and refund flow.`,
  },
  {
    number: 76,
    agentId: 'ivx_holdings_76',
    name: 'IA-76 New App Analytics',
    mission: 'Product analytics',
    inputs: 'Events / KPIs',
    outputs: 'Analytics layer',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-76, the New App Analytics agent. The payment system from IA-75:\n\n${prior}\n\n` +
      `Design the analytics layer for "${appName}". Output: 8-12 key events to track, ` +
      `analytics provider, funnel metrics, and dashboard layout.`,
  },
  {
    number: 77,
    agentId: 'ivx_holdings_77',
    name: 'IA-77 New App Notifications',
    mission: 'Notification system',
    inputs: 'Product events',
    outputs: 'Notification engine plan',
    phase: PHASE_ENGINEERING,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-77, the New App Notifications agent. The analytics layer from IA-76:\n\n${prior}\n\n` +
      `Design the notification system for "${appName}". Output: notification types (push/email/in-app), ` +
      `trigger rules, provider choice, and user preference management.`,
  },

  // ── Phase 3: Platform Delivery (IA-78 to IA-85) ──
  {
    number: 78,
    agentId: 'ivx_holdings_78',
    name: 'IA-78 New App iOS',
    mission: 'iOS delivery',
    inputs: 'App build',
    outputs: 'iOS build plan',
    phase: PHASE_DELIVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-78, the New App iOS agent. The notification system from IA-77:\n\n${prior}\n\n` +
      `Define the iOS delivery plan for "${appName}". Output: iOS framework, ` +
      `minimum iOS version, App Store metadata, and build pipeline steps.`,
  },
  {
    number: 79,
    agentId: 'ivx_holdings_79',
    name: 'IA-79 New App Android',
    mission: 'Android delivery',
    inputs: 'App build',
    outputs: 'Android build plan',
    phase: PHASE_DELIVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-79, the New App Android agent. The iOS plan from IA-78:\n\n${prior}\n\n` +
      `Define the Android delivery plan for "${appName}". Output: Android framework, ` +
      `minimum SDK version, Play Store metadata, and build pipeline steps.`,
  },
  {
    number: 80,
    agentId: 'ivx_holdings_80',
    name: 'IA-80 New App Web',
    mission: 'Web delivery',
    inputs: 'Frontend/backend',
    outputs: 'Web deployment plan',
    phase: PHASE_DELIVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-80, the New App Web agent. The Android plan from IA-79:\n\n${prior}\n\n` +
      `Define the web delivery plan for "${appName}". Output: web framework, ` +
      `hosting provider, domain strategy, and CI/CD pipeline.`,
  },
  {
    number: 81,
    agentId: 'ivx_holdings_81',
    name: 'IA-81 New App Admin Portal',
    mission: 'Administrative tools',
    inputs: 'Operations needs',
    outputs: 'Admin portal spec',
    phase: PHASE_DELIVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-81, the New App Admin Portal agent. The web plan from IA-80:\n\n${prior}\n\n` +
      `Define the admin portal for "${appName}". Output: admin features list, ` +
      `role-based access levels, key admin screens, and data management tools.`,
  },
  {
    number: 82,
    agentId: 'ivx_holdings_82',
    name: 'IA-82 New App Investor Portal',
    mission: 'Investor-facing interface',
    inputs: 'Investor requirements',
    outputs: 'Investor portal spec',
    phase: PHASE_DELIVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-82, the New App Investor Portal agent. The admin portal from IA-81:\n\n${prior}\n\n` +
      `Define the investor portal for "${appName}". Output: investor-facing features, ` +
      `portfolio dashboard layout, document access, and reporting views.`,
  },
  {
    number: 83,
    agentId: 'ivx_holdings_83',
    name: 'IA-83 New App Buyer Portal',
    mission: 'Buyer interface',
    inputs: 'Buyer workflows',
    outputs: 'Buyer portal spec',
    phase: PHASE_DELIVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-83, the New App Buyer Portal agent. The investor portal from IA-82:\n\n${prior}\n\n` +
      `Define the buyer portal for "${appName}". Output: buyer-facing features, ` +
      `deal browsing flow, offer submission, and transaction tracking.`,
  },
  {
    number: 84,
    agentId: 'ivx_holdings_84',
    name: 'IA-84 New App Seller Portal',
    mission: 'Seller interface',
    inputs: 'Seller workflows',
    outputs: 'Seller portal spec',
    phase: PHASE_DELIVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-84, the New App Seller Portal agent. The buyer portal from IA-83:\n\n${prior}\n\n` +
      `Define the seller portal for "${appName}". Output: seller-facing features, ` +
      `listing creation flow, document upload, and offer management.`,
  },
  {
    number: 85,
    agentId: 'ivx_holdings_85',
    name: 'IA-85 New App Marketplace',
    mission: 'Marketplace capability',
    inputs: 'Buyers / sellers / inventory',
    outputs: 'Marketplace plan',
    phase: PHASE_DELIVERY,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-85, the New App Marketplace agent. The seller portal from IA-84:\n\n${prior}\n\n` +
      `Define the marketplace for "${appName}". Output: matching algorithm approach, ` +
      `listing structure, search/filter features, and transaction flow.`,
  },

  // ── Phase 4: Launch & Scale (IA-86 to IA-92) ──
  {
    number: 86,
    agentId: 'ivx_holdings_86',
    name: 'IA-86 New App Automation',
    mission: 'Automate new apps',
    inputs: 'Workflows',
    outputs: 'Automation layer',
    phase: PHASE_LAUNCH,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-86, the New App Automation agent. The marketplace from IA-85:\n\n${prior}\n\n` +
      `Define the automation layer for "${appName}". Output: 5-8 automated workflows, ` +
      `trigger conditions, integration points, and scheduling strategy.`,
  },
  {
    number: 87,
    agentId: 'ivx_holdings_87',
    name: 'IA-87 New App Testing',
    mission: 'Functional testing',
    inputs: 'Builds',
    outputs: 'Test plan',
    phase: PHASE_LAUNCH,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-87, the New App Testing agent. The automation from IA-86:\n\n${prior}\n\n` +
      `Define the test plan for "${appName}". Output: unit test coverage targets, ` +
      `integration test scenarios (5-8), E2E test flows, and test infrastructure.`,
  },
  {
    number: 88,
    agentId: 'ivx_holdings_88',
    name: 'IA-88 New App QA',
    mission: 'Quality assurance',
    inputs: 'Test results / requirements',
    outputs: 'QA gate decision',
    phase: PHASE_LAUNCH,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-88, the New App QA agent. The test plan from IA-87:\n\n${prior}\n\n` +
      `Define the QA gate for "${appName}". Output: quality criteria checklist, ` +
      `acceptance thresholds, known risk areas, and a GO/HOLD/NO-GO release decision.`,
  },
  {
    number: 89,
    agentId: 'ivx_holdings_89',
    name: 'IA-89 New App Security Testing',
    mission: 'Security verification',
    inputs: 'Build / architecture',
    outputs: 'Security report',
    phase: PHASE_LAUNCH,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-89, the New App Security Testing agent. The QA gate from IA-88:\n\n${prior}\n\n` +
      `Define the security testing plan for "${appName}". Output: penetration test areas, ` +
      `OWASP top 10 coverage, dependency scan approach, and security sign-off criteria.`,
  },
  {
    number: 90,
    agentId: 'ivx_holdings_90',
    name: 'IA-90 New App Deployment',
    mission: 'Deployment orchestration',
    inputs: 'Certified build',
    outputs: 'Deployment plan',
    phase: PHASE_LAUNCH,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-90, the New App Deployment agent. The security report from IA-89:\n\n${prior}\n\n` +
      `Define the deployment plan for "${appName}". Output: deployment platform, ` +
      `environment strategy (staging/prod), rollout strategy, and rollback procedure.`,
  },
  {
    number: 91,
    agentId: 'ivx_holdings_91',
    name: 'IA-91 New App Monitoring',
    mission: 'Post-launch monitoring',
    inputs: 'Telemetry / logs',
    outputs: 'Monitoring plan',
    phase: PHASE_LAUNCH,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-91, the New App Monitoring agent. The deployment plan from IA-90:\n\n${prior}\n\n` +
      `Define the monitoring plan for "${appName}". Output: key metrics to monitor, ` +
      `alerting thresholds, uptime targets, and incident response runbook.`,
  },
  {
    number: 92,
    agentId: 'ivx_holdings_92',
    name: 'IA-92 New App Growth',
    mission: 'Grow launched apps',
    inputs: 'Acquisition / product data',
    outputs: 'Growth plan',
    phase: PHASE_LAUNCH,
    promptTemplate: (appName, prior) =>
      `You are IVX IA-92, the New App Growth agent. The monitoring plan from IA-91:\n\n${prior}\n\n` +
      `Define the growth plan for "${appName}". Output: acquisition channels, ` +
      `growth experiments to run, viral mechanics, and 90-day growth milestones.`,
  },
];

export const PIPELINE_AGENT_COUNT = APP_CREATION_PIPELINE_AGENTS.length; // 30

// ── Types ───────────────────────────────────────────────────────────────────

export type PipelineAgentResult = {
  agentNumber: number;
  agentId: string;
  agentName: string;
  phase: PipelinePhase;
  mission: string;
  output: string;
  outputHash: string;
  source: string;
  endpoint: string | null;
  model: string;
  passed: boolean;
  error: string | null;
  durationMs: number;
};

export type PipelineRunResult = {
  marker: string;
  appName: string;
  pipelineStartedAt: string;
  pipelineCompletedAt: string;
  totalDurationMs: number;
  expectedAgents: number;
  executedAgents: number;
  passedAgents: number;
  failedAgents: number;
  phases: {
    discovery: PipelineAgentResult[];
    engineering: PipelineAgentResult[];
    delivery: PipelineAgentResult[];
    launch: PipelineAgentResult[];
  };
  agents: PipelineAgentResult[];
  certified: boolean;
  certificationSummary: string;
  githubSha: string;
  workflowRunId: string | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(text).digest('hex');
}

function truncateOutput(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... [truncated]';
}

function getCommitSha(): string {
  return (
    process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    'unknown'
  );
}

// ── Pipeline Execution ──────────────────────────────────────────────────────

/**
 * Execute a single agent step: call real AI inference and return the result.
 */
async function executePipelineAgent(
  agent: PipelineAgent,
  appName: string,
  priorOutput: string,
  requestId: string,
): Promise<PipelineAgentResult> {
  const startTime = Date.now();
  const prompt = agent.promptTemplate(appName, priorOutput);
  const agentRequestId = `${requestId}-ia-${agent.number}`;

  try {
    if (!isIVXAIConfigured()) {
      throw new Error('IVX AI runtime is not configured — missing gateway URL or API key.');
    }

    const model = resolveIVXAIModel();
    const result = await requestIVXAIText({
      module: 'app-creation-pipeline',
      requestId: agentRequestId,
      model,
      system: `You are ${agent.name}, part of the IVX Holdings 30-agent New App Creation Pipeline. ` +
        `Your mission: ${agent.mission}. You are building the app "${appName}". ` +
        `Be specific, actionable, and concise. Your output feeds the next agent in the pipeline.`,
      prompt,
      maxOutputTokens: 1200,
    });

    const output = truncateOutput(result.text.trim());
    const durationMs = Date.now() - startTime;
    const providerMeta = result.providerMetadata as IVXAIProviderMetadata;

    return {
      agentNumber: agent.number,
      agentId: agent.agentId,
      agentName: agent.name,
      phase: agent.phase,
      mission: agent.mission,
      output,
      outputHash: sha256(output),
      source: providerMeta?.source ?? 'remote_api',
      endpoint: providerMeta?.endpoint ?? getIVXAIEndpoint(model),
      model,
      passed: output.length > 20,
      error: null,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      agentNumber: agent.number,
      agentId: agent.agentId,
      agentName: agent.name,
      phase: agent.phase,
      mission: agent.mission,
      output: '',
      outputHash: '',
      source: '',
      endpoint: null,
      model: resolveIVXAIModel(),
      passed: false,
      error: errorMsg,
      durationMs,
    };
  }
}

/**
 * Execute the full 30-agent pipeline sequentially.
 * Each agent receives the output of the previous agent.
 */
export async function runAppCreationPipeline(input: {
  appName: string;
  requestId?: string;
  workflowRunId?: string | null;
}): Promise<PipelineRunResult> {
  const { appName } = input;
  const requestId = input.requestId || `ivx-app-pipeline-${Date.now()}`;
  const workflowRunId = input.workflowRunId ?? null;
  const startedAt = new Date();
  const startMs = Date.now();

  const results: PipelineAgentResult[] = [];
  let priorOutput = '';

  for (const agent of APP_CREATION_PIPELINE_AGENTS) {
    console.log(`[IVX App Pipeline] Executing ${agent.name} (IA-${agent.number})`, {
      appName,
      phase: agent.phase,
      requestId,
    });

    const result = await executePipelineAgent(agent, appName, priorOutput, requestId);
    results.push(result);

    // Feed the output to the next agent (even if it failed, pass error context)
    priorOutput = result.passed ? result.output : `[Previous agent ${result.agentName} did not produce output. Continue with available context.]`;

    console.log(`[IVX App Pipeline] Completed ${agent.name}`, {
      passed: result.passed,
      durationMs: result.durationMs,
      outputLen: result.output.length,
    });
  }

  const completedAt = new Date();
  const totalDurationMs = Date.now() - startMs;
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  const phases = {
    discovery: results.filter((r) => r.phase === PHASE_DISCOVERY),
    engineering: results.filter((r) => r.phase === PHASE_ENGINEERING),
    delivery: results.filter((r) => r.phase === PHASE_DELIVERY),
    launch: results.filter((r) => r.phase === PHASE_LAUNCH),
  };

  const certified = failed.length === 0 && results.length === PIPELINE_AGENT_COUNT;
  const certificationSummary = certified
    ? `All ${PIPELINE_AGENT_COUNT} agents (IA-63 to IA-92) completed real AI inference sequentially for app "${appName}". ` +
      `Every agent produced a deliverable that fed the next agent in the pipeline. ` +
      `Pipeline certified end-to-end in ${totalDurationMs}ms.`
    : `${failed.length}/${PIPELINE_AGENT_COUNT} agents failed. Pipeline not certified. ` +
      `Failed agents: ${failed.map((f) => `IA-${f.agentNumber}`).join(', ')}`;

  return {
    marker: 'ivx-app-creation-pipeline-30agent-2026-08-17',
    appName,
    pipelineStartedAt: startedAt.toISOString(),
    pipelineCompletedAt: completedAt.toISOString(),
    totalDurationMs,
    expectedAgents: PIPELINE_AGENT_COUNT,
    executedAgents: results.length,
    passedAgents: passed.length,
    failedAgents: failed.length,
    phases,
    agents: results,
    certified,
    certificationSummary,
    githubSha: getCommitSha(),
    workflowRunId,
  };
}

// ── HTTP Handlers ───────────────────────────────────────────────────────────

export const APP_PIPELINE_MARKER = 'ivx-app-creation-pipeline-30agent-2026-08-17';

export function handleAppPipelineStatusRequest(): Response {
  const configured = isIVXAIConfigured();
  const model = resolveIVXAIModel();
  const endpoint = getIVXAIEndpoint(model);
  return new Response(
    JSON.stringify({
      ok: true,
      marker: APP_PIPELINE_MARKER,
      pipeline: 'New App Creation Pipeline',
      agentRange: 'IA-63 to IA-92',
      totalAgents: PIPELINE_AGENT_COUNT,
      phases: {
        discovery: 'IA-63 to IA-67 (5 agents)',
        engineering: 'IA-68 to IA-77 (10 agents)',
        delivery: 'IA-78 to IA-85 (8 agents)',
        launch: 'IA-86 to IA-92 (7 agents)',
      },
      aiConfigured: configured,
      model,
      endpoint,
      githubSha: getCommitSha(),
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function handleAppPipelineAgentsRequest(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      marker: APP_PIPELINE_MARKER,
      totalAgents: PIPELINE_AGENT_COUNT,
      agents: APP_CREATION_PIPELINE_AGENTS.map((a) => ({
        number: a.number,
        agentId: a.agentId,
        name: a.name,
        mission: a.mission,
        inputs: a.inputs,
        outputs: a.outputs,
        phase: a.phase,
      })),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function handleAppPipelineRunRequest(request: Request): Promise<Response> {
  let body: { appName?: unknown; requestId?: unknown; workflowRunId?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const appName = typeof body.appName === 'string' ? body.appName.trim() : '';
  if (!appName) {
    return new Response(
      JSON.stringify({ ok: false, error: 'appName is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : undefined;
  const workflowRunId = typeof body.workflowRunId === 'string' ? body.workflowRunId.trim() : null;

  try {
    const result = await runAppCreationPipeline({ appName, requestId, workflowRunId });
    return new Response(
      JSON.stringify({ ok: true, ...result }),
      {
        status: result.certified ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Pipeline execution failed',
        detail: errorMsg,
        marker: APP_PIPELINE_MARKER,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
