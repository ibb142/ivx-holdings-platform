import AsyncStorage from '@react-native-async-storage/async-storage';

export type IVXOwnerMemoryRole = 'owner' | 'assistant';
export type IVXProjectTaskStatus = 'pending' | 'in_progress' | 'done';

export type IVXOwnerMemoryMessage = {
  id: string;
  conversationId: string;
  role: IVXOwnerMemoryRole;
  text: string;
  createdAt: string;
};

export type IVXOwnerPreference = {
  id: string;
  text: string;
  source: 'owner' | 'inferred';
  updatedAt: string;
};

export type IVXProjectTask = {
  id: string;
  title: string;
  detail: string;
  status: IVXProjectTaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type IVXProjectPlan = {
  id: string;
  title: string;
  goal: string;
  tasks: IVXProjectTask[];
  updatedAt: string;
};

export type IVXProjectContext = {
  summary: string;
  goals: string[];
  constraints: string[];
  currentFocus: string | null;
  updatedAt: string;
};

export type IVXOwnerFileInsight = {
  id: string;
  conversationId?: string | null;
  name: string;
  mimeType: string | null;
  size: number | null;
  summary: string;
  excerpt: string | null;
  uploadedAt: string;
};

export type IVXOwnerMemoryState = {
  version: 1;
  ownerPreferences: IVXOwnerPreference[];
  projectContext: IVXProjectContext;
  projectPlan: IVXProjectPlan | null;
  recentMessages: IVXOwnerMemoryMessage[];
  uploadedFiles: IVXOwnerFileInsight[];
  updatedAt: string;
};

export type IVXOwnerLocalCommandName = 'project_plan' | 'next_task' | 'remember' | 'project_context' | 'memory_status';

export type IVXOwnerLocalCommandIntent = {
  command: IVXOwnerLocalCommandName;
  args: string;
};

export type IVXOwnerLocalCommandResult = {
  handled: true;
  command: IVXOwnerLocalCommandName;
  response: string;
};

export type IVXFileSummaryInput = {
  uri?: string | null;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  file?: {
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    name?: string;
    size?: number;
    type?: string;
  } | null;
};

const IVX_OWNER_MEMORY_STORAGE_KEY = 'ivx_owner_ai_memory_v1';
const MAX_RECENT_MESSAGES = 36;
const MAX_PREFERENCES = 18;
const MAX_FILES = 12;
const MAX_TEXT_FILE_BYTES = 180_000;
const MAX_FILE_EXCERPT_CHARS = 6000;

const SECRET_PATTERNS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /sbp_[A-Za-z0-9._-]{16,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/gi,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9._-]{12,}\b/g,
];

const MEMORY_PROMPT_REPLACEMENTS: readonly [RegExp, string][] = [
  [/\bivx\b/gi, 'external wrapper'],
  [/\bsupabase\b/gi, 'cloud database'],
  [/\bbackend\b/gi, 'cloud service'],
  [/\bruntime\b/gi, 'app flow'],
  [/\baudit\b/gi, 'review'],
  [/\bdeployment\b/gi, 'release'],
  [/\binfrastructure\b/gi, 'hosting layer'],
];

function nowIso(): string {
  return new Date().toISOString();
}

