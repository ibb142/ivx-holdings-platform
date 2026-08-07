/**
 * IVX IA Brain — Orchestrator (§4).
 *
 * The orchestration layer that ties together all brain modules:
 *   1. Domain Router (§1) — classify domains + routes
 *   2. Confidence Gate (§2) — assess confidence level
 *   3. Specialist Framework (§5–§9) — select domain-specific framework
 *   4. Live Retrieval (§3, §12) — detect retrieval need + freshness
 *   5. Hallucination Gate (§16) — scan for fabricated claims
 *   6. Observability (§17) — record event metadata
 *
 * The orchestrator enriches the existing chat-intent-router decision
 * with enterprise brain metadata. The existing 5-branch router remains
 * the execution authority — this module adds the classification,
 * confidence, and observability layer the spec requires.
 *
 * Pure (except for the retrieval execution which is delegated to the caller).
 */

import {
  routeIVXBrainDomains,
  type IVXBrainRoutingDecision,
} from './ivx-brain-domain-router';
import {
  assessConfidence,
  appendConfidenceDisclaimer,
  type IVXConfidenceAssessment,
} from './ivx-brain-confidence-gate';
import {
  selectSpecialistFramework,
  buildSpecialistSystemPrompt,
  type SpecialistFramework,
} from './ivx-brain-specialist-modes';
import {
  detectDataCategory,
  evaluateRetrieval,
  formatRetrievalCitations,
  type IVXDataCategory,
  type IVXRetrievalRecord,
  type IVXRetrievedSource,
} from './ivx-brain-live-retrieval';
import {
  applyHallucinationGate,
  type IVXHallucinationGateResult,
} from './ivx-brain-hallucination-gate';
import {
  buildBrainEvent,
  type IVXBrainEvent,
  type IVXBrainEventBuilder,
} from './ivx-brain-observability';

export const IVX_BRAIN_ORCHESTRATOR_MARKER =
  'ivx-brain-orchestrator-2026-08-07-v1';

// ─── Orchestration Types ─────────────────────────────────────────

export type IVXBrainOrchestrationInput = {
  /** The user's message. */
  prompt: string;
  /** Whether image/file attachments are present. */
  hasAttachments: boolean;
  /** Conversation ID for observability. */
  conversationId: string;
  /** Request/trace ID for observability. */
  requestId: string;
  /** Whether a verified owner session is present. */
  ownerSessionPresent: boolean;
  /** The base persona system prompt (from ivx-senior-engineer-persona.ts). */
  basePersonaPrompt: string;
  /** Whether verified internal IVX data is available. */
  hasInternalData: boolean;
  /** Whether live-retrieved sources are available. */
  hasRetrievedSources: boolean;
  /** Whether sufficient conversation context exists. */
  hasConversationContext: boolean;
  /** Retrieved sources (if live retrieval was performed). */
  retrievedSources: IVXRetrievedSource[];
};

export type IVXBrainOrchestrationPreResponse = {
  /** Domain routing decision. */
  routing: IVXBrainRoutingDecision;
  /** Confidence assessment. */
  confidence: IVXConfidenceAssessment;
  /** Specialist framework selected. */
  specialistFramework: SpecialistFramework;
  /** The enriched system prompt with specialist framework appended. */
  enrichedSystemPrompt: string;
  /** Data category for retrieval (if needed). */
  dataCategory: IVXDataCategory;
  /** Whether live retrieval is needed before answering. */
  needsLiveRetrieval: boolean;
  /** Retrieval evaluation (if sources were provided). */
  retrievalRecord: IVXRetrievalRecord | null;
  /** Prescribed behavior based on confidence level. */
  prescribedBehavior: string;
  /** Marker. */
  marker: string;
};

export type IVXBrainOrchestrationPostResponse = {
  /** Hallucination gate result. */
  hallucinationGate: IVXHallucinationGateResult;
  /** Final answer (after hallucination gate + confidence disclaimer). */
  finalAnswer: string;
  /** Whether the answer was modified by any gate. */
  wasModified: boolean;
  /** Observability event (to be persisted by caller). */
  observabilityEvent: IVXBrainEvent;
  /** Retrieval citations string (if retrieval was used). */
  retrievalCitations: string | null;
};

// ─── Pre-Response Orchestration ──────────────────────────────────

/**
 * Run the pre-response orchestration: classify the message, assess
 * confidence, select a specialist framework, and determine if live
 * retrieval is needed. This runs BEFORE the LLM call.
 *
 * @returns routing decision, confidence, enriched system prompt,
 *          and retrieval requirements.
 */
