/**
 * IVX South Florida Luxury Capital Intelligence Network — durable store (owner-only).
 *
 * BLOCK 17 (revised). NOT a global-everything scanner. This stores the highest-
 * probability CAPITAL SOURCES for IVX's South Florida luxury real-estate offerings:
 * luxury buyers, real-estate investors, developers, and strategic partners — ranked
 * by how well they fit IVX's actual published deals.
 *
 * HARD HONESTY RULES (encoded throughout the engine that writes here):
 *   - NEVER fabricate named real individuals, companies, emails, phones, or social
 *     profiles. Records are high-probability PROSPECT PROFILES (segments / archetypes)
 *     derived from IVX's own deal data, plus the LEGITIMATE public sourcing channel
 *     where such prospects can actually be found + consented.
 *   - Optimize for QUALITY (highest-probability fit), not the largest number of names.
 *   - Unknown values stay null/empty — never invented.
 *   - Every profile carries an explicit compliance/privacy note.
 *
 * Durable layout (mirrors the proven ivx-opportunity-store pattern):
 *   logs/audit/capital-network/profiles.jsonl  append-only event log
 *   logs/audit/capital-network/profiles.json   materialised current state
 *
 * Runtime-light + deterministic: only filesystem I/O, no AI/network. Fully testable.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
export const IVX_CAPITAL_NETWORK_MARKER = 'ivx-capital-network-sfla-2026-05-30';
const NETWORK_ROOT = auditDir('capital-network');
const PROFILES_STATE = path.join(NETWORK_ROOT, 'profiles.json');
const VALID_TYPES = new Set(['buyer', 'investor', 'developer', 'partner']);
const VALID_STATUS = new Set([
    'new', 'researching', 'contacted', 'qualified', 'matched', 'dismissed',
]);
export const DEFAULT_COMPLIANCE_NOTE = 'High-probability prospect PROFILE (segment) derived from IVX deal data — not a fabricated individual or contact detail. ' +
    'Source named, consented contacts only through the listed public channels. Confirm Fair Housing, securities/accredited-investor, ' +
    'and privacy rules with licensed counsel before outreach. IVX never invents names, emails, or phone numbers.';
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
function normalizeScores(input) {
    return {
        confidence: clampScore(input?.confidence),
        relevance: clampScore(input?.relevance),
        dealFit: clampScore(input?.dealFit),
    };
}
/**
 * Blend the three ranking dimensions into one 0–100 fit score. Deal-fit and
 * relevance dominate (we optimize for the highest-probability capital source for
 * IVX's actual offerings); confidence tempers it. Deterministic + testable.
 */
export function computeProspectOverall(scores) {
    const blended = scores.dealFit * 0.42 + scores.relevance * 0.36 + scores.confidence * 0.22;
    return clampScore(blended);
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
    await mkdir(NETWORK_ROOT, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(event) {
    const eventFile = path.join(NETWORK_ROOT, 'profiles.jsonl');
    if (isDurableStoreConfigured()) {
        try {
            await appendDurableEvent(eventFile, event);
        }
        catch {
            // Forensic log is best-effort; never break a write on log failure.
        }
        return;
    }
    await mkdir(NETWORK_ROOT, { recursive: true });
    await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
}
export async function listProspects() {
    const items = await readJsonFile(PROFILES_STATE, []);
    return [...items].sort((a, b) => b.overall - a.overall || b.updatedAt.localeCompare(a.updatedAt));
}
/** Read a single prospect profile by id, or null if it does not exist. */
export async function getProspect(prospectId) {
    const items = await readJsonFile(PROFILES_STATE, []);
    return items.find((item) => item.id === prospectId) ?? null;
}
/**
 * Insert/refresh prospect profiles, de-duplicating by (type + normalized segment)
 * so repeated scans refine in place. Returns the ranked list. A reviewed profile's
 * status is preserved; matched deal names accumulate.
 */
export async function upsertProspects(inputs) {
    const existing = await readJsonFile(PROFILES_STATE, []);
    const keyOf = (type, segment) => `${type}::${segment.trim().toLowerCase()}`;
    const byKey = new Map(existing.map((item) => [keyOf(item.type, item.segment), item]));
    for (const input of inputs) {
        const type = VALID_TYPES.has(input.type) ? input.type : 'investor';
        const segment = input.segment.trim();
        if (!segment)
            continue;
        const key = keyOf(type, segment);
        const prior = byKey.get(key);
        const scores = normalizeScores(input.scores);
        const mergedDeals = Array.from(new Set([...(prior?.matchedDealNames ?? []), ...(input.matchedDealNames ?? [])].map((d) => d.trim()).filter(Boolean)));
        const profile = {
            id: prior?.id ?? createId('prospect'),
            type,
            segment,
            companyType: input.companyType.trim(),
            market: input.market.trim(),
            investmentFocus: input.investmentFocus.trim(),
            publicSource: input.publicSource.trim(),
            scores,
            overall: computeProspectOverall(scores),
            rationale: input.rationale.trim(),
            evidence: input.evidence.trim(),
            signal: input.signal.trim(),
            risks: (input.risks ?? []).map((r) => r.trim()).filter(Boolean),
            nextAction: input.nextAction.trim(),
            matchedDealNames: mergedDeals,
            complianceNote: (input.complianceNote ?? DEFAULT_COMPLIANCE_NOTE).trim(),
            status: prior?.status ?? 'new',
            createdAt: prior?.createdAt ?? nowIso(),
            updatedAt: nowIso(),
        };
        byKey.set(key, profile);
        await appendEvent({ type: 'upsert', profile, at: profile.updatedAt });
    }
    const next = Array.from(byKey.values());
    await writeJsonFile(PROFILES_STATE, next);
    return [...next].sort((a, b) => b.overall - a.overall);
}
export async function setProspectStatus(prospectId, status) {
    if (!VALID_STATUS.has(status))
        return null;
    const items = await readJsonFile(PROFILES_STATE, []);
    const index = items.findIndex((item) => item.id === prospectId);
    if (index === -1)
        return null;
    const updated = { ...items[index], status, updatedAt: nowIso() };
    items[index] = updated;
    await appendEvent({ type: 'set_status', prospectId, status, at: updated.updatedAt });
    await writeJsonFile(PROFILES_STATE, items);
    return updated;
}
