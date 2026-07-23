/**
 * IVX Memory System — Phase 3
 *
 * Three memory classes: SESSION, USER, COMPANY.
 * Every memory record has confidence, verified status, expiration, and owner controls.
 * The AI must not treat an assumption as verified memory.
 */

import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────

export type IVXMemoryCategory = 'session' | 'user' | 'company';

export type IVXMemoryRecord = {
  id: string;
  category: IVXMemoryCategory;
  source: string;
  content: string;
  confidence: number; // 0.0 to 1.0
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  supersededById: string | null;
  ownerVisible: boolean;
  tags: string[];
};

export type IVXMemoryOwnerControl =
  | 'show'
  | 'correct'
  | 'delete'
  | 'mark_permanent'
  | 'mark_temporary';

export type IVXMemoryQuery = {
  category?: IVXMemoryCategory;
  verifiedOnly?: boolean;
  minConfidence?: number;
  tags?: string[];
  search?: string;
  limit?: number;
};

// ─── In-Memory Store ──────────────────────────────────────────────

const memoryStore = new Map<string, IVXMemoryRecord>();
const MAX_STORE_SIZE = 500;

// ─── Pre-seeded Company Memory ────────────────────────────────────

const COMPANY_MEMORY_SEED: Array<Omit<IVXMemoryRecord, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    category: 'company',
    source: 'owner-config',
    content: 'IVXHOLDINGS is a real-estate joint-venture platform with fractional ownership.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['identity', 'company'],
  },
  {
    category: 'company',
    source: 'owner-config',
    content: 'Owner is Ivan Perez (iperez4242@gmail.com). Sole authority for all write actions.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['owner', 'authority'],
  },
  {
    category: 'company',
    source: 'github',
    content: 'Canonical repository: ibb142/rork-global-real-estate-invest, branch main.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['repository', 'github'],
  },
  {
    category: 'company',
    source: 'supabase',
    content: 'Supabase project: kvclcdjmjghndxsngfzb. Auth + database + storage.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['database', 'supabase'],
  },
  {
    category: 'company',
    source: 'render',
    content: 'Backend hosted on Render. API URL: https://api.ivxholding.com.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['infrastructure', 'render'],
  },
  {
    category: 'company',
    source: 'owner-config',
    content: 'Landing URL: https://ivxholding.com. CloudFront distribution E1C0DEI0VKCUYN.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['infrastructure', 'cloudfront', 'landing'],
  },
  {
    category: 'company',
    source: 'owner-config',
    content: 'SMTP is NOT configured. Email confirmation and password reset delivery are blocked. Registration works via auto-confirm.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['smtp', 'email', 'blocked'],
  },
  {
    category: 'company',
    source: 'owner-config',
    content: 'Owner approval phrases: CONFIRM_IVX_GITHUB_WRITE, CONFIRM_IVX_RENDER_DEPLOY, CONFIRM_IVX_APK_UPLOAD, CONFIRM_IVX_SUPABASE_MIGRATION, CONFIRM_IVX_LANDING_UPLOAD, CONFIRM_IVX_CLOUDFRONT_INVALIDATE, CONFIRM_IVX_CREATE_REPOSITORY, CONFIRM_IVX_ROLLBACK, CONFIRM_IVX_RENDER_SERVICE_UPDATE.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['approval', 'security', 'gates'],
  },
  {
    category: 'company',
    source: 'verified-fix',
    content: 'Registration orchestrator creates auth user + profile + member + investment interest. Fixed kyc_status from not_started to pending (DB constraint). Fanout now calls upsertCanonicalMember + onboardNewMember + insertInvestmentInterest.',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['registration', 'fix', 'verified'],
  },
  {
    category: 'company',
    source: 'verified-fix',
    content: 'JV Deal data sync: NaN guard added to formatters. normalizeJVDeal() produces canonical view model. 3 deals: Perez Residence ($2.5M/25%/$50k min), Casa Rosario ($1.4M/30%/$50 min), Jacksonville ($400k/9.5%/$50k min).',
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    supersededById: null,
    ownerVisible: true,
    tags: ['deals', 'jv', 'verified'],
  },
];

// ─── Initialization ───────────────────────────────────────────────

let initialized = false;

export function initializeMemory(): void {
  if (initialized) return;
  initialized = true;

  const now = new Date().toISOString();
  for (const seed of COMPANY_MEMORY_SEED) {
    const record: IVXMemoryRecord = {
      ...seed,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    memoryStore.set(record.id, record);
  }
}

// ─── CRUD Operations ──────────────────────────────────────────────

export function createMemory(input: {
  category: IVXMemoryCategory;
  source: string;
  content: string;
  confidence?: number;
  verified?: boolean;
  expiresAt?: string | null;
  ownerVisible?: boolean;
  tags?: string[];
}): IVXMemoryRecord {
  initializeMemory();
  const now = new Date().toISOString();
  const record: IVXMemoryRecord = {
    id: randomUUID(),
    category: input.category,
    source: input.source,
    content: input.content,
    confidence: input.confidence ?? 0.5,
    verified: input.verified ?? false,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt ?? null,
    supersededById: null,
    ownerVisible: input.ownerVisible ?? true,
    tags: input.tags || [],
  };

  memoryStore.set(record.id, record);

  // Enforce max size — evict oldest expired session memory
  if (memoryStore.size > MAX_STORE_SIZE) {
    const sessionRecords = [...memoryStore.values()]
      .filter((r) => r.category === 'session')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const old of sessionRecords) {
      memoryStore.delete(old.id);
      if (memoryStore.size <= MAX_STORE_SIZE) break;
    }
  }

  return record;
}

