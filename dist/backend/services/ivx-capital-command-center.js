/**
 * IVX Capital Deployment Platform — Capital Command Center (owner tablet dashboard).
 *
 * BLOCK 27 (item 9). The owner's at-a-glance command surface. When the owner opens
 * IVX on a tablet, this is the single read-only roll-up that answers "what should I
 * do with capital today?":
 *   - Best Investor Today      (top investor-role match across active deals)
 *   - Best Buyer Today         (top buyer-role match across active deals)
 *   - Best Opportunity Today   (top-scored active deal)
 *   - Capital Pipeline         (total / committed / raised / weighted + counts)
 *   - Meetings Needed          (pipeline entries that should advance to a meeting)
 *   - Follow-Ups Needed        (sent outreach awaiting a reply + stale CRM contacts)
 *   - Deals at Risk            (open tracked deals with real risk signals)
 *   - Capital Raised This Month(closed pipeline + closed-won tracked deals this month)
 *
 * HARD HONESTY RULE: every figure is derived from a real subsystem record
 * (Investor CRM, Capital Pipeline, Deal Matching, Deal Tracking, jv_deals). Nothing
 * is invented; an empty source reads as 0 / null with an honest note, never a guess.
 * Read-only + defensive — a failing reader degrades to an honest empty section.
 */
import { summarizePipeline, listPipelineEntries } from './ivx-capital-pipeline-store';
import { listInvestors } from './ivx-investor-crm-store';
import { listDeals } from './ivx-deal-tracking-store';
import { listOutreachMessages } from './ivx-outreach-store';
import { runDealMatching } from './ivx-deal-matching-engine';
import { readLandingProjects } from './ivx-project-data';
import { rankDeals } from './ivx-deal-intelligence';
export const IVX_CAPITAL_COMMAND_CENTER_MARKER = 'ivx-capital-command-center-2026-05-31';
/** Stages where the next concrete action is to book a meeting. */
const PRE_MEETING_STAGES = new Set([
    'qualified', 'contacted', 'interested',
]);
const STALE_CONTACT_DAYS = 14;
function bestMatchFor(matching, role) {
    let best = null;
    for (const set of matching.deals) {
        const candidate = set.best[role];
        if (candidate && (!best || candidate.matchScore > best.match.matchScore)) {
            best = { match: candidate, dealName: set.dealName };
        }
    }
    if (!best)
        return null;
    return {
        contactId: best.match.contactId,
        name: best.match.name,
        company: best.match.company,
        matchScore: best.match.matchScore,
        dealName: best.dealName,
        evidence: best.match.evidence.slice(0, 3),
    };
}
function bestOpportunity(scores) {
    const top = [...scores].sort((a, b) => b.weightedScore - a.weightedScore)[0];
    if (!top)
        return null;
    return {
        id: top.id,
        name: top.name,
        weightedScore: top.weightedScore,
        recommendation: top.recommendation,
        rationale: top.rationale,
    };
}
/** Pipeline entries sitting in a pre-meeting stage — a meeting is the next action. */
export function deriveMeetingsNeeded(entries) {
    return entries
        .filter((e) => PRE_MEETING_STAGES.has(e.stage))
        .map((e) => ({
        id: e.id,
        name: e.name,
        company: e.company,
        dealName: e.dealName,
        reason: `At "${e.stage}" — book a meeting to advance.`,
    }));
}
function daysSince(iso, now) {
    if (!iso)
        return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t))
        return null;
    return Math.floor((now - t) / (1000 * 60 * 60 * 24));
}
/**
 * Follow-ups: sent outreach still awaiting a reply, plus CRM contacts that were
 * contacted but have gone stale (no contact in 14+ days, not yet invested).
 */
export function deriveFollowUpsNeeded(outreach, contacts, now = Date.now()) {
    const items = [];
    for (const m of outreach) {
        if (m.status === 'sent' && !m.engagement.replied) {
            items.push({
                id: m.id,
                name: m.recipientName || m.recipientCompany || 'Recipient',
                company: m.recipientCompany,
                dealName: m.relatedDeal,
                reason: 'Sent — awaiting a reply.',
            });
        }
    }
    for (const c of contacts) {
        if (c.status === 'invested')
            continue;
        const age = daysSince(c.lastContactDate, now);
        if (c.status === 'contacted' && (age === null || age >= STALE_CONTACT_DAYS)) {
            items.push({
                id: c.id,
                name: c.name,
                company: c.company,
                dealName: '',
                reason: age === null ? 'Contacted — no recorded last-contact date.' : `No contact in ${age} days.`,
            });
        }
    }
    return items;
}
/** Open tracked deals carrying a real risk signal (no offers / low response / stalled). */
export function deriveDealsAtRisk(deals) {
    const items = [];
    for (const d of deals) {
        if (d.status === 'closed_won' || d.status === 'closed_lost')
            continue;
        const reasons = [];
        if (d.investorsContacted >= 5 && d.investorsResponded === 0) {
            reasons.push(`${d.investorsContacted} contacted, 0 responses`);
        }
        if (d.offersReceived === 0 && d.meetingsScheduled >= 3) {
            reasons.push(`${d.meetingsScheduled} meetings, 0 offers`);
        }
        if (d.capitalTarget !== null && (d.capitalCommitted ?? 0) === 0 && d.investorsContacted >= 3) {
            reasons.push('outreach started, $0 committed');
        }
        if (reasons.length > 0) {
            items.push({
                id: d.id,
                name: d.dealName,
                company: d.counterparty,
                dealName: d.dealName,
                reason: reasons.join('; '),
            });
        }
    }
    return items;
}
function isSameMonth(iso, now) {
    if (!iso)
        return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return false;
    return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}
