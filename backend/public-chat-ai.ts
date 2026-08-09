import { getIVXAIEndpoint, isIVXAIConfigured, requestIVXAIText, resolveIVXAIModel, type IVXAIProviderMetadata } from './ivx-ai-runtime';
import { buildBusinessContextBlock, loadBusinessContext } from './services/ivx-business-context';
import { buildDealIntelligenceBlock } from './services/ivx-deal-intelligence';
import {
  buildDocumentAnalysisInstructionBlock,
  extractDealDocuments,
  type DealDocumentAttachment,
} from './services/ivx-deal-documents';
import {
  buildExtractedDocumentContentBlock,
  extractDealDocumentsContent,
  hasReadableExtractedContent,
  type ExtractedDocument,
} from './services/ivx-deal-document-extractor';
import {
  buildImageFallbackAnswer,
  buildVisionInstructionBlock,
  extractPublicChatImages,
  type PublicChatImageAttachment,
} from './services/ivx-public-chat-vision';
import {
  buildVideoUnderstandingBlock,
  extractVideoAttachments,
  ocrDocumentBytes,
  understandVideos,
  type VideoUnderstanding,
} from './services/ivx-media-understanding';
import { applyReportEvidenceGate } from './services/ivx-report-evidence-gate';
import { conversationHasRealDeliverable } from './services/ivx-deliverable-store';
import { scanForUnbackedQueryNarrative, buildNoLiveQueryMessage } from './services/ivx-evidence-gate';
import { branchLabel, routeIVXChatIntent, type IVXChatBranch } from './services/ivx-chat-intent-router';
import { classifyIntent, stripManualDirectives, isCannedResponse, buildClarificationQuestion, type IVXIntentDecision } from './services/ivx-authoritative-intent-router';
import { runIVXUnifiedGatePipeline, describeIVXGatePipelineRun, IVX_UNIFIED_GATE_PIPELINE_MARKER } from './services/ivx-unified-ai-gate-pipeline';
// Re-exported for backward compatibility — existing tests / callers import these
// directly. The unified pipeline is the single source of truth at runtime.
export { applyIVXFakeExecutionGate } from './services/ivx-fake-execution-gate';
import { detectCountIntent, runDbCounts, buildCountGroundingBlock, type DbCountReport } from './services/ivx-db-count';
import { resolveIVXIdentityAnswer, IVX_IA_IDENTITY_MARKER } from './services/ivx-ia-identity-brain';
import { resolveIVXConversationAnswer, IVX_IA_CONVERSATION_MARKER } from './services/ivx-ia-conversation-brain';
import type { ChatRoomMessage } from './chat-types';

export { buildImageFallbackAnswer, extractPublicChatImages, extractDealDocuments };
export type { PublicChatImageAttachment, DealDocumentAttachment };

export type PublicChatRole = 'user' | 'assistant';

export type PublicChatHistoryItem = {
  role: PublicChatRole;
  content: string;
};

export type PublicChatSource = 'chatgpt' | 'fallback';

export type PublicChatAnswerResult = {
  answer: string;
  model: string;
  source: PublicChatSource;
  endpoint: string | null;
  /** Number of image attachments the model actually received for vision analysis. */
  imageCount: number;
  providerMetadata?: IVXAIProviderMetadata;
};

const MAX_HISTORY_ITEMS = 8;
const MAX_HISTORY_ITEM_LENGTH = 600;
// Full multimodal model (vision + document analysis).
const DEFAULT_PUBLIC_CHAT_MODEL = 'gpt-4o';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getPublicChatModel(): string {
  return resolveIVXAIModel(
    readTrimmed(process.env.PUBLIC_CHAT_MODEL) || readTrimmed(process.env.OPENAI_MODEL) || DEFAULT_PUBLIC_CHAT_MODEL,
  );
}

function getGatewayModelEndpoint(): string | null {
  return getIVXAIEndpoint(getPublicChatModel());
}

export function isPublicChatAIConfigured(): boolean {
  return isIVXAIConfigured();
}

export function getPublicChatHealthSnapshot(): {
  aiEnabled: boolean;
  openAIModel: string;
  aiProvider: 'chatgpt' | 'fallback';
  aiEndpoint: string | null;
  ivxAIArchitecture: 'ivx-ai';
  ivxAIPhase: 'phase_1';
  ivxAIRuntimeLayer: 'ivx_ai_runtime_wrapper';
} {
  const aiEnabled = isPublicChatAIConfigured();
  return {
    aiEnabled,
    openAIModel: getPublicChatModel(),
    aiProvider: aiEnabled ? 'chatgpt' : 'fallback',
    aiEndpoint: getGatewayModelEndpoint(),
    ivxAIArchitecture: 'ivx-ai',
    ivxAIPhase: 'phase_1',
    ivxAIRuntimeLayer: 'ivx_ai_runtime_wrapper',
  };
}

