/**
 * IVX Innovation Dashboard aggregator.
 *
 * Reduces the durable innovation store (ideas + hypotheses + experiments) into
 * the metrics the owner's Innovation Dashboard requires:
 *
 *   inventions proposed / approved / rejected / shipped
 *   experiments running / completed
 *   estimated business value
 *
 * Read-only; never mutates. "Estimated business value" is a transparent,
 * deterministic roll-up so the number is explainable (no magic constant): each
 * idea contributes a value weighted by its revenue + impact scores and its
 * review status (approved/shipped count fully, proposed at a discount, rejected
 * at zero). The per-idea unit value is bounded so the total stays interpretable.
 */
import { listExperiments, listHypotheses, listIdeas, } from './ivx-innovation-store';
export const IVX_INNOVATION_DASHBOARD_MARKER = 'ivx-innovation-dashboard-2026-05-30';
/** Per-idea business value ceiling (USD) used to keep the estimate interpretable. */
export const IDEA_VALUE_CEILING_USD = 250_000;
/**
 * Deterministic per-idea value. Revenue + impact dominate; review status scales
 * the contribution (shipped/approved 100%, proposed 35%, rejected 0%). Result is
 * an integer USD figure capped at IDEA_VALUE_CEILING_USD.
 */
export function estimateIdeaValueUsd(idea) {
    const statusWeight = idea.status === 'shipped' || idea.status === 'approved' ? 1 :
        idea.status === 'proposed' ? 0.35 :
            0;
    if (statusWeight === 0)
        return 0;
    // Blend revenue (0–100) + impact (0–100) into a 0–1 factor.
    const merit = (idea.scores.revenue * 0.6 + idea.scores.impact * 0.4) / 100;
    return Math.round(IDEA_VALUE_CEILING_USD * merit * statusWeight);
}
export async function buildInnovationDashboard() {
    const [ideas, hypotheses, experiments] = await Promise.all([
        listIdeas(),
        listHypotheses(),
        listExperiments(),
    ]);
    const inventions = {
        proposed: ideas.filter((i) => i.status === 'proposed').length,
        approved: ideas.filter((i) => i.status === 'approved').length,
        rejected: ideas.filter((i) => i.status === 'rejected').length,
        shipped: ideas.filter((i) => i.status === 'shipped').length,
        total: ideas.length,
    };
    const experimentBuckets = {
        planned: experiments.filter((e) => e.status === 'planned').length,
        running: experiments.filter((e) => e.status === 'running').length,
        completed: experiments.filter((e) => e.status === 'completed').length,
        abandoned: experiments.filter((e) => e.status === 'abandoned').length,
        total: experiments.length,
    };
    const hypothesisBuckets = {
        open: hypotheses.filter((h) => h.status === 'open').length,
        testing: hypotheses.filter((h) => h.status === 'testing').length,
        validated: hypotheses.filter((h) => h.status === 'validated').length,
        invalidated: hypotheses.filter((h) => h.status === 'invalidated').length,
        total: hypotheses.length,
    };
    const estimatedBusinessValueUsd = ideas.reduce((sum, idea) => sum + estimateIdeaValueUsd(idea), 0);
    return {
        marker: IVX_INNOVATION_DASHBOARD_MARKER,
        generatedAt: new Date().toISOString(),
        inventions,
        experiments: experimentBuckets,
        hypotheses: hypothesisBuckets,
        estimatedBusinessValueUsd,
        topIdeas: ideas.slice(0, 8),
    };
}
