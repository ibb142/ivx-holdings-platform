/**
 * IVX Capital Deployment Platform — Lead Scoring Engine (owner-only).
 *
 * BLOCK 24. Scores every investor/buyer lead in the Investor CRM on a 0–100
 * scale and buckets them Hot / Warm / Cold, using ONLY evidence that actually
 * exists on the record + IVX's real deal data. No fabrication: a signal that is
 * not tracked (e.g. website analytics) is reported as unavailable and excluded
 * from the score denominator rather than guessed.
 *
 * Signals (each normalized 0–100, blended by weight over AVAILABLE signals only):
 *   - engagement        recency of last contact (lastContactDate)
 *   - communication     pipeline-status progression (prospect→invested)
 *   - capitalCapacity   parsed typical check size
 *   - dealInterest      owner-recorded relationship score
 *   - ownerJudgment     owner-recorded lead score
 *   - geographyFit      preferred markets ∩ IVX deal markets (from jv_deals)
 *   - assetClassFit     preferred asset classes ∩ IVX offering asset classes
 *   - websiteActivity   NOT TRACKED — always unavailable, never invented
 *
 * The pure scoring functions are deterministic and fully unit-testable; the
 * async `runLeadScoring()` grounds the geography context in the live `jv_deals`
 * reader and the leads in the durable Investor CRM store.
 */
