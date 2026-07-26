const ROI_WEIGHT = 0.4;
const RISK_WEIGHT = 0.25;
const TIMELINE_WEIGHT = 0.2;
const COMPLETION_WEIGHT = 0.15;
const BUY_THRESHOLD = 70;
const HOLD_THRESHOLD = 50;
/** ROI at/above this (%) earns a full ROI sub-score. */
const ROI_FULL_SCORE_PERCENT = 30;
/** Timelines at/below this (months) earn a full timeline sub-score. */
const TIMELINE_BEST_MONTHS = 12;
/** Timelines at/above this (months) earn the floor timeline sub-score. */
const TIMELINE_WORST_MONTHS = 36;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function round(value) {
    return Math.round(value * 10) / 10;
}
/** Parse "$1,400,000" / "1.4M" / "1,400,000" → 1400000. Returns null when absent. */
export function parseCurrency(value) {
    if (!value) {
        return null;
    }
    const normalized = value.trim().toLowerCase().replace(/[$,\s]/g, '');
    const multiplier = normalized.endsWith('m') ? 1_000_000 : normalized.endsWith('k') ? 1_000 : 1;
    const numeric = Number.parseFloat(normalized.replace(/[mk]$/i, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return numeric * multiplier;
}
/** Parse "30%" / "30" → 30. Returns null when absent. */
export function parsePercent(value) {
    if (!value) {
        return null;
    }
    const numeric = Number.parseFloat(value.replace(/[%\s]/g, ''));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
/**
 * Parse a timeline string into a representative month count. Handles ranges
 * ("14-24 months" → midpoint 19), single values ("18 months" → 18), and
 * year expressions ("2 years" → 24). Non-duration timelines like "Monthly"
 * (a distribution cadence, not a completion horizon) return null.
 */
export function parseTimelineMonths(value) {
    if (!value) {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    const isYears = /year|yr/.test(normalized);
    const numbers = (normalized.match(/\d+(?:\.\d+)?/g) ?? [])
        .map((n) => Number.parseFloat(n))
        .filter((n) => Number.isFinite(n) && n > 0);
    if (numbers.length === 0) {
        return null;
    }
    const average = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    const months = isYears ? average * 12 : average;
    return months > 0 ? round(months) : null;
}
function isActiveStatus(status) {
    if (!status) {
        return false;
    }
    return ['active', 'published', 'live'].includes(status.trim().toLowerCase());
}
export function extractDealMetrics(project) {
    const roiPercent = parsePercent(project.roi);
    const priceUsd = parseCurrency(project.price);
    const minOwnershipUsd = parseCurrency(project.ownershipMinimum);
    const timelineMonths = parseTimelineMonths(project.timeline);
    const coreFields = [roiPercent, priceUsd, minOwnershipUsd, timelineMonths, project.location];
    const presentCount = coreFields.filter((field) => field !== null && field !== undefined).length;
    return {
        roiPercent,
        priceUsd,
        minOwnershipUsd,
        timelineMonths,
        status: project.status,
        published: project.published,
        mediaCount: project.mediaCount,
        dataCompleteness: presentCount / coreFields.length,
    };
}
function scoreRoi(roiPercent) {
    if (roiPercent === null) {
        return 0;
    }
    return clamp((roiPercent / ROI_FULL_SCORE_PERCENT) * 100, 0, 100);
}
function scoreTimeline(timelineMonths) {
    if (timelineMonths === null) {
        // No completion horizon stated — neutral, not penal.
        return 50;
    }
    if (timelineMonths <= TIMELINE_BEST_MONTHS) {
        return 100;
    }
    if (timelineMonths >= TIMELINE_WORST_MONTHS) {
        return 20;
    }
    const span = TIMELINE_WORST_MONTHS - TIMELINE_BEST_MONTHS;
    const progress = (timelineMonths - TIMELINE_BEST_MONTHS) / span;
    return clamp(100 - progress * 80, 20, 100);
}
function scoreCompletion(metrics) {
    let score = 40;
    if (metrics.published) {
        score += 25;
    }
    if (isActiveStatus(metrics.status)) {
        score += 20;
    }
    if (metrics.mediaCount >= 3) {
        score += 15;
    }
    else if (metrics.mediaCount >= 1) {
        score += 8;
    }
    return clamp(score, 0, 100);
}
/** Risk score: HIGH score = LOW risk. Driven by data completeness, timeline length, and status. */
function scoreRisk(metrics) {
    let score = 100;
    // Missing economics is the biggest risk driver.
    score -= (1 - metrics.dataCompleteness) * 50;
    if (metrics.timelineMonths !== null && metrics.timelineMonths > 24) {
        score -= 15;
    }
    if (!metrics.published) {
        score -= 20;
    }
    if (!isActiveStatus(metrics.status)) {
        score -= 10;
    }
    if (metrics.mediaCount === 0) {
        score -= 10;
    }
    return clamp(score, 0, 100);
}
function detectRisks(project, metrics) {
    const risks = [];
    if (metrics.priceUsd === null) {
        risks.push('Missing price / property value — deal economics cannot be fully assessed.');
    }
    if (metrics.roiPercent === null) {
        risks.push('No stated expected ROI — return assumptions are undefined.');
    }
    if (metrics.timelineMonths !== null && metrics.timelineMonths > 24) {
        risks.push(`Long completion horizon (~${metrics.timelineMonths} months) increases execution and market-timing risk.`);
    }
    if (metrics.timelineMonths === null && !/month|quarter/i.test(project.timeline ?? '')) {
        risks.push('No completion timeline stated — exit timing is unclear.');
    }
    if (metrics.minOwnershipUsd === null) {
        risks.push('No minimum ownership stated — participation terms are undefined.');
    }
    if (!metrics.published) {
        risks.push('Deal is not published — it may be a draft and is not yet open to investors.');
    }
    if (metrics.mediaCount === 0) {
        risks.push('No media/photos attached — limited diligence material for the property.');
    }
    if (metrics.dataCompleteness < 0.6) {
        risks.push('Incomplete deal data — recommendation confidence is reduced until the deal room is filled in.');
    }
    return risks;
}
function recommend(weightedScore, metrics) {
    if (metrics.dataCompleteness < 0.4) {
        return 'insufficient-data';
    }
    if (weightedScore >= BUY_THRESHOLD) {
        return 'buy';
    }
    if (weightedScore >= HOLD_THRESHOLD) {
        return 'hold';
    }
    return 'avoid';
}
function buildRationale(name, recommendation, score, weighted) {
    const roiText = score.roiPercent !== null ? `${score.roiPercent}% expected ROI` : 'no stated ROI';
    const timelineText = score.timelineMonths !== null ? `~${score.timelineMonths}-month horizon` : 'an unstated horizon';
    switch (recommendation) {
        case 'buy':
            return `${name} scores ${round(weighted)}/100 — strong on ${roiText} over ${timelineText} with solid data completeness. Suitable for a core allocation after reading the deal-room documents.`;
        case 'hold':
            return `${name} scores ${round(weighted)}/100 — viable but mixed: ${roiText} over ${timelineText}, offset by timeline length, risk, or incomplete data. Reasonable as a smaller position or a watch-list deal.`;
        case 'avoid':
            return `${name} scores ${round(weighted)}/100 — weak on the weighted blend of ${roiText}, ${timelineText}, and risk/completion. Not a priority allocation at current terms.`;
        default:
            return `${name} has insufficient data to score confidently (${roiText}, ${timelineText}). Fill in the deal room before committing capital.`;
    }
}
export function scoreDeal(project) {
    const metrics = extractDealMetrics(project);
    const roiScore = scoreRoi(metrics.roiPercent);
    const timelineScore = scoreTimeline(metrics.timelineMonths);
    const riskScore = scoreRisk(metrics);
    const completionScore = scoreCompletion(metrics);
    const weightedScore = round(roiScore * ROI_WEIGHT + riskScore * RISK_WEIGHT + timelineScore * TIMELINE_WEIGHT + completionScore * COMPLETION_WEIGHT);
    const recommendation = recommend(weightedScore, metrics);
    const partial = {
        id: project.id,
        name: project.name,
        roiScore: round(roiScore),
        timelineScore: round(timelineScore),
        riskScore: round(riskScore),
        completionScore: round(completionScore),
        weightedScore,
        recommendation,
        rationale: '',
        risks: detectRisks(project, metrics),
        metrics,
    };
    partial.rationale = buildRationale(project.name, recommendation, metrics, weightedScore);
    return partial;
}
/** Score and rank every project, highest weighted score first. */
export function rankDeals(projects) {
    return projects
        .map(scoreDeal)
        .sort((a, b) => b.weightedScore - a.weightedScore);
}
function findScore(scores, query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    return (scores.find((s) => s.name.toLowerCase() === normalized || s.id.toLowerCase() === normalized) ??
        scores.find((s) => s.name.toLowerCase().includes(normalized) || normalized.includes(s.name.toLowerCase())) ??
        null);
}
function describeDiff(label, aValue, bValue, unit, higherIsBetter) {
    if (aValue === null && bValue === null) {
        return null;
    }
    if (aValue === null || bValue === null) {
        const known = aValue ?? bValue;
        const who = aValue === null ? 'B' : 'A';
        return `${label}: only ${who === 'A' ? 'A' : 'B'} states a value (${known}${unit}); the other is missing.`;
    }
    const delta = round(aValue - bValue);
    if (delta === 0) {
        return `${label}: equal (${aValue}${unit}).`;
    }
    const aheadName = (delta > 0) === higherIsBetter ? 'A' : 'B';
    return `${label}: A=${aValue}${unit} vs B=${bValue}${unit} (${aheadName} is stronger).`;
}
/** Compare two named/identified deals and explain the differences. */
export function compareDeals(projects, queryA, queryB) {
    const scores = projects.map(scoreDeal);
    const a = findScore(scores, queryA);
    const b = findScore(scores, queryB);
    const missing = [];
    if (!a) {
        missing.push(queryA);
    }
    if (!b) {
        missing.push(queryB);
    }
    if (!a || !b) {
        return {
            found: false,
            missing,
            a,
            b,
            winner: null,
            differences: [],
            summary: `Cannot compare — not found in the published projects: ${missing.join(', ')}.`,
        };
    }
    const differences = [
        describeDiff('Expected ROI', a.metrics.roiPercent, b.metrics.roiPercent, '%', true),
        describeDiff('Price', a.metrics.priceUsd, b.metrics.priceUsd, '', false),
        describeDiff('Timeline', a.metrics.timelineMonths, b.metrics.timelineMonths, ' mo', false),
        describeDiff('Min ownership', a.metrics.minOwnershipUsd, b.metrics.minOwnershipUsd, '', false),
        describeDiff('Weighted score', a.weightedScore, b.weightedScore, '/100', true),
    ].filter((line) => line !== null);
    const winner = a.weightedScore === b.weightedScore ? null : a.weightedScore > b.weightedScore ? a.name : b.name;
    const summary = winner
        ? `${winner} ranks higher overall (${Math.max(a.weightedScore, b.weightedScore)}/100 vs ${Math.min(a.weightedScore, b.weightedScore)}/100). ${a.name} → ${a.recommendation.toUpperCase()}, ${b.name} → ${b.recommendation.toUpperCase()}.`
        : `${a.name} and ${b.name} score evenly (${a.weightedScore}/100). Differentiate on the specific risks below.`;
    return { found: true, missing: [], a, b, winner, differences, summary };
}
/**
 * "Would you invest $X today?" — grounds a capital-allocation answer in the
 * ranked deals, the per-deal minimum ownership, and the recommendation tier.
 */
export function recommendInvestment(projects, amountUsd) {
    const ranked = rankDeals(projects);
    const affordable = ranked.filter((s) => s.metrics.minOwnershipUsd === null || s.metrics.minOwnershipUsd <= amountUsd);
    const blockedByMinimum = ranked.filter((s) => s.metrics.minOwnershipUsd !== null && s.metrics.minOwnershipUsd > amountUsd);
    const buyable = affordable.filter((s) => s.recommendation === 'buy');
    const topPick = buyable[0] ?? affordable[0] ?? ranked[0] ?? null;
    let rationale;
    if (!topPick) {
        rationale = `There are no published projects to allocate $${amountUsd.toLocaleString('en-US')} into right now.`;
    }
    else if (topPick.recommendation === 'buy') {
        rationale = `With $${amountUsd.toLocaleString('en-US')}, the strongest fit is ${topPick.name} (${topPick.weightedScore}/100, BUY). It clears the minimum and leads on the weighted ROI/risk/timeline blend.`;
    }
    else {
        rationale = `With $${amountUsd.toLocaleString('en-US')}, the best available option is ${topPick.name} (${topPick.weightedScore}/100, ${topPick.recommendation.toUpperCase()}). No deal currently rates a clear BUY, so size the position cautiously or wait for a stronger deal.`;
    }
    const caution = 'This is decision support, not financial advice or a guaranteed return. Confirm every number against the actual deal-room documents (budget, appraisal, proforma) before committing capital.';
    return { amountUsd, topPick, affordable, blockedByMinimum, rationale, caution };
}
function formatScoreLine(score, index) {
    const m = score.metrics;
    const parts = [
        m.roiPercent !== null ? `ROI ${m.roiPercent}%` : 'ROI n/a',
        m.priceUsd !== null ? `price $${m.priceUsd.toLocaleString('en-US')}` : 'price n/a',
        m.timelineMonths !== null ? `~${m.timelineMonths} mo` : 'timeline n/a',
        m.minOwnershipUsd !== null ? `min $${m.minOwnershipUsd.toLocaleString('en-US')}` : 'min n/a',
    ].join(', ');
    return `${index + 1}. ${score.name} — score ${score.weightedScore}/100 → ${score.recommendation.toUpperCase()} (${parts}). Risk sub-score ${score.riskScore}/100.`;
}
/**
 * Render a deal-intelligence grounding block from the live project data so the
 * model answers analytical questions ("rank all projects", "highest ROI",
 * "would you invest $X", "biggest risks") from the SAME scored numbers — instead
 * of improvising inconsistent analysis per message. Honest no-op when there are
 * no published projects (the business-context block already states that).
 */
export function buildDealIntelligenceBlock(projects) {
    if (!projects.ok || projects.projects.length === 0) {
        return null;
    }
    const ranked = rankDeals(projects.projects);
    const highestRoi = [...ranked]
        .filter((s) => s.metrics.roiPercent !== null)
        .sort((a, b) => (b.metrics.roiPercent ?? 0) - (a.metrics.roiPercent ?? 0))[0];
    const lines = [
        'IVX DEAL INTELLIGENCE (computed from the live jv_deals projects above — use these exact scores):',
        'Scoring model: weighted blend of ROI (40%), risk (25%), timeline (20%), completion (15%). buy ≥ 70, hold 50–69, avoid < 50, insufficient-data when key fields are missing. Scores are decision support, NOT guarantees.',
        '',
        'RANKING (best weighted score first):',
        ...ranked.map(formatScoreLine),
    ];
    if (highestRoi) {
        lines.push('', `HIGHEST ROI: ${highestRoi.name} at ${highestRoi.metrics.roiPercent}%.`);
    }
    const risky = ranked.filter((s) => s.risks.length > 0);
    if (risky.length > 0) {
        lines.push('', 'KEY RISKS PER DEAL:');
        for (const score of risky) {
            lines.push(`- ${score.name}: ${score.risks.join(' ')}`);
        }
    }
    lines.push('', 'When asked to rank, compare, recommend buy/hold/avoid, assess risk, or whether to invest a given amount, answer from these scores and minimum-ownership figures. Compare two deals by their ROI, price, timeline, min ownership, and weighted score. Never invent values that are not present; if a field is n/a, say so. Always add that this is decision support, not a guaranteed return, and that the deal-room documents (budget, appraisal, proforma) must be reviewed before committing capital.');
    return lines.join('\n');
}
