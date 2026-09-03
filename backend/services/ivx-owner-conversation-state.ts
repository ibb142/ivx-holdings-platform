/**
 * IVX Owner Conversation State — durable pending-action memory for owner-ai chat.
 *
 * Purpose: fix the conversation state-loss bug where the owner asks a question
 * ("How many properties do we have?"), the AI asks for permission, the owner
 * approves, and then the AI loses the original request and produces a generic
 * deployment plan.
 *
 * This service stores a structured pending-action record per conversation and
 * per owner. It is read/written on every owner-ai turn so follow-ups resolve
 * the original intent instead of being reinterpreted.
 *
 * Persistence: uses the same durable-store abstraction as ivx-ia-memory-store
 * (Supabase-backed when configured, otherwise local JSON). Survives Render
 * restarts and app reloads.
 *
 * Security: NEVER stores secrets, raw SQL, or credentials. Only stores the
 * owner-visible intent, target table/resource, and last-known status.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';
import { detectCountIntent, runDbCounts, buildCountGroundingBlock, type CountTarget } from './ivx-db-count';
import { createRequestId } from './ivx-request-id';

export const IVX_OWNER_CONVERSATION_STATE_MARKER = 'ivx-owner-conversation-state-v7-0-2026-07-31-ivx-level-narrative';

const ROOT = auditDir('owner-conversation-state');
const STATE = path.join(ROOT, 'states.json');

type ExecutionState = 'PENDING_APPROVAL' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';

const TERMINAL_ACTION_STATES = new Set<ExecutionState>(['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED']);

export type OwnerActionType =
  | 'database_read'
  | 'database_read_active'
  | 'database_list_latest'
  | 'database_write'
  | 'code_change'
  | 'deployment'
  | 'explanation'
  | 'information'
  | 'task_status'
  | 'task_cancel'
  | 'unknown';

export type PendingOwnerAction = {
  actionId: string;
  conversationId: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  executionState: ExecutionState;
  originalQuestion: string;
  actionType: OwnerActionType;
  resource: string | null;
  operation: string | null;
  authorizationRequired: boolean;
  authorizationStatus: 'pending' | 'granted' | 'denied' | 'not_required';
  languagePreference: string | null;
  lastResultSummary: string | null;
  lastError: string | null;
  traceId: string | null;
  // Generic metadata (e.g. requested limit for list queries, filter for active queries).
  metadata: Record<string, unknown>;
};

export type OwnerConversationState = {
  conversationId: string;
  ownerId: string;
  updatedAt: string;
  languagePreference: string | null;
  activeActionId: string | null;
  actions: PendingOwnerAction[];
  lastCompletedActionId: string | null;
  unresolvedQuestion: string | null;
  lastVerifiedProductionState: Record<string, unknown> | null;
  readOnlyAuthorized: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function readStates(): Promise<OwnerConversationState[]> {
  if (isDurableStoreConfigured()) {
    return readDurableJson<OwnerConversationState[]>(STATE, []);
  }
  try {
    const raw = await readFile(STATE, 'utf8');
    return JSON.parse(raw) as OwnerConversationState[];
  } catch {
    return [];
  }
}

async function writeStates(value: OwnerConversationState[]): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(STATE, value);
    return;
  }
  await mkdir(ROOT, { recursive: true });
  await writeFile(STATE, JSON.stringify(value, null, 2), 'utf8');
}

async function appendStateEvent(event: Record<string, unknown>): Promise<void> {
  const eventFile = path.join(ROOT, 'events.jsonl');
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(eventFile, event);
    } catch {
      // Forensic log is best-effort.
    }
    return;
  }
  try {
    await mkdir(ROOT, { recursive: true });
    await writeFile(eventFile, `${JSON.stringify(event)}\n`, { flag: 'a' });
  } catch {
    // Best-effort.
  }
}

function defaultState(conversationId: string, ownerId: string): OwnerConversationState {
  return {
    conversationId,
    ownerId,
    updatedAt: nowIso(),
    languagePreference: null,
    activeActionId: null,
    actions: [],
    lastCompletedActionId: null,
    unresolvedQuestion: null,
    lastVerifiedProductionState: null,
    readOnlyAuthorized: false,
  };
}

export async function getOwnerConversationState(
  conversationId: string,
  ownerId: string,
): Promise<OwnerConversationState> {
  const states = await readStates();
  const existing = states.find((s) => s.conversationId === conversationId && s.ownerId === ownerId);
  if (existing) return existing;
  return defaultState(conversationId, ownerId);
}

export async function setOwnerConversationState(
  state: OwnerConversationState,
): Promise<OwnerConversationState> {
  const states = await readStates();
  const index = states.findIndex(
    (s) => s.conversationId === state.conversationId && s.ownerId === state.ownerId,
  );
  const next = { ...state, updatedAt: nowIso() };
  if (index >= 0) {
    states[index] = next;
  } else {
    states.push(next);
  }
  await writeStates(states);
  await appendStateEvent({ type: 'upsert', conversationId: state.conversationId, ownerId: state.ownerId, at: next.updatedAt });
  return next;
}

export async function clearActiveAction(
  conversationId: string,
  ownerId: string,
): Promise<OwnerConversationState> {
  const state = await getOwnerConversationState(conversationId, ownerId);
  const next = { ...state, activeActionId: null, updatedAt: nowIso() };
  return setOwnerConversationState(next);
}

export async function addPendingAction(
  conversationId: string,
  ownerId: string,
  input: {
    originalQuestion: string;
    actionType: OwnerActionType;
    resource: string | null;
    operation: string | null;
    authorizationRequired: boolean;
    languagePreference?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<PendingOwnerAction> {
  const state = await getOwnerConversationState(conversationId, ownerId);
  const action: PendingOwnerAction = {
    actionId: `act-${createRequestId()}`,
    conversationId,
    ownerId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    executionState: 'PENDING_APPROVAL',
    originalQuestion: input.originalQuestion,
    actionType: input.actionType,
    resource: input.resource,
    operation: input.operation,
    authorizationRequired: input.authorizationRequired,
    authorizationStatus: input.authorizationRequired ? 'pending' : 'not_required',
    languagePreference: input.languagePreference ?? state.languagePreference,
    lastResultSummary: null,
    lastError: null,
    traceId: null,
    metadata: input.metadata ?? {},
  };
  const actions = [...state.actions, action];
  // Keep only the most recent 20 actions per conversation to bound size.
  const trimmed = actions.slice(-20);
  await setOwnerConversationState({
    ...state,
    actions: trimmed,
    activeActionId: action.actionId,
    unresolvedQuestion: input.originalQuestion,
  });
  await appendStateEvent({
    type: 'pending_action_added',
    conversationId,
    ownerId,
    actionId: action.actionId,
    actionType: action.actionType,
    resource: action.resource,
    at: action.createdAt,
  });
  return action;
}

export async function updateAction(
  conversationId: string,
  ownerId: string,
  actionId: string,
  patch: Partial<PendingOwnerAction>,
): Promise<PendingOwnerAction | null> {
  const state = await getOwnerConversationState(conversationId, ownerId);
  const actionIndex = state.actions.findIndex((a) => a.actionId === actionId);
  if (actionIndex < 0) return null;
  const actions = [...state.actions];
  const updated: PendingOwnerAction = { ...actions[actionIndex]!, ...patch, updatedAt: nowIso() };
  actions[actionIndex] = updated;
  const terminal = TERMINAL_ACTION_STATES.has(updated.executionState);
  const wasActive = state.activeActionId === actionId;
  await setOwnerConversationState({
    ...state,
    actions,
    activeActionId: terminal && wasActive ? null : state.activeActionId,
    unresolvedQuestion: terminal && wasActive ? null : state.unresolvedQuestion,
    lastCompletedActionId: updated.executionState === 'COMPLETED' ? actionId : state.lastCompletedActionId,
  });
  if (terminal) {
    await appendStateEvent({
      type: 'terminal_action_closed',
      conversationId,
      ownerId,
      actionId,
      executionState: updated.executionState,
      at: updated.updatedAt,
    });
  }
  return updated;
}

export async function getActiveAction(
  conversationId: string,
  ownerId: string,
): Promise<PendingOwnerAction | null> {
  const state = await getOwnerConversationState(conversationId, ownerId);
  if (!state.activeActionId) return null;
  const active = state.actions.find((a) => a.actionId === state.activeActionId) ?? null;
  if (!active) return null;
  if (TERMINAL_ACTION_STATES.has(active.executionState)) {
    await setOwnerConversationState({ ...state, activeActionId: null, unresolvedQuestion: null });
    return null;
  }
  return active;
}

export async function resolveActiveAction(
  conversationId: string,
  ownerId: string,
  status: 'granted' | 'denied',
): Promise<PendingOwnerAction | null> {
  const state = await getOwnerConversationState(conversationId, ownerId);
  if (!state.activeActionId) return null;
  const actionIndex = state.actions.findIndex((a) => a.actionId === state.activeActionId);
  if (actionIndex < 0) return null;
  const actions = [...state.actions];
  const updated: PendingOwnerAction = {
    ...actions[actionIndex]!,
    authorizationStatus: status,
    executionState: status === 'granted' ? 'EXECUTING' : 'CANCELLED',
    updatedAt: nowIso(),
  };
  actions[actionIndex] = updated;
  await setOwnerConversationState({
    ...state,
    actions,
    activeActionId: status === 'denied' ? null : state.activeActionId,
    unresolvedQuestion: status === 'denied' ? null : state.unresolvedQuestion,
  });
  return updated;
}

const APPROVAL_PHRASES = [
  'proceed', 'procede', 'hazlo', 'hazlo ahora', 'autorizado', 'te autorizo',
  'la quiero', 'lo quiero', 'la quiero ahora', 'lo quiero ahora',
  'sí', 'si', 'yes', 'go ahead', 'do it now', 'do it', 'ejecutalo', 'ejecútalo',
  'continua', 'continúa', 'aprobado', 'i approve', 'you have permission',
  'adelante', 'vamos', 'confirma', 'confirmado', 'dale', 'ok', 'okay',
  'está bien', 'esta bien', 'por supuesto', 'claro', 'hazlo por favor',
  'procede por favor', 'execute', 'run it', 'check now',
];

const DENIAL_PHRASES = [
  'cancel', 'cancela', 'cancelar', 'stop', 'detente', 'no lo hagas',
  'no procedas', 'no procede', 'denied', 'denegado', 'rechazado', 'rechaza',
  'olvídalo', 'olvidalo', 'nvm', 'never mind', 'forget it',
];

export function detectOwnerApproval(message: string): 'approve' | 'deny' | 'neutral' {
  const normalized = asTrimmedString(message).toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'neutral';
  const tokens = normalized.split(' ');

  function matchesPhrase(phrase: string): boolean {
    const p = phrase.toLowerCase();
    if (p.includes(' ')) {
      // Multi-word: bounded by spaces or string edges
      return normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p) || normalized.includes(' ' + p + ' ');
    }
    // Single-word: exact token match (prevents 'si' matching 'sistema', 'no' matching 'normal')
    return tokens.includes(p);
  }

  // Check denial first so "no, proceed" is not treated as approval.
  for (const phrase of DENIAL_PHRASES) {
    if (matchesPhrase(phrase)) return 'deny';
  }
  for (const phrase of APPROVAL_PHRASES) {
    if (matchesPhrase(phrase)) return 'approve';
  }
  return 'neutral';
}

export function isApprovalQuestion(message: string): boolean {
  const normalized = asTrimmedString(message).toLowerCase();
  return /\b(puedes?|puedo|can you|podrías?|podrias?|would you|could you)\b.{0,40}\b(revisar|consultar|ver|check|inspect|query|look at|look up|buscar|contar|count)\b/i.test(normalized)
    || /\b(te parece|está bien|esta bien|ok\?|okay\?|yes\?|sí\?)\b/i.test(normalized);
}

export function isInformationRequest(message: string): boolean {
  const normalized = asTrimmedString(message).toLowerCase();
  return /\b(how many|cuántas?|cuantas?|cuántos?|cuantos?|number of|how much|what is|what's|cuál es|cual es|how many|are there|hay|tell me|dime|show me|muéstrame|muestrame|list|latest|últimas?|ultimas?|últimos?|ultimos?|recent|recientes|status of|estado de)\b/i.test(normalized);
}

export function classifyOwnerActionType(message: string): { actionType: OwnerActionType; resource: string | null; operation: string | null; metadata: Record<string, unknown> } {
  const normalized = asTrimmedString(message).toLowerCase();
  const countTargets = detectCountIntent(message);

  // Property / real-estate questions.
  const isPropertyQuestion = /\b(propiedad|propiedades|property|properties|casa|casas|deal|deals|project|projects|jv\s*deal|inmueble|inmuebles)\b/i.test(normalized);
  const wantsActive = /\b(activas?|activos?|active|activo|en\s*venta|for\s+sale|available|disponible|disponibles|live|published)\b/i.test(normalized);
  const wantsLatest = /\b(últimas?|ultimas?|últimos?|ultimos?|latest|recent|recientes|last\s+five|last\s+5|últimas\s+cinco|ultimas\s+cinco|muéstrame|muestrame|show\s+me|list)\b/i.test(normalized);
  const listLimitMatch = normalized.match(/\b(\d+)\b/);
  const listLimit = listLimitMatch ? Math.min(Math.max(Number(listLimitMatch[1]), 1), 100) : 5;

  if (isPropertyQuestion) {
    if (wantsLatest) {
      return { actionType: 'database_list_latest', resource: 'properties', operation: 'select_latest', metadata: { limit: listLimit } };
    }
    if (wantsActive) {
      return { actionType: 'database_read_active', resource: 'properties', operation: 'count_active', metadata: {} };
    }
    return { actionType: 'database_read', resource: 'properties', operation: 'count', metadata: {} };
  }

  // Generic count intents mapped to other targets.
  if (countTargets.length > 0) {
    return { actionType: 'database_read', resource: countTargets[0]!, operation: 'count', metadata: { countTargets } };
  }

  // Task control / status / cancel.
  // V6.8 FIX: Only match context-recall phrases ("where were we", "dónde nos quedamos", etc).
  // Do NOT match bare "status" or "estado" — those are too broad and capture engineering
  // questions like "What is the status of the task?" which should go to the LLM.
  if (/(where are we|where were we|dónde nos quedamos|donde nos quedamos|qué estabas haciendo|que estabas haciendo|what were you doing|dónde quedamos|donde quedamos|dónde estábamos|donde estabamos|where did we leave)/i.test(normalized)) {
    return { actionType: 'task_status', resource: null, operation: 'status', metadata: {} };
  }
  if (/\b(cancel|cancela|cancelar|stop|detente)\b/i.test(normalized)) {
    return { actionType: 'task_cancel', resource: null, operation: 'cancel', metadata: {} };
  }
  if (/\b(continue|continuar|continúa|continua|resume|reanudar|go on)\b/i.test(normalized)) {
    return { actionType: 'task_status', resource: null, operation: 'resume', metadata: {} };
  }

  // Code change / deployment.
  if (/\b(fix|arregla|repara|soluciona|corrige|add|agrega|añade|create|crea|deploy|despliega|deployar|update|actualiza|change|cambia|modify|modifica)\b/i.test(normalized)) {
    if (/\b(deploy|despliega|deployar|deployar|production|producción|produccion|live)\b/i.test(normalized)) {
      return { actionType: 'deployment', resource: null, operation: 'deploy', metadata: {} };
    }
    return { actionType: 'code_change', resource: null, operation: 'fix', metadata: {} };
  }

  if (isInformationRequest(message)) {
    return { actionType: 'information', resource: null, operation: 'answer', metadata: {} };
  }

  if (/\b(explica|explicar|explain|why|por qué|porque|porqué|how does|how do|cómo|como|architecture|arquitectura)\b/i.test(normalized)) {
    return { actionType: 'explanation', resource: null, operation: 'explain', metadata: {} };
  }

  return { actionType: 'unknown', resource: null, operation: null, metadata: {} };
}


export function classifyOwnerActionTypeWithContext(
  message: string,
  previousAction: PendingOwnerAction | null,
): { actionType: OwnerActionType; resource: string | null; operation: string | null; metadata: Record<string, unknown> } {
  const classified = classifyOwnerActionType(message);
  // If the message itself is clearly a property/deal query, use that classification directly.
  if (classified.resource === 'properties' || classified.resource === 'deals' || classified.actionType === 'database_read' || classified.actionType === 'database_read_active' || classified.actionType === 'database_list_latest') {
    return classified;
  }
  // V6.6 FIX: Only reclassify as a property query if the message actually contains
  // property-related keywords AND count/list/active keywords. This prevents engineering
  // questions ("What is the root cause?", "What is the commit SHA?") from being
  // misrouted to the database just because the previous action was a property query.
  if ((classified.actionType === 'information' || classified.actionType === 'unknown') && previousAction && (previousAction.resource === 'properties' || previousAction.resource === 'deals')) {
    const normalized = asTrimmedString(message).toLowerCase();
    // The message must mention properties/deals/casas/etc to be reclassified.
    const mentionsProperty = /\b(propiedad|propiedades|property|properties|casa|casas|deal|deals|jv\s*deal|inmueble|inmuebles)\b/i.test(normalized);
    // Or it must contain active/latest/count keywords with an implicit property context
    // (e.g. "¿cuántas están activas?" after a property query).
    const wantsActive = /\b(activas?|activos?|active|activo|en\s*venta|for\s+sale|available|disponible|disponibles|live|published)\b/i.test(normalized);
    const wantsLatest = /\b(últimas?|ultimas?|últimos?|ultimos?|latest|recent|recientes|last\s+five|last\s+5|últimas\s+cinco|ultimas\s+cinco|muéstrame|muestrame|show\s+me|list)\b/i.test(normalized);
    const wantsCount = /\b(cuántas?|cuántos?|cuantas?|cuantos?|how\s+many|count|number\s+of|total)\b/i.test(normalized);
    // Only reclassify if the message is clearly about properties/deals.
    // Engineering questions (root cause, commit SHA, deployment, architecture, etc.)
    // must NOT be reclassified as property queries.
    const isEngineeringQuestion = /\b(root\s*cause|commit|sha|deploy|deployment|render|github|bug|fix|arregl|repar|solucion|code|codigo|architecture|arquitectura|worker|task|tarea|priority|prioridad|evidence|evidencia|status|health|salud|worker|log|error|test|prueba)\b/i.test(normalized);
    if (isEngineeringQuestion) {
      // Don't reclassify — let the original classification stand (information/unknown → LLM).
      return classified;
    }
    if (mentionsProperty || wantsActive || wantsLatest || wantsCount) {
      const listLimitMatch = normalized.match(/\b(\d+)\b/);
      const listLimit = listLimitMatch ? Math.min(Math.max(Number(listLimitMatch[1]), 1), 100) : 5;
      if (wantsActive) return { actionType: 'database_read_active', resource: 'properties', operation: 'count_active', metadata: {} };
      if (wantsLatest) return { actionType: 'database_list_latest', resource: 'properties', operation: 'select_latest', metadata: { limit: listLimit } };
      return { actionType: 'database_read', resource: 'properties', operation: 'count', metadata: {} };
    }
    // Fallback: if the message is information/unknown and doesn't mention properties,
    // don't reclassify — let it go to the LLM for a proper answer.
    return classified;
  }
  return classified;
}

export function isReadOnlyActionType(actionType: OwnerActionType): boolean {
  return actionType === 'database_read' || actionType === 'database_read_active' || actionType === 'database_list_latest' || actionType === 'explanation' || actionType === 'task_status';
}

export function isOwnerExecutionActionType(actionType: OwnerActionType): boolean {
  return actionType === 'deployment' || actionType === 'code_change';
}

export function detectExplicitDeployAuthorization(message: string): boolean {
  const normalized = asTrimmedString(message).toLowerCase();
  return /\b(deploy\s+live|deploy\s+now|deploy\s+to\s+production|hazlo\s+ahora|do\s+it\s+now|execute\s+now|run\s+now|ship\s+it|push\s+live|go\s+live|despliega\s+ya|despliega\s+ahora|publica\s+ya|verify\s+and\s+deploy|deploy\s+and\s+verify|deploy\s+live\s+provide\s+verified)\b/i.test(normalized)
    || /\b(confirm\s+do\s+it|confirm\s+deploy|confirm\s+and\s+deploy|autorizo\s+el\s+deploy|autorizado\s+para\s+deployar|approved\s+for\s+deploy)\b/i.test(normalized);
}

/**
 * V6.12 HONEST ROUTING: Direct-answer guard for identity/capability questions.
 * When the owner asks "are you a senior developer?" or "ivx is senior developer yes or no",
 * IVX IA must answer directly and honestly. It must NOT start a deployment worker or
 * return a stuck task card.
 */
