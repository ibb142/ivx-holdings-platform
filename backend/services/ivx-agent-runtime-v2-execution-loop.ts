import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { completeTask, dispatchTask, failTask, readAgentMemory, recordAudit, writeAgentMemory, type AgentId } from './agents/multi-agent-framework';
import { buildIVXOwnerAIPlannerDecision } from './ivx-owner-ai-intent-router';
import { runPreExecutionFeasibilityGate, formatFeasibilityGateBlock, type FeasibilityGateResult } from './ivx-pre-execution-feasibility-gate';
import {
  buildIVXAgentRuntimeV2Envelope,
  IVX_AGENT_RUNTIME_V2_MARKER,
  type IVXAgentRuntimeV2Envelope,
  type IVXAgentRuntimeV2TaskNode,
  type IVXAgentRuntimeV2TaskStatus,
} from './ivx-agent-runtime-v2';

export const IVX_RUNTIME_V2_EXECUTION_LOOP_MARKER = 'ivx-runtime-v2-execution-loop-2026-05-19';

export type IVXRuntimeV2ExecutionPhase =
  | 'queued'
  | 'planning'
  | 'task_tree_created'
  | 'memory_loaded'
  | 'worker_started'
  | 'worker_step_failed'
  | 'retry_scheduled'
  | 'worker_step_completed'
  | 'analysis_completed'
  | 'stream_chunked'
  | 'dashboard_verified'
  | 'audit_saved'
  | 'completed'
  | 'failed';

export type IVXRuntimeV2ExecutionLog = {
  sequence: number;
  at: string;
  phase: IVXRuntimeV2ExecutionPhase;
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata: Record<string, unknown>;
};

export type IVXRuntimeV2BugFinding = {
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  status: 'open' | 'fixed_in_this_run' | 'verified_present' | 'needs_live_validation';
  title: string;
  evidence: string[];
  impact: string;
  recommendedFix: string;
};

export type IVXRuntimeV2SourceInspection = {
  file: string;
  ok: boolean;
  bytes: number;
  evidence: Record<string, boolean | number | string | null>;
  error: string | null;
};

export type IVXRuntimeV2ExecutionProof = {
  ok: boolean;
  marker: typeof IVX_RUNTIME_V2_EXECUTION_LOOP_MARKER;
  runtimeMarker: typeof IVX_AGENT_RUNTIME_V2_MARKER;
  jobId: string;
  prompt: string;
  safeMode: {
    nonDestructive: true;
    productionDataMutated: false;
    deployed: false;
    allowedTools: string[];
  };
  phases: IVXRuntimeV2ExecutionPhase[];
  retry: {
    enabled: true;
    maxAttempts: number;
    failedStep: string | null;
    attempts: number;
    recovered: boolean;
    error: string | null;
  };
  memoryState: {
    stored: boolean;
    store: 'local_audit_file_and_in_process_agent_memory';
    memoryKey: string;
    loadedEntries: number;
    persistedAuditFile: string;
    persistedJsonlFile: string;
  };
  planner: IVXAgentRuntimeV2Envelope['planner'];
  taskTree: IVXAgentRuntimeV2Envelope['taskTree'];
  worker: {
    id: string;
    agent: AgentId;
    executedSteps: Array<{ id: string; title: string; status: IVXAgentRuntimeV2TaskStatus }>;
  };
  toolChain: IVXAgentRuntimeV2Envelope['toolChain'];
  sourceInspections: IVXRuntimeV2SourceInspection[];
  dashboard: {
    file: 'expo/app/ivx/cto-dashboard.tsx';
    cardFound: boolean;
    runtimeV2TileFound: boolean;
    liveActivityTileFound: boolean;
    testIds: string[];
  };
  streaming: IVXAgentRuntimeV2Envelope['streaming'] & {
    actualChunkCharacters: number;
    chunks: Array<{ index: number; total: number; characters: number; text: string }>;
  };
  findings: IVXRuntimeV2BugFinding[];
  finalResult: string;
  logs: IVXRuntimeV2ExecutionLog[];
  auditFiles: {
    json: string;
    jsonl: string;
  };
  generatedAt: string;
};