import { listInvestors } from './ivx-investor-crm-store';
import { parseCurrency } from './ivx-deal-intelligence';
import { readLandingProjects } from './ivx-project-data';
export const IVX_LEAD_SCORING_MARKER = 'ivx-lead-scoring-2026-05-31';
/** IVX's real South Florida luxury offering asset classes (documented in BLOCK 17). */
export const IVX_OFFERING_ASSET_CLASSES = [
    'luxury homes', 'waterfront', 'development sites', 'land', 'multifamily', 'condos', 'luxury condos',
];
const HOT_THRESHOLD = 70;
const WARM_THRESHOLD = 45;
/** Status → progression sub-score. */
const STATUS_PROGRESSION = {
    prospect: 20,
    contacted: 45,
    meeting_scheduled: 70,
    active: 85,
    invested: 100,
};
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function round(value) {
    return Math.round(value);
}
function lower(value) {
    return value.trim().toLowerCase();
}
/** True if any term in `a` overlaps any term in `b` (substring either direction). */
function termsOverlap(a, b) {
    const left = a.map(lower).filter(Boolean);
    const right = b.map(lower).filter(Boolean);
    return left.some((l) => right.some((r) => l.includes(r) || r.includes(l)));
}
function scoreEngagement(lastContactDate, referenceDate) {
    const weight = 0.18;
    if (!lastContactDate) {
        return { key: 'engagement', label: 'Engagement (last contact)', available: false, score: 0, weight, detail: 'No last-contact date recorded.' };
    }
    const time = Date.parse(lastContactDate);
    if (!Number.isFinite(time)) {
        return { key: 'engagement', label: 'Engagement (last contact)', available: false, score: 0, weight, detail: 'Last-contact date is unparseable.' };
    }
    const days = Math.max(0, (referenceDate - time) / (1000 * 60 * 60 * 24));
    let score;
    if (days <= 14)
        score = 100;
    else if (days >= 180)
        score = 20;
    else
        score = clamp(100 - ((days - 14) / (180 - 14)) * 80, 20, 100);
    return {
        key: 'engagement',
        label: 'Engagement (last contact)',
        available: true,
        score: round(score),
        weight,
        detail: `Last contacted ~${Math.round(days)} day(s) ago.`,
    };
}
function scoreCommunication(status) {
    return {
        key: 'communication',
        label: 'Communication history (pipeline)',
        available: true,
        score: STATUS_PROGRESSION[status],
        weight: 0.18,
        detail: `Pipeline status: ${status.replace(/_/g, ' ')}.`,
    };
}
function scoreCapitalCapacity(typicalCheckSize) {
    const weight = 0.2;
    const parsed = parseCurrency(typicalCheckSize || null);
    if (parsed === null) {
        return { key: 'capitalCapacity', label: 'Capital capacity (check size)', available: false, score: 0, weight, detail: 'No typical check size recorded.' };
    }
    let score;
    if (parsed >= 1_000_000)
        score = 100;
    else if (parsed <= 50_000)
        score = 30;
    else
        score = clamp(40 + ((parsed - 50_000) / (1_000_000 - 50_000)) * 60, 30, 100);
    return {
        key: 'capitalCapacity',
        label: 'Capital capacity (check size)',
        available: true,
        score: round(score),
        weight,
        detail: `Typical check size ~$${parsed.toLocaleString('en-US')}.`,
    };
}
function scoreDealInterest(relationshipScore) {
    const weight = 0.16;
    if (relationshipScore <= 0) {
        return { key: 'dealInterest', label: 'Deal interest (relationship)', available: false, score: 0, weight, detail: 'No relationship score recorded.' };
    }
    return {
        key: 'dealInterest',
        label: 'Deal interest (relationship)',
        available: true,
        score: clamp(relationshipScore, 0, 100),
        weight,
        detail: `Owner-recorded relationship score ${relationshipScore}/100.`,
    };
}
function scoreOwnerJudgment(leadScore) {
    const weight = 0.15;
    if (leadScore <= 0) {
        return { key: 'ownerJudgment', label: 'Owner judgment (lead score)', available: false, score: 0, weight, detail: 'No owner lead score recorded.' };
    }
    return {
        key: 'ownerJudgment',
        label: 'Owner judgment (lead score)',
        available: true,
        score: clamp(leadScore, 0, 100),
        weight,
        detail: `Owner-recorded lead score ${leadScore}/100.`,
    };
}
function scoreGeographyFit(preferredMarkets, ivxMarkets) {
    const weight = 0.16;
    if (preferredMarkets.length === 0 || ivxMarkets.length === 0) {
        return {
            key: 'geographyFit',
            label: 'Geography fit (markets)',
            available: false,
            score: 0,
            weight,
            detail: preferredMarkets.length === 0 ? 'No preferred markets recorded.' : 'No IVX deal markets available to match against.',
        };
    }
    const overlap = termsOverlap(preferredMarkets, ivxMarkets);
    return {
        key: 'geographyFit',
        label: 'Geography fit (markets)',
        available: true,
        score: overlap ? 100 : 30,
        weight,
        detail: overlap ? 'Preferred markets overlap IVX deal markets.' : 'Preferred markets do not overlap current IVX deal markets.',
    };
}
function scoreAssetClassFit(preferredAssetClasses, ivxAssetClasses) {
    const weight = 0.12;
    if (preferredAssetClasses.length === 0 || ivxAssetClasses.length === 0) {
        return {
            key: 'assetClassFit',
            label: 'Asset-class fit',
            available: false,
            score: 0,
            weight,
            detail: preferredAssetClasses.length === 0 ? 'No preferred asset classes recorded.' : 'No IVX offering asset classes to match against.',
        };
    }
    const overlap = termsOverlap(preferredAssetClasses, ivxAssetClasses);
    return {
        key: 'assetClassFit',
        label: 'Asset-class fit',
        available: true,
        score: overlap ? 100 : 35,
        weight,
        detail: overlap ? 'Preferred asset classes overlap the IVX offering.' : 'Preferred asset classes do not overlap the IVX offering.',
    };
}
function scoreWebsiteActivity() {
    return {
        key: 'websiteActivity',
        label: 'Website activity',
        available: false,
        score: 0,
        weight: 0.1,
        detail: 'Not tracked — no analytics integration. Excluded from the score, never invented.',
    };
}
export function categorizeLead(overall) {
    if (overall >= HOT_THRESHOLD)
        return 'hot';
    if (overall >= WARM_THRESHOLD)
        return 'warm';
    return 'cold';
}
/** Score a single CRM record against the IVX context. Pure + deterministic. */
export function scoreLead(record, context) {
    const signals = [
        scoreEngagement(record.lastContactDate, context.referenceDate),
        scoreCommunication(record.status),
        scoreCapitalCapacity(record.typicalCheckSize),
        scoreDealInterest(record.relationshipScore),
        scoreOwnerJudgment(record.leadScore),
        scoreGeographyFit(record.preferredMarkets, context.ivxMarkets),
        scoreAssetClassFit(record.preferredAssetClasses, context.ivxAssetClasses),
        scoreWebsiteActivity(),
    ];
    const available = signals.filter((s) => s.available);
    const weightSum = available.reduce((sum, s) => sum + s.weight, 0);
    const overall = weightSum > 0
        ? round(available.reduce((sum, s) => sum + s.score * s.weight, 0) / weightSum)
        : 0;
    const category = categorizeLead(overall);
    const topPositive = [...available].sort((a, b) => b.score - a.score)[0];
    const rationale = available.length === 0
        ? 'Insufficient evidence to score — only the pipeline status is known.'
        : `${category.toUpperCase()} lead (${overall}/100) from ${available.length} evidenced signal(s)` +
            (topPositive ? `; strongest: ${topPositive.label} (${topPositive.score}/100).` : '.');
    return {
        id: record.id,
        name: record.name,
        company: record.company,
        status: record.status,
        overall,
        category,
        signals,
        evidenceCount: available.length,
        rationale,
    };
}
/** Derive lowercased IVX deal markets from the live project locations. */
export function deriveIvxMarkets(locations) {
    return Array.from(new Set(locations
        .map((loc) => (loc ? lower(loc) : ''))
        .filter(Boolean)));
}
export function summarizeLeadScores(leads) {
    const hot = leads.filter((l) => l.category === 'hot').length;
    const warm = leads.filter((l) => l.category === 'warm').length;
    const cold = leads.filter((l) => l.category === 'cold').length;
    const scored = leads.filter((l) => l.evidenceCount > 0).length;
    const avgScore = leads.length > 0 ? round(leads.reduce((sum, l) => sum + l.overall, 0) / leads.length) : 0;
    return { total: leads.length, hot, warm, cold, avgScore, scored };
}
/**
 * Score every CRM lead against the live IVX deal markets. Read-only; grounds the
 * geography signal in real `jv_deals` locations. Defensive — a failed project
 * read simply leaves the geography signal unavailable (never fabricated).
 */
export async function runLeadScoring() {
    const [investors, projects] = await Promise.all([
        listInvestors().catch(() => []),
        readLandingProjects().catch(() => null),
    ]);
    const ivxMarkets = projects && projects.ok
        ? deriveIvxMarkets(projects.projects.map((p) => p.location))
        : [];
    const ivxAssetClasses = IVX_OFFERING_ASSET_CLASSES.map((c) => c);
    const context = {
        ivxMarkets,
        ivxAssetClasses,
        referenceDate: Date.now(),
    };
    const leads = investors
        .map((record) => scoreLead(record, context))
        .sort((a, b) => b.overall - a.overall);
    return {
        marker: IVX_LEAD_SCORING_MARKER,
        generatedAt: new Date().toISOString(),
        context: {
            ivxMarkets,
            ivxAssetClasses,
            marketsSource: projects && projects.ok ? `jv_deals (${ivxMarkets.length} market(s))` : 'jv_deals unavailable — geography fit not scored',
        },
        leads,
        summary: summarizeLeadScores(leads),
    };
}
