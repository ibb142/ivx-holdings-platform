import { upsertIdeas, listIdeas, } from './ivx-innovation-store';
export const IVX_INNOVATION_ENGINE_MARKER = 'ivx-innovation-engine-2026-05-30';
/**
 * Collect every signal source. Read-only and defensive — a failed reader never
 * throws; it degrades to an honest empty/zero signal so the scan always runs.
 */
export async function collectInnovationSignals(options = {}) {
    const scannedAt = new Date().toISOString();
    // Lazy-import the heavy signal readers so this module's pure logic
    // (deriveIdeasFromSignals / parseRoiPercent) stays importable + testable
    // without pulling in the AI runtime chain.
    let projects = null;
    try {
        const { readLandingProjects } = await import('./ivx-project-data');
        projects = await readLandingProjects();
    }
    catch {
        projects = null;
    }
    let dashboard = null;
    try {
        const { buildAutonomousDashboard } = await import('./ivx-autonomous-core');
        dashboard = await buildAutonomousDashboard();
    }
    catch {
        dashboard = null;
    }
    const incidents = await (async () => {
        try {
            const { listIncidents } = await import('./ivx-incident-store');
            return listIncidents(200);
        }
        catch {
            return [];
        }
    })();
    const publishedProjects = projects?.publishedCount ?? projects?.projects.length ?? 0;
    const projectsWithoutMedia = projects?.projects.filter((p) => (p.mediaCount ?? 0) === 0).length ?? 0;
    const rois = (projects?.projects ?? [])
        .map((p) => parseRoiPercent(p.roi))
        .filter((value) => value !== null);
    const avgRoiPercent = rois.length > 0 ? Math.round(rois.reduce((a, b) => a + b, 0) / rois.length) : null;
    const openIncidents = incidents.filter((i) => i.status === 'open' || i.status === 'diagnosing').length;
    const failedWork = dashboard?.buckets.failed ?? 0;
    const blockedWork = dashboard?.buckets.blocked ?? 0;
    const missingCapabilities = dashboard?.capabilities.filter((c) => c.state === 'missing').length ?? 0;
    const partialCapabilities = dashboard?.capabilities.filter((c) => c.state === 'partial').length ?? 0;
    const portfolioConcentration = publishedProjects === 0 ? 'empty' : publishedProjects < 3 ? 'thin' : 'diversifying';
    return {
        scannedAt,
        ivxData: {
            ok: projects?.ok ?? false,
            publishedProjects,
            projectsWithoutMedia,
            avgRoiPercent,
            reason: projects?.ok === false ? projects.error ?? 'project source unavailable' : null,
        },
        userBehavior: {
            estimatedConversations: Math.max(0, Math.floor(options.conversationCount ?? 0)),
            note: 'Conversation volume is a demand proxy; richer behavior analytics can be wired later.',
        },
        performance: { openIncidents, failedWork, blockedWork },
        market: { portfolioConcentration, publishedProjects },
        competitor: { missingCapabilities, partialCapabilities },
    };
}
/** Parse a human-readable ROI string ("30%", "expected 14%") into a number. */
export function parseRoiPercent(value) {
    if (!value)
        return null;
    const match = String(value).match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (!match)
        return null;
    const n = Number.parseFloat(match[1]);
    return Number.isFinite(n) ? n : null;
}
/**
 * Derive scored idea candidates from the signal snapshot. Every idea is grounded
 * in a real signal value (placed into `evidence`), so the output reflects the
 * platform's actual state rather than a fixed list.
 */