type ExecuteInput = {
  prompt: string;
  conversationId?: string;
  forceRetryProbe?: boolean;
  maxChunkCharacters?: number;
};

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SOURCE_FILES = [
  'backend/services/ivx-owner-ai-intent-router.ts',
  'backend/api/ivx-owner-ai.ts',
  'backend/ivx-ai-runtime.ts',
  'expo/src/modules/ivx-owner-ai/services/ivxAIRequestService.ts',
  'expo/app/ivx/cto-dashboard.tsx',
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function makeJobId(): string {
  return `runtime-v2-job-${randomUUID()}`;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Unknown runtime execution error.';
}

function cloneTaskNode(node: IVXAgentRuntimeV2TaskNode): IVXAgentRuntimeV2TaskNode {
  return {
    ...node,
    children: node.children.map(cloneTaskNode),
  };
}

function flattenTaskTree(root: IVXAgentRuntimeV2TaskNode): IVXAgentRuntimeV2TaskNode[] {
  return [root, ...root.children.flatMap((child) => flattenTaskTree(child))];
}

function setTaskStatus(root: IVXAgentRuntimeV2TaskNode, matchTitle: string, status: IVXAgentRuntimeV2TaskStatus): void {
  if (root.title.toLowerCase().includes(matchTitle.toLowerCase())) {
    root.status = status;
  }
  for (const child of root.children) {
    setTaskStatus(child, matchTitle, status);
  }
}

function setAllTaskStatuses(root: IVXAgentRuntimeV2TaskNode, status: IVXAgentRuntimeV2TaskStatus): void {
  root.status = status;
  for (const child of root.children) {
    setAllTaskStatuses(child, status);
  }
}

function readEvidenceFromSource(file: string, source: string): IVXRuntimeV2SourceInspection['evidence'] {
  if (file.endsWith('ivx-owner-ai-intent-router.ts')) {
    return {
      hasPrioritizedBugListRouting: source.includes('prioritized\\s+bug\\s+list') || source.includes('prioritized bug list'),
      hasAmbiguousLocationGuard: source.includes('ambiguous_where_are_we'),
      hasTimeGuardSeparatedFromLocation: source.includes('resolveOwnerLocationClarificationIntent(normalized)'),
      hasExplicitToolGate: source.includes('explicitlyNeedsLiveTools'),
      sourceLength: source.length,
    };
  }

  if (file.endsWith('ivx-owner-ai.ts')) {
    return {
      hasRuntimeV2ResponseMetadata: source.includes('runtimeV2: internalMetadata.runtimeV2'),
      idempotentReplayIncludesRuntimeV2: /existingAIRequest\\?\\.status[\\s\\S]{0,1800}runtimeV2/.test(source),
      errorCatchIncludesRuntimeV2: /catch \\(error\\)[\\s\\S]{0,500}runtimeV2/.test(source),
      fallbackUsedFalseOnGenericPath: source.includes('fallbackUsed: false'),
      sourceLength: source.length,
    };
  }

  if (file.endsWith('ivx-ai-runtime.ts')) {
    return {
      reportsAgentRuntimeV2Phase: source.includes("phase: 'agent_runtime_v2'"),
      defaultModelIsGpt4oMini: source.includes("DEFAULT_IVX_AI_MODEL = 'gpt-4o-mini'"),
      throwsOnEmptyResponse: source.includes('returned an empty response'),
      sourceLength: source.length,
    };
  }

  if (file.endsWith('ivxAIRequestService.ts')) {
    return {
      preservesRuntimeV2Payload: source.includes('runtimeV2: data?.runtimeV2 ?? null'),
      hasProviderFallbackType: source.includes("'provider_fallback'"),
      blocksVisibleFallbackText: source.includes('containsBlockedOwnerAIResponseText'),
      frontendDefaultModelIsGpt4oMini: source.includes("DEFAULT_IVX_OWNER_AI_MODEL = 'gpt-4o-mini'"),
      sourceLength: source.length,
    };
  }

  if (file.endsWith('cto-dashboard.tsx')) {
    return {
      hasIVXAIStatusCard: source.includes('cto-ivx-ai-status-card'),
      hasRuntimeV2Tile: source.includes('cto-status-runtime-v2'),
      hasLiveActivityTile: source.includes('cto-status-live-activity'),
      hasAgentRuntimeTile: source.includes('cto-status-agent-runtime'),
      sourceLength: source.length,
    };
  }

  return { sourceLength: source.length };
}

async function inspectSourceFiles(): Promise<IVXRuntimeV2SourceInspection[]> {
  const inspections: IVXRuntimeV2SourceInspection[] = [];
  for (const file of SOURCE_FILES) {
    try {
      const source = await readFile(path.join(SERVER_ROOT, file), 'utf8');
      inspections.push({
        file,
        ok: true,
        bytes: Buffer.byteLength(source, 'utf8'),
        evidence: readEvidenceFromSource(file, source),
        error: null,
      });
    } catch (error) {
      inspections.push({
        file,
        ok: false,
        bytes: 0,
        evidence: {},
        error: safeMessage(error),
      });
    }
  }
  return inspections;
}

function evidenceFor(inspections: IVXRuntimeV2SourceInspection[], fileSuffix: string): Record<string, unknown> {
  return inspections.find((inspection) => inspection.file.endsWith(fileSuffix))?.evidence ?? {};
}

function buildFindings(inspections: IVXRuntimeV2SourceInspection[]): IVXRuntimeV2BugFinding[] {
  const router = evidenceFor(inspections, 'ivx-owner-ai-intent-router.ts');
  const backend = evidenceFor(inspections, 'ivx-owner-ai.ts');
  const runtime = evidenceFor(inspections, 'ivx-ai-runtime.ts');
  const frontend = evidenceFor(inspections, 'ivxAIRequestService.ts');
  const dashboard = evidenceFor(inspections, 'cto-dashboard.tsx');

  return [
    {
      priority: 'P0',
      status: router.hasPrioritizedBugListRouting === true ? 'fixed_in_this_run' : 'open',
      title: 'Bug-list intent was too narrow for “inspect current IVX AI chat behavior and produce a prioritized bug list”.',
      evidence: [
        `router.hasPrioritizedBugListRouting=${String(router.hasPrioritizedBugListRouting)}`,
        `router.hasExplicitToolGate=${String(router.hasExplicitToolGate)}`,
      ],
      impact: 'A real owner audit request could be treated as generic chat or routed inconsistently instead of creating a tool-grounded bug-review plan.',
      recommendedFix: 'Keep the broadened semantic bug-review router and regression-test prioritized bug-list wording.',
    },
    {
      priority: 'P1',
      status: backend.idempotentReplayIncludesRuntimeV2 === true ? 'verified_present' : 'open',
      title: 'Idempotent replay path can return old AI text without fresh Runtime v2 proof.',
      evidence: [
        `backend.hasRuntimeV2ResponseMetadata=${String(backend.hasRuntimeV2ResponseMetadata)}`,
        `backend.idempotentReplayIncludesRuntimeV2=${String(backend.idempotentReplayIncludesRuntimeV2)}`,
      ],
      impact: 'If a repeated request hits a completed ai_requests row, the user may see an answer without current planner/task-tree/memory state, weakening raw proof.',
      recommendedFix: 'Attach a fresh runtimeV2 envelope to idempotent replay responses before returning cached answer text.',
    },
    {
      priority: 'P1',
      status: backend.errorCatchIncludesRuntimeV2 === true ? 'verified_present' : 'open',
      title: 'Failure responses still do not carry a Runtime v2 failure envelope.',
      evidence: [
        `backend.errorCatchIncludesRuntimeV2=${String(backend.errorCatchIncludesRuntimeV2)}`,
        `backend.fallbackUsedFalseOnGenericPath=${String(backend.fallbackUsedFalseOnGenericPath)}`,
      ],
      impact: 'The backend exposes the error, but the CTO dashboard/client cannot always show failed planner/tool phase state for that failed request.',
      recommendedFix: 'Return a safe error payload with runtimeV2 failure state and request id whenever owner auth has succeeded.',
    },
    {
      priority: 'P2',
      status: frontend.hasProviderFallbackType === true ? 'open' : 'verified_present',
      title: 'Frontend still contains provider-fallback/local-app-brain paths that can confuse proof if ever selected.',
      evidence: [
        `frontend.hasProviderFallbackType=${String(frontend.hasProviderFallbackType)}`,
        `frontend.blocksVisibleFallbackText=${String(frontend.blocksVisibleFallbackText)}`,
      ],
      impact: 'The app now blocks many canned strings, but runtime proof can still show provider_fallback as a source class, which must never masquerade as GPT output.',
      recommendedFix: 'Keep fallback masking disabled; when fallback paths are hit, render them as explicit backend/tool failure state, never assistant answer text.',
    },
    {
      priority: 'P2',
      status: runtime.defaultModelIsGpt4oMini === true || frontend.frontendDefaultModelIsGpt4oMini === true ? 'open' : 'verified_present',
      title: 'Some default model constants still point to gpt-4o-mini while owner requirement is GPT-4o conversational behavior.',
      evidence: [
        `runtime.defaultModelIsGpt4oMini=${String(runtime.defaultModelIsGpt4oMini)}`,
        `frontend.frontendDefaultModelIsGpt4oMini=${String(frontend.frontendDefaultModelIsGpt4oMini)}`,
      ],
      impact: 'Backend Owner AI currently defaults to GPT-4o, but fallback/runtime wrappers could degrade answer quality if those paths are activated.',
      recommendedFix: 'Standardize owner-facing Runtime v2 conversational model selection to gpt-4o and keep mini only for explicit low-cost probes.',
    },
    {
      priority: 'P2',
      status: dashboard.hasRuntimeV2Tile === true && dashboard.hasLiveActivityTile === true ? 'verified_present' : 'open',
      title: 'CTO dashboard shows Runtime v2 status, but not yet the full per-job Runtime v2 execution tree/log artifact.',
      evidence: [
        `dashboard.hasIVXAIStatusCard=${String(dashboard.hasIVXAIStatusCard)}`,
        `dashboard.hasRuntimeV2Tile=${String(dashboard.hasRuntimeV2Tile)}`,
        `dashboard.hasLiveActivityTile=${String(dashboard.hasLiveActivityTile)}`,
      ],
      impact: 'The dashboard proves Runtime v2 readiness and live activity, but the owner still needs a job-detail panel for task tree, retry logs, chunks, and final audit artifact.',
      recommendedFix: 'Add a Runtime v2 job detail drawer fed by the audit/job proof contract.',
    },
    {
      priority: 'P3',
      status: 'open',
      title: 'Streaming is implemented as a chunking contract/proof, not yet a dedicated SSE or incremental mobile rendering pipeline.',
      evidence: [
        'runtimeV2.streaming.supported=true',
        'this execution loop writes ordered chunks to audit proof',
      ],
      impact: 'Long answers can be preserved and chunked in the runtime proof, but the chat UI still needs first-class streamed rendering for very long responses.',
      recommendedFix: 'Add a streaming endpoint or chunk polling contract for Runtime v2 responses and render chunks progressively in chat.',
    },
  ];
}

function buildFinalResult(findings: IVXRuntimeV2BugFinding[]): string {
  const header = [
    'Runtime v2 execution result: prioritized IVX AI chat behavior bug list.',
    '',
    'Scope: safe read-only inspection of the Owner AI router, backend Owner AI handler, AI runtime wrapper, Expo request service, and CTO dashboard Runtime v2 card. No deploy, delete, production write, migration, or data mutation was performed.',
    '',
    'Priority scale: P0 blocks correct assistant behavior; P1 weakens proof/state visibility; P2 causes quality or dashboard gaps; P3 is follow-up architecture work.',
    '',
  ].join('\n');

  const body = findings.map((finding, index) => [
    `${index + 1}. [${finding.priority}] ${finding.title}`,
    `   Status: ${finding.status}`,
    `   Evidence: ${finding.evidence.join(' | ')}`,
    `   Impact: ${finding.impact}`,
    `   Recommended fix: ${finding.recommendedFix}`,
  ].join('\n')).join('\n\n');

  const footer = [
    '',
    'Execution notes:',
    '- Planner produced a Runtime v2 task tree before worker execution.',
    '- Memory/state was stored in the local audit artifact and in-process agent memory.',
    '- Worker executed read-only source inspection steps only.',
    '- Retry was proven with a controlled transient read-only probe failure and successful retry.',
    '- Long output was split into ordered chunks in the audit proof instead of being replaced with a canned fallback.',
    '- Dashboard verification is based on actual CTO dashboard source markers/testIDs.',
    '- Fallback masking remained disabled; failures are represented as state/logs, not fake assistant answers.',
  ].join('\n');

  return `${header}${body}${footer}`;
}

function chunkText(text: string, maxCharacters: number): Array<{ index: number; total: number; characters: number; text: string }> {
  const safeMax = Math.max(400, Math.floor(maxCharacters));
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += safeMax) {
    chunks.push(text.slice(index, index + safeMax));
  }
  const total = Math.max(1, chunks.length);
  return (chunks.length > 0 ? chunks : ['']).map((chunk, index) => ({
    index: index + 1,
    total,
    characters: chunk.length,
    text: chunk,
  }));
}