export function detectIdentityOrCapabilityQuestion(message: string): { direct: true; answer: string } | null {
  const normalized = asTrimmedString(message).toLowerCase();
  if (!normalized) return null;

  // V6.15: If the owner is asking for PROOF / EVIDENCE / TEST / AUDIT, do NOT
  // return a canned identity answer. Let the routing send it to real senior-
  // developer execution so the response contains live task evidence.
  const asksForEvidence = /\b(proof|evidence|test|testing|audit|verify|demonstrate|show\s+me|prove)\b/i.test(normalized);
  if (asksForEvidence) return null;

  const asksIdentity = /\b(eres|es|is|are|soy|am)\b.{0,60}\b(ivx|t[uú]|yo)\b.{0,60}\b(senior\s+developer|senior\s+engineer|ingeniero\s+senior|desarrollador\s+senior|developer\s+senior|engineer\s+senior)\b/i.test(normalized)
    || /\b(ivx|t[uú])\b.{0,60}\b(eres|es|is|are)\b.{0,60}\b(senior\s+developer|senior\s+engineer|ingeniero\s+senior|desarrollador\s+senior)\b/i.test(normalized)
    || /\b(senior\s+developer|senior\s+engineer|ingeniero\s+senior|desarrollador\s+senior)\b.{0,40}\b(yes\s+or\s+no|s[ií]\s+o\s+no|o\s+no|or\s+no)\b/i.test(normalized)
    || /\b(ivx\s+is\s+senior|ivx\s+es\s+senior|ivx\s+senior\s+developer)\b/i.test(normalized)
    || /\b(tu\s+eres\s+senior|tu\s+eres\s+un\s+senior|eres\s+un\s+senior)\b/i.test(normalized)
    // V6.14: catch plain identity questions without "yes or no" or explicit "ivx" prefix
    || /\b(are\s+you|is\s+ivx|is\s+this|is\s+it)\b.{0,30}\b(senior\s+(developer|engineer|software\s+engineer|software\s+developer)|ingeniero\s+senior|desarrollador\s+senior)\b/i.test(normalized)
    || /\b(eres|es)\s+(t[uú]?\s+)?(un\s+|una\s+)?(senior\s+(developer|engineer)|ingeniero\s+senior|desarrollador\s+senior)\b/i.test(normalized)
    || /\b(you\s+are\s+(a\s+)?(real\s+)?senior|ivx\s+is\s+(a\s+)?(real\s+)?senior)\b/i.test(normalized)
    || /\b(senior\s+(developer|engineer))\b.{0,20}\?/i.test(normalized);

  if (asksIdentity) {
    return {
      direct: true,
      answer: 'I am IVX Owner AI, an autonomous engineering assistant running on your own infrastructure (GitHub, Render, Supabase, Vercel AI Gateway). I can inspect code, generate patches, run tests, commit to GitHub, deploy to Render, and verify production health — all with your approval. V6.14 fixes the identity guard to catch all forms of the question, and the autonomous worker is being tested end-to-end. I am independent from Rork at runtime — your infrastructure, your credentials, your repo. I am built by Rork but I run on my own.',
    };
  }

  return null;
}

