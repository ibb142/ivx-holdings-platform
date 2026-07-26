/**
 * IVX Business Development Orchestrator (owner-only, read/derive only).
 *
 * Runs the whole supervised BD pipeline in one pass and returns a single
 * structured report:
 *
 *   1. Buyer discovery        (ivx-buyer-discovery → SEC Form D, classified)
 *   2. Investor discovery     (ivx-investor-discovery → SEC Form D)
 *   3. Deal review            (ivx-opportunity-engine → scored opportunities)
 *   4. Technology discovery   (ivx-technology-discovery → ranked candidates)
 *   5. Opportunity scoring    (derived from the deal-review output)
 *   6. Outreach DRAFTS        (ivx-outreach-drafter → subject/body proposals)
 *
 * HARD OWNER GATE — the whole point of this module:
 *   - It NEVER sends outreach, emails, or calls. Drafts are proposals only.
 *   - It NEVER deploys anything.
 *   - Every produced artifact is marked `requiresOwnerApproval: true` and the
 *     report-level `ownerGate` block reports `outreachSent:false`,
 *     `emailsSent:false`, `callsPlaced:false`, `deployed:false`.
 *
 * Defensive: a failed stage degrades to an honest `ok:false` + reason for that
 * stage; the orchestrator never throws and never fabricates results.
 */
import { discoverBuyers } from './ivx-buyer-discovery';
import { discoverInvestors } from './ivx-investor-discovery';
import { runOpportunityScan } from './ivx-opportunity-engine';
import { runTechnologyDiscoveryScan } from './ivx-technology-discovery';
import { buildOutreachDraft, } from './ivx-outreach-drafter';
export const IVX_BIZDEV_ORCHESTRATOR_MARKER = 'ivx-bizdev-orchestrator-2026-06-12';
const COMPLIANCE_NOTE = 'Decision support only. Every record is sourced from public SEC EDGAR filings with a direct ' +
    'verification link. Outreach is DRAFTED only and never sent — owner approval is required before ' +
    'any contact, email, call, or deployment. No guaranteed returns, no fabricated leads.';
function ownerGate() {
    return {
        requiresOwnerApproval: true,
        outreachSent: false,
        emailsSent: false,
        callsPlaced: false,
        deployed: false,
        note: 'No outreach, email, call, or deployment was performed. Owner approval is required for any live action.',
    };
}
function errorMessage(error, fallback) {
    return error instanceof Error ? error.message : fallback;
}
/** Pick a sensible default outreach type for a target kind. */
function defaultOutreachType(kind) {
    return kind === 'buyer' ? 'buyer_intro' : 'investor_intro';
}
/**
 * Build owner-approval-required outreach DRAFTS for the top discovered targets.
 * Pure over already-discovered records; never sends, never invents contacts.
 */
export function buildOutreachDraftProposals(input) {
    const max = Math.min(Math.max(input.maxPerKind ?? 5, 0), 25);
    const proposals = [];
    for (const buyer of input.buyers.slice(0, max)) {
        const outreachType = defaultOutreachType('buyer');
        proposals.push({
            id: `draft-buyer-${buyer.cik}-${buyer.accessionNumber}`,
            targetEntity: buyer.entityName,
            targetType: 'buyer',
            outreachType,
            draft: buildOutreachDraft({
                type: outreachType,
                recipientCompany: buyer.entityName,
                contextNote: `Classified as ${buyer.buyerTypeLabel}. Public SEC filing: ${buyer.filingUrl}`,
                senderName: input.senderName,
            }),
            requiresOwnerApproval: true,
            status: 'draft',
        });
    }
    for (const investor of input.investors.slice(0, max)) {
        const outreachType = defaultOutreachType('investor');
        proposals.push({
            id: `draft-investor-${investor.cik}-${investor.accessionNumber}`,
            targetEntity: investor.entityName,
            targetType: 'investor',
            outreachType,
            draft: buildOutreachDraft({
                type: outreachType,
                recipientCompany: investor.entityName,
                contextNote: `Public SEC filing: ${investor.filingUrl}`,
                senderName: input.senderName,
            }),
            requiresOwnerApproval: true,
            status: 'draft',
        });
    }
    return proposals;
}
/**
 * Run the full owner-supervised BD pipeline. Read/derive only — never sends or
 * deploys. Each stage is independently defensive.
 */
