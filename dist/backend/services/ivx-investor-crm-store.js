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
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
import { resolveCanonicalIdentity } from './ivx-crm-canonical';
export const IVX_INVESTOR_CRM_MARKER = 'ivx-investor-crm-2026-05-31';
const CRM_ROOT = auditDir('investor-crm');
const INVESTORS_STATE = path.join(CRM_ROOT, 'investors.json');
const VALID_SOURCES = new Set([
    'owner_entered', 'submitted_form', 'crm_import', 'public_source', 'verified_deal',
]);
const VALID_STATUS = new Set([
    'prospect', 'contacted', 'meeting_scheduled', 'active', 'invested',
]);
const VALID_ACCREDITED = new Set([
    'accredited', 'non_accredited', 'unknown',
]);
export const VALID_PARTY_TYPES = new Set([
    'investor', 'buyer', 'broker', 'developer', 'lender', 'partner',
]);
/** Normalize any input to a valid PartyType, defaulting to 'investor'. */
export function normalizePartyType(value) {
    const v = asTrimmedString(value).toLowerCase();
    return VALID_PARTY_TYPES.has(v) ? v : 'investor';
}
/**
 * Stable dedupe key for a contact: party type + name + the strongest available
 * identity signal (email, else phone, else company). Used to detect duplicate
 * rows on import so a re-imported list never silently doubles the CRM.
 */
export function investorDedupeKey(input) {
    const name = asTrimmedString(input.name).toLowerCase();
    const party = normalizePartyType(input.partyType);
    const email = asTrimmedString(input.email).toLowerCase();
    const phone = asTrimmedString(input.phone).replace(/[^0-9+]/g, '');
    const company = asTrimmedString(input.company).toLowerCase();
    const identity = email || phone || company || '';
    return `${party}|${name}|${identity}`;
}
function nowIso() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
/** Clamp any input to a 0–100 integer score. */
export function clampScore(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value.map((v) => asTrimmedString(v)).filter(Boolean)));
}
function normalizeAccredited(value) {
    const v = asTrimmedString(value).toLowerCase();
    return VALID_ACCREDITED.has(v) ? v : 'unknown';
}
/** Normalize an ISO-ish date string to an ISO string, or null if absent/invalid. */
export function normalizeDate(value) {
    const v = asTrimmedString(value);
    if (!v)
        return null;
    const time = Date.parse(v);
    if (!Number.isFinite(time))
        return null;
    return new Date(time).toISOString();
}
async function readJsonFile(file, fallback) {
    if (isDurableStoreConfigured()) {
        return readDurableJson(file, fallback);
    }
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeJsonFile(file, value) {
    if (isDurableStoreConfigured()) {
        await writeDurableJson(file, value);
        return;
    }
    await mkdir(CRM_ROOT, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(event) {
    const eventFile = path.join(CRM_ROOT, 'investors.jsonl');
    if (isDurableStoreConfigured()) {
        try {
            await appendDurableEvent(eventFile, event);
        }
        catch {
            // Forensic log is best-effort; never break a CRM write on log failure.
        }
        return;
    }
    try {
        await mkdir(CRM_ROOT, { recursive: true });
        await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort; never break a CRM write on log failure.
    }
}
/**
 * Validate a create input. Enforces the honesty rule: name + a real attributable
 * source are required. Everything else is optional (unknowns stay empty).
 */
export function validateCreateInvestor(input) {
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
function buildRecord(input, prior) {
    const status = input.status && VALID_STATUS.has(input.status)
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
export async function listInvestors() {
    const items = await readJsonFile(INVESTORS_STATE, []);
    return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getInvestor(id) {
    const items = await readJsonFile(INVESTORS_STATE, []);
    return items.find((item) => item.id === id) ?? null;
}
/** Canonical company id for a record/input, scoped by party type. */
export function canonicalCompanyIdFor(input) {
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
export async function createInvestor(input) {
    const validation = validateCreateInvestor(input);
    if (!validation.ok)
        return validation;
    const items = await readJsonFile(INVESTORS_STATE, []);
    const canonical = canonicalCompanyIdFor(input);
    const existingIndex = items.findIndex((r) => canonicalCompanyIdFor(r) === canonical);
    if (existingIndex !== -1) {
        const prior = items[existingIndex];
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
export async function updateInvestor(id, patch) {
    const items = await readJsonFile(INVESTORS_STATE, []);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1)
        return null;
    const prior = items[index];
    const merged = buildRecord({ ...prior, ...patch, source: patch.source ?? prior.source, name: patch.name ?? prior.name }, prior);
    items[index] = merged;
    await writeJsonFile(INVESTORS_STATE, items);
    await appendEvent({ type: 'update', investorId: id, investor: merged, at: merged.updatedAt });
    return merged;
}
/** Set just the relationship status (pipeline move). Returns null if not found / invalid. */
export async function setInvestorStatus(id, status) {
    if (!VALID_STATUS.has(status))
        return null;
    return updateInvestor(id, { status });
}
/**
 * Overwrite the entire investor store in a single durable write. Used by the
 * dedup merge migration. Callers must pass the full, already-merged record set.
 */
export async function replaceAllInvestors(records) {
    await writeJsonFile(INVESTORS_STATE, records);
    await appendEvent({ type: 'replace_all', count: records.length, at: nowIso() });
}
/** Delete an investor record. Returns true if a record was removed. */
export async function deleteInvestor(id) {
    const items = await readJsonFile(INVESTORS_STATE, []);
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length)
        return false;
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
export async function importInvestors(inputs) {
    const items = await readJsonFile(INVESTORS_STATE, []);
    const created = [];
    const errors = [];
    const duplicateRows = [];
    // Seed the seen-set with existing records so a re-imported list never doubles
    // the CRM, and so duplicate rows WITHIN one import batch collapse to one record.
    const seen = new Set(items.map((r) => investorDedupeKey(r)));
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
/** Read-only roll-up over the CRM for the dashboard header. */
export async function summarizeInvestors() {
    const items = await readJsonFile(INVESTORS_STATE, []);
    const byStatus = {
        prospect: 0, contacted: 0, meeting_scheduled: 0, active: 0, invested: 0,
    };
    const bySource = {
        owner_entered: 0, submitted_form: 0, crm_import: 0, public_source: 0, verified_deal: 0,
    };
    const byPartyType = {
        investor: 0, buyer: 0, broker: 0, developer: 0, lender: 0, partner: 0,
    };
    let accredited = 0;
    let leadSum = 0;
    let relSum = 0;
    for (const item of items) {
        byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
        bySource[item.source] = (bySource[item.source] ?? 0) + 1;
        byPartyType[item.partyType] = (byPartyType[item.partyType] ?? 0) + 1;
        if (item.accreditedStatus === 'accredited')
            accredited += 1;
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
