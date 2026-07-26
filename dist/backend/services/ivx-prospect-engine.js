/**
 * IVX Prospect Engine — 20-Category Organic Growth System
 *
 * Extends the existing lead-discovery + scoring infrastructure with the full
 * 20-category prospect classification, 30+ field prospect record, 8-component
 * lead scoring, 13-state qualification status machine, and 8-signal dedup.
 *
 * HARD HONESTY RULES:
 *   - Never claims a person is interested/accredited/approved/committed without evidence
 *   - Capital ranges only stored when publicly stated
 *   - Accredited status never inferred from job title/wealth/property
 *   - Sources required for every record — no fabricated prospects
 */
import { randomUUID } from 'crypto';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_PROSPECT_ENGINE_MARKER = 'ivx-prospect-engine-2026-07-23';
export const ALL_PROSPECT_CATEGORIES = [
    'INDIVIDUAL_INVESTOR',
    'ACCREDITED_INVESTOR_CANDIDATE',
    'FAMILY_OFFICE',
    'PRIVATE_EQUITY',
    'REAL_ESTATE_FUND',
    'DIRECT_LENDER',
    'PRIVATE_LENDER',
    'INSTITUTIONAL_INVESTOR',
    'CORPORATE_BUYER',
    'INDIVIDUAL_BUYER',
    'DEVELOPER',
    'BUILDER',
    'LAND_OWNER',
    'JV_PARTNER',
    'BROKER',
    'REALTOR',
    'TOKENIZATION_PLATFORM',
    'DIGITAL_ASSET_INVESTOR',
    'INFLUENCER',
    'STRATEGIC_PARTNER',
];
export const QUALIFICATION_TRANSITIONS = {
    DISCOVERED: ['SOURCE_VERIFIED', 'NEEDS_REVIEW', 'DUPLICATE', 'STALE'],
    SOURCE_VERIFIED: ['POTENTIAL_MATCH', 'NEEDS_REVIEW', 'CONTACT_ELIGIBLE', 'DO_NOT_CONTACT', 'STALE'],
    NEEDS_REVIEW: ['SOURCE_VERIFIED', 'POTENTIAL_MATCH', 'NOT_QUALIFIED', 'STALE'],
    POTENTIAL_MATCH: ['CONTACT_ELIGIBLE', 'NOT_QUALIFIED', 'DO_NOT_CONTACT', 'STALE'],
    CONTACT_ELIGIBLE: ['CONTACTED', 'DO_NOT_CONTACT', 'STALE'],
    CONTACTED: ['RESPONDED', 'NOT_QUALIFIED', 'DO_NOT_CONTACT', 'STALE'],
    RESPONDED: ['QUALIFIED', 'NOT_QUALIFIED', 'DO_NOT_CONTACT'],
    QUALIFIED: ['CONVERTED', 'NOT_QUALIFIED', 'DO_NOT_CONTACT'],
    NOT_QUALIFIED: ['DO_NOT_CONTACT', 'STALE'],
    DO_NOT_CONTACT: [],
    DUPLICATE: [],
    STALE: ['DISCOVERED'],
    CONVERTED: [],
};
export function canTransitionTo(from, to) {
    const allowed = QUALIFICATION_TRANSITIONS[from] ?? [];
    return allowed.includes(to);
}
export function getScoreBand(score) {
    if (score >= 80)
        return 'HIGH_PRIORITY';
    if (score >= 60)
        return 'STRONG_MATCH';
    if (score >= 40)
        return 'REVIEW';
    if (score >= 20)
        return 'LOW_PRIORITY';
    return 'ARCHIVE';
}
/**
 * Calculate 8-component lead score with transparent per-component reasoning.
 * Every point assignment is documented in the reasons array.
 */