export async function runBusinessDevelopmentOrchestrator(options = {}) {
    const generatedAt = new Date().toISOString();
    const query = options.query?.trim() || 'real estate';
    const limit = options.limit;
    const includeOutreachDrafts = options.includeOutreachDrafts !== false;
    // 1. Buyer discovery.
    let buyerStage;
    let buyers = [];
    try {
        const result = await discoverBuyers({
            query,
            buyerTypes: options.buyerTypes,
            limit,
            fetchImpl: options.fetchImpl,
            delayMs: options.delayMs,
        });
        buyers = result.buyers;
        buyerStage = {
            ok: result.ok,
            ran: true,
            error: result.error,
            data: { resultCount: result.resultCount, countsByType: result.countsByType, buyers: result.buyers },
        };
    }
    catch (error) {
        buyerStage = {
            ok: false,
            ran: true,
            error: errorMessage(error, 'Buyer discovery failed.'),
            data: {
                resultCount: 0,
                countsByType: {
                    cash_buyer: 0, family_office: 0, developer: 0, operator: 0,
                    acquisition_group: 0, broker: 0, reit: 0,
                },
                buyers: [],
            },
        };
    }
    // 2. Investor discovery.
    let investorStage;
    let investors = [];
    try {
        const result = await discoverInvestors({
            query,
            discoveryClass: 'jv_deals',
            limit,
            fetchImpl: options.fetchImpl,
            delayMs: options.delayMs,
        });
        investors = result.investors;
        investorStage = {
            ok: result.ok,
            ran: true,
            error: result.error,
            data: { resultCount: result.resultCount, investors: result.investors },
        };
    }
    catch (error) {
        investorStage = {
            ok: false,
            ran: true,
            error: errorMessage(error, 'Investor discovery failed.'),
            data: { resultCount: 0, investors: [] },
        };
    }
    // 3. Deal review + 5. opportunity scoring (both derive from the same scan).
    let dealStage;
    let scoringStage;
    try {
        const scan = await runOpportunityScan();
        const scored = scan.opportunities.map((opportunity) => ({
            id: opportunity.id,
            title: opportunity.title,
            category: opportunity.category,
            overallScore: opportunity.overall,
            riskScore: opportunity.scores.risk,
            recommendedAction: opportunity.executionPlan?.nextThreeActions?.[0] ?? 'Owner review required.',
            requiresOwnerApproval: true,
        }));
        const topScore = scored.length > 0
            ? scored.reduce((max, o) => Math.max(max, o.overallScore), 0)
            : null;
        dealStage = {
            ok: true,
            ran: true,
            error: null,
            data: { generatedCount: scan.generatedCount, opportunities: scored },
        };
        scoringStage = {
            ok: true,
            ran: true,
            error: null,
            data: { scoredCount: scored.length, topScore },
        };
    }
    catch (error) {
        const message = errorMessage(error, 'Deal review failed.');
        dealStage = { ok: false, ran: true, error: message, data: { generatedCount: 0, opportunities: [] } };
        scoringStage = { ok: false, ran: true, error: message, data: { scoredCount: 0, topScore: null } };
    }
    // 4. Technology discovery.
    let techStage;
    try {
        const result = await runTechnologyDiscoveryScan({ includeExternal: false });
        techStage = {
            ok: true,
            ran: true,
            error: null,
            data: { candidateCount: result.candidates.length, topRank: result.ranking.topRank },
        };
    }
    catch (error) {
        techStage = {
            ok: false,
            ran: true,
            error: errorMessage(error, 'Technology discovery failed.'),
            data: { candidateCount: 0, topRank: null },
        };
    }
    // 6. Outreach drafts (owner-approval-required, never sent).
    let outreachStage;
    if (includeOutreachDrafts) {
        const drafts = buildOutreachDraftProposals({ buyers, investors, senderName: options.senderName });
        outreachStage = {
            ok: true,
            ran: true,
            error: null,
            data: { draftCount: drafts.length, drafts },
        };
    }
    else {
        outreachStage = {
            ok: true,
            ran: false,
            error: null,
            data: { draftCount: 0, drafts: [] },
        };
    }
    const ok = buyerStage.ok && investorStage.ok && dealStage.ok && techStage.ok && scoringStage.ok && outreachStage.ok;
    return {
        ok,
        marker: IVX_BIZDEV_ORCHESTRATOR_MARKER,
        generatedAt,
        stages: {
            buyerDiscovery: buyerStage,
            investorDiscovery: investorStage,
            dealReview: dealStage,
            technologyDiscovery: techStage,
            opportunityScoring: scoringStage,
            outreachDrafts: outreachStage,
        },
        ownerGate: ownerGate(),
        complianceNote: COMPLIANCE_NOTE,
    };
}
