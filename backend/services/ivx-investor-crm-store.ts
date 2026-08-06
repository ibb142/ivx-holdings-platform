/**
 * IVX Capital Deployment Platform — Investor CRM durable store (owner-only).
 *
 * BLOCK 20. The first pillar of turning IVX from an Opportunity Intelligence
 * platform into a Capital Deployment Platform: a real, owner-managed CRM of
 * investor records that the owner can create, read, update, and delete.
 *
 * HARD HONESTY RULE (the platform-wide rule, enforced here):
 *   - IVX NEVER fabricates investors, emails, phone numbers, companies, or deal
 *     data. Every record originates from a real, attributable source:
 *       owner_entered | submitted_form | crm_import | public_source | verified_deal
 *     `source` is required on create; `sourceDetail` carries the attribution
 *     (who entered it / which form / which import file / which public URL).
 *   - Unknown values stay empty/null — never invented.
 *   - Lead/relationship scores are owner-supplied judgements (0–100), not
 *     auto-fabricated; they default to 0 until the owner sets them.
 *
 * Durable layout (mirrors the proven ivx-capital-network-store pattern):
 *   logs/audit/investor-crm/investors.jsonl  append-only event log
 *   logs/audit/investor-crm/investors.json   materialised current state
 *
 * Runtime-light + deterministic: only filesystem I/O, no AI/network. Fully testable.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';
import { resolveCanonicalIdentity } from './ivx-crm-canonical';

export const IVX_INVESTOR_CRM_MARKER = 'ivx-investor-crm-2026-05-31';

/** Where an investor record came from — required, for honest attribution. */
export type InvestorSource =
  | 'owner_entered'
  | 'submitted_form'
  | 'crm_import'
  | 'public_source'
  | 'verified_deal';

/** Relationship lifecycle stage. */
export type InvestorStatus =
  | 'prospect'
  | 'contacted'
  | 'meeting_scheduled'
  | 'active'
  | 'invested';

/** Accreditation state — `unknown` until verified, never assumed. */
export type AccreditedStatus = 'accredited' | 'non_accredited' | 'unknown';

/**
 * The kind of capital-relationship this record represents. The Investor CRM is
 * the single owner-managed contact store for every party type the owner imports.
 */
export type PartyType =
  | 'investor'
  | 'buyer'
  | 'broker'
  | 'developer'
  | 'lender'
  | 'partner';

export type InvestorRecord = {
  id: string;
  name: string;
  /** Which party type this contact is (investor/buyer/broker/developer/lender/partner). */
  partyType: PartyType;
  company: string;
  email: string;
  phone: string;
  location: string;
  /** e.g. "Family office", "Syndicator", "Private equity", "Individual". */
  investmentType: string;
  accreditedStatus: AccreditedStatus;
  /** Markets the investor prefers (e.g. ["South Florida", "Miami"]). */
  preferredMarkets: string[];
  /** Asset classes (e.g. ["Multifamily", "Luxury condos", "Land"]). */
  preferredAssetClasses: string[];
  /** Free-text typical check size as the owner recorded it (e.g. "$250k–$1M"). */
  typicalCheckSize: string;
  /** Free-text timeline (e.g. "0–6 months", "Opportunistic"). */
  investmentTimeline: string;
  notes: string;
  /** ISO date of the last contact, or null if never contacted. */
  lastContactDate: string | null;
  /** Owner-supplied lead quality, 0–100. */
  leadScore: number;
  /** Owner-supplied relationship strength, 0–100. */
  relationshipScore: number;
  status: InvestorStatus;
  source: InvestorSource;
  /** Attribution detail for the source (who/which form/which import/which URL). */
  sourceDetail: string;
  createdAt: string;
  updatedAt: string;
};

const CRM_ROOT = auditDir('investor-crm');
const INVESTORS_STATE = path.join(CRM_ROOT, 'investors.json');

