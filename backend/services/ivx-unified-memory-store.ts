/**
 * IVX Unified Executive Memory (owner-only) — BLOCK 39.
 *
 * ONE durable memory API used by every higher brain — Owner AI, CRM AI,
 * Autonomous Mode, and the Executive Layer — so the platform stops forgetting
 * what it learned between sessions. It stores and retrieves the ten executive
 * record families the owner asked for:
 *   goals · projects · investors · crm_entities · owner_preferences · decisions ·
 *   execution_history · technical_debt · architecture_decisions · outcomes
 *
 * HARD HONESTY RULES (platform-wide, enforced here):
 *   - Memory NEVER fabricates content. `kind` + a non-empty `title` are required;
 *     unknown fields stay empty/null. `source` attributes who wrote the memory
 *     (owner_ai | crm_ai | autonomous_mode | executive_layer | owner | system).
 *   - Records are durable across process restarts (on-disk JSONL + materialised
 *     JSON), so a fresh process re-hydrates the full memory.
 *   - De-dupe by (kind + normalized title): a repeated write REFINES the existing
 *     memory (merges data, bumps updatedAt) instead of creating a duplicate.
 *
 * Durable layout (mirrors the proven execution-trace / investor-crm stores):
 *   logs/audit/unified-memory/memory.jsonl   append-only event log (source of truth)
 *   logs/audit/unified-memory/memory.json    materialised current state (fast reads)
 *
 * DURABILITY (2026-06-14): Render runs on a tier WITHOUT a persistent disk, so the
 * local *.json/*.jsonl files are wiped on every deploy/restart — the executive
 * brain would forget every learned goal/decision/preference between sessions. When
 * Supabase credentials are present, this store now persists to the SAME durable
 * Postgres document store the identity memory and business stores use, so the
 * brain truly remembers across logout, login, and redeploys. The filesystem path
 * remains the fallback for local dev / tests where Supabase is not configured.
 *
 * Runtime-light + deterministic: filesystem I/O or durable Supabase, no AI. Never
 * throws into callers — a failed persist is swallowed so remembering can never
 * break the action that produced the memory.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';

export const IVX_UNIFIED_MEMORY_MARKER = 'ivx-unified-memory-2026-06-02';

/** The ten executive memory families. */
export type MemoryKind =
  | 'goal'
  | 'project'
  | 'investor'
  | 'crm_entity'
  | 'owner_preference'
  | 'decision'
  | 'execution_history'
  | 'technical_debt'
  | 'architecture_decision'
  | 'outcome';

/** Who wrote a memory — for honest attribution. */
export type MemorySource =
  | 'owner_ai'
  | 'crm_ai'
  | 'autonomous_mode'
  | 'executive_layer'
  | 'owner'
  | 'system';

/** A single durable unified-memory record. */
export type MemoryRecord = {
  id: string;
  kind: MemoryKind;
  /** Short human title — required, never fabricated. */
  title: string;
  /** Optional longer description. */
  summary: string;
  /** Structured payload for the kind (free-form, never invented). */
  data: Record<string, unknown>;
  /** Lowercased searchable tags. */
  tags: string[];
  /** Who wrote it. */
  source: MemorySource;
  /** Free-text lifecycle status (open|active|archived|done|…). */
  status: string;
  /** Ids of related memories (e.g. an outcome linked to a decision). */
  relatedIds: string[];
  createdAt: string;
  updatedAt: string;
};

const VALID_KINDS: ReadonlySet<MemoryKind> = new Set([
  'goal',
  'project',
  'investor',
  'crm_entity',
  'owner_preference',
  'decision',
  'execution_history',
  'technical_debt',
  'architecture_decision',
  'outcome',
]);

const VALID_SOURCES: ReadonlySet<MemorySource> = new Set([
  'owner_ai',
  'crm_ai',
  'autonomous_mode',
  'executive_layer',
  'owner',
  'system',
]);

const DIR = path.join(process.cwd(), 'logs', 'audit', 'unified-memory');
const LOG_PATH = path.join(DIR, 'memory.jsonl');
const STATE_PATH = path.join(DIR, 'memory.json');
const TMP_PATH = path.join(DIR, 'memory.json.tmp');
const MAX_RECORDS = 5000;

let writeChain: Promise<void> = Promise.resolve();