/** Capital raised this calendar month: closed pipeline + closed-won tracked deals. */
export function deriveCapitalRaisedThisMonth(entries, deals, now = new Date()) {
    let total = 0;
    for (const e of entries) {
        if (e.stage === 'closed' && isSameMonth(e.updatedAt, now)) {
            total += e.capitalCommitted ?? 0;
        }
    }
    for (const d of deals) {
        if (d.status === 'closed_won' && isSameMonth(d.closedAt, now)) {
            total += d.capitalCommitted ?? 0;
        }
    }
    return Math.round(total);
}
function usd(value) {
    return `$${Math.round(value).toLocaleString('en-US')}`;
}
/**
 * Build the Capital Command Center snapshot. Read-only; gathers every source
 * defensively so one empty/failed reader never breaks the dashboard.
 */
export async function buildCapitalCommandCenter() {
    const now = new Date();
    const [pipelineSummary, pipelineEntries, contacts, deals, outreach, matching, projects] = await Promise.all([
        summarizePipeline().catch(() => null),
        listPipelineEntries().catch(() => []),
        listInvestors().catch(() => []),
        listDeals().catch(() => []),
        listOutreachMessages().catch(() => []),
        runDealMatching().catch(() => null),
        readLandingProjects().catch(() => null),
    ]);
    const bestInvestorToday = matching ? bestMatchFor(matching, 'investor') : null;
    const bestBuyerToday = matching ? bestMatchFor(matching, 'buyer') : null;
    const dealScores = projects && projects.ok ? rankDeals(projects.projects) : [];
    const bestOpportunityToday = bestOpportunity(dealScores);
    const capitalPipeline = {
        totalPipeline: pipelineSummary?.totalPipeline ?? 0,
        capitalCommitted: pipelineSummary?.capitalCommitted ?? 0,
        capitalRaised: pipelineSummary?.capitalRaised ?? 0,
        weightedPipeline: pipelineSummary?.weightedPipeline ?? 0,
        activeInvestors: pipelineSummary?.activeInvestors ?? 0,
        activeBuyers: pipelineSummary?.activeBuyers ?? 0,
        dealsInProgress: pipelineSummary?.dealsInProgress ?? 0,
    };
    const meetingsNeeded = deriveMeetingsNeeded(pipelineEntries);
    const followUpsNeeded = deriveFollowUpsNeeded(outreach, contacts, now.getTime());
    const dealsAtRisk = deriveDealsAtRisk(deals);
    const capitalRaisedThisMonth = deriveCapitalRaisedThisMonth(pipelineEntries, deals, now);
    const headline = `Capital Command Center — best investor today: ${bestInvestorToday ? `${bestInvestorToday.name} (${bestInvestorToday.matchScore}/100 on ${bestInvestorToday.dealName})` : 'none yet'}. Pipeline ${usd(capitalPipeline.totalPipeline)} open, ${usd(capitalRaisedThisMonth)} raised this month. ${meetingsNeeded.length} meeting(s) + ${followUpsNeeded.length} follow-up(s) needed, ${dealsAtRisk.length} deal(s) at risk.`;
    const empty = contacts.length === 0 && pipelineEntries.length === 0 && deals.length === 0;
    const note = empty
        ? 'No CRM, pipeline, or tracked-deal records yet — add capital relationships to populate the command center.'
        : 'Every figure is grounded in your live CRM, pipeline, matching, and deal-tracking records.';
    return {
        marker: IVX_CAPITAL_COMMAND_CENTER_MARKER,
        generatedAt: now.toISOString(),
        bestInvestorToday,
        bestBuyerToday,
        bestOpportunityToday,
        capitalPipeline,
        meetingsNeeded,
        followUpsNeeded,
        dealsAtRisk,
        capitalRaisedThisMonth,
        headline,
        note,
    };
}