const VALID_SOURCES: ReadonlySet<InvestorSource> = new Set([
  'owner_entered', 'submitted_form', 'crm_import', 'public_source', 'verified_deal',
]);
const VALID_STATUS: ReadonlySet<InvestorStatus> = new Set([
  'prospect', 'contacted', 'meeting_scheduled', 'active', 'invested',
]);
const VALID_ACCREDITED: ReadonlySet<AccreditedStatus> = new Set([
  'accredited', 'non_accredited', 'unknown',
]);
export const VALID_PARTY_TYPES: ReadonlySet<PartyType> = new Set([
  'investor', 'buyer', 'broker', 'developer', 'lender', 'partner',
]);

/** Normalize any input to a valid PartyType, defaulting to 'investor'. */
export function normalizePartyType(value: unknown): PartyType {
  const v = asTrimmedString(value).toLowerCase() as PartyType;
  return VALID_PARTY_TYPES.has(v) ? v : 'investor';
}

/**
 * Stable dedupe key for a contact: party type + name + the strongest available
 * identity signal (email, else phone, else company). Used to detect duplicate
 * rows on import so a re-imported list never silently doubles the CRM.
 */
export function investorDedupeKey(input: {
  name?: unknown;
  partyType?: unknown;
  email?: unknown;
  phone?: unknown;
  company?: unknown;
}): string {
  const name = asTrimmedString(input.name).toLowerCase();
  const party = normalizePartyType(input.partyType);
  const email = asTrimmedString(input.email).toLowerCase();
  const phone = asTrimmedString(input.phone).replace(/[^0-9+]/g, '');
  const company = asTrimmedString(input.company).toLowerCase();
  const identity = email || phone || company || '';
  return `${party}|${name}|${identity}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Clamp any input to a 0–100 integer score. */
export function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => asTrimmedString(v)).filter(Boolean)));
}

function normalizeAccredited(value: unknown): AccreditedStatus {
  const v = asTrimmedString(value).toLowerCase() as AccreditedStatus;
  return VALID_ACCREDITED.has(v) ? v : 'unknown';
}

/** Normalize an ISO-ish date string to an ISO string, or null if absent/invalid. */
export function normalizeDate(value: unknown): string | null {
  const v = asTrimmedString(value);
  if (!v) return null;
  const time = Date.parse(v);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  if (isDurableStoreConfigured()) {
    return readDurableJson<T>(file, fallback);
  }
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(file, value);
    return;
  }
  await mkdir(CRM_ROOT, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function appendEvent(event: Record<string, unknown>): Promise<void> {
  const eventFile = path.join(CRM_ROOT, 'investors.jsonl');
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(eventFile, event);
    } catch {
      // Forensic log is best-effort; never break a CRM write on log failure.
    }
    return;
  }
  try {
    await mkdir(CRM_ROOT, { recursive: true });
    await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Forensic log is best-effort; never break a CRM write on log failure.
  }
}

export type CreateInvestorInput = {
  name: string;
  source: InvestorSource;
  sourceDetail?: string;
  partyType?: PartyType;
  company?: string;
  email?: string;
  phone?: string;
  location?: string;
  investmentType?: string;
  accreditedStatus?: AccreditedStatus;
  preferredMarkets?: string[];
  preferredAssetClasses?: string[];
  typicalCheckSize?: string;
  investmentTimeline?: string;
  notes?: string;
  lastContactDate?: string | null;
  leadScore?: number;
  relationshipScore?: number;
  status?: InvestorStatus;
};

export type UpdateInvestorInput = Partial<Omit<CreateInvestorInput, 'source'>> & {
  source?: InvestorSource;
};

/** Validation result for a create input. */
export type InvestorValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate a create input. Enforces the honesty rule: name + a real attributable
 * source are required. Everything else is optional (unknowns stay empty).
 */
export function validateCreateInvestor(input: CreateInvestorInput): InvestorValidation {
  if (!asTrimmedString(input.name)) {
    return { ok: false, error: 'Investor name is required — IVX never fabricates a record.' };
  }
  if (!VALID_SOURCES.has(input.source)) {
    return {
      ok: false,
      error: 'A real source is required (owner_entered | submitted_form | crm_import | public_source | verified_deal).',
    };
  }
  if ((input.source === 'public_source' || input.source === 'crm_import') && !asTrimmedString(input.sourceDetail)) {
    return {
      ok: false,
      error: 'Source attribution (sourceDetail) is required for public_source and crm_import records.',
    };
  }
  return { ok: true };
}

function buildRecord(input: CreateInvestorInput, prior?: InvestorRecord): InvestorRecord {
  const status: InvestorStatus = input.status && VALID_STATUS.has(input.status)
    ? input.status
    : prior?.status ?? 'prospect';
  return {
    id: prior?.id ?? createId('investor'),
    name: asTrimmedString(input.name) || prior?.name || '',
    partyType: input.partyType !== undefined ? normalizePartyType(input.partyType) : prior?.partyType ?? 'investor',
    company: input.company !== undefined ? asTrimmedString(input.company) : prior?.company ?? '',
    email: input.email !== undefined ? asTrimmedString(input.email) : prior?.email ?? '',
    phone: input.phone !== undefined ? asTrimmedString(input.phone) : prior?.phone ?? '',
    location: input.location !== undefined ? asTrimmedString(input.location) : prior?.location ?? '',
    investmentType: input.investmentType !== undefined ? asTrimmedString(input.investmentType) : prior?.investmentType ?? '',
    accreditedStatus: input.accreditedStatus !== undefined ? normalizeAccredited(input.accreditedStatus) : prior?.accreditedStatus ?? 'unknown',
    preferredMarkets: input.preferredMarkets !== undefined ? asStringArray(input.preferredMarkets) : prior?.preferredMarkets ?? [],
    preferredAssetClasses: input.preferredAssetClasses !== undefined ? asStringArray(input.preferredAssetClasses) : prior?.preferredAssetClasses ?? [],
    typicalCheckSize: input.typicalCheckSize !== undefined ? asTrimmedString(input.typicalCheckSize) : prior?.typicalCheckSize ?? '',
    investmentTimeline: input.investmentTimeline !== undefined ? asTrimmedString(input.investmentTimeline) : prior?.investmentTimeline ?? '',
    notes: input.notes !== undefined ? asTrimmedString(input.notes) : prior?.notes ?? '',
    lastContactDate: input.lastContactDate !== undefined ? normalizeDate(input.lastContactDate) : prior?.lastContactDate ?? null,
    leadScore: input.leadScore !== undefined ? clampScore(input.leadScore) : prior?.leadScore ?? 0,
    relationshipScore: input.relationshipScore !== undefined ? clampScore(input.relationshipScore) : prior?.relationshipScore ?? 0,
    status,
    source: input.source && VALID_SOURCES.has(input.source) ? input.source : prior?.source ?? 'owner_entered',
    sourceDetail: input.sourceDetail !== undefined ? asTrimmedString(input.sourceDetail) : prior?.sourceDetail ?? '',
    createdAt: prior?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
}

export async function listInvestors(): Promise<InvestorRecord[]> {
  const items = await readJsonFile<InvestorRecord[]>(INVESTORS_STATE, []);
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type InvestorListWithSummary = {
  investors: InvestorRecord[];
  total: number;
  summary: InvestorCrmSummary;
};

export async function listInvestorsWithSummary(): Promise<InvestorListWithSummary> {
  const items = await readJsonFile<InvestorRecord[]>(INVESTORS_STATE, []);
  const sorted = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const byStatus: Record<InvestorStatus, number> = {
    prospect: 0, contacted: 0, meeting_scheduled: 0, active: 0, invested: 0,
  };
  const bySource: Record<InvestorSource, number> = {
    owner_entered: 0, submitted_form: 0, crm_import: 0, public_source: 0, verified_deal: 0,
  };
  const byPartyType: Record<PartyType, number> = {
    investor: 0, buyer: 0, broker: 0, developer: 0, lender: 0, partner: 0,
  };
  let accredited = 0;
  let leadSum = 0;
  let relSum = 0;
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;
    byPartyType[item.partyType] = (byPartyType[item.partyType] ?? 0) + 1;
    if (item.accreditedStatus === 'accredited') accredited += 1;
    leadSum += item.leadScore;
    relSum += item.relationshipScore;
  }
  const total = items.length;
  const summary: InvestorCrmSummary = {
    marker: IVX_INVESTOR_CRM_MARKER,
    generatedAt: nowIso(),
    total,
    byStatus,
    bySource,
    byPartyType,
    accredited,
    avgLeadScore: total > 0 ? Math.round(leadSum / total) : 0,
    avgRelationshipScore: total > 0 ? Math.round(relSum / total) : 0,
  };
  return { investors: sorted, total, summary };
}

export async function getInvestor(id: string): Promise<InvestorRecord | null> {
  const items = await readJsonFile<InvestorRecord[]>(INVESTORS_STATE, []);
  return items.find((item) => item.id === id) ?? null;
}

/** Canonical company id for a record/input, scoped by party type. */
export function canonicalCompanyIdFor(input: {
  name?: unknown; company?: unknown; email?: unknown; phone?: unknown;
  notes?: unknown; sourceDetail?: unknown; partyType?: unknown;
}): string {
  return resolveCanonicalIdentity({
    name: asTrimmedString(input.name),
    company: asTrimmedString(input.company),
    email: asTrimmedString(input.email),
    phone: asTrimmedString(input.phone),
    notes: asTrimmedString(input.notes),
    sourceDetail: asTrimmedString(input.sourceDetail),
    partyType: input.partyType !== undefined ? normalizePartyType(input.partyType) : 'investor',
  }).canonicalCompanyId;
}

/**
 * Create a new investor record OR update the existing canonical match.
 *
 * HARD DUPLICATE BLOCKER: before inserting, the record's `canonicalCompanyId`
 * (cik → website → domain → legal_name → normalized_name, scoped by party type)
 * is checked against the store. If a record with the same canonical id already
 * exists, it is UPDATED in place (never a second INSERT), guaranteeing
 * one company = one CRM record per party type.
 */
export async function createInvestor(
  input: CreateInvestorInput,
): Promise<{ ok: true; investor: InvestorRecord; deduped: boolean } | { ok: false; error: string }> {
  const validation = validateCreateInvestor(input);
  if (!validation.ok) return validation;
  const items = await readJsonFile<InvestorRecord[]>(INVESTORS_STATE, []);
  const canonical = canonicalCompanyIdFor(input);
  const existingIndex = items.findIndex((r) => canonicalCompanyIdFor(r) === canonical);
  if (existingIndex !== -1) {
    const prior = items[existingIndex]!;
    const merged = buildRecord({ ...prior, ...input, name: input.name || prior.name, source: prior.source }, prior);
    items[existingIndex] = merged;
    await writeJsonFile(INVESTORS_STATE, items);
    await appendEvent({ type: 'upsert', investorId: merged.id, canonical, investor: merged, at: merged.updatedAt });
    return { ok: true, investor: merged, deduped: true };
  }
  const record = buildRecord(input);
  items.push(record);
  await writeJsonFile(INVESTORS_STATE, items);
  await appendEvent({ type: 'create', investor: record, canonical, at: record.createdAt });
  return { ok: true, investor: record, deduped: false };
}

/** Update an existing investor record. Returns null if not found. */
export async function updateInvestor(id: string, patch: UpdateInvestorInput): Promise<InvestorRecord | null> {
  const items = await readJsonFile<InvestorRecord[]>(INVESTORS_STATE, []);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const prior = items[index]!;
  const merged = buildRecord({ ...prior, ...patch, source: patch.source ?? prior.source, name: patch.name ?? prior.name }, prior);
  items[index] = merged;
  await writeJsonFile(INVESTORS_STATE, items);
  await appendEvent({ type: 'update', investorId: id, investor: merged, at: merged.updatedAt });
  return merged;
}

/** Set just the relationship status (pipeline move). Returns null if not found / invalid. */
export async function setInvestorStatus(id: string, status: InvestorStatus): Promise<InvestorRecord | null> {
  if (!VALID_STATUS.has(status)) return null;
  return updateInvestor(id, { status });
}

/**
 * Overwrite the entire investor store in a single durable write. Used by the
 * dedup merge migration. Callers must pass the full, already-merged record set.
 */
export async function replaceAllInvestors(records: InvestorRecord[]): Promise<void> {
  await writeJsonFile(INVESTORS_STATE, records);
  await appendEvent({ type: 'replace_all', count: records.length, at: nowIso() });
}

/** Delete an investor record. Returns true if a record was removed. */
export async function deleteInvestor(id: string): Promise<boolean> {
  const items = await readJsonFile<InvestorRecord[]>(INVESTORS_STATE, []);
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  await writeJsonFile(INVESTORS_STATE, next);
  await appendEvent({ type: 'delete', investorId: id, at: nowIso() });
  return true;
}

/**
 * Bulk-import a batch of records in a single durable write. Each input is
 * validated with the same no-fabrication rule as `createInvestor`; invalid
 * rows are skipped (never persisted) and reported with their reason, so the
 * caller can show an honest imported/skipped count after every import.
 */
export async function importInvestors(
  inputs: CreateInvestorInput[],
): Promise<{
  imported: number;
  skipped: number;
  duplicates: number;
  total: number;
  errors: { index: number; name: string; error: string }[];
  duplicateRows: { index: number; name: string; reason: string }[];
  records: InvestorRecord[];
}> {
  const items = await readJsonFile<InvestorRecord[]>(INVESTORS_STATE, []);
  const created: InvestorRecord[] = [];
  const errors: { index: number; name: string; error: string }[] = [];
  const duplicateRows: { index: number; name: string; reason: string }[] = [];
  // Seed the seen-set with existing records so a re-imported list never doubles
  // the CRM, and so duplicate rows WITHIN one import batch collapse to one record.
  const seen = new Set<string>(items.map((r) => investorDedupeKey(r)));
  inputs.forEach((input, index) => {
    const validation = validateCreateInvestor(input);
    if (!validation.ok) {
      errors.push({ index, name: asTrimmedString(input.name), error: validation.error });
      return;
    }
    const key = investorDedupeKey(input);
    if (seen.has(key)) {
      duplicateRows.push({
        index,
        name: asTrimmedString(input.name),
        reason: 'Duplicate of an existing contact (same name + email/phone/company) — skipped, not re-added.',
      });
      return;
    }
    seen.add(key);
    const record = buildRecord(input);
    items.push(record);
    created.push(record);
  });
  if (created.length > 0) {
    await writeJsonFile(INVESTORS_STATE, items);
    await appendEvent({ type: 'import', count: created.length, ids: created.map((r) => r.id), at: nowIso() });
  }
  return {
    imported: created.length,
    skipped: errors.length,
    duplicates: duplicateRows.length,
    total: inputs.length,
    errors,
    duplicateRows,
    records: created,
  };
}

export type InvestorCrmSummary = {
  marker: string;
  generatedAt: string;
  total: number;
  byStatus: Record<InvestorStatus, number>;
  bySource: Record<InvestorSource, number>;
  byPartyType: Record<PartyType, number>;
  accredited: number;
  avgLeadScore: number;
  avgRelationshipScore: number;
};

/** Read-only roll-up over the CRM for the dashboard header. */
export async function summarizeInvestors(): Promise<InvestorCrmSummary> {
  const items = await readJsonFile<InvestorRecord[]>(INVESTORS_STATE, []);
  const byStatus: Record<InvestorStatus, number> = {
    prospect: 0, contacted: 0, meeting_scheduled: 0, active: 0, invested: 0,
  };
  const bySource: Record<InvestorSource, number> = {
    owner_entered: 0, submitted_form: 0, crm_import: 0, public_source: 0, verified_deal: 0,
  };
  const byPartyType: Record<PartyType, number> = {
    investor: 0, buyer: 0, broker: 0, developer: 0, lender: 0, partner: 0,
  };
  let accredited = 0;
  let leadSum = 0;
  let relSum = 0;
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;
    byPartyType[item.partyType] = (byPartyType[item.partyType] ?? 0) + 1;
    if (item.accreditedStatus === 'accredited') accredited += 1;
    leadSum += item.leadScore;
    relSum += item.relationshipScore;
  }
  const total = items.length;
  return {
    marker: IVX_INVESTOR_CRM_MARKER,
    generatedAt: nowIso(),
    total,
    byStatus,
    bySource,
    byPartyType,
    accredited,
    avgLeadScore: total > 0 ? Math.round(leadSum / total) : 0,
    avgRelationshipScore: total > 0 ? Math.round(relSum / total) : 0,
  };
}
