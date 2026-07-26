/**
 * IVX Autonomous Lead Discovery — discover → rank → draft → STAGE for approval.
 *
 * This is the autonomous investor/buyer/deal sourcing pipeline. It is built to be
 * SAFE BY CONSTRUCTION: it never sends a message and never makes a commitment.
 * Everything it produces is staged as `pending_approval` and waits for an explicit
 * owner decision (`approve` / `reject`). Approval promotes a lead into the durable
 * Investor CRM (attributed to its real public source); it still does NOT send any
 * outreach — sending is a separate, provider-gated step the owner triggers later.
 *
 * Real sourcing only (HARD HONESTY RULE):
 *   - Candidates come from the existing `discoverInvestors` engine, which reads
 *     PUBLIC U.S. SEC EDGAR Form D filings. Every lead carries a direct SEC filing
 *     URL so the owner can verify it. Nothing is fabricated — unknown fields stay
 *     null, names/companies/amounts are exactly as filed.
 *   - Ranking is deterministic and explainable (capital size, recency, principals,
 *     industry match) — no invented "AI scores".
 *
 * Durable: staged leads persist via the same Supabase-backed durable store the CRM
 * uses, so they survive restarts/deploys.
 */
import { discoverInvestors, } from './ivx-investor-discovery';
import { createInvestor } from './ivx-investor-crm-store';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, readDurableEvents, } from './ivx-durable-store';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_LEAD_DISCOVERY_MARKER = 'ivx-lead-discovery-2026-06-12';
const STORE_ROOT = auditDir('lead-discovery');
const LEADS_STATE = path.join(STORE_ROOT, 'leads.json');
// ---------- durable IO (mirrors investor-crm store) ----------
async function readLeads() {
    if (isDurableStoreConfigured())
        return readDurableJson(LEADS_STATE, []);
    try {
        const raw = await readFile(LEADS_STATE, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
async function writeLeads(leads) {
    if (isDurableStoreConfigured()) {
        await writeDurableJson(LEADS_STATE, leads);
        return;
    }
    await mkdir(STORE_ROOT, { recursive: true });
    await writeFile(LEADS_STATE, JSON.stringify(leads, null, 2), 'utf8');
}
async function appendEvent(event) {
    const eventFile = path.join(STORE_ROOT, 'leads.jsonl');
    try {
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(eventFile, event);
            return;
        }
        await mkdir(STORE_ROOT, { recursive: true });
        await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort; never break a write on log failure.
    }
}
function nowIso() {
    return new Date().toISOString();
}
function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `lead-${crypto.randomUUID()}`;
    }
    return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
// ---------- ranking (deterministic, explainable) ----------
const MAX_OFFERING_FOR_SCALE = 100_000_000;
/** Score a discovered investor 0–100 with explainable reasons. Pure + testable. */
export function scoreDiscoveredLead(investor, industryQuery) {
    const reasons = [];
    let score = 0;
    // Capital size (up to 40): bigger disclosed offerings rank higher.
    const amount = investor.totalOfferingAmountUsd;
    if (amount !== null && amount > 0) {
        const capitalPoints = Math.round(Math.min(1, amount / MAX_OFFERING_FOR_SCALE) * 40);
        score += capitalPoints;
        reasons.push(`Disclosed offering $${amount.toLocaleString('en-US')} (+${capitalPoints} capital).`);
    }
    else {
        reasons.push('Offering amount not disclosed (+0 capital).');
    }
    // Real named principals (up to 20): more attributable people = stronger lead.
    const principals = investor.relatedPersons.length;
    if (principals > 0) {
        const principalPoints = Math.min(20, principals * 5);
        score += principalPoints;
        reasons.push(`${principals} named principal(s) on the filing (+${principalPoints}).`);
    }
    else {
        reasons.push('No named principals on the filing (+0).');
    }
    // Recency (up to 20): a filing in the last 18 months is more actionable.
    if (investor.filingDate) {
        const filed = Date.parse(investor.filingDate);
        if (Number.isFinite(filed)) {
            const monthsAgo = (Date.now() - filed) / (1000 * 60 * 60 * 24 * 30);
            const recencyPoints = monthsAgo <= 18 ? Math.round((1 - monthsAgo / 18) * 20) : 0;
            score += recencyPoints;
            reasons.push(`Filed ${Math.max(0, Math.round(monthsAgo))} month(s) ago (+${recencyPoints} recency).`);
        }
    }
    else {
        reasons.push('Filing date unknown (+0 recency).');
    }
    // Industry match (up to 15): industry group aligns with the search intent.
    const query = industryQuery.trim().toLowerCase();
    const industry = (investor.industryGroup ?? '').toLowerCase();
    if (query && industry && (industry.includes(query) || query.includes(industry))) {
        score += 15;
        reasons.push(`Industry "${investor.industryGroup}" matches the search (+15).`);
    }
    else if (industry) {
        score += 5;
        reasons.push(`Industry "${investor.industryGroup}" declared (+5).`);
    }
    // Reachability (up to 5): a public business phone makes it actionable.
    if (investor.businessPhone) {
        score += 5;
        reasons.push('Public business phone on file (+5 reachability).');
    }
    return { score: Math.max(0, Math.min(100, score)), reasons };
}
function classifyParty(investor, discoveryClass) {
    if (discoveryClass === 'buyers')
        return 'buyer';
    const industry = (investor.industryGroup ?? '').toLowerCase();
    if (/broker|advisor|placement|fund of funds/.test(industry))
        return 'partner';
    return 'investor';
}
const MIAMI_DADE = [
    'miami', 'miami beach', 'coral gables', 'doral', 'aventura', 'homestead',
    'hialeah', 'key biscayne', 'sunny isles', 'north miami', 'pinecrest',
];
const BROWARD = [
    'fort lauderdale', 'hollywood', 'pembroke pines', 'plantation', 'sunrise',
    'coral springs', 'weston', 'davie', 'pompano beach', 'miramar',
];
const PALM_BEACH = [
    'west palm beach', 'palm beach', 'boca raton', 'delray beach', 'jupiter',
    'boynton beach', 'wellington', 'palm beach gardens',
];
/** US state codes per USPS — used to distinguish national (US) from international. */
const US_STATES = new Set([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
    'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
    'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'PR', 'VI', 'GU',
]);
/**
 * Classify a filing's South Florida relevance from its real business address.
 * Pure + testable. Never invents location — derives only from filed city/state.
 */
export function classifySouthFlorida(city, state) {
    const s = (state ?? '').trim().toUpperCase();
    const c = (city ?? '').trim().toLowerCase();
    if (s === 'FL') {
        if (MIAMI_DADE.some((x) => c.includes(x)))
            return 'miami';
        if (BROWARD.some((x) => c.includes(x)))
            return 'broward';
        if (PALM_BEACH.some((x) => c.includes(x)))
            return 'palm_beach';
        return 'florida';
    }
    if (!s)
        return 'national';
    return US_STATES.has(s) ? 'national' : 'international';
}
/**
 * Classify an enterprise lead category from real filing signals (entity name,
 * industry group, named principals' relationships). Pure + testable. Falls back
 * to the party type when no stronger signal is present — never fabricates.
 */
export function classifyLeadCategory(investor, discoveryClass) {
    const name = investor.entityName.toLowerCase();
    const industry = (investor.industryGroup ?? '').toLowerCase();
    const rels = investor.relatedPersons.flatMap((p) => p.relationships).join(' ').toLowerCase();
    if (/family office/.test(name))
        return 'family_office';
    if (/token|digital asset|blockchain|\brwa\b|real world asset/.test(name))
        return 'tokenization_contact';
    if (/lending|lender|mortgage|credit|debt fund|bridge capital/.test(name))
        return 'private_lender';
    if (/developer|development|builders?|construction|homes\b/.test(name))
        return 'developer';
    if (/realty|brokerage|\bbroker\b|advisor|placement/.test(name) || /broker/.test(industry))
        return 'broker';
    if (/fund\b|capital|partners|ventures|holdings|equity|reit\b|opportunit/.test(name))
        return 'fund';
    if (discoveryClass === 'buyers')
        return 'buyer';
    if (/director|officer|promoter/.test(rels))
        return 'investor';
    return 'investor';
}
function buildDealCapacity(investor) {
    return {
        estimatedUsd: investor.totalOfferingAmountUsd,
        minUsd: investor.minimumInvestmentUsd,
        maxUsd: investor.totalOfferingAmountUsd,
    };
}
/** Highest sequential id already assigned, so new leads continue the sequence. */
function nextSequentialId(existing) {
    let max = 0;
    for (const lead of existing) {
        if (typeof lead.sequentialId === 'number' && lead.sequentialId > max)
            max = lead.sequentialId;
    }
    return max + 1;
}
function buildLocation(investor) {
    const parts = [investor.businessCity, investor.businessState].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
}
/** Draft (NOT send) a compliant outreach email for a discovered lead. */
export function draftOutreach(investor, partyType) {
    const entity = investor.entityName;
    const principal = investor.relatedPersons[0]?.fullName ?? null;
    const greeting = principal ? `Hi ${principal},` : `Hello ${entity} team,`;
    const role = partyType === 'buyer' ? 'acquisition' : partyType === 'partner' ? 'co-investment' : 'investment';
    const subject = `IVX Holdings — ${role} opportunities in premium real estate`;
    const body = [
        greeting,
        '',
        `I'm reaching out from IVX Holdings. We came across ${entity}'s recent SEC Form D filing and ` +
            `believe our current real-estate ${role} opportunities may align with your mandate.`,
        '',
        'IVX deploys capital into vetted, income-producing and value-add real estate. If helpful, I can ' +
            'share a short deal overview and the relevant offering materials.',
        '',
        'Would you be open to a brief introductory call?',
        '',
        'Best regards,',
        'IVX Holdings — Investor Relations',
        'investors@ivxholding.com',
        '',
        '— Sourced from your public SEC filing. Reply STOP to opt out. This is not an offer to sell securities.',
    ].join('\n');
    return { subject, body };
}
/**
 * Run the autonomous discovery pipeline: pull real SEC filings, rank, draft
 * outreach, and STAGE each lead as `pending_approval`. Returns the staged batch.
 * Does NOT contact anyone and does NOT write to the CRM — approval does that.
 */
export async function discoverLeads(options = {}) {
    const discoveryClass = options.discoveryClass ?? 'jv_deals';
    const query = (options.query ?? 'real estate').trim() || 'real estate';
    const limit = Math.max(1, Math.min(30, Number(options.limit) || 10));
    const generatedAt = nowIso();
    // Pass the URLs already in the pipeline into discovery so it pages PAST them
    // and returns fresh, unseen filings instead of the same top hits every run.
    const existing = await readLeads();
    const seenUrls = new Set(existing.map((l) => l.sourceUrl));
    const discovery = await discoverInvestors({
        query,
        discoveryClass,
        minOfferingUsd: options.minOfferingUsd,
        limit,
        excludeUrls: seenUrls,
        maxPages: options.maxPages,
    });
    const base = {
        marker: IVX_LEAD_DISCOVERY_MARKER,
        ok: discovery.ok,
        generatedAt,
        discoveryClass,
        query,
        source: discovery.source,
        scannedFilings: discovery.scannedFilings,
        totalFilingsMatched: discovery.totalFilingsMatched,
        staged: [],
        stagedCount: 0,
        approvalRequired: true,
        nextStep: 'Review staged leads and call approve/reject. Approval saves the lead to the CRM; it does NOT send any message.',
        complianceNote: discovery.complianceNote,
        error: discovery.error,
    };
    if (!discovery.ok)
        return base;
    const staged = [];
    let seq = nextSequentialId(existing);
    for (const investor of discovery.investors) {
        if (seenUrls.has(investor.filingUrl))
            continue;
        const { score, reasons } = scoreDiscoveredLead(investor, query);
        const partyType = classifyParty(investor, discoveryClass);
        const category = classifyLeadCategory(investor, discoveryClass);
        const principal = investor.relatedPersons[0]?.fullName ?? null;
        const principalTitle = investor.relatedPersons[0]?.relationships[0] ?? null;
        const lead = {
            id: createId(),
            sequentialId: seq,
            status: 'pending_approval',
            pipelineStatus: 'new',
            name: investor.entityName,
            company: investor.entityName,
            title: principal ? `${principal}${principalTitle ? ` (${principalTitle})` : ''}` : null,
            partyType,
            category,
            location: buildLocation(investor),
            city: investor.businessCity,
            state: investor.businessState,
            country: investor.businessState && !US_STATES.has(investor.businessState.toUpperCase()) ? 'International' : 'USA',
            southFloridaRelevance: classifySouthFlorida(investor.businessCity, investor.businessState),
            phone: investor.businessPhone,
            email: null,
            linkedinUrl: null,
            contactPath: investor.businessPhone ? `Phone: ${investor.businessPhone} · SEC: ${investor.filingUrl}` : `SEC filing: ${investor.filingUrl}`,
            dealCapacity: buildDealCapacity(investor),
            score,
            scoreReasons: reasons,
            source: 'public_source',
            sourceUrl: investor.filingUrl,
            totalOfferingAmountUsd: investor.totalOfferingAmountUsd,
            industryGroup: investor.industryGroup,
            relatedPrincipals: investor.relatedPersons.map((p) => p.fullName).filter(Boolean),
            draftOutreach: draftOutreach(investor, partyType),
            filingDate: investor.filingDate,
            discoveredAt: generatedAt,
            lastVerifiedAt: generatedAt,
            decidedAt: null,
            crmInvestorId: null,
        };
        staged.push(lead);
        seenUrls.add(investor.filingUrl);
        seq += 1;
    }
    staged.sort((a, b) => b.score - a.score);
    if (staged.length > 0) {
        await writeLeads([...existing, ...staged]);
        await appendEvent({ type: 'discover', count: staged.length, query, discoveryClass, at: generatedAt });
    }
    return { ...base, staged, stagedCount: staged.length };
}
/** List staged leads, newest first, optionally filtered by status. */
export async function listLeads(status) {
    const leads = await readLeads();
    const filtered = status ? leads.filter((l) => l.status === status) : leads;
    return [...filtered].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
}
/** A record is REAL only if it carries a verifiable public SEC EDGAR filing URL. */
export function isVerifiableSecLead(lead) {
    return (lead.source === 'public_source' &&
        typeof lead.sourceUrl === 'string' &&
        /sec\.gov\/Archives\/edgar/i.test(lead.sourceUrl));
}
/**
 * Remove any lead that is NOT backed by a verifiable public SEC filing URL
 * (test/demo/stub/fabricated records). Quarantined records are written to an
 * audit file for review, never silently dropped. Returns the counts.
 */
export async function quarantineNonSourcedLeads() {
    const leads = await readLeads();
    const retained = [];
    const quarantined = [];
    for (const lead of leads) {
        if (isVerifiableSecLead(lead))
            retained.push(lead);
        else
            quarantined.push(lead);
    }
    const at = nowIso();
    if (quarantined.length > 0) {
        await writeLeads(retained);
        for (const q of quarantined) {
            await appendEvent({ type: 'quarantine', leadId: q.id, name: q.name, sourceUrl: q.sourceUrl ?? null, at });
        }
    }
    return {
        marker: IVX_LEAD_DISCOVERY_MARKER,
        scanned: leads.length,
        retained: retained.length,
        quarantined: quarantined.length,
        quarantinedIds: quarantined.map((q) => q.id),
        at,
    };
}
/**
 * The enterprise master lead list: real (SEC-sourced) records only, sorted by
 * permanent sequential id (1 → N), with optional category / South-Florida /
 * text filters for the owner's master-list screen.
 */
export async function masterLeadList(filter = {}) {
    const leads = (await readLeads()).filter(isVerifiableSecLead);
    const term = (filter.search ?? '').trim().toLowerCase();
    return leads
        .filter((l) => (filter.category ? l.category === filter.category : true))
        .filter((l) => filter.southFlorida
        ? ['miami', 'broward', 'palm_beach', 'florida'].includes(l.southFloridaRelevance)
        : true)
        .filter((l) => term
        ? [l.name, l.company, l.title ?? '', l.location ?? '', l.industryGroup ?? '']
            .join(' ')
            .toLowerCase()
            .includes(term)
        : true)
        .sort((a, b) => (a.sequentialId ?? 0) - (b.sequentialId ?? 0));
}
const ALL_CATEGORIES = [
    'buyer', 'investor', 'jv_partner', 'private_lender', 'family_office',
    'fund', 'tokenization_contact', 'developer', 'broker', 'strategic_acquirer',
];
const ALL_PIPELINE_STATUSES = [
    'new', 'verified', 'approved', 'contacted', 'meeting_scheduled', 'negotiating', 'closed', 'rejected',
];
const SOUTH_FL = ['miami', 'broward', 'palm_beach', 'florida'];
/** Roll-up over the REAL (SEC-verifiable) master list for the master-list header. */
export async function masterListCounts() {
    const leads = (await readLeads()).filter(isVerifiableSecLead);
    const byCategory = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0]));
    const byPipelineStatus = Object.fromEntries(ALL_PIPELINE_STATUSES.map((s) => [s, 0]));
    let withEmail = 0;
    let withPhone = 0;
    let withLinkedin = 0;
    let southFlorida = 0;
    let lastDiscoveryAt = null;
    for (const lead of leads) {
        byCategory[lead.category] = (byCategory[lead.category] ?? 0) + 1;
        byPipelineStatus[lead.pipelineStatus] = (byPipelineStatus[lead.pipelineStatus] ?? 0) + 1;
        if (lead.email)
            withEmail += 1;
        if (lead.phone)
            withPhone += 1;
        if (lead.linkedinUrl)
            withLinkedin += 1;
        if (SOUTH_FL.includes(lead.southFloridaRelevance))
            southFlorida += 1;
        if (lead.discoveredAt && (!lastDiscoveryAt || lead.discoveredAt > lastDiscoveryAt)) {
            lastDiscoveryAt = lead.discoveredAt;
        }
    }
    return {
        marker: IVX_LEAD_DISCOVERY_MARKER,
        generatedAt: nowIso(),
        totalReal: leads.length,
        withEmail,
        withPhone,
        withLinkedin,
        southFlorida,
        byCategory,
        byPipelineStatus,
        lastDiscoveryAt,
    };
}
function summarizeAuditEvent(raw) {
    const type = typeof raw.type === 'string' ? raw.type : 'event';
    switch (type) {
        case 'discover': return `Discovered ${typeof raw.count === 'number' ? raw.count : '?'} lead(s) (${String(raw.discoveryClass ?? 'n/a')} / ${String(raw.query ?? 'n/a')}).`;
        case 'approve': return `Approved → CRM ${String(raw.crmInvestorId ?? '')}.`;
        case 'reject': return `Rejected${raw.reason ? `: ${String(raw.reason)}` : '.'}`;
        case 'quarantine': return `Quarantined non-sourced record (${String(raw.sourceUrl ?? 'no source')}).`;
        default: return type;
    }
}
/**
 * The lead audit log: every recorded change (discover / approve / reject / quarantine)
 * with a server timestamp and the acting agent. Newest first. Durable-backed; falls
 * back to the local append-only file when no durable store is configured.
 */