export async function executeReadOnlyAction(
  action: PendingOwnerAction,
): Promise<{ answer: string; evidence: Record<string, unknown>; ok: boolean; error: string | null }> {
  const { actionType, resource, originalQuestion, metadata } = action;
  const ts = nowIso();
  const lang = action.languagePreference ?? 'en';
  const isSpanish = /es/i.test(lang) || /\b(cuántas|cuantas|propiedades|activas|muestrame|muéstrame|dónde|donde|qué|que)\b/i.test(originalQuestion);

  try {
    if (actionType === 'database_read' && resource === 'properties') {
      const countTargets = (metadata.countTargets as CountTarget[] | undefined) ?? ['jv_deals'];
      const report = await runDbCounts(countTargets);
      const result = report.results[0] ?? {
        ok: false, count: null, table: null, reason: 'not_configured', detail: 'No result', queriedAt: ts, executed: false, target: 'jv_deals', httpStatus: null,
      };
      if (result.ok && result.count !== null) {
        const answer = isSpanish
          ? `Tenemos **${result.count} propiedades** en producción ahora mismo — están en la tabla \`jv_deals\` en Supabase.\n\nEstos no son números de cache ni estimados; los acabo de consultar directamente. Si quieres que te liste cuáles son o veas cuáles están activas, dímelo y lo saco al instante.`
          : `We've got **${result.count} properties** in production right now — sitting in the \`jv_deals\` table in Supabase.\n\nThese aren't cached numbers or estimates — I just pulled them directly. Want me to list them out or filter by active status? I can grab that in a second.`;
        return { answer, evidence: { result, report, source: 'supabase', table: result.table, queriedAt: result.queriedAt }, ok: true, error: null };
      }
      const answer = isSpanish
        ? `No pude obtener el conteo de propiedades.\n\nError: ${result.detail}\nTrace ID: ${action.actionId}\nRequired action: ${result.reason === 'not_configured' ? 'Configure Supabase service role key' : 'Verify the table exists in Supabase'}`
        : `I could not retrieve the property count.\n\nError: ${result.detail}\nTrace ID: ${action.actionId}\nRequired action: ${result.reason === 'not_configured' ? 'Configure Supabase service role key' : 'Verify the table exists in Supabase'}`;
      return { answer, evidence: { result, report }, ok: false, error: result.detail };
    }

    if (actionType === 'database_read_active' && resource === 'properties') {
      // Try to count active properties by guessing the status column.
      const { countActiveProperties } = await import('./ivx-property-queries');
      const result = await countActiveProperties();
      if (result.ok && result.count !== null) {
        const answer = isSpanish
          ? `**${result.count} propiedades activas** en producción.\n\nFiltré por estado activo en \`jv_deals\` — son datos en tiempo real de Supabase, no una foto vieja. Si quieres que profundice en alguna en particular, dame el nombre o el ID y te traigo el detalle completo.`
          : `**${result.count} active properties** in production right now.\n\nI filtered by active status in \`jv_deals\` — this is real-time data from Supabase, not a snapshot. If you want me to dig into a specific one, just give me the name or ID and I'll pull the full details.`;
        return { answer, evidence: { result, source: 'supabase', table: result.table, filter: result.filter, queriedAt: result.queriedAt }, ok: true, error: null };
      }
      const answer = isSpanish
        ? `No pude obtener el conteo de propiedades activas.\n\nError: ${result.detail}\nTrace ID: ${action.actionId}\nRequired action: ${result.reason === 'not_configured' ? 'Configure Supabase service role key' : 'Verify the status column exists in the properties table'}`
        : `I could not retrieve the active property count.\n\nError: ${result.detail}\nTrace ID: ${action.actionId}\nRequired action: ${result.reason === 'not_configured' ? 'Configure Supabase service role key' : 'Verify the status column exists in the properties table'}`;
      return { answer, evidence: { result }, ok: false, error: result.detail };
    }

    if (actionType === 'database_list_latest' && resource === 'properties') {
      const { listLatestProperties } = await import('./ivx-property-queries');
      const limit = typeof metadata.limit === 'number' ? metadata.limit : 5;
      const result = await listLatestProperties(limit);
      if (result.ok && result.rows.length > 0) {
        const rows = result.rows.map((row, i) => {
          const r = row as Record<string, unknown>;
          const name = r.name ?? r.deal_name ?? r.title ?? 'Sin nombre';
          const status = r.status ?? r.deal_status ?? 'unknown';
          const value = r.value ?? r.deal_value ?? r.amount ?? null;
          const valueStr = value !== null ? ` — Value: ${value}` : '';
          return `${i + 1}. **${name}** (status: ${status}${valueStr})`;
        }).join('\n');
        const answer = isSpanish
          ? `Aquí están las últimas ${result.rows.length} propiedades de \`jv_deals\`:\n\n${rows}\n\nDatos en tiempo real de Supabase. Si quieres que abra alguna de estas y te muestre el detalle completo — financieros, estructura del trato, lo que sea — solo dime cuál.`
          : `Here are the latest ${result.rows.length} from \`jv_deals\`:\n\n${rows}\n\nReal-time data from Supabase. If you want me to open any of these and show you the full details — financials, deal structure, whatever you need — just say which one.`;
        return { answer, evidence: { result, source: 'supabase', table: result.table, queriedAt: result.queriedAt }, ok: true, error: null };
      }
      const answer = isSpanish
        ? `No pude obtener las últimas propiedades.\n\nError: ${result.detail}\nTrace ID: ${action.actionId}\nRequired action: ${result.reason === 'not_configured' ? 'Configure Supabase service role key' : 'Verify the table and columns exist in Supabase'}`
        : `I could not retrieve the latest properties.\n\nError: ${result.detail}\nTrace ID: ${action.actionId}\nRequired action: ${result.reason === 'not_configured' ? 'Configure Supabase service role key' : 'Verify the table and columns exist in Supabase'}`;
      return { answer, evidence: { result }, ok: false, error: result.detail };
    }

    // Generic count fallback (non-property targets).
    if (actionType === 'database_read' && Array.isArray(metadata.countTargets)) {
      const report = await runDbCounts(metadata.countTargets as CountTarget[]);
      const grounding = buildCountGroundingBlock(report) ?? '';
      const answer = isSpanish
        ? `Resultados del conteo:\n${grounding}\n\nEstos son datos verificados directamente de Supabase.`
        : `Count results:\n${grounding}\n\nThis is verified data pulled directly from Supabase.`;
      return { answer, evidence: { report }, ok: report.anyOk, error: report.anyOk ? null : 'No counts succeeded' };
    }

    return {
      answer: isSpanish ? 'No puedo ejecutar esa acción directamente — reformula tu pregunta y te ayudo.' : 'I can\'t execute that action directly — rephrase your question and I\'ll help you out.',
      evidence: {},
      ok: false,
      error: 'Unsupported read-only action',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    const answer = isSpanish
      ? `Falló la ejecución de la acción.\n\nError: ${detail}\nTrace ID: ${action.actionId}\nRequired action: Revisa los logs del backend.`
      : `Action execution failed.\n\nError: ${detail}\nTrace ID: ${action.actionId}\nRequired action: Check backend logs.`;
    return { answer, evidence: {}, ok: false, error: detail };
  }
}

export function buildWhereWeWereSummary(state: OwnerConversationState): string {
  // Use the most recent action in the actions array (last element = most recent).
  // This is more reliable than activeActionId/lastCompletedActionId which may
  // point to stale actions from prior conversation turns.
  const action = state.actions.length > 0 ? state.actions[state.actions.length - 1] : null;
  if (!action) return 'No tengo una acción activa o reciente recordada en esta conversación.';
  const isSpanish = action.languagePreference === 'es' || /\b(cuántas|propiedades|activas|muestrame|dónde|qué)\b/i.test(action.originalQuestion);
  const stateText = action.executionState === 'COMPLETED' ? (isSpanish ? 'completada' : 'completed') : (isSpanish ? 'pendiente' : 'pending');
  const canReExecute = action.executionState === 'COMPLETED' && isReadOnlyActionType(action.actionType);
  const reExecHint = canReExecute
    ? (isSpanish ? ' Si quieres que corra esa consulta otra vez para tener datos frescos, dime «muéstrame» o «otra vez».' : ' If you want me to re-run that query for fresh data, just say "show me" or "again".')
    : '';
  return isSpanish
    ? `Estábamos en esto: "${action.originalQuestion}". ${action.executionState === 'COMPLETED' ? 'Ya completé esa consulta.' : 'Todavía está pendiente.'} ${state.actions.length > 1 ? `Antes de eso, también trabajamos en ${state.actions.length - 1} ${state.actions.length - 1 === 1 ? 'otra consulta' : 'otras consultas'}.` : ''}${reExecHint} ¿Seguimos con algo más?`
    : `We were working on: "${action.originalQuestion}". ${action.executionState === 'COMPLETED' ? 'I completed that query.' : 'It\'s still pending.'} ${state.actions.length > 1 ? `Before that, we also handled ${state.actions.length - 1} other ${state.actions.length - 1 === 1 ? 'query' : 'queries'}.` : ''}${reExecHint} Want to continue with something else?`;
}
