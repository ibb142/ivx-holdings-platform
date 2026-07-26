/**
 * IVX CRM — Deduplication, VIP tiering, lead scoring, and owner review (owner-only).
 *
 *   GET  /api/ivx/crm/dedup-audit   → live duplicate audit over the whole CRM
 *   POST /api/ivx/crm/dedup-merge   → merge duplicates (keep oldest, fold the rest)
 *   GET  /api/ivx/crm/vip           → VIP tier counts + scored, ranked records
 *   GET  /api/ivx/owner/review      → owner review queue (VIP, dupes, low-confidence, stale)
 *
 * One company = one CRM record per party type. Every number returned here is
 * computed live from the durable CRM store — never fabricated.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { listInvestors, replaceAllInvestors, } from '../services/ivx-investor-crm-store';
import { resolveCanonicalIdentity, parseCapitalUsd, tierForCapital, scoreLead, } from '../services/ivx-crm-canonical';
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
        }
        return null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
function canonicalOf(record) {
    return resolveCanonicalIdentity({
        name: record.name,
        company: record.company,
        email: record.email,
        phone: record.phone,
        notes: record.notes,
        sourceDetail: record.sourceDetail,
        partyType: record.partyType,
    }).canonicalCompanyId;
}
/** Group records by canonical company id (already party-type scoped). */
function groupByCanonical(records) {
    const groups = new Map();
    for (const record of records) {
        const key = canonicalOf(record);
        const bucket = groups.get(key);
        if (bucket)
            bucket.push(record);
        else
            groups.set(key, [record]);
    }
    return groups;
}
// ── PHASE 1: dedup audit ─────────────────────────────────────────────────────
export async function handleCrmDedupAuditRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const records = await listInvestors();
    const groups = groupByCanonical(records);
    const duplicates = [];
    let duplicateRecords = 0;
    for (const [, bucket] of groups) {
        if (bucket.length <= 1)
            continue;
        // Records over the first are the redundant copies.
        duplicateRecords += bucket.length - 1;
        const primary = bucket
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        duplicates.push({
            companyName: primary.company || primary.name,
            partyType: primary.partyType,
            recordCount: bucket.length,
            ids: bucket.map((r) => r.id),
        });
    }
    duplicates.sort((a, b) => b.recordCount - a.recordCount);
    const totalRecords = records.length;
    const uniqueCompanies = groups.size;
    return ownerOnlyJson({
        ok: true,
        totalRecords,
        uniqueCompanies,
        duplicateRecords,
        duplicateCompanies: duplicates.length,
        duplicatePercent: totalRecords > 0 ? Math.round((duplicateRecords / totalRecords) * 1000) / 10 : 0,
        duplicates,
        generatedAt: new Date().toISOString(),
    });
}
// ── PHASE 4: merge duplicates ────────────────────────────────────────────────
function mergeText(a, b) {
    const an = a.trim();
    const bn = b.trim();
    if (!an)
        return bn;
    if (!bn || an.includes(bn))
        return an;
    return `${an}\n${bn}`;
}
function unionStrings(a, b) {
    return Array.from(new Set([...a, ...b].map((s) => s.trim()).filter(Boolean)));
}
/** Fold all duplicate records of a canonical group into the oldest record. */
function mergeGroup(bucket) {
    const sorted = bucket.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const base = { ...sorted[0] };
    for (const dup of sorted.slice(1)) {
        base.company = base.company || dup.company;
        base.email = base.email || dup.email;
        base.phone = base.phone || dup.phone;
        base.location = base.location || dup.location;
        base.investmentType = base.investmentType || dup.investmentType;
        base.typicalCheckSize = base.typicalCheckSize || dup.typicalCheckSize;
        base.investmentTimeline = base.investmentTimeline || dup.investmentTimeline;
        base.notes = mergeText(base.notes, dup.notes);
        base.sourceDetail = mergeText(base.sourceDetail, dup.sourceDetail);
        base.preferredMarkets = unionStrings(base.preferredMarkets, dup.preferredMarkets);
        base.preferredAssetClasses = unionStrings(base.preferredAssetClasses, dup.preferredAssetClasses);
        base.leadScore = Math.max(base.leadScore, dup.leadScore);
        base.relationshipScore = Math.max(base.relationshipScore, dup.relationshipScore);
        if (dup.accreditedStatus === 'accredited')
            base.accreditedStatus = 'accredited';
        // Keep the most advanced pipeline status.
        const order = ['prospect', 'contacted', 'meeting_scheduled', 'active', 'invested'];
        if (order.indexOf(dup.status) > order.indexOf(base.status))
            base.status = dup.status;
        if (dup.lastContactDate && (!base.lastContactDate || dup.lastContactDate > base.lastContactDate)) {
            base.lastContactDate = dup.lastContactDate;
        }
    }
    base.updatedAt = new Date().toISOString();
    return base;
}
export async function handleCrmDedupMergeRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const records = await listInvestors();
    const beforeCount = records.length;
    const groups = groupByCanonical(records);
    const merged = [];
    let duplicatesRemoved = 0;
    for (const [, bucket] of groups) {
        if (bucket.length === 1) {
            merged.push(bucket[0]);
        }
        else {
            merged.push(mergeGroup(bucket));
            duplicatesRemoved += bucket.length - 1;
        }
    }
    if (duplicatesRemoved > 0) {
        await replaceAllInvestors(merged);
    }
    return ownerOnlyJson({
        ok: true,
        beforeCount,
        afterCount: merged.length,
        duplicatesRemoved,
        generatedAt: new Date().toISOString(),
    });
}
function scoreRecord(record) {
    const breakdown = scoreLead({
        name: record.name,
        company: record.company,
        email: record.email,
        phone: record.phone,
        notes: record.notes,
        sourceDetail: record.sourceDetail,
        typicalCheckSize: record.typicalCheckSize,
        preferredMarkets: record.preferredMarkets,
        preferredAssetClasses: record.preferredAssetClasses,
        relationshipScore: record.relationshipScore,
        createdAt: record.createdAt,
        lastContactDate: record.lastContactDate,
    });
    const capitalUsd = breakdown.capitalUsd ?? parseCapitalUsd(record.typicalCheckSize, record.notes);
    return {
        id: record.id,
        name: record.name,
        company: record.company,
        partyType: record.partyType,
        investorTier: tierForCapital(capitalUsd),
        capitalUsd,
        score: breakdown.score,
        band: breakdown.band,
    };
}
export async function handleCrmVipRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const records = await listInvestors();
    const scored = records.map(scoreRecord);
    const tierCounts = {
        VIP_PLATINUM: 0, VIP_GOLD: 0, VIP_SILVER: 0, EMERGING: 0,
    };
    const histogram = {
        VIP: 0, TIER1: 0, TIER2: 0, QUALIFIED: 0, COLD: 0, REJECT: 0,
    };
    for (const s of scored) {
        tierCounts[s.investorTier] += 1;
        histogram[s.band] += 1;
    }
    const investors = scored.filter((s) => s.partyType === 'investor');
    const buyers = scored.filter((s) => s.partyType === 'buyer');
    const byScore = (a, b) => b.score - a.score || (b.capitalUsd ?? 0) - (a.capitalUsd ?? 0);
    return ownerOnlyJson({
        ok: true,
        total: scored.length,
        tiers: {
            platinum: tierCounts.VIP_PLATINUM,
            gold: tierCounts.VIP_GOLD,
            silver: tierCounts.VIP_SILVER,
            emerging: tierCounts.EMERGING,
        },
        scoreHistogram: histogram,
        topInvestors: investors.slice().sort(byScore).slice(0, 20),
        topBuyers: buyers.slice().sort(byScore).slice(0, 20),
        generatedAt: new Date().toISOString(),
    });
}
// ── PHASE 7: owner review queue ──────────────────────────────────────────────
export async function handleOwnerReviewRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const records = await listInvestors();
    const now = Date.now();
    const STALE_DAYS = 30;
    const groups = groupByCanonical(records);
    const duplicateCandidates = [];
    for (const [, bucket] of groups) {
        if (bucket.length <= 1)
            continue;
        const primary = bucket.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        duplicateCandidates.push({
            companyName: primary.company || primary.name,
            partyType: primary.partyType,
            ids: bucket.map((r) => r.id),
        });
    }
    const scored = records.map((r) => ({ record: r, scored: scoreRecord(r) }));
    const vipInvestors = scored
        .filter((s) => s.scored.investorTier === 'VIP_PLATINUM' || s.scored.investorTier === 'VIP_GOLD')
        .map((s) => s.scored)
        .sort((a, b) => (b.capitalUsd ?? 0) - (a.capitalUsd ?? 0));
    const lowConfidence = scored
        .filter((s) => s.scored.score < 50 && s.scored.score >= 25)
        .map((s) => ({ id: s.record.id, name: s.record.name, score: s.scored.score }));
    const staleRecords = records
        .filter((r) => {
        const updated = Date.parse(r.updatedAt);
        return Number.isFinite(updated) && (now - updated) / (1000 * 60 * 60 * 24) > STALE_DAYS;
    })
        .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt }));
    const noActivity = records
        .filter((r) => !r.lastContactDate && r.status === 'prospect')
        .map((r) => ({ id: r.id, name: r.name, status: r.status }));
    return ownerOnlyJson({
        ok: true,
        counts: {
            vipInvestors: vipInvestors.length,
            duplicateCandidates: duplicateCandidates.length,
            lowConfidence: lowConfidence.length,
            staleRecords: staleRecords.length,
            noActivity: noActivity.length,
        },
        vipInvestors: vipInvestors.slice(0, 50),
        duplicateCandidates: duplicateCandidates.slice(0, 50),
        lowConfidence: lowConfidence.slice(0, 50),
        staleRecords: staleRecords.slice(0, 50),
        noActivity: noActivity.slice(0, 50),
        generatedAt: new Date().toISOString(),
    });
}
