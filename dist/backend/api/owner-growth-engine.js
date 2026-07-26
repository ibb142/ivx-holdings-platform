/**
 * Owner-only Autonomous Growth Engine routes.
 *
 * Surfaces the IVX IA growth engine (idea generation, investor/buyer discovery, JV deal
 * structuring, tokenization drafting, app/module specs, outreach drafting) behind the
 * owner guard. Read/derive/draft actions run immediately; anything that touches money,
 * contracts, legal claims, securities, deployment, or outbound comms is staged and
 * reported as requiring owner approval (OWNER_CONTROL_GATES).
 *
 * Routes (all owner-guarded):
 *   GET  /api/growth/overview          engine roll-up + live capabilities
 *   GET  /api/growth/capabilities      capability + remaining-dependency report
 *   POST /api/growth/ideas             IDEA_ENGINE — generate + rank concepts
 *   GET  /api/growth/ideas             list generated ideas
 *   POST /api/growth/leads             INVESTOR_BUYER_DISCOVERY / AUTONOMOUS_SEARCH
 *   GET  /api/growth/leads             list staged leads
 *   POST /api/growth/leads/:id/approve owner approval → promote lead into CRM (no send)
 *   POST /api/growth/leads/:id/reject  owner rejection
 *   POST /api/growth/jv                JV_DEAL_ENGINE — draft a JV structure
 *   GET  /api/growth/jv                list JV drafts
 *   POST /api/growth/tokenization      TOKENIZATION_ENGINE — draft a tokenized concept
 *   GET  /api/growth/tokenization      list tokenization drafts
 *   POST /api/growth/modules           APP_AND_MODULE_CREATOR — draft a build spec
 *   GET  /api/growth/modules           list module specs
 *   POST /api/growth/outreach          OUTREACH_PREP — draft an outreach message
 *   GET  /api/growth/outreach          list outreach drafts
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { approveLead, discoverLeads, listLeads, leadAuditLog, masterLeadList, masterListCounts, rejectLead, } from '../services/ivx-lead-discovery';
import { draftJVDeal, draftModuleSpec, draftOutreachMessage, draftTokenization, generateIdeas, getGrowthEngineCapabilities, getGrowthEngineOverview, listIdeas, listJVDeals, listModuleSpecs, listOutreachDrafts, listTokenizationConcepts, } from '../services/ivx-growth-engine';
const DEPLOYMENT_MARKER = 'ivx-owner-growth-engine-2026-06-15';
function nowIso() {
    return new Date().toISOString();
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function readJsonBody(request) {
    return (await request.json().catch(() => ({})));
}
function getErrorStatus(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('missing bearer token') || message.includes('invalid or expired'))
        return 401;
    if (message.includes('privileged ivx access is required'))
        return 403;
    if (message.includes('required') || message.includes('not found'))
        return 400;
    return 500;
}
async function withOwner(request, fn) {
    try {
        await assertIVXOwnerOnly(request);
        const payload = await fn();
        return ownerOnlyJson({ ok: true, deploymentMarker: DEPLOYMENT_MARKER, ...payload });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Growth engine error.';
        return ownerOnlyJson({ ok: false, error: message, detail: message, deploymentMarker: DEPLOYMENT_MARKER }, getErrorStatus(error));
    }
}
const VALID_IDEA_CATEGORIES = new Set(['venture', 'technology', 'real_estate', 'ai', 'tokenization', 'jv']);
function parseCategories(value) {
    if (!Array.isArray(value))
        return undefined;
    const parsed = value
        .map((v) => readTrimmed(v))
        .filter((v) => VALID_IDEA_CATEGORIES.has(v));
    return parsed.length > 0 ? parsed : undefined;
}
/* ---------------- overview + capabilities ---------------- */
export async function handleGrowthOverview(request) {
    return withOwner(request, async () => ({ overview: await getGrowthEngineOverview(), timestamp: nowIso() }));
}
export async function handleGrowthCapabilities(request) {
    return withOwner(request, async () => ({ capabilities: getGrowthEngineCapabilities(), timestamp: nowIso() }));
}
/* ---------------- IDEA_ENGINE ---------------- */
export async function handleGrowthIdeaGenerate(request) {
    return withOwner(request, async () => {
        const body = await readJsonBody(request);
        const ideas = await generateIdeas({
            focus: readTrimmed(body.focus) || undefined,
            categories: parseCategories(body.categories),
            limit: typeof body.limit === 'number' ? body.limit : undefined,
        });
        return { ideas, count: ideas.length, timestamp: nowIso() };
    });
}
export async function handleGrowthIdeaList(request) {
    return withOwner(request, async () => {
        const ideas = await listIdeas();
        return { ideas, count: ideas.length, timestamp: nowIso() };
    });
}
/* ---------------- INVESTOR_BUYER_DISCOVERY / AUTONOMOUS_SEARCH ---------------- */
const VALID_DISCOVERY_CLASSES = new Set(['buyers', 'jv_deals']);
export async function handleGrowthLeadDiscover(request) {
    return withOwner(request, async () => {
        const body = await readJsonBody(request);
        const discoveryClassRaw = readTrimmed(body.discoveryClass);
        const run = await discoverLeads({
            query: readTrimmed(body.query) || undefined,
            discoveryClass: VALID_DISCOVERY_CLASSES.has(discoveryClassRaw) ? discoveryClassRaw : undefined,
            limit: typeof body.limit === 'number' ? body.limit : undefined,
        });
        return { run, timestamp: nowIso() };
    });
}
export async function handleGrowthLeadList(request) {
    return withOwner(request, async () => {
        const leads = await listLeads();
        return { leads, count: leads.length, timestamp: nowIso() };
    });
}
const VALID_LEAD_CATEGORIES = new Set([
    'buyer', 'investor', 'jv_partner', 'private_lender', 'family_office',
    'fund', 'tokenization_contact', 'developer', 'broker', 'strategic_acquirer',
]);
/** MASTER LEAD LIST: real (SEC-sourced) leads sorted 1→N, with counts + filters. */
export async function handleGrowthMasterList(request) {
    return withOwner(request, async () => {
        const url = new URL(request.url);
        const categoryRaw = readTrimmed(url.searchParams.get('category'));
        const leads = await masterLeadList({
            category: VALID_LEAD_CATEGORIES.has(categoryRaw) ? categoryRaw : undefined,
            southFlorida: url.searchParams.get('southFlorida') === 'true',
            search: readTrimmed(url.searchParams.get('search')) || undefined,
        });
        const counts = await masterListCounts();
        return { leads, count: leads.length, counts, timestamp: nowIso() };
    });
}
/** LEAD AUDIT LOG: every recorded change (discover/approve/reject/quarantine). */
export async function handleGrowthLeadAudit(request) {
    return withOwner(request, async () => {
        const url = new URL(request.url);
        const limitRaw = Number(url.searchParams.get('limit'));
        const entries = await leadAuditLog(Number.isFinite(limitRaw) ? limitRaw : 200);
        return { entries, count: entries.length, timestamp: nowIso() };
    });
}
export async function handleGrowthLeadApprove(request, leadId) {
    return withOwner(request, async () => {
        const id = readTrimmed(leadId);
        if (!id)
            throw new Error('leadId is required.');
        const result = await approveLead(id);
        if (!result.ok)
            throw new Error(result.error);
        return { result, timestamp: nowIso() };
    });
}
export async function handleGrowthLeadReject(request, leadId) {
    return withOwner(request, async () => {
        const id = readTrimmed(leadId);
        if (!id)
            throw new Error('leadId is required.');
        const body = await readJsonBody(request);
        const result = await rejectLead(id, readTrimmed(body.reason) || undefined);
        if (!result.ok)
            throw new Error(result.error);
        return { result, timestamp: nowIso() };
    });
}
/* ---------------- JV_DEAL_ENGINE ---------------- */
export async function handleGrowthJVDraft(request) {
    return withOwner(request, async () => {
        const body = await readJsonBody(request);
        const deal = await draftJVDeal({
            title: readTrimmed(body.title) || undefined,
            partnerName: readTrimmed(body.partnerName) || undefined,
            partnerContribution: readTrimmed(body.partnerContribution) || undefined,
            ivxEquityPct: typeof body.ivxEquityPct === 'number' ? body.ivxEquityPct : undefined,
        });
        return { deal, timestamp: nowIso() };
    });
}
export async function handleGrowthJVList(request) {
    return withOwner(request, async () => {
        const deals = await listJVDeals();
        return { deals, count: deals.length, timestamp: nowIso() };
    });
}
/* ---------------- TOKENIZATION_ENGINE ---------------- */
export async function handleGrowthTokenizationDraft(request) {
    return withOwner(request, async () => {
        const body = await readJsonBody(request);
        const concept = await draftTokenization({
            assetName: readTrimmed(body.assetName) || undefined,
            raiseTargetUsd: typeof body.raiseTargetUsd === 'number' ? body.raiseTargetUsd : undefined,
            pricePerTokenUsd: typeof body.pricePerTokenUsd === 'number' ? body.pricePerTokenUsd : undefined,
            targetIrrPct: typeof body.targetIrrPct === 'number' ? body.targetIrrPct : undefined,
        });
        return { concept, timestamp: nowIso() };
    });
}
export async function handleGrowthTokenizationList(request) {
    return withOwner(request, async () => {
        const concepts = await listTokenizationConcepts();
        return { concepts, count: concepts.length, timestamp: nowIso() };
    });
}
/* ---------------- APP_AND_MODULE_CREATOR ---------------- */
export async function handleGrowthModuleDraft(request) {
    return withOwner(request, async () => {
        const body = await readJsonBody(request);
        const conceptTitle = readTrimmed(body.conceptTitle ?? body.title);
        if (!conceptTitle)
            throw new Error('conceptTitle is required to draft a module spec.');
        const spec = await draftModuleSpec(conceptTitle, readTrimmed(body.summary) || undefined);
        return { spec, timestamp: nowIso() };
    });
}
export async function handleGrowthModuleList(request) {
    return withOwner(request, async () => {
        const specs = await listModuleSpecs();
        return { specs, count: specs.length, timestamp: nowIso() };
    });
}
/* ---------------- OUTREACH_PREP ---------------- */
const VALID_AUDIENCES = new Set(['investor', 'buyer', 'jv_partner']);
export async function handleGrowthOutreachDraft(request) {
    return withOwner(request, async () => {
        const body = await readJsonBody(request);
        const audienceRaw = readTrimmed(body.audience);
        const draft = await draftOutreachMessage({
            audience: VALID_AUDIENCES.has(audienceRaw) ? audienceRaw : undefined,
            recipientName: readTrimmed(body.recipientName) || undefined,
            context: readTrimmed(body.context) || undefined,
        });
        return { draft, timestamp: nowIso() };
    });
}
export async function handleGrowthOutreachList(request) {
    return withOwner(request, async () => {
        const drafts = await listOutreachDrafts();
        return { drafts, count: drafts.length, timestamp: nowIso() };
    });
}
export function ownerGrowthEngineOptions() {
    return ownerOnlyOptions();
}