function createMemoryId(prefix: string): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return `${prefix}-${cryptoRef.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const redacted = SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, '[redacted]'), value);
  return redacted.replace(/\s+/g, ' ').trim();
}

function promptSafeText(value: string): string {
  return MEMORY_PROMPT_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value).trim();
}

function uniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(normalized);
    if (next.length >= limit) {
      break;
    }
  }

  return next;
}

function getDefaultProjectContext(): IVXProjectContext {
  return {
    summary: 'IVX mobile app with a local-first Owner AI room, real AI replies, local memory, project guidance, file understanding, safe confirmations, and optional cloud sync later.',
    goals: [
      'Complete the IVX app end-to-end from the local app flow first.',
      'Keep IVX Owner AI clean, business-focused, and useful for step-by-step building.',
      'Remember owner preferences, project direction, uploaded files, and next actions on this device.',
    ],
    constraints: [
      'Use local app flow first so progress is not blocked by cloud services.',
      'Ask for confirmation before any destructive or sensitive change.',
      'Keep user-facing replies clean and IVX-owned.',
    ],
    currentFocus: 'Add Owner AI memory, project planning, next-task guidance, file understanding, and safe action confirmations.',
    updatedAt: nowIso(),
  };
}

function getDefaultMemoryState(): IVXOwnerMemoryState {
  return {
    version: 1,
    ownerPreferences: [],
    projectContext: getDefaultProjectContext(),
    projectPlan: null,
    recentMessages: [],
    uploadedFiles: [],
    updatedAt: nowIso(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTask(value: unknown): IVXProjectTask | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeText(value.id) || createMemoryId('task');
  const title = normalizeText(value.title);
  const detail = normalizeText(value.detail);
  const statusValue = normalizeText(value.status);
  const status: IVXProjectTaskStatus = statusValue === 'in_progress' || statusValue === 'done' ? statusValue : 'pending';
  const createdAt = normalizeText(value.createdAt) || nowIso();
  const updatedAt = normalizeText(value.updatedAt) || createdAt;

  if (!title) {
    return null;
  }

  return { id, title, detail, status, createdAt, updatedAt };
}

function normalizeMemoryState(value: unknown): IVXOwnerMemoryState {
  const fallback = getDefaultMemoryState();
  if (!isRecord(value)) {
    return fallback;
  }

  const projectContextRecord = isRecord(value.projectContext) ? value.projectContext : null;
  const fallbackContext = getDefaultProjectContext();
  const projectContext: IVXProjectContext = {
    summary: normalizeText(projectContextRecord?.summary) || fallbackContext.summary,
    goals: uniqueStrings(Array.isArray(projectContextRecord?.goals) ? projectContextRecord.goals.map(String) : fallbackContext.goals, 8),
    constraints: uniqueStrings(Array.isArray(projectContextRecord?.constraints) ? projectContextRecord.constraints.map(String) : fallbackContext.constraints, 8),
    currentFocus: normalizeText(projectContextRecord?.currentFocus) || fallbackContext.currentFocus,
    updatedAt: normalizeText(projectContextRecord?.updatedAt) || fallbackContext.updatedAt,
  };

  const projectPlanRecord = isRecord(value.projectPlan) ? value.projectPlan : null;
  const projectPlanTasks = Array.isArray(projectPlanRecord?.tasks)
    ? projectPlanRecord.tasks.map(normalizeTask).filter((task): task is IVXProjectTask => task !== null)
    : [];
  const projectPlan: IVXProjectPlan | null = projectPlanRecord && projectPlanTasks.length > 0
    ? {
        id: normalizeText(projectPlanRecord.id) || createMemoryId('plan'),
        title: normalizeText(projectPlanRecord.title) || 'IVX project plan',
        goal: normalizeText(projectPlanRecord.goal) || projectContext.summary,
        tasks: projectPlanTasks,
        updatedAt: normalizeText(projectPlanRecord.updatedAt) || nowIso(),
      }
    : null;

  const ownerPreferences = Array.isArray(value.ownerPreferences)
    ? value.ownerPreferences
        .map((item): IVXOwnerPreference | null => {
          if (!isRecord(item)) {
            return null;
          }
          const text = normalizeText(item.text);
          if (!text) {
            return null;
          }
          return {
            id: normalizeText(item.id) || createMemoryId('pref'),
            text,
            source: item.source === 'inferred' ? 'inferred' : 'owner',
            updatedAt: normalizeText(item.updatedAt) || nowIso(),
          };
        })
        .filter((item): item is IVXOwnerPreference => item !== null)
        .slice(-MAX_PREFERENCES)
    : [];

  const recentMessages = Array.isArray(value.recentMessages)
    ? value.recentMessages
        .map((item): IVXOwnerMemoryMessage | null => {
          if (!isRecord(item)) {
            return null;
          }
          const text = normalizeText(item.text);
          const role = item.role === 'assistant' ? 'assistant' : 'owner';
          if (!text) {
            return null;
          }
          return {
            id: normalizeText(item.id) || createMemoryId('msg'),
            conversationId: normalizeText(item.conversationId) || 'ivx-owner-room',
            role,
            text,
            createdAt: normalizeText(item.createdAt) || nowIso(),
          };
        })
        .filter((item): item is IVXOwnerMemoryMessage => item !== null)
        .slice(-MAX_RECENT_MESSAGES)
    : [];

  const uploadedFiles = Array.isArray(value.uploadedFiles)
    ? value.uploadedFiles
        .map((item): IVXOwnerFileInsight | null => {
          if (!isRecord(item)) {
            return null;
          }
          const name = normalizeText(item.name);
          if (!name) {
            return null;
          }
          return {
            id: normalizeText(item.id) || createMemoryId('file'),
            conversationId: normalizeText(item.conversationId) || null,
            name,
            mimeType: normalizeText(item.mimeType) || null,
            size: typeof item.size === 'number' ? item.size : null,
            summary: normalizeText(item.summary) || `Uploaded file: ${name}`,
            excerpt: normalizeText(item.excerpt) || null,
            uploadedAt: normalizeText(item.uploadedAt) || nowIso(),
          };
        })
        .filter((item): item is IVXOwnerFileInsight => item !== null)
        .slice(-MAX_FILES)
    : [];

  return {
    version: 1,
    ownerPreferences,
    projectContext,
    projectPlan,
    recentMessages,
    uploadedFiles,
    updatedAt: normalizeText(value.updatedAt) || nowIso(),
  };
}

async function saveMemoryState(memory: IVXOwnerMemoryState): Promise<IVXOwnerMemoryState> {
  const normalized = normalizeMemoryState({ ...memory, updatedAt: nowIso() });
  await AsyncStorage.setItem(IVX_OWNER_MEMORY_STORAGE_KEY, JSON.stringify(normalized));
  console.log('[IVXOwnerMemory] Saved memory state:', {
    preferences: normalized.ownerPreferences.length,
    recentMessages: normalized.recentMessages.length,
    hasPlan: !!normalized.projectPlan,
    files: normalized.uploadedFiles.length,
  });
  return normalized;
}

function extractPreferenceFromMessage(text: string): string | null {
  const match = text.match(/(?:^|\b)(?:remember that|remember|preference:|my preference is|i prefer)\s+(.+)$/i);
  return normalizeText(match?.[1]).slice(0, 240) || null;
}

function inferProjectContextUpdate(text: string): Partial<IVXProjectContext> | null {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  if (!normalized) {
    return null;
  }

  if (lower.includes('ivx app') || lower.includes('owner ai') || lower.includes('project context') || lower.includes('local-first') || lower.includes('next phase')) {
    return {
      summary: 'IVX mobile app with local-first Owner AI, real AI replies, local memory, project planning, file understanding, safe confirmations, and optional cloud sync later.',
      currentFocus: normalized.slice(0, 260),
    };
  }

  return null;
}

function upsertPreference(memory: IVXOwnerMemoryState, text: string, source: IVXOwnerPreference['source']): IVXOwnerMemoryState {
  const normalized = normalizeText(text).slice(0, 260);
  if (!normalized) {
    return memory;
  }

  const key = normalized.toLowerCase();
  const existing = memory.ownerPreferences.filter((preference) => preference.text.toLowerCase() !== key);
  return {
    ...memory,
    ownerPreferences: [
      ...existing,
      {
        id: createMemoryId('pref'),
        text: normalized,
        source,
        updatedAt: nowIso(),
      },
    ].slice(-MAX_PREFERENCES),
    updatedAt: nowIso(),
  };
}

function mergeProjectContext(memory: IVXOwnerMemoryState, update: Partial<IVXProjectContext>): IVXOwnerMemoryState {
  const current = memory.projectContext;
  return {
    ...memory,
    projectContext: {
      ...current,
      summary: normalizeText(update.summary) || current.summary,
      goals: update.goals ? uniqueStrings([...update.goals, ...current.goals], 8) : current.goals,
      constraints: update.constraints ? uniqueStrings([...update.constraints, ...current.constraints], 8) : current.constraints,
      currentFocus: normalizeText(update.currentFocus) || current.currentFocus,
      updatedAt: nowIso(),
    },
    updatedAt: nowIso(),
  };
}

function buildDefaultPlan(goalInput: string | null): IVXProjectPlan {
  const createdAt = nowIso();
  const goal = normalizeText(goalInput) || 'Complete the IVX app end-to-end with Owner AI as the local-first project guide.';
  const taskSeeds: Array<{ title: string; detail: string }> = [
    {
      title: 'Lock the Owner AI room as the project command center',
      detail: 'Keep normal chat clean, fast, and useful while the owner builds IVX step by step.',
    },
    {
      title: 'Keep local memory active for every owner conversation',
      detail: 'Remember preferences, project context, recent decisions, and useful uploaded-file notes on this device.',
    },
    {
      title: 'Use project plan and next task commands daily',
      detail: 'Turn broad goals into a practical sequence, then guide the owner through one focused task at a time.',
    },
    {
      title: 'Understand uploaded files and convert them into build actions',
      detail: 'Summarize file purpose, extract readable text when safe, and suggest the next useful implementation step.',
    },
    {
      title: 'Protect sensitive or destructive actions with confirmation',
      detail: 'Ask for clear confirmation before deleting, resetting, clearing, replacing, or changing sensitive project data.',
    },
    {
      title: 'Finish core IVX screens and flows',
      detail: 'Prioritize owner room, inbox, project guidance, client-facing chat, diagnostics polish, and device testing.',
    },
    {
      title: 'Add optional cloud sync only after local progress is stable',
      detail: 'Keep local progress unblocked first, then connect shared sync when it improves the business workflow.',
    },
  ];

  return {
    id: createMemoryId('plan'),
    title: 'IVX end-to-end project plan',
    goal,
    tasks: taskSeeds.map((task, index) => ({
      id: createMemoryId(`task-${index + 1}`),
      title: task.title,
      detail: task.detail,
      status: index === 0 ? 'in_progress' : 'pending',
      createdAt,
      updatedAt: createdAt,
    })),
    updatedAt: createdAt,
  };
}

function formatProjectPlan(plan: IVXProjectPlan): string {
  const taskLines = plan.tasks.map((task, index) => {
    const marker = task.status === 'done' ? 'done' : task.status === 'in_progress' ? 'now' : 'next';
    return `${index + 1}. ${promptSafeText(task.title)} — ${marker}\n   ${promptSafeText(task.detail)}`;
  });

  return [`Project plan: ${promptSafeText(plan.goal)}`, ...taskLines, 'Say “next task” when you want the next focused action.'].join('\n');
}

function formatNextTask(plan: IVXProjectPlan): string {
  const activeTask = plan.tasks.find((task) => task.status === 'in_progress')
    ?? plan.tasks.find((task) => task.status === 'pending')
    ?? plan.tasks[plan.tasks.length - 1];

  if (!activeTask) {
    return 'Next task: your IVX plan is complete. Send the next goal and I’ll create the next sequence.';
  }

  return [
    `Next task: ${promptSafeText(activeTask.title)}`,
    promptSafeText(activeTask.detail),
    'Action: send me the exact screen, flow, file, or decision you want to work on first, and I’ll guide the next build step.',
  ].join('\n');
}

function getIntentArgs(trimmed: string, pattern: RegExp): string {
  return normalizeText(trimmed.replace(pattern, ''));
}

function isTextLikeFile(name: string, mimeType: string | null): boolean {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType?.toLowerCase() ?? '';
  return lowerMime.startsWith('text/')
    || lowerMime.includes('json')
    || lowerMime.includes('xml')
    || lowerMime.includes('javascript')
    || lowerName.endsWith('.txt')
    || lowerName.endsWith('.md')
    || lowerName.endsWith('.json')
    || lowerName.endsWith('.csv')
    || lowerName.endsWith('.ts')
    || lowerName.endsWith('.tsx')
    || lowerName.endsWith('.js')
    || lowerName.endsWith('.jsx')
    || lowerName.endsWith('.html')
    || lowerName.endsWith('.css');
}

function formatFileSize(size: number | null): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    return 'unknown size';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function readTextFileExcerpt(input: IVXFileSummaryInput): Promise<string | null> {
  const name = normalizeText(input.name);
  const mimeType = normalizeText(input.mimeType) || normalizeText(input.file?.type) || null;
  const size = typeof input.size === 'number' ? input.size : typeof input.file?.size === 'number' ? input.file.size : null;
  if (!isTextLikeFile(name, mimeType) || (typeof size === 'number' && size > MAX_TEXT_FILE_BYTES)) {
    return null;
  }

  try {
    if (input.file?.text) {
      return normalizeText(await input.file.text()).slice(0, MAX_FILE_EXCERPT_CHARS) || null;
    }

    if (input.file?.arrayBuffer) {
      const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
      if (decoder) {
        const buffer = await input.file.arrayBuffer();
        return normalizeText(decoder.decode(buffer)).slice(0, MAX_FILE_EXCERPT_CHARS) || null;
      }
    }

    if (input.uri) {
      const response = await fetch(input.uri);
      const text = await response.text();
      return normalizeText(text).slice(0, MAX_FILE_EXCERPT_CHARS) || null;
    }
  } catch (error) {
    console.log('[IVXOwnerMemory] File excerpt read skipped:', error instanceof Error ? error.message : 'unknown');
  }

  return null;
}

export function resolveIVXOwnerLocalCommandIntent(text: unknown): IVXOwnerLocalCommandIntent | null {
  const trimmed = normalizeText(text);
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/^\//, '').trim();
  const lower = normalized.toLowerCase();

  if (lower === 'project plan' || lower.startsWith('project plan ')) {
    return { command: 'project_plan', args: getIntentArgs(normalized, /^project\s+plan\s*/i) };
  }

  if (lower === 'plan' || lower.startsWith('plan ')) {
    return { command: 'project_plan', args: getIntentArgs(normalized, /^plan\s*/i) };
  }

  if (lower === 'next task' || lower.startsWith('next task ') || lower === 'next') {
    return { command: 'next_task', args: getIntentArgs(normalized, /^next(?:\s+task)?\s*/i) };
  }

  if (lower === 'remember' || lower.startsWith('remember ')) {
    return { command: 'remember', args: getIntentArgs(normalized, /^remember\s*/i) };
  }

  if (lower === 'project context' || lower.startsWith('project context ') || lower === 'context' || lower.startsWith('context ')) {
    return { command: 'project_context', args: getIntentArgs(normalized, /^(?:project\s+context|context)\s*/i) };
  }

  if (lower === 'memory' || lower === 'memory status' || lower === 'what do you remember') {
    return { command: 'memory_status', args: '' };
  }

  return null;
}

function getRelevantMemoryState(memory: IVXOwnerMemoryState, conversationId?: string | null, query?: string | null): IVXOwnerMemoryState {
  const roomId = normalizeText(conversationId);
  const queryTerms = uniqueStrings(normalizeText(query).toLowerCase().split(/\s+/g), 8);
  const roomMessages = roomId
    ? memory.recentMessages.filter((message) => message.conversationId === roomId)
    : memory.recentMessages;
  // Enterprise isolation: never inject messages from a different conversation into the active room.
  const globalMessages: IVXOwnerMemoryMessage[] = [];
  const scoreFile = (file: IVXOwnerFileInsight): number => {
    let score = file.conversationId && roomId && file.conversationId === roomId ? 10 : 0;
    const haystack = `${file.name} ${file.summary} ${file.excerpt ?? ''}`.toLowerCase();
    score += queryTerms.filter((term) => term.length >= 3 && haystack.includes(term)).length;
    return score;
  };
  const relevantFiles = [...memory.uploadedFiles]
    .sort((left, right) => scoreFile(right) - scoreFile(left) || new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime())
    .filter((file) => scoreFile(file) > 0 || !roomId || !file.conversationId)
    .slice(0, MAX_FILES);

  return {
    ...memory,
    recentMessages: [...globalMessages, ...roomMessages].slice(-MAX_RECENT_MESSAGES),
    uploadedFiles: relevantFiles,
  };
}

export function buildIVXOwnerMemoryPromptBlock(memory: IVXOwnerMemoryState, options?: { conversationId?: string | null; query?: string | null }): string {
  const relevantMemory = getRelevantMemoryState(memory, options?.conversationId, options?.query);
  const roomId = normalizeText(options?.conversationId);
  const preferences = relevantMemory.ownerPreferences.slice(-6).map((preference) => promptSafeText(preference.text));
  const roomRecent = relevantMemory.recentMessages
    .filter((message) => !roomId || message.conversationId === roomId)
    .slice(-8)
    .map((message) => `${message.role}: ${promptSafeText(message.text).slice(0, 220)}`);
  const globalRecent: string[] = [];
  const files = relevantMemory.uploadedFiles.slice(-4).map((file) => `${promptSafeText(file.name)}${file.conversationId ? ` [room:${promptSafeText(file.conversationId).slice(0, 24)}]` : ''} — ${promptSafeText(file.summary).slice(0, 220)}`);
  const planTasks = relevantMemory.projectPlan?.tasks.slice(0, 6).map((task) => `${task.status}: ${promptSafeText(task.title)}`) ?? [];

  return [
    roomId ? `Room-scoped IVX memory for: ${promptSafeText(roomId)}` : 'Local IVX memory for this owner:',
    `Project: ${promptSafeText(relevantMemory.projectContext.summary)}`,
    relevantMemory.projectContext.currentFocus ? `Current focus: ${promptSafeText(relevantMemory.projectContext.currentFocus)}` : null,
    preferences.length ? `Owner preferences: ${preferences.join(' | ')}` : null,
    planTasks.length ? `Project plan: ${planTasks.join(' | ')}` : null,
    files.length ? `Relevant files: ${files.join(' | ')}` : null,
    roomRecent.length ? `Recent room turns: ${roomRecent.join(' | ')}` : null,
    'Use this room memory quietly for retrieval and continuity. Do not list the memory unless the owner asks.',
  ].filter((line): line is string => typeof line === 'string' && line.trim().length > 0).join('\n');
}

export function createIVXOwnerFileUnderstandingPrompt(file: IVXOwnerFileInsight): string {
  return [
    'The owner uploaded a file for the IVX project. Understand it and give a concise useful next step.',
    `File name: ${file.name}`,
    `Type: ${file.mimeType ?? 'unknown'}`,
    `Size: ${formatFileSize(file.size)}`,
    `Local file note: ${file.summary}`,
    file.excerpt ? `Readable excerpt: ${file.excerpt.slice(0, MAX_FILE_EXCERPT_CHARS)}` : 'Readable excerpt: not available from this device path.',
    'Answer with what this file appears to be, why it matters, and the next build action.',
  ].join('\n');
}

/**
 * Build a single consolidated AI prompt for a batch of uploaded files (up to 20 images/videos/docs).
 * The prompt forces the AI to confirm the exact count, analyze each item individually, then summarize
 * issues and next steps across the full batch.
 */
export function createIVXOwnerMultiFileUnderstandingPrompt(input: {
  files: IVXOwnerFileInsight[];
  caption?: string | null;
}): string {
  const files = Array.isArray(input.files) ? input.files : [];
  const count = files.length;
  if (count === 0) {
    return 'The owner attempted to upload files but none were received. Ask the owner to retry.';
  }
  const caption = normalizeText(input.caption);
  const imageCount = files.filter((file) => (file.mimeType ?? '').toLowerCase().startsWith('image/')).length;
  const videoCount = files.filter((file) => (file.mimeType ?? '').toLowerCase().startsWith('video/')).length;
  const otherCount = count - imageCount - videoCount;
  const breakdown = [
    imageCount > 0 ? `${imageCount} image${imageCount === 1 ? '' : 's'}` : null,
    videoCount > 0 ? `${videoCount} video${videoCount === 1 ? '' : 's'}` : null,
    otherCount > 0 ? `${otherCount} other file${otherCount === 1 ? '' : 's'}` : null,
  ].filter((line): line is string => typeof line === 'string').join(', ');

  const fileLines = files.map((file, index) => {
    const number = index + 1;
    const mime = file.mimeType ?? 'unknown';
    const size = formatFileSize(file.size);
    const note = file.summary ? ` — ${file.summary.slice(0, 220)}` : '';
    const excerpt = file.excerpt ? `\n     Readable excerpt: ${file.excerpt.slice(0, 400)}` : '';
    return `  ${number}. ${file.name} [${mime}, ${size}]${note}${excerpt}`;
  });

  return [
    `The owner uploaded ${count} file${count === 1 ? '' : 's'} (${breakdown}) for the IVX project in a single message.`,
    caption ? `Owner caption: ${caption}` : null,
    'STRICT INSTRUCTIONS:',
    `1. Begin your answer with: "Received ${count} file${count === 1 ? '' : 's'} (${breakdown})."`,
    '2. Analyze EVERY item below individually. Do not skip any. Do not say you cannot see them — describe what each file appears to be from its name, type, size, and excerpt.',
    '3. For images/screenshots: identify visible UI, text, errors, layout issues. For videos: describe likely content and key frames. For documents: summarize content from the excerpt.',
    '4. After per-item analysis, write a "Summary of issues found" section listing every problem detected across the batch.',
    '5. End with a "Next steps" section with concrete owner actions.',
    '',
    'Files in this batch:',
    ...fileLines,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

export const ivxOwnerMemoryService = {
  async loadMemory(): Promise<IVXOwnerMemoryState> {
    try {
      const raw = await AsyncStorage.getItem(IVX_OWNER_MEMORY_STORAGE_KEY);
      if (!raw) {
        return getDefaultMemoryState();
      }

      return normalizeMemoryState(JSON.parse(raw) as unknown);
    } catch (error) {
      console.log('[IVXOwnerMemory] Failed to load memory:', error instanceof Error ? error.message : 'unknown');
      return getDefaultMemoryState();
    }
  },

  async saveOwnerPreference(text: string, source: IVXOwnerPreference['source'] = 'owner'): Promise<IVXOwnerMemoryState> {
    const memory = await this.loadMemory();
    return saveMemoryState(upsertPreference(memory, text, source));
  },

  async saveProjectContext(text: string): Promise<IVXOwnerMemoryState> {
    const memory = await this.loadMemory();
    const normalized = normalizeText(text);
    if (!normalized) {
      return memory;
    }

    return saveMemoryState(mergeProjectContext(memory, {
      summary: normalized.slice(0, 320),
      currentFocus: normalized.slice(0, 260),
    }));
  },

  async recordConversationTurn(input: {
    conversationId: string;
    ownerText: string;
    assistantText?: string | null;
  }): Promise<IVXOwnerMemoryState> {
    const ownerText = normalizeText(input.ownerText);
    const assistantText = normalizeText(input.assistantText);
    let memory = await this.loadMemory();
    const createdAt = nowIso();
    const additions: IVXOwnerMemoryMessage[] = [];

    if (ownerText) {
      additions.push({
        id: createMemoryId('owner-turn'),
        conversationId: input.conversationId,
        role: 'owner',
        text: ownerText.slice(0, 1200),
        createdAt,
      });
    }

    if (assistantText) {
      additions.push({
        id: createMemoryId('assistant-turn'),
        conversationId: input.conversationId,
        role: 'assistant',
        text: assistantText.slice(0, 1200),
        createdAt,
      });
    }

    const preference = extractPreferenceFromMessage(ownerText);
    if (preference) {
      memory = upsertPreference(memory, preference, 'owner');
    }

    const contextUpdate = inferProjectContextUpdate(ownerText);
    if (contextUpdate) {
      memory = mergeProjectContext(memory, contextUpdate);
    }

    return saveMemoryState({
      ...memory,
      recentMessages: [...memory.recentMessages, ...additions].slice(-MAX_RECENT_MESSAGES),
      updatedAt: nowIso(),
    });
  },

  async ensureProjectPlan(goal?: string | null): Promise<IVXProjectPlan> {
    const memory = await this.loadMemory();
    if (memory.projectPlan && !normalizeText(goal)) {
      return memory.projectPlan;
    }

    const plan = buildDefaultPlan(goal ?? memory.projectContext.summary);
    await saveMemoryState({
      ...mergeProjectContext(memory, {
        currentFocus: plan.tasks.find((task) => task.status === 'in_progress')?.title ?? memory.projectContext.currentFocus,
      }),
      projectPlan: plan,
      updatedAt: nowIso(),
    });
    return plan;
  },

  async getNextTask(): Promise<{ memory: IVXOwnerMemoryState; task: IVXProjectTask | null; response: string }> {
    let memory = await this.loadMemory();
    let plan = memory.projectPlan;
    if (!plan) {
      plan = await this.ensureProjectPlan(memory.projectContext.summary);
      memory = await this.loadMemory();
    }

    const activeIndex = plan.tasks.findIndex((task) => task.status === 'in_progress');
    const pendingIndex = plan.tasks.findIndex((task) => task.status === 'pending');
    const selectedIndex = activeIndex >= 0 ? activeIndex : pendingIndex;
    if (selectedIndex < 0) {
      return { memory, task: null, response: formatNextTask(plan) };
    }

    const updatedTasks = plan.tasks.map((task, index) => index === selectedIndex ? { ...task, status: 'in_progress' as const, updatedAt: nowIso() } : task);
    const updatedPlan = { ...plan, tasks: updatedTasks, updatedAt: nowIso() };
    memory = await saveMemoryState(mergeProjectContext({ ...memory, projectPlan: updatedPlan }, {
      currentFocus: updatedTasks[selectedIndex]?.title ?? memory.projectContext.currentFocus,
    }));

    return { memory, task: updatedTasks[selectedIndex] ?? null, response: formatNextTask(updatedPlan) };
  },

  async summarizePickedFile(input: IVXFileSummaryInput): Promise<IVXOwnerFileInsight> {
    const name = normalizeText(input.name) || input.file?.name || `ivx-file-${Date.now()}`;
    const mimeType = normalizeText(input.mimeType) || normalizeText(input.file?.type) || null;
    const size = typeof input.size === 'number' ? input.size : typeof input.file?.size === 'number' ? input.file.size : null;
    const excerpt = await readTextFileExcerpt({ ...input, name, mimeType, size });
    const summary = excerpt
      ? `Readable file captured locally with ${Math.min(excerpt.length, MAX_FILE_EXCERPT_CHARS)} characters extracted for IVX review.`
      : `File captured locally as ${mimeType ?? 'unknown type'} with ${formatFileSize(size)}. Full content was not readable from this device path.`;

    return {
      id: createMemoryId('file'),
      name,
      mimeType,
      size,
      summary,
      excerpt,
      uploadedAt: nowIso(),
    };
  },

  async recordFileUpload(file: IVXOwnerFileInsight): Promise<IVXOwnerMemoryState> {
    const memory = await this.loadMemory();
    const normalizedFile = {
      ...file,
      conversationId: normalizeText(file.conversationId) || null,
      name: normalizeText(file.name) || `ivx-file-${Date.now()}`,
      summary: normalizeText(file.summary) || `Uploaded file: ${file.name}`,
      excerpt: normalizeText(file.excerpt) || null,
      uploadedAt: normalizeText(file.uploadedAt) || nowIso(),
    } satisfies IVXOwnerFileInsight;
    return saveMemoryState({
      ...memory,
      uploadedFiles: [...memory.uploadedFiles, normalizedFile].slice(-MAX_FILES),
      projectContext: {
        ...memory.projectContext,
        currentFocus: `Review uploaded file: ${normalizedFile.name}`,
        updatedAt: nowIso(),
      },
      updatedAt: nowIso(),
    });
  },

  async loadRoomMemory(conversationId: string, query?: string | null): Promise<IVXOwnerMemoryState> {
    const memory = await this.loadMemory();
    return getRelevantMemoryState(memory, conversationId, query);
  },

  async handleLocalCommand(text: string, conversationId?: string | null): Promise<IVXOwnerLocalCommandResult | null> {
    const intent = resolveIVXOwnerLocalCommandIntent(text);
    if (!intent) {
      return null;
    }

    if (intent.command === 'project_plan') {
      const plan = await this.ensureProjectPlan(intent.args || null);
      return { handled: true, command: intent.command, response: formatProjectPlan(plan) };
    }

    if (intent.command === 'next_task') {
      const next = await this.getNextTask();
      return { handled: true, command: intent.command, response: next.response };
    }

    if (intent.command === 'remember') {
      if (!intent.args) {
        return { handled: true, command: intent.command, response: 'Tell me what to remember, like: remember I prefer short launch checklists.' };
      }
      await this.saveOwnerPreference(intent.args, 'owner');
      return { handled: true, command: intent.command, response: 'Saved to IVX memory. I’ll use it when guiding your project.' };
    }

    if (intent.command === 'project_context') {
      if (!intent.args) {
        return { handled: true, command: intent.command, response: 'Send the project context after the command, like: project context IVX is focused on owner chat, memory, and guided build tasks.' };
      }
      await this.saveProjectContext(intent.args);
      return { handled: true, command: intent.command, response: 'Project context saved. I’ll use it to keep the IVX build moving in the right direction.' };
    }

    const memory = await this.loadMemory();
    const roomMemory = getRelevantMemoryState(memory, conversationId, text);
    const roomId = normalizeText(conversationId);
    return {
      handled: true,
      command: intent.command,
      response: [
        `IVX memory: ${memory.recentMessages.length} recent turns, ${memory.ownerPreferences.length} preferences, ${memory.uploadedFiles.length} uploaded file notes.`,
        roomId ? `Room memory: ${roomMemory.recentMessages.filter((message) => message.conversationId === roomId).length} room turn(s), ${roomMemory.uploadedFiles.length} relevant file note(s).` : null,
        `Current focus: ${promptSafeText(memory.projectContext.currentFocus ?? memory.projectContext.summary)}`,
        memory.projectPlan ? `Plan: ${memory.projectPlan.tasks.filter((task) => task.status !== 'done').length} open task(s).` : 'Plan: say “project plan” to create one.',
      ].filter((line): line is string => typeof line === 'string').join('\n'),
    };
  },
};