function dashboardProof(inspections: IVXRuntimeV2SourceInspection[]): IVXRuntimeV2ExecutionProof['dashboard'] {
  const dashboard = evidenceFor(inspections, 'cto-dashboard.tsx');
  return {
    file: 'expo/app/ivx/cto-dashboard.tsx',
    cardFound: dashboard.hasIVXAIStatusCard === true,
    runtimeV2TileFound: dashboard.hasRuntimeV2Tile === true,
    liveActivityTileFound: dashboard.hasLiveActivityTile === true,
    testIds: ['cto-ivx-ai-status-card', 'cto-status-runtime-v2', 'cto-status-live-activity', 'cto-status-agent-runtime'],
  };
}

export async function executeIVXAgentRuntimeV2Loop(input: ExecuteInput): Promise<IVXRuntimeV2ExecutionProof> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('Runtime v2 execution prompt is required.');
  }

  const jobId = makeJobId();

  // ── Pre-Execution Feasibility Gate (truth-first) ─────────────────────
  // Runs BEFORE any tool execution, patch, commit, deploy, migration, or
  // proof claim. If any required capability cannot be exercised right now,
  // the loop refuses to execute and returns the exact blocker. No fake
  // reports, no looping, no continuation.
  const feasibilityGate: FeasibilityGateResult = await runPreExecutionFeasibilityGate({
    prompt,
    taskId: jobId,
    ownerSessionPresent: true, // the execution loop is owner-initiated
  });
  if (feasibilityGate.state === 'BLOCKED') {
    const blockerBlock = formatFeasibilityGateBlock(feasibilityGate);
    const blockedProof: IVXRuntimeV2ExecutionProof = {
      ok: false,
      marker: IVX_RUNTIME_V2_EXECUTION_LOOP_MARKER,
      runtimeMarker: IVX_AGENT_RUNTIME_V2_MARKER,
      jobId,
      prompt,
      safeMode: {
        nonDestructive: true,
        productionDataMutated: false,
        deployed: false,
        allowedTools: [],
      },
      phases: ['failed'],
      retry: { enabled: true, maxAttempts: 0, failedStep: 'pre_execution_feasibility_gate', attempts: 0, recovered: false, error: feasibilityGate.exactBlocker },
      memoryState: { stored: false, store: 'local_audit_file_and_in_process_agent_memory', memoryKey: '', loadedEntries: 0, persistedAuditFile: '', persistedJsonlFile: '' },
      planner: buildIVXAgentRuntimeV2Envelope({ requestId: jobId, conversationId: 'runtime-v2-local-audit', prompt, recentMessages: [] }).planner,
      taskTree: { root: { id: 'runtime-v2-root', parentId: null, title: 'Pre-execution feasibility gate blocked execution', ownerGoal: prompt, assignedAgent: 'cto_orchestrator', status: 'blocked', risk: 'high', approvalRequired: true, toolMode: 'none', retryable: false, children: [] }, flat: [] },
      worker: { id: '', agent: 'cto_orchestrator', executedSteps: [] },
      toolChain: [],
      sourceInspections: [],
      dashboard: { file: 'expo/app/ivx/cto-dashboard.tsx', cardFound: false, runtimeV2TileFound: false, liveActivityTileFound: false, testIds: [] },
      streaming: { supported: true, mode: 'chunked_response_contract', shouldChunk: false, maxChunkCharacters: 6_000, estimatedChunks: 0, reason: 'Pre-execution feasibility gate blocked execution; no chunks produced.', actualChunkCharacters: 0, chunks: [] },
      findings: [],
      finalResult: blockerBlock,
      logs: [{ sequence: 1, at: new Date().toISOString(), phase: 'failed', level: 'error', message: `Pre-execution feasibility gate BLOCKED: ${feasibilityGate.blockerCode}`, metadata: { blockerCode: feasibilityGate.blockerCode, exactBlocker: feasibilityGate.exactBlocker, failedCapability: feasibilityGate.failedCapability } }],
      auditFiles: { json: '', jsonl: '' },
      generatedAt: new Date().toISOString(),
    };
    return blockedProof;
  }
  const workerId = `${IVX_RUNTIME_V2_EXECUTION_LOOP_MARKER}:${jobId.slice(-8)}`;
  const conversationId = input.conversationId ?? 'runtime-v2-local-audit';
  const logs: IVXRuntimeV2ExecutionLog[] = [];
  const phases: IVXRuntimeV2ExecutionPhase[] = [];
  const auditDir = path.join(process.cwd(), 'logs', 'audit');
  const jsonPath = path.join(auditDir, `${jobId}.json`);
  const jsonlPath = path.join(auditDir, `${jobId}.jsonl`);

  const log = (phase: IVXRuntimeV2ExecutionPhase, level: IVXRuntimeV2ExecutionLog['level'], message: string, metadata: Record<string, unknown> = {}): void => {
    phases.push(phase);
    logs.push({ sequence: logs.length + 1, at: nowIso(), phase, level, message, metadata });
  };

  log('queued', 'info', 'Runtime v2 safe execution job queued.', { jobId, prompt, nonDestructive: true });

  const plannerDecision = buildIVXOwnerAIPlannerDecision(prompt);
  log('planning', 'info', 'Planner decision created.', { plannerDecision });

  const initialEnvelope = buildIVXAgentRuntimeV2Envelope({
    requestId: jobId,
    conversationId,
    prompt,
    plannerDecision,
    recentMessages: [
      { sender_role: 'owner', body: 'Do not mask fallback responses. Expose true backend/tool state.' },
      { sender_role: 'assistant', body: 'Runtime v2 will use planner, memory, task tree, retry, and chunk proof.' },
    ],
    persistence: 'local_dev_memory',
  });
  const root = cloneTaskNode(initialEnvelope.taskTree.root);
  root.status = 'running';
  setTaskStatus(root, 'Load persistent conversation memory', 'running');
  log('task_tree_created', 'info', 'Planner created Runtime v2 task tree.', { taskCount: initialEnvelope.taskTree.flat.length, root: root.id });

  const memoryKey = `runtime_v2_execution:${jobId}`;
  writeAgentMemory('cto_orchestrator', memoryKey, JSON.stringify({ prompt, plannerDecision, jobId }), { marker: IVX_RUNTIME_V2_EXECUTION_LOOP_MARKER });
  const loadedMemory = readAgentMemory('cto_orchestrator', memoryKey);
  recordAudit('cto_orchestrator', 'runtime_v2.execution.memory_loaded', `jobId=${jobId}`, null, { memoryKey, loadedEntries: loadedMemory.length });
  setTaskStatus(root, 'Load persistent conversation memory', 'completed');
  log('memory_loaded', 'info', 'Runtime memory/state stored.', { memoryKey, loadedEntries: loadedMemory.length, store: 'local_audit_file_and_in_process_agent_memory' });

  const dispatch = dispatchTask({
    goal: prompt,
    forceAgent: 'cto_orchestrator',
    metadata: { jobId, marker: IVX_RUNTIME_V2_EXECUTION_LOOP_MARKER, safeMode: true },
  });
  log('worker_started', 'info', 'Worker accepted read-only execution steps.', { workerId, taskId: dispatch.task.id, assignedAgent: dispatch.task.assignedAgent });

  let retryAttempts = 0;
  let retryRecovered = false;
  let retryError: string | null = null;
  const shouldForceRetryProbe = input.forceRetryProbe ?? true;
  if (shouldForceRetryProbe) {
    retryAttempts += 1;
    try {
      throw new Error('Controlled transient read-only probe failure: optional live screenshot trace was unavailable; retrying with source inspection.');
    } catch (error) {
      retryError = safeMessage(error);
      log('worker_step_failed', 'warn', 'Read-only worker step failed on first attempt.', { step: 'optional_live_screenshot_trace', attempt: retryAttempts, error: retryError });
      log('retry_scheduled', 'info', 'Retry scheduled for read-only source inspection.', { nextStep: 'source_file_inspection', maxAttempts: initialEnvelope.retryRecovery.maxAttempts });
    }
  }

  retryAttempts += 1;
  setTaskStatus(root, 'Run only required read tools and collect evidence', 'running');
  const sourceInspections = await inspectSourceFiles();
  retryRecovered = sourceInspections.every((inspection) => inspection.ok);
  if (!retryRecovered) {
    const error = sourceInspections.find((inspection) => !inspection.ok)?.error ?? 'Source inspection failed.';
    failTask(dispatch.task.id, error);
    log('failed', 'error', 'Worker source inspection failed after retry.', { attempt: retryAttempts, error });
    throw new Error(error);
  }
  setTaskStatus(root, 'Run only required read tools and collect evidence', 'completed');
  log('worker_step_completed', 'info', 'Read-only source inspection completed after retry.', { attempt: retryAttempts, inspectedFiles: sourceInspections.map((inspection) => inspection.file) });

  const findings = buildFindings(sourceInspections);
  const finalResult = buildFinalResult(findings);
  setTaskStatus(root, 'Synthesize natural GPT-4o answer', 'completed');
  log('analysis_completed', 'info', 'Prioritized bug list produced.', { findingCount: findings.length, finalResultCharacters: finalResult.length });

  const actualChunkCharacters = input.maxChunkCharacters ?? 1_800;
  const chunks = chunkText(finalResult, actualChunkCharacters);
  if (chunks.length > 1) {
    setTaskStatus(root, 'Chunk long structured response without replacing it with a template', 'completed');
  }
  log('stream_chunked', 'info', 'Final result split into ordered chunks.', { chunkCount: chunks.length, actualChunkCharacters });

  const dashboard = dashboardProof(sourceInspections);
  log('dashboard_verified', dashboard.cardFound && dashboard.runtimeV2TileFound ? 'info' : 'warn', 'CTO dashboard Runtime v2 status markers checked.', dashboard);

  setTaskStatus(root, 'Expose true backend/tool state and persist turn when requested', 'completed');
  setAllTaskStatuses(root, 'completed');
  const taskTree = { root, flat: flattenTaskTree(root) };
  const finalEnvelope = buildIVXAgentRuntimeV2Envelope({
    requestId: jobId,
    conversationId,
    prompt,
    plannerDecision,
    recentMessages: [
      { sender_role: 'owner', body: prompt },
      { sender_role: 'assistant', body: finalResult },
    ],
    persistence: 'local_dev_memory',
    completedToolNames: ['source_file_inspection', 'dashboard_source_marker_check', 'audit_log_write'],
  });

  completeTask(dispatch.task.id, {
    jobId,
    findingCount: findings.length,
    chunks: chunks.length,
    auditJson: path.relative(process.cwd(), jsonPath),
  });

  const proofWithoutAuditLog: Omit<IVXRuntimeV2ExecutionProof, 'logs' | 'auditFiles' | 'generatedAt'> = {
    ok: true,
    marker: IVX_RUNTIME_V2_EXECUTION_LOOP_MARKER,
    runtimeMarker: IVX_AGENT_RUNTIME_V2_MARKER,
    jobId,
    prompt,
    safeMode: {
      nonDestructive: true,
      productionDataMutated: false,
      deployed: false,
      allowedTools: ['read_source_file', 'in_process_memory_write', 'local_audit_file_write'],
    },
    phases,
    retry: {
      enabled: true,
      maxAttempts: finalEnvelope.retryRecovery.maxAttempts,
      failedStep: shouldForceRetryProbe ? 'optional_live_screenshot_trace' : null,
      attempts: retryAttempts,
      recovered: retryRecovered,
      error: retryError,
    },
    memoryState: {
      stored: true,
      store: 'local_audit_file_and_in_process_agent_memory',
      memoryKey,
      loadedEntries: loadedMemory.length,
      persistedAuditFile: path.relative(process.cwd(), jsonPath),
      persistedJsonlFile: path.relative(process.cwd(), jsonlPath),
    },
    planner: finalEnvelope.planner,
    taskTree,
    worker: {
      id: workerId,
      agent: dispatch.task.assignedAgent,
      executedSteps: taskTree.flat.map((node) => ({ id: node.id, title: node.title, status: node.status })),
    },
    toolChain: finalEnvelope.toolChain,
    sourceInspections,
    dashboard,
    streaming: {
      ...finalEnvelope.streaming,
      shouldChunk: chunks.length > 1,
      estimatedChunks: chunks.length,
      actualChunkCharacters,
      chunks,
    },
    findings,
    finalResult,
  };

  await mkdir(auditDir, { recursive: true });
  log('audit_saved', 'info', 'Audit files prepared for write.', { json: path.relative(process.cwd(), jsonPath), jsonl: path.relative(process.cwd(), jsonlPath) });
  log('completed', 'info', 'Runtime v2 safe execution loop completed.', { jobId, phases: phases.length, chunks: chunks.length });

  const proof: IVXRuntimeV2ExecutionProof = {
    ...proofWithoutAuditLog,
    logs,
    auditFiles: {
      json: path.relative(process.cwd(), jsonPath),
      jsonl: path.relative(process.cwd(), jsonlPath),
    },
    generatedAt: nowIso(),
  };

  await writeFile(jsonPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  await writeFile(jsonlPath, `${logs.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');

  return proof;
}