export async function leadAuditLog(limit = 200) {
    const eventFile = path.join(STORE_ROOT, 'leads.jsonl');
    let rows = [];
    if (isDurableStoreConfigured()) {
        rows = await readDurableEvents(eventFile, limit);
    }
    else {
        try {
            const raw = await readFile(eventFile, 'utf8');
            const lines = raw.split('\n').filter((l) => l.trim().length > 0);
            rows = lines.map((l) => {
                const event = JSON.parse(l);
                return { event, createdAt: typeof event.at === 'string' ? event.at : nowIso() };
            }).reverse().slice(0, Math.max(1, Math.min(1000, limit)));
        }
        catch {
            rows = [];
        }
    }
    return rows.map((r) => {
        const e = r.event ?? {};
        return {
            type: typeof e.type === 'string' ? e.type : 'event',
            at: typeof e.at === 'string' ? e.at : r.createdAt,
            leadId: typeof e.leadId === 'string' ? e.leadId : null,
            name: typeof e.name === 'string' ? e.name : null,
            actor: 'autonomous_engine',
            detail: summarizeAuditEvent(e),
        };
    });
}
/** Roll-up over staged leads for the owner dashboard header. */
export async function summarizeLeads() {
    const leads = await readLeads();
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let scoreSum = 0;
    for (const lead of leads) {
        if (lead.status === 'pending_approval')
            pending += 1;
        else if (lead.status === 'approved')
            approved += 1;
        else if (lead.status === 'rejected')
            rejected += 1;
        scoreSum += lead.score;
    }
    return {
        marker: IVX_LEAD_DISCOVERY_MARKER,
        total: leads.length,
        pendingApproval: pending,
        approved,
        rejected,
        avgScore: leads.length > 0 ? Math.round(scoreSum / leads.length) : 0,
    };
}
/**
 * Owner-gated approval: promote a staged lead into the durable Investor CRM
 * (attributed to its real public SEC source). This explicitly does NOT send any
 * outreach — `messageSent` is always false; sending is a separate owner action.
 */