export function calculateLeadScore(input) {
    const clamp25 = (n) => Math.max(0, Math.min(25, Math.round(n)));
    const clamp15 = (n) => Math.max(0, Math.min(15, Math.round(n)));
    const clamp10 = (n) => Math.max(0, Math.min(10, Math.round(n)));
    const clamp5 = (n) => Math.max(0, Math.min(5, Math.round(n)));
    const ivx = clamp25(input.ivxOpportunityMatch);
    const geo = clamp15(input.geographicMatch);
    const deal = clamp15(input.propertyDealTypeMatch);
    const activity = clamp15(input.recentPublicActivity);
    const capital = clamp10(input.statedCapitalDealRange);
    const role = clamp10(input.roleDecisionAuthority);
    const source = clamp5(input.sourceQuality);
    const contact = clamp5(input.contactEligibility);
    const total = ivx + geo + deal + activity + capital + role + source + contact;
    const reasons = [
        `IVX opportunity match: ${ivx}/25`,
        `Geographic match: ${geo}/15`,
        `Property/deal-type match: ${deal}/15`,
        `Recent public activity: ${activity}/15`,
        `Stated capital/deal range: ${capital}/10`,
        `Role/decision authority: ${role}/10`,
        `Source quality: ${source}/5`,
        `Contact eligibility: ${contact}/5`,
        `TOTAL: ${total}/100 — Band: ${getScoreBand(total)}`,
    ];
    return {
        ivxOpportunityMatch: ivx,
        geographicMatch: geo,
        propertyDealTypeMatch: deal,
        recentPublicActivity: activity,
        statedCapitalDealRange: capital,
        roleDecisionAuthority: role,
        sourceQuality: source,
        contactEligibility: contact,
        total,
        reasons,
    };
}
export function normalizeName(name) {
    if (!name)
        return null;
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
export function extractDomain(url) {
    if (!url)
        return null;
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        return u.hostname.replace(/^www\./, '').toLowerCase();
    }
    catch {
        return null;
    }
}
export function hashValue(value) {
    if (!value)
        return null;
    // Simple hash for dedup — not a security hash
    let h = 0;
    for (let i = 0; i < value.length; i++) {
        h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    }
    return `h${Math.abs(h).toString(16)}`;
}
export function buildDedupSignals(prospect) {
    return {
        normalizedPersonName: normalizeName(prospect.personName ?? null),
        companyDomain: extractDomain(prospect.publicWebsite ?? null),
        emailHash: null, // Only set when lawfully stored
        phoneHash: null, // Only set when lawfully stored
        publicProfileUrl: prospect.publicProfileUrl ?? null,
        companyRegistrationId: null,
    };
}
/**
 * Check if two prospects are duplicates using 6 signals.
 * Any matching non-null signal = duplicate.
 */