export function getMemory(id: string): IVXMemoryRecord | null {
  initializeMemory();
  return memoryStore.get(id) || null;
}

export function queryMemory(query: IVXMemoryQuery): IVXMemoryRecord[] {
  initializeMemory();

  let results = [...memoryStore.values()];

  // Filter expired
  const now = new Date();
  results = results.filter((r) => {
    if (!r.expiresAt) return true;
    return new Date(r.expiresAt) > now;
  });

  // Filter superseded
  results = results.filter((r) => r.supersededById === null);

  if (query.category) {
    results = results.filter((r) => r.category === query.category);
  }

  if (query.verifiedOnly) {
    results = results.filter((r) => r.verified);
  }

  if (query.minConfidence !== undefined) {
    results = results.filter((r) => r.confidence >= query.minConfidence!);
  }

  if (query.tags && query.tags.length > 0) {
    results = results.filter((r) => query.tags!.some((t) => r.tags.includes(t)));
  }

  if (query.search) {
    const search = query.search.toLowerCase();
    results = results.filter((r) => r.content.toLowerCase().includes(search));
  }

  // Sort by confidence (highest first), then by most recently updated
  results.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return results.slice(0, query.limit || 20);
}

export function updateMemory(id: string, updates: Partial<IVXMemoryRecord>): IVXMemoryRecord | null {
  initializeMemory();
  const existing = memoryStore.get(id);
  if (!existing) return null;

  const updated: IVXMemoryRecord = {
    ...existing,
    ...updates,
    id: existing.id, // Prevent ID change
    updatedAt: new Date().toISOString(),
  };
  memoryStore.set(id, updated);
  return updated;
}

export function deleteMemory(id: string): boolean {
  initializeMemory();
  return memoryStore.delete(id);
}

// ─── Owner Controls ───────────────────────────────────────────────

export function executeOwnerControl(control: IVXMemoryOwnerControl, input: {
  id?: string;
  content?: string;
  expiresAt?: string | null;
}): { success: boolean; message: string; record?: IVXMemoryRecord } {
  initializeMemory();

  switch (control) {
    case 'show': {
      const records = queryMemory({ limit: 50, ownerVisible: true } as IVXMemoryQuery & { ownerVisible: boolean });
      return { success: true, message: `${records.length} memory records found` };
    }

    case 'correct': {
      if (!input.id || !input.content) {
        return { success: false, message: 'id and content required' };
      }
      const updated = updateMemory(input.id, { content: input.content, verified: false, confidence: 0.5 });
      if (!updated) return { success: false, message: 'Memory record not found' };
      return { success: true, message: 'Memory corrected (marked unverified)', record: updated };
    }

    case 'delete': {
      if (!input.id) return { success: false, message: 'id required' };
      const deleted = deleteMemory(input.id);
      return { success: deleted, message: deleted ? 'Memory deleted' : 'Memory not found' };
    }

    case 'mark_permanent': {
      if (!input.id) return { success: false, message: 'id required' };
      const updated = updateMemory(input.id, { expiresAt: null });
      if (!updated) return { success: false, message: 'Memory not found' };
      return { success: true, message: 'Memory marked permanent', record: updated };
    }

    case 'mark_temporary': {
      if (!input.id) return { success: false, message: 'id required' };
      const expiresAt = input.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const updated = updateMemory(input.id, { expiresAt });
      if (!updated) return { success: false, message: 'Memory not found' };
      return { success: true, message: 'Memory marked temporary', record: updated };
    }

    default:
      return { success: false, message: 'Unknown control' };
  }
}

// ─── Verification Guard ───────────────────────────────────────────

/**
 * The AI must not treat an assumption as verified memory.
 * This function checks whether a memory record can be cited as fact.
 */
export function canCiteAsFact(record: IVXMemoryRecord): boolean {
  if (!record.verified) return false;
  if (record.confidence < 0.8) return false;
  if (record.supersededById !== null) return false;
  if (record.expiresAt) {
    if (new Date(record.expiresAt) < new Date()) return false;
  }
  return true;
}

/**
 * Create a verified memory record (only from verified outcomes).
 */
export function createVerifiedMemory(input: {
  category: IVXMemoryCategory;
  source: string;
  content: string;
  tags?: string[];
}): IVXMemoryRecord {
  return createMemory({
    ...input,
    confidence: 1.0,
    verified: true,
    expiresAt: null,
    ownerVisible: true,
  });
}

/**
 * Create an inferred memory (NOT verified — cannot be cited as fact).
 */
export function createInferredMemory(input: {
  category: IVXMemoryCategory;
  source: string;
  content: string;
  tags?: string[];
}): IVXMemoryRecord {
  return createMemory({
    ...input,
    confidence: 0.5,
    verified: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    ownerVisible: true,
  });
}

// ─── Status ───────────────────────────────────────────────────────

export function getMemoryStatus(): {
  totalRecords: number;
  byCategory: Record<string, number>;
  verifiedCount: number;
  inferredCount: number;
  expiredCount: number;
} {
  initializeMemory();
  const records = [...memoryStore.values()];
  const now = new Date();

  return {
    totalRecords: records.length,
    byCategory: {
      session: records.filter((r) => r.category === 'session').length,
      user: records.filter((r) => r.category === 'user').length,
      company: records.filter((r) => r.category === 'company').length,
    },
    verifiedCount: records.filter((r) => r.verified).length,
    inferredCount: records.filter((r) => !r.verified).length,
    expiredCount: records.filter((r) => r.expiresAt && new Date(r.expiresAt) < now).length,
  };
}

export const IVX_MEMORY_SYSTEM_MARKER = 'ivx-memory-system-2026-07-23-v1';