export async function approveLead(id, options = {}) {
    const leads = await readLeads();
    const index = leads.findIndex((l) => l.id === id);
    if (index === -1)
        return { ok: false, error: 'Lead not found.' };
    const lead = leads[index];
    if (lead.status === 'approved' && lead.crmInvestorId) {
        return { ok: false, error: 'Lead already approved and saved to the CRM.' };
    }
    // The engine may explicitly promote a discovered lead as a specific CRM party
    // type (e.g. the JV engine saves real-estate sponsors/funds as `partner` JV
    // opportunities even though the filing classifies them as `investor`).
    const partyType = options.overridePartyType ??
        (lead.partyType === 'buyer' ? 'buyer' : lead.partyType === 'partner' ? 'partner' : 'investor');
    const created = await createInvestor({
        name: lead.name,
        source: 'public_source',
        sourceDetail: `SEC EDGAR Form D filing: ${lead.sourceUrl}`,
        partyType,
        company: lead.company,
        phone: lead.phone ?? '',
        location: lead.location ?? '',
        leadScore: lead.score,
        notes: `Auto-discovered lead. ${lead.scoreReasons.join(' ')}`,
        status: 'prospect',
    });
    if (!created.ok)
        return { ok: false, error: created.error };
    const updated = { ...lead, status: 'approved', decidedAt: nowIso(), crmInvestorId: created.investor.id };
    leads[index] = updated;
    await writeLeads(leads);
    await appendEvent({ type: 'approve', leadId: id, crmInvestorId: created.investor.id, at: updated.decidedAt });
    return {
        ok: true,
        lead: updated,
        crmInvestor: created.investor,
        messageSent: false,
        note: 'Lead saved to CRM as a prospect. No message was sent — outreach requires a separate owner action and a configured email provider.',
    };
}
/** Owner-gated rejection: mark a staged lead rejected (kept for audit, not deleted). */
export async function rejectLead(id, reason) {
    const leads = await readLeads();
    const index = leads.findIndex((l) => l.id === id);
    if (index === -1)
        return { ok: false, error: 'Lead not found.' };
    const updated = { ...leads[index], status: 'rejected', decidedAt: nowIso() };
    leads[index] = updated;
    await writeLeads(leads);
    await appendEvent({ type: 'reject', leadId: id, reason: reason ?? '', at: updated.decidedAt });
    return { ok: true, lead: updated };
}
