/**
 * IVX Opportunity Dashboard aggregator (owner-only).
 *
 * Read-only reduction of the durable opportunity store into the tablet dashboard
 * the owner asked for:
 *   - top opportunities today (ranked by overall attractiveness)
 *   - highest ROI / upside
 *   - fastest execution
 *   - lowest risk
 *   - capital required + next action + AI confidence + evidence + risk warnings
 *   - active alerts
 *
 * Never mutates. Deterministic + runtime-light. Includes the multi-AI research
 * layer status so the owner can see which research sources are online.
 */
import { listAlerts, listOpportunities } from './ivx-opportunity-store';
import { buildResearchLayer } from './ivx-opportunity-engine';
export const IVX_OPPORTUNITY_DASHBOARD_MARKER = 'ivx-opportunity-dashboard-2026-05-30';
function maxBy(items, key) {
    if (items.length === 0)
        return null;
    return items.reduce((best, item) => (key(item) > key(best) ? item : best), items[0]);
}
export async function buildOpportunityDashboard() {
    const [opportunities, alerts] = await Promise.all([listOpportunities(), listAlerts(50)]);
    // Active opportunities (exclude dismissed/closed) drive the "best" picks.
    const active = opportunities.filter((o) => o.status !== 'dismissed' && o.status !== 'closed');
    const totals = {
        total: opportunities.length,
        new: opportunities.filter((o) => o.status === 'new').length,
        watching: opportunities.filter((o) => o.status === 'watching').length,
        pursuing: opportunities.filter((o) => o.status === 'pursuing').length,
        dismissed: opportunities.filter((o) => o.status === 'dismissed').length,
        closed: opportunities.filter((o) => o.status === 'closed').length,
    };
    const byCategory = {};
    for (const opp of opportunities) {
        byCategory[opp.category] = (byCategory[opp.category] ?? 0) + 1;
    }
    return {
        marker: IVX_OPPORTUNITY_DASHBOARD_MARKER,
        generatedAt: new Date().toISOString(),
        totals,
        byCategory,
        topToday: active.slice(0, 8),
        highestUpside: maxBy(active, (o) => o.scores.upside),
        fastestExecution: maxBy(active, (o) => o.scores.speed),
        lowestRisk: maxBy(active, (o) => o.scores.risk),
        alerts,
        unacknowledgedAlerts: alerts.filter((a) => !a.acknowledged).length,
        research: buildResearchLayer(),
    };
}
/**
 * Return the single best opportunity today with a structured rationale —
 * the answer to "Find today's best opportunity." Honest null when there are none.
 */
export function selectBestOpportunity(opportunities) {
    const active = opportunities.filter((o) => o.status !== 'dismissed' && o.status !== 'closed');
    if (active.length === 0)
        return null;
    return [...active].sort((a, b) => b.overall - a.overall)[0] ?? null;
}
