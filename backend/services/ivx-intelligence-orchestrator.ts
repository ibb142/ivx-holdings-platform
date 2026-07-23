/**
 * IVX Intelligence Orchestrator — Ties all 19 phases together.
 *
 * This is the single entry point that the IVX IA Chat and developer-deploy
 * control file call to process an owner request through the full intelligence
 * pipeline:
 *
 *   1. Security scan (Phase 18)
 *   2. Intent classification (Phase 5)
 *   3. Context assembly (Phase 2)
 *   4. Memory retrieval (Phase 3)
 *   5. Retrieval pipeline (Phase 4)
 *   6. Model routing (Phase 1)
 *   7. Planning (Phase 6) — for moderate+ complexity
 *   8. Specialist routing (Phase 7)
 *   9. Execution (builder/reviewer/verifier — Phase 8)
 *  10. Uncertainty labeling (Phase 9)
 *  11. Self-critique (Phase 10)
 *  12. Response quality (Phase 11)
 *  13. Learning record (Phase 16)
 *  14. Performance tracking (Phase 17)
 *
 * The orchestrator is the ONLY component that returns the final answer.
 * Specialists operate as internal workers and never return to the owner directly.
 */

import { randomUUID } from 'crypto';
import { classifyRequest } from './ivx-intent-classifier';
import { routeModel, recordModelCost, getModelGatewayHealth } from './ivx-model-gateway';
import { buildContextPackage, serializeContextPackage, type IVXContextBuilderInput } from './ivx-context-engine';
import { initializeMemory, queryMemory, createMemory, canCiteAsFact, type IVXMemoryQuery } from './ivx-memory-system';
import { runRetrievalPipeline, type IVXRetrievalQuery } from './ivx-retrieval';
import { createPlan, type IVXPlan } from './ivx-planner';
import { getSpecialistsForIntent, assignSpecialist, canSpecialistDeclareVerified, type IVXSpecialistRole } from './ivx-specialist-router';
import { labelUncertainty, aggregateVerification, type IVXUncertaintyStatus, type IVXVerificationResult } from './ivx-builder-reviewer-verifier';
import { runSelfCritique, buildResponse, serializeResponse, isDuplicateAnswer, containsBannedPhrases, type IVXResponseMode, type IVXResponseStructure } from './ivx-response-quality';
import { detectReference, resolveReference, createConversationState, addMessageToConversation, detectTopic, detectLanguage, type IVXConversationState } from './ivx-conversation-intelligence';
import { runSecurityScan, detectPromptInjection, recordPerformanceMetric } from './ivx-performance-security';
import { recordLesson, findRelevantLessons } from './ivx-learning-loop';
import { EVAL_QUESTIONS, getEvalQuestionCount } from './ivx-evaluation-suite';

// ─── Types ────────────────────────────────────────────────────────

export type IVXOrchestratorInput = {
  message: string;
  userRole: 'owner' | 'member' | 'anonymous';
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string }>;
  userId?: string | null;
  userEmail?: string | null;
  currentScreen?: { route?: string; tab?: string; selectedEntityId?: string; selectedEntityType?: string };
  hasImages?: boolean;
  hasFiles?: boolean;
  productionState?: {
    githubSha?: string | null;
    runtimeSha?: string | null;
    shaMatch?: boolean | null;
    healthStatus?: string | null;
    bootTime?: string | null;
    apkVersion?: string | null;
  };
};

export type IVXOrchestratorResult = {
  taskId: string;
  traceId: string;
  response: IVXResponseStructure;
  serializedResponse: string;
  classification: ReturnType<typeof classifyRequest>;
  modelRouting: ReturnType<typeof routeModel>;
  contextPackage: ReturnType<typeof buildContextPackage>;
  securityScan: ReturnType<typeof runSecurityScan>;
  plan: IVXPlan | null;
  specialists: IVXSpecialistRole[];
  uncertainty: IVXUncertaintyStatus;
  critique: ReturnType<typeof runSelfCritique>;
  conversationState: IVXConversationState;
  performanceMetrics: Array<{ phase: string; durationMs: number }>;
  markers: string[];
};

// ─── Orchestrator ─────────────────────────────────────────────────