export function orchestratePreResponse(
  input: IVXBrainOrchestrationInput,
): IVXBrainOrchestrationPreResponse {
  // 1. Domain routing
  const routing = routeIVXBrainDomains(input.prompt, input.hasAttachments);

  // 2. Confidence assessment
  const confidence = assessConfidence(input.prompt, {
    hasInternalData: input.hasInternalData,
    hasRetrievedSources: input.hasRetrievedSources,
    hasConversationContext: input.hasConversationContext,
  });

  // 3. Specialist framework selection
  const { framework, prompt: specialistPrompt } = selectSpecialistFramework(
    routing.primaryDomain,
  );
  const enrichedSystemPrompt = specialistPrompt
    ? buildSpecialistSystemPrompt(input.basePersonaPrompt, routing.primaryDomain)
    : input.basePersonaPrompt;

  // 4. Data category + retrieval need
  const dataCategory = detectDataCategory(input.prompt);
  const needsLiveRetrieval = routing.requiresLiveRetrieval;

  // 5. Retrieval evaluation (if sources were provided)
  let retrievalRecord: IVXRetrievalRecord | null = null;
  if (input.retrievedSources.length > 0) {
    retrievalRecord = evaluateRetrieval(input.prompt, input.retrievedSources);
  }

  return {
    routing,
    confidence,
    specialistFramework: framework,
    enrichedSystemPrompt,
    dataCategory,
    needsLiveRetrieval,
    retrievalRecord,
    prescribedBehavior: confidence.prescribedBehavior,
    marker: IVX_BRAIN_ORCHESTRATOR_MARKER,
  };
}

// ─── Post-Response Orchestration ─────────────────────────────────

/**
 * Run the post-response orchestration: scan for hallucinations,
 * append confidence disclaimers, and build the observability event.
 * This runs AFTER the LLM call.
 *
 * @param preResponse The pre-response orchestration result.
 * @param llmAnswer The raw LLM-generated answer.
 * @param builder Observability event builder fields.
 */
export function orchestratePostResponse(
  preResponse: IVXBrainOrchestrationPreResponse,
  llmAnswer: string,
  builder: Pick<
    IVXBrainEventBuilder,
    'model' | 'toolsUsed' | 'sourcesUsed' | 'fallbackUsed' | 'errors' | 'safetyDecision' | 'finalStatus' | 'gateStages' | 'tokenUsage' | 'timeToFirstTokenMs' | 'feedback'
  > & {
    input: IVXBrainOrchestrationInput;
  },
): IVXBrainOrchestrationPostResponse {
  const { input } = builder;

  // 1. Hallucination gate
  const hallucinationGate = applyHallucinationGate(llmAnswer, {
    hasRetrievedSources: input.hasRetrievedSources,
    hasInternalData: input.hasInternalData,
  });

  // 2. Confidence disclaimer (only if not already gated by hallucination gate)
  let finalAnswer = hallucinationGate.answer;
  let wasModified = hallucinationGate.gated;

  if (!hallucinationGate.gated && preResponse.confidence.level !== 'HIGH') {
    const withDisclaimer = appendConfidenceDisclaimer(finalAnswer, preResponse.confidence);
    if (withDisclaimer !== finalAnswer) {
      finalAnswer = withDisclaimer;
      wasModified = true;
    }
  }

  // 3. Retrieval citations
  let retrievalCitations: string | null = null;
  if (preResponse.retrievalRecord) {
    retrievalCitations = formatRetrievalCitations(preResponse.retrievalRecord);
  }

  // 4. Build observability event
  const startTime = Date.now(); // The caller should set the actual start time
  const eventBuilder: IVXBrainEventBuilder = {
    requestId: input.requestId,
    conversationId: input.conversationId,
    startTime,
    intent: preResponse.routing.primaryDomain,
    domain: preResponse.routing.primaryDomain,
    domains: preResponse.routing.domains,
    routes: preResponse.routing.routes,
    model: builder.model,
    toolsUsed: builder.toolsUsed,
    sourcesUsed: builder.sourcesUsed,
    confidence: preResponse.confidence.level,
    fallbackUsed: builder.fallbackUsed,
    errors: builder.errors,
    safetyDecision: builder.safetyDecision,
    finalStatus: builder.finalStatus,
    gateStages: builder.gateStages,
    hallucinationFlags: hallucinationGate.flags.length,
    usedLiveRetrieval: preResponse.needsLiveRetrieval,
    wasGated: wasModified,
    tokenUsage: builder.tokenUsage,
    timeToFirstTokenMs: builder.timeToFirstTokenMs,
    feedback: builder.feedback,
  };
  const observabilityEvent = buildBrainEvent(eventBuilder);

  return {
    hallucinationGate,
    finalAnswer,
    wasModified,
    observabilityEvent,
    retrievalCitations,
  };
}