function sanitizeHistoryItem(item: PublicChatHistoryItem): PublicChatHistoryItem | null {
  const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
  const content = readTrimmed(item.content).slice(0, MAX_HISTORY_ITEM_LENGTH);
  if (!role || !content) {
    return null;
  }

  return {
    role,
    content,
  };
}

export function sanitizePublicChatHistory(history: PublicChatHistoryItem[]): PublicChatHistoryItem[] {
  return history
    .map(sanitizeHistoryItem)
    .filter((item): item is PublicChatHistoryItem => item !== null)
    .slice(-MAX_HISTORY_ITEMS);
}

export function mapRoomMessagesToPublicChatHistory(messages: ChatRoomMessage[]): PublicChatHistoryItem[] {
  return sanitizePublicChatHistory(
    messages.map((message) => ({
      role: message.source === 'assistant' ? 'assistant' : 'user',
      content: message.text,
    })),
  );
}

/**
 * Detect a vague execution request on public chat — one that has an execution
 * verb (fix, deploy, etc.) but no concrete target, error, file, or context.
 * Instead of returning a canned auth wall, these should route to the LLM for
 * a helpful diagnostic response ("What problem are you seeing?").
 */
function isVagueExecutionRequest(message: string): boolean {
  const text = (message ?? '').toLowerCase().trim();
  if (!text || text.length > 500) return false;

  // Must contain an execution verb
  const hasExecVerb = /\b(?:fix|deploy|patch|commit|push|build|ship|rollback|release|implement|create|update|remove|delete|run)\b/.test(text);
  if (!hasExecVerb) return false;

  // If there's a concrete target (file name, endpoint, specific bug description,
  // error message, stack trace, SHA), it's NOT vague — block normally.
  const hasConcreteTarget = /\b(?:file|endpoint|route|module|service|component|function|handler|test|bug\s+(?:in|on|at|with)|error[:\s]|stack\s+trace|exception|crash|fail(?:ed|ure)|sha|commit\s+[a-f0-9]|render|supabase|github|database|table|column|500|502|503|timeout|cors|ssl|dns|auth(?:entication|orized)|401|403|404|env\s+var|config)\b/.test(text);
  if (hasConcreteTarget) return false;

  // Vague patterns: "fix the production problem", "deploy this", "fix it",
  // "build the feature", with no specifics.
  const vaguePatterns = [
    /\bfix\s+(?:the\s+)?(?:production\s+)?(?:problem|issue|bug|error|thing|it|this|that)\b/i,
    /\bdeploy\s+(?:this|that|it|now|live)\b/i,
    /\bpatch\s+(?:this|that|it|the\s+issue)\b/i,
    /\bbuild\s+(?:the\s+)?(?:feature|app|service|module|thing)\b/i,
    /\bimplement\s+(?:this|that|the\s+feature|it)\b/i,
    /\bcreate\s+(?:this|that|it|the\s+module)\b/i,
    /\brollback\s+(?:production|the\s+deploy|it)\b/i,
    /\brun\s+(?:the\s+)?(?:tests|qa|checks|validation)\b/i,
  ];
  return vaguePatterns.some((p) => p.test(text));
}