export function isDuplicate(a, b) {
    if (a.normalizedPersonName && b.normalizedPersonName &&
        a.normalizedPersonName === b.normalizedPersonName)
        return true;
    if (a.companyDomain && b.companyDomain &&
        a.companyDomain === b.companyDomain)
        return true;
    if (a.emailHash && b.emailHash && a.emailHash === b.emailHash)
        return true;
    if (a.phoneHash && b.phoneHash && a.phoneHash === b.phoneHash)
        return true;
    if (a.publicProfileUrl && b.publicProfileUrl &&
        a.publicProfileUrl === b.publicProfileUrl)
        return true;
    if (a.companyRegistrationId && b.companyRegistrationId &&
        a.companyRegistrationId === b.companyRegistrationId)
        return true;
    return false;
}
// ─── Prospect Store ────────────────────────────────────────────────
const STORE_DIR = auditDir('growth-engine');
const PROSPECTS_FILE = path.join(STORE_DIR, 'prospects.json');
const PROSPECTS_LOG = path.join(STORE_DIR, 'prospects.jsonl');
let prospectCache = null;
async function loadProspects() {
    if (prospectCache)
        return prospectCache;
    if (isDurableStoreConfigured()) {
        prospectCache = await readDurableJson(PROSPECTS_FILE, []);
        return prospectCache;
    }
    try {
        const data = await readFile(PROSPECTS_FILE, 'utf8');
        prospectCache = JSON.parse(data);
        return prospectCache;
    }
    catch {
        prospectCache = [];
        return prospectCache;
    }
}
async function saveProspects(prospects) {
    prospectCache = prospects;
    if (isDurableStoreConfigured()) {
        await writeDurableJson(PROSPECTS_FILE, prospects);
        return;
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(PROSPECTS_FILE, JSON.stringify(prospects, null, 2), 'utf8');
}
async function logProspectEvent(event) {
    try {
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(PROSPECTS_LOG, event);
            return;
        }
        await mkdir(STORE_DIR, { recursive: true });
        await appendFile(PROSPECTS_LOG, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Best-effort logging
    }
}
/**
 * Create a new prospect with full dedup checking.
 * If a duplicate is found, returns the existing record with isDuplicate=true.
 */
export async function createProspect(input) {
    const now = new Date().toISOString();
    const prospects = await loadProspects();
    const newSignals = buildDedupSignals(input);
    // Check for duplicates against all existing prospects
    for (const existing of prospects) {
        const existingSignals = buildDedupSignals(existing);
        if (isDuplicate(newSignals, existingSignals)) {
            // Mark as duplicate, don't create new record
            const dupRecord = {
                ...existing,
                duplicateStatus: 'DUPLICATE_OF',
                duplicateOfProspectId: existing.prospectId,
                lastUpdated: now,
            };
            await logProspectEvent({
                action: 'duplicate_found',
                prospectId: existing.prospectId,
                timestamp: now,
                signals: newSignals,
            });
            return { prospect: dupRecord, isDuplicate: true, duplicateOfProspectId: existing.prospectId };
        }
    }
    const score = calculateLeadScore(input.scoreInput);
    const prospectId = `prospect-${randomUUID()}`;
    const defaultPermission = input.contactPermissionStatus ?? 'NO_CONTACT_AUTHORITY';
    const eligibility = defaultPermission === 'EMAIL_ELIGIBLE'
        ? 'ELIGIBLE'
        : defaultPermission === 'DO_NOT_CONTACT' || defaultPermission === 'UNSUBSCRIBED' || defaultPermission === 'SUPPRESSED'
            ? 'BLOCKED'
            : 'REVIEW_REQUIRED';
    const record = {
        prospectId,
        dateDiscovered: now,
        primaryCategory: input.primaryCategory,
        secondaryCategory: input.secondaryCategory ?? null,
        personName: input.personName ?? null,
        companyName: input.companyName ?? null,
        jobTitle: input.jobTitle ?? null,
        companyType: input.companyType ?? null,
        publicWebsite: input.publicWebsite ?? null,
        publicProfileUrl: input.publicProfileUrl ?? null,
        country: input.country ?? null,
        state: input.state ?? null,
        city: input.city ?? null,
        serviceArea: input.serviceArea ?? null,
        investmentOrBuyerFocus: input.investmentOrBuyerFocus ?? null,
        propertyTypes: input.propertyTypes ?? [],
        geographicFocus: input.geographicFocus ?? [],
        publiclyStatedCapitalRange: input.publiclyStatedCapitalRange ?? null,
        publiclyStatedDealSize: input.publiclyStatedDealSize ?? null,
        knownRecentActivity: input.knownRecentActivity ?? null,
        whyRelevantToIVX: input.whyRelevantToIVX,
        matchedIVXOpportunity: input.matchedIVXOpportunity ?? null,
        sourceUrls: input.sourceUrls,
        sourceDate: now,
        sourceConfidence: Math.max(0, Math.min(1, input.sourceConfidence)),
        contactChannelAvailable: input.contactChannelAvailable ?? null,
        contactPermissionStatus: defaultPermission,
        outreachEligibility: eligibility,
        leadScore: score.total,
        leadScoreBreakdown: score,
        qualificationStatus: 'DISCOVERED',
        accreditedStatus: input.accreditedStatus ?? 'ACCREDITED_STATUS_UNKNOWN',
        buyerStatus: input.buyerStatus ?? null,
        tokenizedSubType: input.tokenizedSubType ?? null,
        jvContributionType: input.jvContributionType ?? null,
        duplicateStatus: 'UNIQUE',
        duplicateOfProspectId: null,
        ownerReviewStatus: 'PENDING',
        lastUpdated: now,
    };
    prospects.push(record);
    await saveProspects(prospects);
    await logProspectEvent({
        action: 'prospect_created',
        prospectId,
        timestamp: now,
        category: input.primaryCategory,
        score: score.total,
    });
    return { prospect: record, isDuplicate: false, duplicateOfProspectId: null };
}
/**
 * Update a prospect's qualification status using the status machine.
 * Throws if the transition is not allowed.
 */
export async function updateQualificationStatus(prospectId, newStatus) {
    const prospects = await loadProspects();
    const idx = prospects.findIndex((p) => p.prospectId === prospectId);
    if (idx < 0)
        throw new Error(`Prospect not found: ${prospectId}`);
    const prospect = prospects[idx];
    if (!canTransitionTo(prospect.qualificationStatus, newStatus)) {
        throw new Error(`Invalid transition: ${prospect.qualificationStatus} → ${newStatus}. Allowed: ${QUALIFICATION_TRANSITIONS[prospect.qualificationStatus].join(', ')}`);
    }
    const now = new Date().toISOString();
    const updated = {
        ...prospect,
        qualificationStatus: newStatus,
        lastUpdated: now,
    };
    prospects[idx] = updated;
    await saveProspects(prospects);
    await logProspectEvent({
        action: 'qualification_updated',
        prospectId,
        from: prospect.qualificationStatus,
        to: newStatus,
        timestamp: now,
    });
    return updated;
}
/**
 * Set owner review status for a prospect.
 */
export async function setOwnerReview(prospectId, reviewStatus) {
    const prospects = await loadProspects();
    const idx = prospects.findIndex((p) => p.prospectId === prospectId);
    if (idx < 0)
        throw new Error(`Prospect not found: ${prospectId}`);
    const now = new Date().toISOString();
    const updated = {
        ...prospects[idx],
        ownerReviewStatus: reviewStatus,
        lastUpdated: now,
    };
    prospects[idx] = updated;
    await saveProspects(prospects);
    await logProspectEvent({
        action: 'owner_review_set',
        prospectId,
        reviewStatus,
        timestamp: now,
    });
    return updated;
}
// ─── Query Operations ──────────────────────────────────────────────
export async function listProspects(filter) {
    const prospects = await loadProspects();
    let filtered = prospects.filter((p) => p.duplicateStatus === 'UNIQUE');
    if (filter?.category) {
        filtered = filtered.filter((p) => p.primaryCategory === filter.category);
    }
    if (filter?.qualificationStatus) {
        filtered = filtered.filter((p) => p.qualificationStatus === filter.qualificationStatus);
    }
    if (filter?.minScore !== undefined) {
        filtered = filtered.filter((p) => p.leadScore >= (filter.minScore ?? 0));
    }
    if (filter?.ownerReviewStatus) {
        filtered = filtered.filter((p) => p.ownerReviewStatus === filter.ownerReviewStatus);
    }
    // Sort by score descending
    filtered.sort((a, b) => b.leadScore - a.leadScore);
    if (filter?.limit) {
        return filtered.slice(0, filter.limit);
    }
    return filtered;
}
export async function getProspectById(prospectId) {
    const prospects = await loadProspects();
    return prospects.find((p) => p.prospectId === prospectId) ?? null;
}
export async function getProspectSummary() {
    const prospects = await loadProspects();
    const unique = prospects.filter((p) => p.duplicateStatus === 'UNIQUE');
    const duplicates = prospects.filter((p) => p.duplicateStatus !== 'UNIQUE');
    const byCategory = {};
    const byQualificationStatus = {};
    const byScoreBand = {};
    const byOwnerReview = {};
    for (const p of unique) {
        byCategory[p.primaryCategory] = (byCategory[p.primaryCategory] ?? 0) + 1;
        byQualificationStatus[p.qualificationStatus] = (byQualificationStatus[p.qualificationStatus] ?? 0) + 1;
        const band = getScoreBand(p.leadScore);
        byScoreBand[band] = (byScoreBand[band] ?? 0) + 1;
        byOwnerReview[p.ownerReviewStatus] = (byOwnerReview[p.ownerReviewStatus] ?? 0) + 1;
    }
    const topProspects = unique
        .sort((a, b) => b.leadScore - a.leadScore)
        .slice(0, 25)
        .map((p) => ({
        prospectId: p.prospectId,
        personName: p.personName,
        companyName: p.companyName,
        primaryCategory: p.primaryCategory,
        leadScore: p.leadScore,
        qualificationStatus: p.qualificationStatus,
    }));
    return {
        total: prospects.length,
        unique: unique.length,
        duplicates: duplicates.length,
        byCategory,
        byQualificationStatus,
        byScoreBand,
        byOwnerReview,
        topProspects,
    };
}
export const DAILY_TARGETS = {
    MINIMUM: 100,
    STANDARD: 250,
    MAXIMUM: 500,
};
export async function getDailyTargetResult(date, target = 'STANDARD') {
    const prospects = await loadProspects();
    const dayStart = new Date(date + 'T00:00:00Z').getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const todayProspects = prospects.filter((p) => {
        const discovered = new Date(p.dateDiscovered).getTime();
        return discovered >= dayStart && discovered < dayEnd;
    });
    const unique = todayProspects.filter((p) => p.duplicateStatus === 'UNIQUE');
    const dups = todayProspects.filter((p) => p.duplicateStatus !== 'UNIQUE');
    return {
        date,
        target,
        targetCount: DAILY_TARGETS[target],
        discovered: unique.length,
        sourceVerified: unique.filter((p) => ['SOURCE_VERIFIED', 'POTENTIAL_MATCH', 'CONTACT_ELIGIBLE', 'CONTACTED', 'RESPONDED', 'QUALIFIED', 'CONVERTED'].includes(p.qualificationStatus)).length,
        potentialMatch: unique.filter((p) => ['POTENTIAL_MATCH', 'CONTACT_ELIGIBLE', 'CONTACTED', 'RESPONDED', 'QUALIFIED', 'CONVERTED'].includes(p.qualificationStatus)).length,
        contactEligible: unique.filter((p) => ['CONTACT_ELIGIBLE', 'CONTACTED', 'RESPONDED', 'QUALIFIED', 'CONVERTED'].includes(p.qualificationStatus)).length,
        contacted: unique.filter((p) => ['CONTACTED', 'RESPONDED', 'QUALIFIED', 'CONVERTED'].includes(p.qualificationStatus)).length,
        responded: unique.filter((p) => ['RESPONDED', 'QUALIFIED', 'CONVERTED'].includes(p.qualificationStatus)).length,
        qualified: unique.filter((p) => p.qualificationStatus === 'QUALIFIED' || p.qualificationStatus === 'CONVERTED').length,
        duplicatesRemoved: dups.length,
        suppressed: unique.filter((p) => p.outreachEligibility === 'SUPPRESSED' || p.contactPermissionStatus === 'SUPPRESSED').length,
    };
}