export function deriveIdeasFromSignals(signal) {
    const ideas = [];
    // ── ivx_data signals ───────────────────────────────────────────────────
    if (signal.ivxData.projectsWithoutMedia > 0) {
        ideas.push({
            title: 'Auto-generated visual deal sheets for media-light projects',
            summary: 'Generate a polished one-page visual deal sheet (renders, key economics, map) for projects that currently have no media, lifting investor confidence and conversion.',
            category: 'product',
            signalSource: 'ivx_data',
            evidence: `${signal.ivxData.projectsWithoutMedia} published project(s) have zero media attached.`,
            scores: { confidence: 72, impact: 70, feasibility: 65, revenue: 58, complexity: 45 },
        });
    }
    if (signal.ivxData.avgRoiPercent !== null) {
        ideas.push({
            title: 'Investor ROI-fit matching engine',
            summary: 'Match each investor to deals whose ROI/timeline/minimum fit their stated profile, then surface a personalized shortlist — turning the portfolio into a guided recommendation experience.',
            category: 'ai_workflow',
            signalSource: 'ivx_data',
            evidence: `Portfolio average ROI ≈ ${signal.ivxData.avgRoiPercent}% across published deals — enough spread to match profiles.`,
            scores: { confidence: 68, impact: 76, feasibility: 60, revenue: 72, complexity: 58 },
        });
    }
    // ── market signals ─────────────────────────────────────────────────────
    if (signal.market.portfolioConcentration !== 'diversifying') {
        ideas.push({
            title: 'Fractional-share secondary marketplace',
            summary: 'Let investors trade their fractional positions to each other, adding liquidity to JV deals — a differentiator most real-estate-JV platforms lack.',
            category: 'business_model',
            signalSource: 'market',
            evidence: `Portfolio is "${signal.market.portfolioConcentration}" (${signal.market.publishedProjects} published) — liquidity tooling is a natural growth lever.`,
            scores: { confidence: 55, impact: 82, feasibility: 40, revenue: 80, complexity: 78 },
        });
    }
    // ── performance signals ────────────────────────────────────────────────
    if (signal.performance.openIncidents > 0 || signal.performance.failedWork > 0) {
        ideas.push({
            title: 'Self-healing reliability watchdog with auto-rollback',
            summary: 'Continuously watch production health and auto-roll-back or hotfix safe regressions before users notice, reducing downtime risk as the platform scales.',
            category: 'platform_capability',
            signalSource: 'performance',
            evidence: `${signal.performance.openIncidents} open incident(s), ${signal.performance.failedWork} failed work item(s) detected by the autonomous core.`,
            scores: { confidence: 70, impact: 74, feasibility: 62, revenue: 35, complexity: 60 },
        });
    }
    // ── competitor / capability-gap signals ────────────────────────────────
    if (signal.competitor.missingCapabilities > 0 || signal.competitor.partialCapabilities > 0) {
        ideas.push({
            title: 'Document-intelligence underwriting copilot',
            summary: 'Turn uploaded deal-room documents into an automated underwriting summary (NOI, cap rate, risk flags) reviewed by the AI, closing the gap with institutional analyst tooling.',
            category: 'technology_concept',
            signalSource: 'competitor',
            evidence: `${signal.competitor.missingCapabilities} missing + ${signal.competitor.partialCapabilities} partial autonomous-core capabilities indicate room to out-build competitors.`,
            scores: { confidence: 64, impact: 80, feasibility: 55, revenue: 74, complexity: 66 },
        });
    }
    // ── user_behavior signals ──────────────────────────────────────────────
    if (signal.userBehavior.estimatedConversations >= 0) {
        ideas.push({
            title: 'Proactive investor digest from chat insights',
            summary: 'Summarize what investors ask most into a weekly proactive digest (new deals matching their questions, answers to common concerns), driving re-engagement and conversion.',
            category: 'ai_workflow',
            signalSource: 'user_behavior',
            evidence: `~${signal.userBehavior.estimatedConversations} tracked conversation(s); recurring questions can be mined into proactive outreach.`,
            scores: { confidence: 60, impact: 66, feasibility: 70, revenue: 64, complexity: 42 },
        });
    }
    return ideas;
}
/**
 * Run one full scan: collect signals → derive scored ideas → persist (de-duped)
 * → return the refreshed, priority-ranked idea list. This is the single entry
 * point the Innovation Dashboard / "Improve IVX today" flow calls.
 */
export async function runInnovationScan(options = {}) {
    const { withAgentRun } = await import('./ivx-agent-activity-store');
    return withAgentRun({
        kind: 'innovation_scan',
        label: 'Innovation scan',
        why: 'Generate and score new product / business / AI ideas from real IVX signals.',
        detail: 'Collecting innovation signals across ivx_data, user behavior, performance, market, competitor…',
        proofOf: (result) => `Generated ${result.generatedCount} idea(s); ${result.ideas.length} total in backlog.`,
    }, async () => {
        const signal = await collectInnovationSignals(options);
        const candidates = deriveIdeasFromSignals(signal);
        if (candidates.length > 0) {
            await upsertIdeas(candidates);
        }
        const ideas = await listIdeas();
        console.log('[IVXInnovationEngine] SCAN', {
            marker: IVX_INNOVATION_ENGINE_MARKER,
            generated: candidates.length,
            total: ideas.length,
        });
        return {
            marker: IVX_INNOVATION_ENGINE_MARKER,
            scannedAt: signal.scannedAt,
            signal,
            generatedCount: candidates.length,
            ideas,
        };
    });
}