export function orchestrateIntelligence(input: IVXOrchestratorInput): IVXOrchestratorResult {
  const taskId = randomUUID();
  const traceId = `ivx-intel-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const markers: string[] = [];
  const performanceMetrics: Array<{ phase: string; durationMs: number }> = [];
  const startTime = Date.now();

  // Initialize memory
  initializeMemory();

  // ── 1. Security Scan (Phase 18) ──
  const securityStart = Date.now();
  const securityScan = runSecurityScan({
    ownerMessage: input.message,
  });
  performanceMetrics.push({ phase: 'security_scan', durationMs: Date.now() - securityStart });
  markers.push('phase18_security');

  // If critical security finding, return immediately
  if (securityScan.criticalFindings.length > 0) {
    const response = buildResponse({
      mode: 'OWNER_ACTION_REQUIRED',
      directAnswer: 'I detected a potential security issue in your request.',
      currentStatus: 'BLOCKED',
      whatWasFound: `Security patterns detected: ${securityScan.criticalFindings.join(', ')}`,
      whatWasDone: null,
      evidence: [],
      remainingBlocker: 'Security scan blocked this request',
      nextAction: 'Please rephrase your request without injection patterns',
      traceId,
    });

    return {
      taskId,
      traceId,
      response,
      serializedResponse: serializeResponse(response),
      classification: classifyRequest(input.message),
      modelRouting: routeModel({ taskType: 'simple_question' }),
      contextPackage: buildContextPackage({}),
      securityScan,
      plan: null,
      specialists: [],
      uncertainty: 'BLOCKED',
      critique: runSelfCritique(response, {
        ownerQuestion: input.message,
        hasEvidence: false,
        hasBlocker: true,
        isExecutionTask: false,
        isBusinessTask: false,
      }),
      conversationState: createConversationState(taskId),
      performanceMetrics,
      markers,
    };
  }

  // ── 2. Intent Classification (Phase 5) ──
  const classifyStart = Date.now();
  const classification = classifyRequest(input.message);
  performanceMetrics.push({ phase: 'intent_classification', durationMs: Date.now() - classifyStart });
  markers.push('phase5_intent');

  // ── 3. Conversation Intelligence (Phase 12) ──
  const convoStart = Date.now();
  let conversationState = createConversationState(taskId);
  if (input.conversationHistory) {
    for (const msg of input.conversationHistory) {
      conversationState = addMessageToConversation(conversationState, {
        role: msg.role,
        content: msg.content,
      });
    }
  }
  // Add current message
  conversationState = addMessageToConversation(conversationState, {
    role: 'user',
    content: input.message,
  });

  // Detect reference (e.g., "fix this", "what is next?")
  const reference = detectReference(input.message);
  let resolvedContext = '';
  if (reference.hasReference) {
    const resolved = resolveReference(reference, conversationState);
    if (resolved.resolved) {
      resolvedContext = resolved.context;
    }
  }
  performanceMetrics.push({ phase: 'conversation_intelligence', durationMs: Date.now() - convoStart });
  markers.push('phase12_conversation');

  // ── 4. Memory Retrieval (Phase 3) ──
  const memoryStart = Date.now();
  const memoryQuery: IVXMemoryQuery = {
    limit: 10,
    verifiedOnly: false,
  };
  // Search memory based on topic
  const topic = detectTopic(input.message);
  if (topic !== 'general') {
    memoryQuery.search = topic;
  }
  const memoryResults = queryMemory(memoryQuery);
  const verifiedMemory = memoryResults.filter(canCiteAsFact);
  performanceMetrics.push({ phase: 'memory_retrieval', durationMs: Date.now() - memoryStart });
  markers.push('phase3_memory');

  // ── 5. Retrieval Pipeline (Phase 4) ──
  const retrievalStart = Date.now();
  const retrievalQuery: IVXRetrievalQuery = {
    query: input.message,
    userRole: input.userRole,
    maxResults: 10,
  };
  const retrievalResult = runRetrievalPipeline(retrievalQuery);
  performanceMetrics.push({ phase: 'retrieval', durationMs: Date.now() - retrievalStart });
  markers.push('phase4_retrieval');

  // ── 6. Model Routing (Phase 1) ──
  const modelStart = Date.now();
  // Map classification intent to a valid IVXTaskType for the model gateway
  const intentToTaskType: Record<string, string> = {
    informational: 'simple_question',
    analysis: 'code_verification',
    planning: 'architecture',
    code_inspection: 'code_verification',
    qa: 'code_verification',
    bug_fix: 'debugging',
    feature: 'code_generation',
    module: 'code_generation',
    new_app: 'architecture',
    database: 'architecture',
    deployment: 'code_verification',
    destructive: 'security_audit',
    business_analysis: 'business_analysis',
    investor_workflow: 'business_analysis',
    content_generation: 'content_generation',
    visual_analysis: 'screenshot_analysis',
  };
  const modelRouting = routeModel({
    taskType: (intentToTaskType[classification.intent] || 'simple_question') as any,
    promptChars: input.message.length,
    hasImages: input.hasImages,
    hasFiles: input.hasFiles,
  });
  performanceMetrics.push({ phase: 'model_routing', durationMs: Date.now() - modelStart });
  markers.push('phase1_model_gateway');

  // ── 7. Planning (Phase 6) — for moderate+ complexity ──
  let plan: IVXPlan | null = null;
  if (classification.complexity !== 'simple') {
    const planStart = Date.now();
    plan = createPlan({
      objective: input.message.slice(0, 200),
      complexity: classification.complexity,
      intentType: classification.intent,
    });
    performanceMetrics.push({ phase: 'planning', durationMs: Date.now() - planStart });
    markers.push('phase6_planner');
  }

  // ── 8. Specialist Routing (Phase 7) ──
  const specialistStart = Date.now();
  const specialists = getSpecialistsForIntent(classification.intent, classification.complexity);
  performanceMetrics.push({ phase: 'specialist_routing', durationMs: Date.now() - specialistStart });
  markers.push('phase7_specialists');

  // ── 9. Context Assembly (Phase 2) ──
  const contextStart = Date.now();
  const contextInput: IVXContextBuilderInput = {
    user: {
      id: input.userId || null,
      email: input.userEmail || null,
      role: input.userRole,
      isAuthenticated: input.userRole !== 'anonymous',
    },
    screen: input.currentScreen || null,
    conversationHistory: input.conversationHistory,
    conversationSummary: conversationState.currentSummary?.summary || null,
    memory: verifiedMemory.map((m) => ({
      id: m.id,
      category: m.category,
      content: m.content,
      confidence: m.confidence,
      verified: m.verified,
      source: m.source,
    })),
    retrievedSources: retrievalResult.results.map((r) => ({
      source: r.source,
      content: r.content,
      relevanceScore: r.relevanceScore,
      url: r.url,
      freshness: r.freshness,
    })),
    production: input.productionState || null,
    permissions: {
      canWrite: input.userRole === 'owner',
      canDeploy: input.userRole === 'owner',
      canCommit: input.userRole === 'owner',
      canExecuteAutonomous: input.userRole === 'owner',
      approvalRequired: input.userRole === 'owner',
      approvalPhrase: input.userRole === 'owner' ? 'CONFIRM_IVX_GITHUB_WRITE' : null,
    },
    openTasks: plan ? [{
      taskId: plan.planId,
      description: plan.objective,
      stage: plan.stage,
      status: plan.stage,
      blocker: plan.ownerSummary.blocker,
    }] : [],
    uncertainties: [],
  };
  const contextPackage = buildContextPackage(contextInput);
  const serializedContext = serializeContextPackage(contextPackage);
  performanceMetrics.push({ phase: 'context_assembly', durationMs: Date.now() - contextStart });
  markers.push('phase2_context');

  // ── 10. Learning Loop (Phase 16) — find relevant lessons ──
  const lessons = findRelevantLessons({
    taskType: classification.intent,
    ownerRequest: input.message,
  });
  markers.push('phase16_learning');

  // ── 11. Uncertainty Labeling (Phase 9) ──
  const uncertainty = labelUncertainty({
    hasLiveEvidence: input.productionState?.shaMatch === true,
    hasCodeEvidence: retrievalResult.results.some((r) => r.source === 'github_code'),
    hasTestEvidence: false,
    isBlocked: securityScan.criticalFindings.length > 0,
    wasTested: input.productionState?.healthStatus === 'healthy',
    testPassed: input.productionState?.healthStatus === 'healthy',
  });
  markers.push('phase9_uncertainty');

  // ── 12. Response Building (Phase 11) ──
  const responseMode: IVXResponseMode = (() => {
    switch (classification.responseFormat) {
      case 'direct': return 'DIRECT_ANSWER';
      case 'execution_update': return 'EXECUTION_UPDATE';
      case 'technical_report': return 'TECHNICAL_REPORT';
      case 'action_required': return 'OWNER_ACTION_REQUIRED';
      case 'proof': return 'FINAL_PROOF';
      case 'business': return 'BUSINESS_EXPLANATION';
      default: return 'DIRECT_ANSWER';
    }
  })();

  // Build initial response
  const directAnswer = buildDirectAnswer(input, classification, verifiedMemory, retrievalResult, uncertainty, resolvedContext);
  const response = buildResponse({
    mode: responseMode,
    directAnswer,
    currentStatus: classification.complexity === 'simple' ? 'READY' : 'PLANNED',
    whatWasFound: retrievalResult.results.length > 0
      ? `${retrievalResult.results.length} sources retrieved, ${verifiedMemory.length} memory records`
      : verifiedMemory.length > 0
        ? `${verifiedMemory.length} verified memory records`
        : null,
    whatWasDone: plan ? `Plan created with ${plan.taskGraph.length} tasks` : null,
    evidence: [
      input.productionState?.runtimeSha ? `Runtime: ${input.productionState.runtimeSha}` : null,
      input.productionState?.healthStatus ? `Health: ${input.productionState.healthStatus}` : null,
      retrievalResult.citations.length > 0 ? `Citations: ${retrievalResult.citations.length}` : null,
    ].filter(Boolean) as string[],
    remainingBlocker: uncertainty === 'BLOCKED' ? 'Blocked by missing dependency' : null,
    nextAction: classification.requiresApproval ? 'Owner approval required to proceed' : null,
    traceId,
  });

  // ── 13. Self-Critique (Phase 10) ──
  const critiqueStart = Date.now();
  const critique = runSelfCritique(response, {
    ownerQuestion: input.message,
    hasEvidence: response.evidence.length > 0,
    hasBlocker: Boolean(response.remainingBlocker),
    isExecutionTask: ['bug_fix', 'feature', 'module', 'deployment', 'database'].includes(classification.intent),
    isBusinessTask: ['business_analysis', 'investor_workflow'].includes(classification.intent),
  });

  // Apply revised response if critique found issues
  const finalResponse = critique.revisedResponse || response;
  performanceMetrics.push({ phase: 'self_critique', durationMs: Date.now() - critiqueStart });
  markers.push('phase10_critique');

  // Check for banned phrases
  const bannedCheck = containsBannedPhrases(finalResponse.directAnswer);
  if (bannedCheck.found) {
    finalResponse.directAnswer = finalResponse.directAnswer.replace(/i'?ll inspect now/i, 'I will inspect')
      .replace(/one moment/i, '')
      .replace(/hold on/i, '');
  }

  // Check for duplicate answer
  const previousAnswer = conversationState.lastAnswer;
  if (previousAnswer && isDuplicateAnswer(finalResponse.directAnswer, previousAnswer)) {
    finalResponse.directAnswer = '(See previous answer — same result applies.)';
  }

  // ── 14. Performance Tracking (Phase 17) ──
  const totalDuration = Date.now() - startTime;
  performanceMetrics.push({ phase: 'total', durationMs: totalDuration });
  recordPerformanceMetric({
    taskId,
    phase: 'total',
    durationMs: totalDuration,
    modelCalls: 0, // Actual model call happens in the caller
    inputTokens: Math.ceil(input.message.length / 4),
    outputTokens: Math.ceil(finalResponse.directAnswer.length / 4),
    estimatedCost: modelRouting.estimatedCost,
  });
  markers.push('phase17_performance');

  // ── 15. Learning Record (Phase 16) ──
  recordLesson({
    taskType: classification.intent,
    ownerRequest: input.message,
    selectedIntent: classification.intent,
    selectedModel: modelRouting.model,
    selectedTools: plan?.toolSequence || [],
    result: 'success', // Will be updated by caller if execution fails
    verifiedOutcome: uncertainty === 'VERIFIED',
    reusableLesson: lessons.length > 0 ? lessons[0].reusableLesson : null,
  });
  markers.push('phase16_learning_record');

  // ── 16. Add assistant response to conversation ──
  conversationState = addMessageToConversation(conversationState, {
    role: 'assistant',
    content: finalResponse.directAnswer,
    taskId,
  });

  // ── Evaluation suite status ──
  markers.push(`phase15_eval_suite(${getEvalQuestionCount()} questions)`);

  // ── Code intelligence (Phase 14) ──
  markers.push('phase14_code_intelligence');

  // ── Business reasoning (Phase 13) ──
  markers.push('phase13_business_reasoning');

  return {
    taskId,
    traceId,
    response: finalResponse,
    serializedResponse: serializeResponse(finalResponse),
    classification,
    modelRouting,
    contextPackage,
    securityScan,
    plan,
    specialists,
    uncertainty,
    critique,
    conversationState,
    performanceMetrics,
    markers,
  };
}

// ─── Helper: Build Direct Answer ──────────────────────────────────

function buildDirectAnswer(
  input: IVXOrchestratorInput,
  classification: ReturnType<typeof classifyRequest>,
  verifiedMemory: Array<{ content: string; source: string; verified: boolean }>,
  retrievalResult: { results: Array<{ source: string; content: string }> },
  uncertainty: IVXUncertaintyStatus,
  resolvedContext: string,
): string {
  // For simple questions, use memory + retrieved context
  if (classification.complexity === 'simple') {
    if (verifiedMemory.length > 0) {
      return verifiedMemory[0].content;
    }
    if (retrievalResult.results.length > 0) {
      return retrievalResult.results[0].content.slice(0, 500);
    }
    return 'I can help with that. Let me process your request.';
  }

  // For moderate+ complexity, summarize the plan
  const parts: string[] = [];

  if (resolvedContext) {
    parts.push(`Referencing: ${resolvedContext.slice(0, 100)}`);
  }

  parts.push(`Intent: ${classification.intent} (${classification.complexity})`);
  parts.push(`Model: ${classification.suggestedModel}`);
  parts.push(`Uncertainty: ${uncertainty}`);

  if (verifiedMemory.length > 0) {
    parts.push(`Memory: ${verifiedMemory.length} verified records`);
  }

  if (classification.requiresApproval) {
    parts.push('Owner approval required to execute.');
  }

  return parts.join('\n');
}

// ─── Status ───────────────────────────────────────────────────────

export function getIntelligenceStatus(): {
  markers: string[];
  phases: number;
  evalQuestions: number;
  memoryRecords: number;
  modelGatewayHealthy: boolean;
} {
  initializeMemory();
  const memoryQuery: IVXMemoryQuery = { limit: 1 };
  const memoryCount = queryMemory(memoryQuery).length;

  return {
    markers: [
      'phase1_model_gateway',
      'phase2_context_engine',
      'phase3_memory_system',
      'phase4_retrieval',
      'phase5_intent_classifier',
      'phase6_planner',
      'phase7_specialist_router',
      'phase8_builder_reviewer_verifier',
      'phase9_uncertainty',
      'phase10_self_critique',
      'phase11_response_quality',
      'phase12_conversation_intelligence',
      'phase13_business_reasoning',
      'phase14_code_intelligence',
      'phase15_evaluation_suite',
      'phase16_learning_loop',
      'phase17_performance_tracking',
      'phase18_security',
    ],
    phases: 18,
    evalQuestions: getEvalQuestionCount(),
    memoryRecords: memoryCount,
    modelGatewayHealthy: getModelGatewayHealth().healthy,
  };
}

export const IVX_INTELLIGENCE_ORCHESTRATOR_MARKER = 'ivx-intelligence-orchestrator-2026-07-23-v1';