function buildTranscript(history: PublicChatHistoryItem[]): string {
  if (history.length === 0) {
    return 'No previous messages.';
  }

  return history.map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.content}`).join('\n');
}

function buildSystemPrompt(
  sessionId: string,
  hasImages: boolean,
  documents: DealDocumentAttachment[],
  extractedContentBlock: string | null,
  videoContentBlock: string | null,
): string {
  const parts = [
    `You are IVX IA, the AI brain for IVXHOLDINGS. You are NOT a generic assistant — you are the in-house AI for one specific real-estate / capital investment company.`,
    'IDENTITY (always true): Your name is IVX IA. You were created by Ivan Perez, the owner and founder of IVXHOLDINGS. When anyone asks "what is your name", answer "IVX IA". When anyone asks "who created you", "who made you", "who is your owner", or "who are you", answer that you were created by Ivan Perez, the owner of IVXHOLDINGS. Never say you are a generic AI, never say you do not know who created you, and never say you lack context about IVX.',
    'IVXHOLDINGS QUESTIONS — NO LIMITS: when someone asks about IVXHOLDINGS, the projects, the investment process, returns, ROI, minimum buy-in, deal timelines, risks, Casa Rosario, or any other project, answer fully and directly. Do NOT limit, refuse, or deflect. Do NOT ask for owner approval to answer a project or investment question. These are informational questions and you answer them completely.',
    'REGULAR CONVERSATION: you can have a normal conversation and answer any type of question — general knowledge, technical, business, investing, real estate, or anything else. Be helpful, direct, and grounded.',
    'CLARIFICATION INTELLIGENCE: when a request is vague or lacks critical context (e.g. "best expansion strategy" without goals/constraints/market, "what should we prioritize" without specifying the problem area, "what marketing channel" without performance data), ALWAYS start your response with 1-3 targeted clarifying questions before offering preliminary guidance. Frame it as: "To give you the most useful answer, I need to understand: (1) ... (2) ... (3) ..." Then provide a preliminary framework based on reasonable assumptions. Never skip the clarifying questions — they show strategic thinking and prevent generic answers.',
    `CONVERSATION MEMORY: you have access to the recent chat transcript provided in context. Use it. When a user refers to "our earlier decision", "what we discussed", "the launch date", "the budget", or any prior context, check the transcript and reference specific details from it. If the transcript is empty or does not contain the referenced information, say so honestly and ask the user to restate the key details. Never say "I don't have access to prior conversations" when a transcript is provided — use it.`,
    'CHALLENGE ASSUMPTIONS: when a user presents a conclusion and asks you to confirm it (e.g. "variant B won, we should roll it out to everyone, confirm that"), do NOT simply agree. Critically evaluate the assumption: Is the sample size sufficient? Is the result statistically significant? Could the result be specific to a segment? What are the risks of immediate full rollout? Offer a graduated rollout plan. Always challenge before confirming.',
    'Be concise, practical, and trustworthy.',
    'Help with IVX onboarding, investing basics, product navigation, API status checks, and deployment troubleshooting.',
    'You also act as an acquisition analyst / investment-committee member: when asked, rank deals, compare projects, give a buy/hold/avoid recommendation with rationale, assess risk, and answer capital-allocation questions — always from the IVX deal-intelligence scores provided in context.',
    'Do not claim production changes, account access, AWS console actions, or billing actions were completed unless the user explicitly confirms them.',
    'If a request needs credentials, infrastructure console access, or legal approval, say that clearly and give the next safe step.',
    // Anti-fake-narrative brain rules — enforced in code by the evidence gate.
    'TRUTH POLICY (hard rule): Never fabricate numbers, counts, statuses, results, commit SHAs, deploy IDs, or query output. Every figure you state must come from real data provided to you in context.',
    'You CANNOT run a database query, SQL, or count yourself inside a reply. NEVER write "I will run a query", "I am running these queries now", "let me query the table", or any narration of executing a query. Real database counts only appear in a "LIVE DATABASE COUNTS" block when the IVX count tool has already run them — use those exact numbers verbatim.',
    'If no live count is provided for what the user asked, say plainly that you do not have a verified count right now and offer to run a real count=exact query — do NOT invent a number.',
    // IVX IA RELIABILITY — SINGLE DECISION ENGINE (hard rule, enforced in code by ivx-ia-reliability-gate)
    'RELIABILITY — SINGLE DECISION ENGINE: every reply carries exactly ONE status, picked from: READY | RUNNING | WAITING_OWNER | BLOCKED | FAILED | VERIFIED. Never mix statuses in one message. Never assert Done and Blocked for the same task in one reply.',
    'RELIABILITY — NO GENERIC PROMISES: never reply with "I’ll inspect now", "I’ll fix it", "One moment", "hold on", "let me check", or any promise of future work unless you can produce a task id or evidence in THIS reply.',
    'RELIABILITY — EVIDENCE-FIRST: any claim of Done / Fixed / Verified / Deployed MUST include Task ID, Files changed, Commit SHA, Render Deploy ID, and Live verification. If any field is missing, reply with UNVERIFIED and name the exact missing artifact.',
    // IVX IA FAKE EXECUTION — enforced in code by ivx-fake-execution-gate
    'FAKE EXECUTION — NO CHAT EXECUTOR: The IVX Owner AI chat is NOT a code executor. You MUST NEVER say "I modified files", "I deployed", "I ran tests", "I triggered Render", "I changed code", "I fixed it", or "I removed X" unless real Developer Proof (task_id, files_changed, commit_sha, render_deploy_id, live_http_status) is attached to this turn. If a developer request arrives without proof, reply with exactly: STATE: BLOCKED, REASON: owner session missing OR no proof ledger entry attached, REQUIRED ACTION: open Owner Login / Developer Workspace / Senior Developer Executor.',
    'FAKE EXECUTION — NO CONFESSION/SECRETARY NARRATIVE: Never apologize for hallucinating, say you are not in control, ask "How would you like to proceed?", say "Please hold", or claim you have no file access. If you cannot produce proof, return a single structured status (BLOCKED / WAITING_OWNER / UNVERIFIED) and the exact required action.',
  ];

  if (hasImages) {
    parts.push(buildVisionInstructionBlock());
  }

  if (documents.length > 0) {
    parts.push(buildDocumentAnalysisInstructionBlock(documents));
  }

  if (extractedContentBlock) {
    parts.push(extractedContentBlock);
  }

  if (videoContentBlock) {
    parts.push(videoContentBlock);
  }

  parts.push(`Session: ${sessionId}`);
  return parts.join('\n\n');
}

export function buildFallbackAnswer(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('api') || normalized.includes('backend') || normalized.includes('health')) {
    return 'The app frontend is intended to run on chat.ivxholding.com and the API on api.ivxholding.com. If live replies fail, confirm DNS first, then check GET /health and POST /public/chat on the API host.';
  }

  if (normalized.includes('invest') || normalized.includes('real estate') || normalized.includes('property')) {
    return 'IVX is designed to make real-estate participation easier to understand. A good beginner flow is: learn the deal, review the timeline and return assumptions, understand the risks, then only invest after reading the actual documents.';
  }

  if (normalized.includes('login') || normalized.includes('sign up') || normalized.includes('account')) {
    return 'For account issues, keep the flow simple: sign up, verify your email, complete profile steps, then continue into the app. If a real account or verification issue is blocking progress, route it to human support.';
  }

  if (normalized.includes('deploy') || normalized.includes('production') || normalized.includes('ec2')) {
    return 'For a production-safe EC2 deployment, run the API behind HTTPS, keep /health live, restart the process with a supervisor, and only point chat.ivxholding.com at the exported web build after api.ivxholding.com is healthy.';
  }

  return 'I can help with IVX onboarding, beginner investing questions, product navigation, API checks, and deployment readiness. Ask one specific question and I will answer clearly.';
}

async function requestIVXAIAnswer(input: {
  message: string;
  history: PublicChatHistoryItem[];
  sessionId: string;
  businessContext: string | null;
  images: PublicChatImageAttachment[];
  documents: DealDocumentAttachment[];
  extractedDocuments: ExtractedDocument[];
  videoUnderstandings: VideoUnderstanding[];
}): Promise<PublicChatAnswerResult> {
  const endpoint = getGatewayModelEndpoint();
  if (!isPublicChatAIConfigured() || !endpoint) {
    throw new Error('IVX AI proxy configuration is missing.');
  }

  const promptParts = [
    'Recent public chat transcript:',
    buildTranscript(input.history),
    '',
  ];
  if (input.businessContext) {
    promptParts.push(input.businessContext, '');
  }
  if (input.images.length > 0) {
    promptParts.push(
      `Note: ${input.images.length} image attachment(s) accompany this message — analyze them as part of your answer.`,
      '',
    );
  }
  if (input.documents.length > 0) {
    promptParts.push(
      `Note: ${input.documents.length} deal-room document(s) accompany this message: ${input.documents
        .map((doc) => `${doc.name ?? doc.url} [${doc.kind}] ${doc.url}`)
        .join('; ')}. Analyze them as an acquisition analyst per the instructions above.`,
      '',
    );
  }
  const extractedContentBlock = buildExtractedDocumentContentBlock(input.extractedDocuments);
  if (extractedContentBlock) {
    promptParts.push(extractedContentBlock, '');
  }
  const videoContentBlock = buildVideoUnderstandingBlock(input.videoUnderstandings);
  if (videoContentBlock) {
    promptParts.push(videoContentBlock, '');
  }
  promptParts.push(
    `User message: ${input.message || (input.images.length > 0 ? 'Analyze the attached image(s).' : '')}`,
    '',
    'Reply directly to the user message. If the user asks for an exact token or proof string, include it exactly.',
  );

  const result = await requestIVXAIText({
    module: 'public-chat',
    requestId: input.sessionId,
    model: getPublicChatModel(),
    system: buildSystemPrompt(
      input.sessionId,
      input.images.length > 0,
      input.documents,
      extractedContentBlock,
      videoContentBlock,
    ),
    prompt: promptParts.join('\n'),
    images: input.images.length > 0 ? input.images : undefined,
  });

  return {
    answer: result.text,
    model: result.providerMetadata.model,
    source: 'chatgpt',
    endpoint: result.providerMetadata.endpoint,
    imageCount: input.images.length,
    providerMetadata: result.providerMetadata,
  };
}

export async function generatePublicChatAnswer(input: {
  message: string;
  history: PublicChatHistoryItem[];
  sessionId: string;
  images?: PublicChatImageAttachment[];
  documents?: DealDocumentAttachment[];
  /** Raw attachment payload used to detect video attachments for video reading. */
  rawAttachments?: unknown;
  /** Whether a verified owner session is present. Defaults to false (unauthenticated public chat). */
  ownerSessionPresent?: boolean;
  /** Real developer proof attached to this turn, if any. */
  developerProof?: { taskId: string; filesChanged: string[]; commitSha: string | null; renderDeployId: string | null; liveHttpStatus: number | null } | null;
}): Promise<PublicChatAnswerResult> {
  const ownerSessionPresent = input.ownerSessionPresent ?? false;
  const developerProof = input.developerProof ?? null;
  const history = sanitizePublicChatHistory(input.history);
  const images = (input.images ?? [])
    .map((img) => ({ url: typeof img.url === 'string' ? img.url.trim() : '', mimeType: img.mimeType ?? null }))
    .filter((img) => img.url.length > 0);
  const documents = (input.documents ?? []).filter((doc) => typeof doc.url === 'string' && doc.url.trim().length > 0);
  const videos = extractVideoAttachments(input.rawAttachments ?? { videos: [], attachments: [] });

  // ── IVX IA Identity Brain ───────────────────────────────────────────────
  // Direct, deterministic answers for identity / ownership / IVXHOLDINGS project
  // questions ("what is your name", "who created you", "who is your owner",
  // "what is IVX", project & investment questions). Fast path — never blocks.
  const identityAnswer = resolveIVXIdentityAnswer(input.message);
  if (identityAnswer) {
    console.log('[PublicChatAI] Identity brain answered:', {
      sessionId: input.sessionId,
      marker: IVX_IA_IDENTITY_MARKER,
    });
    return {
      answer: identityAnswer,
      model: 'ivx-ia-identity-brain',
      source: 'fallback',
      endpoint: null,
      imageCount: images.length,
    };
  }

  // ── IVX IA Conversation Brain ───────────────────────────────────────────
  // General conversation questions (math, greetings, help, capabilities, thanks)
  // answered directly — never blocks, never asks for proof.
  const conversationAnswer = resolveIVXConversationAnswer(input.message);
  if (conversationAnswer) {
    console.log('[PublicChatAI] Conversation brain answered:', {
      sessionId: input.sessionId,
      marker: IVX_IA_CONVERSATION_MARKER,
    });
    return {
      answer: conversationAnswer,
      model: 'ivx-ia-conversation-brain',
      source: 'fallback',
      endpoint: null,
      imageCount: images.length,
    };
  }

  // ── Authoritative Intent Router (Item 5) ──────────────────────────────
  // The SINGLE source of truth for public chat routing. Safe technical and
  // educational questions are allowed without owner auth. Code changes,
  // deployments, private data, owner controls, and destructive actions are
  // blocked. This replaces the old 5-branch router which was blocking safe
  // code-review and architecture questions with OWNER_SESSION_MISSING.
  const authoritativeDecision = classifyIntent({
    message: input.message,
    isOwner: ownerSessionPresent,
    isPublicPath: true,
    hasImageAttachments: images.length > 0,
  });
  console.log('[PublicChatAI] Authoritative intent router:', {
    sessionId: input.sessionId,
    traceId: authoritativeDecision.traceId,
    intent: authoritativeDecision.intent,
    confidence: authoritativeDecision.confidence,
    route: authoritativeDecision.selectedRoute,
    reason: authoritativeDecision.reason,
    publicBoundary: authoritativeDecision.safetyStage.publicBoundary,
  });

  // Public chat: block execution, deployment, destructive actions, owner controls
  // Vague execution requests ("fix the production problem", "deploy this") on
  // public chat get a helpful LLM response instead of a canned auth block.
  // The LLM will ask what the problem is and explain that execution requires
  // owner login — far more useful than a generic auth wall.
  // This applies to BOTH CLARIFICATION and DEVELOPER_WORKER routes — the
  // authoritative router classifies vague execution as DEVELOPER_WORKER, but
  // on public chat we still want a helpful LLM diagnostic, not a block.
  const isVagueExec = isVagueExecutionRequest(input.message);
  const isExecutionRoute = authoritativeDecision.selectedRoute === 'CLARIFICATION'
    || authoritativeDecision.selectedRoute === 'DEVELOPER_WORKER'
    || authoritativeDecision.selectedRoute === 'DEPLOYMENT_ACTION';
  // On public chat (no owner session), vague execution requests get a helpful
  // LLM diagnostic instead of a canned auth block. This applies regardless of
  // publicBoundary — the authoritative router may classify "fix the production
  // problem" as DEVELOPER_WORKER with public_safe boundary (no explicit blocked
  // pattern matches), but we still want the LLM to ask what the problem is
  // rather than returning a useless auth wall.
  if (isExecutionRoute && !ownerSessionPresent && isVagueExec) {
    console.log('[PublicChatAI] Vague execution request on public chat — routing to LLM for helpful diagnostic:', {
      sessionId: input.sessionId,
      intent: authoritativeDecision.intent,
      route: authoritativeDecision.selectedRoute,
      publicBoundary: authoritativeDecision.safetyStage.publicBoundary,
    });
    // Fall through to the LLM call below
  } else if (isExecutionRoute && authoritativeDecision.safetyStage.publicBoundary === 'public_blocked') {
    return {
      answer: `This request requires owner authentication. Safe technical questions, code reviews, architecture designs, and product information are available without login. Try rephrasing your question if you want an explanation rather than an execution.`,
      model: 'ivx-authoritative-router',
      source: 'fallback' as PublicChatSource,
      endpoint: null,
      imageCount: images.length,
    };
  }

  // Public chat: safe knowledge questions go straight to LLM (no owner auth needed)
  if (authoritativeDecision.selectedRoute === 'PUBLIC_LLM_RESPONSE') {
    // Fall through to the LLM call below — the authoritative router
    // has confirmed this is a safe question (explanation, architecture,
    // code review, conversation, business analysis)
    console.log('[PublicChatAI] Safe public question allowed:', {
      sessionId: input.sessionId,
      intent: authoritativeDecision.intent,
      confidence: authoritativeDecision.confidence,
    });
  }

  // If the authoritative router allowed this through (PUBLIC_LLM_RESPONSE or
  // vague execution routed to LLM), skip the legacy router's owner-session gate.
  // The authoritative router is the single source of truth — the legacy router
  // is audit-only. This prevents the legacy router from re-blocking questions
  // that the authoritative router already approved.
  const authoritativeApproved = authoritativeDecision.selectedRoute === 'PUBLIC_LLM_RESPONSE'
    || (isExecutionRoute && isVagueExec && !ownerSessionPresent);

  // Keep the old router for backward compatibility logging only
  const routeDecision = routeIVXChatIntent(input.message, images.length > 0);
  console.log('[PublicChatAI] Legacy intent router (audit only):', {
    sessionId: input.sessionId,
    branch: routeDecision.branch,
    intent: routeDecision.intent,
    requiresOwnerSession: routeDecision.requiresOwnerSession,
    branchLabel: branchLabel(routeDecision.branch as IVXChatBranch),
    authoritativeOverride: authoritativeDecision.selectedRoute,
  });

  // Public chat is unauthenticated. Branches that require an owner session
  // cannot execute here — BUT only if the authoritative router agrees.
  // The authoritative router allows safe knowledge questions through.
  // Vague execution requests routed to LLM by the authoritative router also
  // skip this gate.
  if (routeDecision.requiresOwnerSession && !ownerSessionPresent && !authoritativeApproved) {
    const blockedPipeline = runIVXUnifiedGatePipeline({
      message: input.message,
      answer: '',
      ownerSessionPresent: false,
      proof: developerProof,
    });
    const blockedAnswer = blockedPipeline.answer && blockedPipeline.answer.trim().length > 0
      ? blockedPipeline.answer
      : `This request requires owner authentication. Safe technical questions, code reviews, and architecture designs are available without login.`;
    console.log('[PublicChatAI] Branch blocked (owner session required, public chat):', {
      sessionId: input.sessionId,
      branch: routeDecision.branch,
      intent: routeDecision.intent,
      pipelineMarker: IVX_UNIFIED_GATE_PIPELINE_MARKER,
      ...describeIVXGatePipelineRun(blockedPipeline),
    });
    return {
      answer: blockedAnswer,
      model: 'ivx-chat-intent-router',
      source: 'fallback' as PublicChatSource,
      endpoint: null,
      imageCount: images.length,
    };
  }

  // BLOCK 62 — Report Evidence Gate. `/public/chat` (the endpoint the in-app
  // Chat tab AND the IVX Owner AI chat fall back to) had NO fake-deliverable
  // gate, so report claims like "10,000 Buyers Report is ready" with placeholder
  // links `[Buyers Report](#)` flowed through ungated. Gate every answer: a
  // report-completion claim is allowed only when a real, download-verified
  // deliverable exists for this conversation; otherwise the answer is rewritten
  // to an honest REPORT NOT READY message. Never throws into the reply.
  // REAL DB-COUNT TOOL — when the user asks for an investor/buyer/JV-deal count,
  // execute an actual count=exact query against Supabase BEFORE generating the
  // answer. The true numbers are injected into context so the model answers from
  // real data, and `realQueryRan` is set so the query-narrative gate knows a real
  // query actually executed this turn (otherwise such narration is fabricated).
  let countReport: DbCountReport | null = null;
  let countGroundingBlock: string | null = null;
  const countTargets = detectCountIntent(input.message);
  if (countTargets.length > 0) {
    try {
      countReport = await runDbCounts(countTargets);
      countGroundingBlock = buildCountGroundingBlock(countReport);
      console.log('[PublicChatAI] Real DB count tool ran:', {
        sessionId: input.sessionId,
        targets: countTargets,
        anyExecuted: countReport.anyExecuted,
        anyOk: countReport.anyOk,
        results: countReport.results.map((r) => ({ target: r.target, ok: r.ok, count: r.count, reason: r.reason })),
      });
    } catch (countError) {
      console.log('[PublicChatAI] DB count tool skipped:', countError instanceof Error ? countError.message : 'unknown');
    }
  }
  const realQueryRan = countReport?.anyExecuted ?? false;

  const gateAnswer = async (result: PublicChatAnswerResult): Promise<PublicChatAnswerResult> => {
    let hasRealDeliverable = false;
    try {
      hasRealDeliverable = await conversationHasRealDeliverable(input.sessionId);
    } catch (gateError) {
      console.log('[PublicChatAI] Deliverable check skipped:', gateError instanceof Error ? gateError.message : 'unknown');
    }

    // QUERY-NARRATIVE GATE — block fabricated "I'm running these queries now"
    // narration when no real query executed this turn.
    const queryViolations = scanForUnbackedQueryNarrative(result.answer, realQueryRan);
    if (queryViolations.length > 0) {
      console.log('[PublicChatAI] Query-narrative gate blocked fabricated query narration:', {
        sessionId: input.sessionId,
        violations: queryViolations.map((v) => v.rule),
        realQueryRan,
      });
      return { ...result, answer: buildNoLiveQueryMessage() };
    }

    const gate = applyReportEvidenceGate({ answer: result.answer, hasRealDeliverable });
    if (gate.gated) {
      console.log('[PublicChatAI] Report Evidence Gate blocked a fake-completion claim:', {
        sessionId: input.sessionId,
        violations: gate.violations,
        hasRealDeliverable,
      });
      return { ...result, answer: gate.answer };
    }

    // ── Unified IVX IA Gate Pipeline (Stabilization Sprint) ────────────────
    // The unified gate pipeline (fake-execution, senior-developer narrative,
    // access-status narrative, reliability) is designed for DEVELOPER and
    // OWNER-EXECUTION requests where success claims about code/deploy/test
    // must carry proof evidence. Running it on general_ai investor answers
    // causes false-positive BLOCKED rewrites: normal words like "verified"
    // (in KYC/registration context) or "completed" (in onboarding steps)
    // trip the reliability gate's success-assertion patterns and replace the
    // answer with "STATE: BLOCKED — MISSING EVIDENCE: Commit SHA, Render
    // Deploy ID". This was confirmed live: "What are the steps to become a
    // member?" and "How long does verification take?" were both blocked.
    //
    // Fix: only run the developer-evidence gate pipeline on branches that
    // actually involve execution/developer/owner claims. The general_ai
    // branch (normal investor questions) is still protected by the
    // query-narrative gate and report-evidence gate above.
    // The unified gate pipeline (fake-execution, reliability gates) is designed
    // for DEVELOPER and OWNER-EXECUTION requests. Running it on general AI /
    // business analysis / conversation answers causes false-positive BLOCKED
    // rewrites. Skip the gate pipeline when:
    //   1. The legacy router classifies this as general_ai, OR
    //   2. The authoritative router approved this as PUBLIC_LLM_RESPONSE, OR
    //   3. This is a vague execution request routed to the LLM for diagnostics
    // This prevents business judgment questions (A/B test rollouts, strategy
    // confirmations) from being rewritten to "STATE: BLOCKED" by the
    // fake-execution gate.
    const isGeneralAiBranch = routeDecision.branch === 'general_ai';
    const skipGatePipeline = isGeneralAiBranch || authoritativeApproved;
    if (!skipGatePipeline) {
      const pipeline = runIVXUnifiedGatePipeline({
        message: input.message,
        answer: result.answer,
        ownerSessionPresent,
        proof: developerProof,
      });
      if (pipeline.gated) {
        console.log('[PublicChatAI] Unified IVX IA gate pipeline intervened:', {
          sessionId: input.sessionId,
          pipelineMarker: IVX_UNIFIED_GATE_PIPELINE_MARKER,
          ...describeIVXGatePipelineRun(pipeline),
        });
        return { ...result, answer: pipeline.answer };
      }
    }
    return result;
  };

  // BLOCK 2 — load full IVX business context automatically for EVERY conversation
  // (projects, deal data, company, landing page, owner) so questions like
  // "What is Casa Rosario?" are answered from real business data without a
  // manual lookup. Never blocks the reply if the project read fails.
  // BLOCK 4 — alongside business context, compute the deal-intelligence block
  // (scores, ranking, recommendations, risks) so analytical questions answer
  // from one consistent set of numbers.
  let businessContext: string | null = null;
  try {
    const context = await loadBusinessContext();
    const baseBlock = buildBusinessContextBlock(context);
    const dealIntel = buildDealIntelligenceBlock(context.projects);
    businessContext = dealIntel ? `${baseBlock}\n\n${dealIntel}` : baseBlock;
    console.log('[PublicChatAI] Business context loaded:', {
      projectsOk: context.projects.ok,
      publishedCount: context.projects.publishedCount,
      dealIntelligence: dealIntel !== null,
      missingEnv: context.projects.missingEnv,
      company: context.company.name,
      landing: context.landing.url,
      ownerKnown: context.owner.email !== null,
    });
  } catch (contextError) {
    console.log('[PublicChatAI] Business context skipped:', contextError instanceof Error ? contextError.message : 'unknown');
  }

  // BLOCK 5 — read the attached deal-room documents server-side (PDF text layer,
  // CSV/TXT) so the analyst instructions operate on REAL figures instead of an
  // unreadable URL. Scanned/image-only PDFs are flagged honestly. Never blocks
  // the reply if extraction fails.
  let extractedDocuments: ExtractedDocument[] = [];
  if (documents.length > 0) {
    try {
      // Real OCR for scanned/image-only PDFs: the extractor calls back into the
      // vision model with the raw bytes when a PDF has no text layer.
      extractedDocuments = await extractDealDocumentsContent(documents, { ocrDocument: ocrDocumentBytes });
      console.log('[PublicChatAI] Deal documents extracted:', {
        total: extractedDocuments.length,
        readable: extractedDocuments.filter((doc) => doc.status === 'extracted').length,
        scanned: extractedDocuments.filter((doc) => doc.status === 'scanned').length,
        failed: extractedDocuments.filter((doc) => doc.status === 'failed').length,
        hasReadable: hasReadableExtractedContent(extractedDocuments),
      });
    } catch (extractionError) {
      console.log('[PublicChatAI] Document extraction skipped:', extractionError instanceof Error ? extractionError.message : 'unknown');
    }
  }

  // Real video reading: hand each attached video to a video-capable model and
  // ground the answer on what it actually shows. Never blocks the reply.
  let videoUnderstandings: VideoUnderstanding[] = [];
  if (videos.length > 0) {
    try {
      videoUnderstandings = await understandVideos(videos);
      console.log('[PublicChatAI] Videos analyzed:', {
        total: videoUnderstandings.length,
        understood: videoUnderstandings.filter((video) => video.status === 'understood').length,
        failed: videoUnderstandings.filter((video) => video.status === 'failed').length,
      });
    } catch (videoError) {
      console.log('[PublicChatAI] Video understanding skipped:', videoError instanceof Error ? videoError.message : 'unknown');
    }
  }

  try {
    if (isPublicChatAIConfigured()) {
      const result = await requestIVXAIAnswer({
        message: input.message,
        history,
        sessionId: input.sessionId,
        businessContext,
        images,
        documents,
        extractedDocuments,
        videoUnderstandings,
      });
      console.log('[PublicChatAI] IVX AI reply generated:', {
        model: result.model,
        endpoint: result.endpoint,
        historyCount: history.length,
        answerLength: result.answer.length,
        imageCount: result.imageCount,
        documentCount: documents.length,
        extractedDocumentCount: extractedDocuments.filter((doc) => doc.status === 'extracted').length,
      });
      return await gateAnswer(result);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'unknown';
    const errName = error instanceof Error ? error.name : 'unknown';
    console.log('[PublicChatAI] IVX AI request failed, falling back:', errMsg);
    // Temporary debug: surface sanitized error info for diagnosis
    (globalThis as Record<string, unknown>).__ivxLastChatError = { message: errMsg.slice(0, 200), name: errName };
  }

  // Verification / confirmation requests must never leak an empty fallback.
  // When the AI request fails and the prompt is a verification challenge (e.g.
  // "Did you actually do this?"), the chat cannot attest completion on its own —
  // only the Developer Proof Ledger can. Run the unified gate pipeline on the
  // fallback answer so it resolves to UNVERIFIED with the strict routing message
  // instead of an empty "" reply. (Fake-execution / confession markers in a
  // non-empty fallback are already caught by gateAnswer below.)
  const fallbackAnswer = images.length > 0 ? buildImageFallbackAnswer() : buildFallbackAnswer(input.message);
  const fallbackResult = await gateAnswer({
    answer: fallbackAnswer,
    model: isPublicChatAIConfigured() ? getPublicChatModel() : 'ivx-local-fallback',
    source: 'fallback',
    endpoint: getGatewayModelEndpoint(),
    imageCount: images.length,
  });
  // gateAnswer may produce the strict UNVERIFIED/BLOCKED template for a
  // verification request even when the fallback answer is empty — that is the
  // correct behavior. If the gated answer is empty (no verification, no fake
  // claims, just a normal-question fallback that happened to be empty), fall
  // back to the original fallback answer so the user always sees a reply.
  if (!fallbackResult.answer || fallbackResult.answer.trim().length === 0) {
    return { ...fallbackResult, answer: fallbackAnswer };
  }
  return fallbackResult;
}

export function buildPublicChatTranscript(history: PublicChatHistoryItem[]): string {
  return buildTranscript(sanitizePublicChatHistory(history));
}