function nowIso(): string {
  return new Date().toISOString();
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `mem_${crypto.randomUUID()}`;
  }
  return `mem_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTagArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((v) => asTrimmedString(v).toLowerCase())
        .filter(Boolean),
    ),
  );
}

function asIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => asTrimmedString(v)).filter(Boolean)));
}

function asData(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

/** Normalize a title for de-dupe matching (lowercase, collapse whitespace). */
export function normalizeMemoryTitle(value: unknown): string {
  return asTrimmedString(value).toLowerCase().replace(/\s+/g, ' ');
}

async function ensureDir(): Promise<void> {
  await mkdir(DIR, { recursive: true });
}

async function readState(): Promise<MemoryRecord[]> {
  // Durable Supabase first (survives Render redeploys); filesystem fallback for
  // local dev / tests where Supabase is not configured.
  if (isDurableStoreConfigured()) {
    try {
      const rows = await readDurableJson<MemoryRecord[]>(STATE_PATH, []);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MemoryRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeState(records: MemoryRecord[]): Promise<void> {
  const bounded = records.slice(-MAX_RECORDS);
  if (isDurableStoreConfigured()) {
    await writeDurableJson(STATE_PATH, bounded);
    return;
  }
  // Robust atomic write: temp file lives in the SAME directory as the target
  // so the final rename is intra-device (avoids EXDEV when os.tmpdir() is on a
  // different filesystem than the project dir). Unique name per write prevents
  // parallel-writer collisions.
  await ensureDir();
  const tmp = path.join(DIR, `ivx-unified-memory-${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(bounded, null, 2), 'utf8');
  try {
    await rename(tmp, STATE_PATH);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      await ensureDir();
      await rename(tmp, STATE_PATH);
      return;
    }
    throw error;
  }
}

async function appendEvent(event: Record<string, unknown>): Promise<void> {
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(LOG_PATH, event);
    } catch {
      // Forensic log is best-effort; never break a memory write on log failure.
    }
    return;
  }
  try {
    await ensureDir();
    await appendFile(LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Forensic log is best-effort; never break a memory write on log failure.
  }
}

/** Serialize writes so concurrent remember()/update() calls can't race. */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export type RememberMemoryInput = {
  kind: MemoryKind;
  title: string;
  summary?: string;
  data?: Record<string, unknown>;
  tags?: string[];
  source?: MemorySource;
  status?: string;
  relatedIds?: string[];
};

export type MemoryValidation = { ok: true } | { ok: false; error: string };

/** Validate a remember input — kind must be valid and title non-empty. */
export function validateMemoryInput(input: RememberMemoryInput): MemoryValidation {
  if (!input || !VALID_KINDS.has(input.kind)) {
    return {
      ok: false,
      error:
        'A valid memory kind is required (goal | project | investor | crm_entity | owner_preference | decision | execution_history | technical_debt | architecture_decision | outcome).',
    };
  }
  if (!asTrimmedString(input.title)) {
    return { ok: false, error: 'A non-empty title is required — IVX memory never fabricates a record.' };
  }
  return { ok: true };
}

function buildRecord(input: RememberMemoryInput, prior?: MemoryRecord): MemoryRecord {
  const source: MemorySource =
    input.source && VALID_SOURCES.has(input.source) ? input.source : prior?.source ?? 'system';
  return {
    id: prior?.id ?? createId(),
    kind: input.kind,
    title: asTrimmedString(input.title) || prior?.title || '',
    summary: input.summary !== undefined ? asTrimmedString(input.summary) : prior?.summary ?? '',
    // Merge data so a refine-write augments rather than discards prior knowledge.
    data: input.data !== undefined ? { ...(prior?.data ?? {}), ...asData(input.data) } : prior?.data ?? {},
    tags:
      input.tags !== undefined
        ? Array.from(new Set([...(prior?.tags ?? []), ...asTagArray(input.tags)]))
        : prior?.tags ?? [],
    source,
    status: input.status !== undefined ? asTrimmedString(input.status) || 'active' : prior?.status ?? 'active',
    relatedIds:
      input.relatedIds !== undefined
        ? Array.from(new Set([...(prior?.relatedIds ?? []), ...asIdArray(input.relatedIds)]))
        : prior?.relatedIds ?? [],
    createdAt: prior?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
}

/**
 * Remember a memory. De-dupes by (kind + normalized title): a repeated write
 * refines the existing record (merges data/tags/relatedIds) instead of creating
 * a duplicate. Returns the stored record, or null+error on validation failure.
 */
export async function remember(
  input: RememberMemoryInput,
): Promise<{ ok: true; record: MemoryRecord; refined: boolean } | { ok: false; error: string }> {
  const validation = validateMemoryInput(input);
  if (!validation.ok) return validation;
  return enqueueWrite(async () => {
    const records = await readState();
    const titleKey = normalizeMemoryTitle(input.title);
    const index = records.findIndex(
      (r) => r.kind === input.kind && normalizeMemoryTitle(r.title) === titleKey,
    );
    if (index >= 0) {
      const refined = buildRecord(input, records[index]!);
      records[index] = refined;
      await writeState(records);
      await appendEvent({ type: 'refine', record: refined, at: refined.updatedAt });
      return { ok: true as const, record: refined, refined: true };
    }
    const record = buildRecord(input);
    records.push(record);
    await writeState(records);
    await appendEvent({ type: 'remember', record, at: record.createdAt });
    return { ok: true as const, record, refined: false };
  });
}

export type RecallQuery = {
  kind?: MemoryKind;
  kinds?: MemoryKind[];
  tag?: string;
  source?: MemorySource;
  status?: string;
  /** Case-insensitive substring match over title + summary + tags. */
  search?: string;
  /** Max records to return (default 200). */
  limit?: number;
};

/** Pure filter+sort over a record array — extracted for unit testing. */
export function filterMemories(records: readonly MemoryRecord[], query: RecallQuery = {}): MemoryRecord[] {
  const kinds = new Set<MemoryKind>([
    ...(query.kind ? [query.kind] : []),
    ...(query.kinds ?? []),
  ]);
  const tag = asTrimmedString(query.tag).toLowerCase();
  const source = query.source;
  const status = asTrimmedString(query.status).toLowerCase();
  const search = asTrimmedString(query.search).toLowerCase();
  const limit = Number.isFinite(query.limit) && (query.limit ?? 0) > 0 ? Math.floor(query.limit as number) : 200;

  const filtered = records.filter((r) => {
    if (kinds.size > 0 && !kinds.has(r.kind)) return false;
    if (tag && !r.tags.includes(tag)) return false;
    if (source && r.source !== source) return false;
    if (status && r.status.toLowerCase() !== status) return false;
    if (search) {
      const haystack = `${r.title}\n${r.summary}\n${r.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  return filtered
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

/** Retrieve memories matching a query (durable, cross-session). */
export async function recall(query: RecallQuery = {}): Promise<MemoryRecord[]> {
  const records = await readState();
  return filterMemories(records, query);
}

/** Retrieve a single memory by id, or null. */
export async function getMemory(id: string): Promise<MemoryRecord | null> {
  const records = await readState();
  return records.find((r) => r.id === id) ?? null;
}

/** Update a memory by id (merges data/tags/relatedIds). Returns null if not found. */
export async function updateMemory(
  id: string,
  patch: Partial<Omit<RememberMemoryInput, 'kind'>>,
): Promise<MemoryRecord | null> {
  return enqueueWrite(async () => {
    const records = await readState();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return null;
    const prior = records[index]!;
    const merged = buildRecord({ ...patch, kind: prior.kind, title: patch.title ?? prior.title }, prior);
    records[index] = merged;
    await writeState(records);
    await appendEvent({ type: 'update', record: merged, at: merged.updatedAt });
    return merged;
  });
}

/** Forget (delete) a memory by id. Returns true if removed. */
export async function forget(id: string): Promise<boolean> {
  return enqueueWrite(async () => {
    const records = await readState();
    const next = records.filter((r) => r.id !== id);
    if (next.length === records.length) return false;
    await writeState(next);
    await appendEvent({ type: 'forget', memoryId: id, at: nowIso() });
    return true;
  });
}

export type MemorySummary = {
  marker: string;
  generatedAt: string;
  total: number;
  byKind: Record<MemoryKind, number>;
  bySource: Record<MemorySource, number>;
  lastUpdatedAt: string | null;
};

function emptyKindCounts(): Record<MemoryKind, number> {
  return {
    goal: 0,
    project: 0,
    investor: 0,
    crm_entity: 0,
    owner_preference: 0,
    decision: 0,
    execution_history: 0,
    technical_debt: 0,
    architecture_decision: 0,
    outcome: 0,
  };
}

function emptySourceCounts(): Record<MemorySource, number> {
  return {
    owner_ai: 0,
    crm_ai: 0,
    autonomous_mode: 0,
    executive_layer: 0,
    owner: 0,
    system: 0,
  };
}

/** Pure roll-up over a record array — extracted for unit testing. */
export function summarizeMemoryRecords(records: readonly MemoryRecord[]): MemorySummary {
  const byKind = emptyKindCounts();
  const bySource = emptySourceCounts();
  let lastUpdatedAt: string | null = null;
  for (const r of records) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    if (!lastUpdatedAt || r.updatedAt > lastUpdatedAt) lastUpdatedAt = r.updatedAt;
  }
  return {
    marker: IVX_UNIFIED_MEMORY_MARKER,
    generatedAt: nowIso(),
    total: records.length,
    byKind,
    bySource,
    lastUpdatedAt,
  };
}

/** Read-only roll-up over the whole memory store. */
export async function summarizeMemory(): Promise<MemorySummary> {
  const records = await readState();
  return summarizeMemoryRecords(records);
}