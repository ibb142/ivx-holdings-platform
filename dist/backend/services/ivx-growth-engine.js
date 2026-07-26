/**
 * IVX IA Autonomous Growth Engine.
 *
 * One cohesive engine that lets IVX IA independently:
 *   1. IDEA_ENGINE             — generate + rank venture / technology / real-estate /
 *                                AI / tokenization / JV concepts.
 *   2. INVESTOR_BUYER_DISCOVERY — discover/stage real investor & buyer leads
 *                                (delegates to the existing SEC-backed lead-discovery
 *                                pipeline; never fabricates leads).
 *   3. JV_DEAL_ENGINE          — draft JV deal structures, partner maps, economics,
 *                                risk notes, and next steps.
 *   4. TOKENIZATION_ENGINE     — draft compliant tokenized-asset concepts, waterfall
 *                                logic, investor terms, and legal-review flags. NEVER
 *                                executes a securities offering.
 *   5. AUTONOMOUS_SEARCH       — run discovery and persist findings into the pipeline.
 *   6. APP_AND_MODULE_CREATOR  — turn an approved concept into a build spec (modules,
 *                                routes, screens). Spec only — building/deploying is gated.
 *   7. OUTREACH_PREP           — draft investor/buyer/JV outreach; staged, never sent.
 *   8. OWNER_CONTROL_GATES     — anything touching money, contracts, legal claims,
 *                                securities, deployment, or outbound comms is staged as
 *                                `pending_approval` and requires an explicit owner decision.
 *
 * SAFE BY CONSTRUCTION: this engine generates and stages artifacts. It never sends a
 * message, signs a contract, moves money, issues a security, or deploys code on its own.
 * Every such action is classified by OWNER_CONTROL_GATES and held for owner approval.
 *
 * Durable: all generated artifacts persist via the same Supabase-backed durable store the
 * CRM and lead pipeline use, with a filesystem fallback for local/dev/test.
 */
import { auditDir } from './ivx-data-root';
import { appendDurableEvent, isDurableStoreConfigured, readDurableJson, writeDurableJson, } from './ivx-durable-store';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_GROWTH_ENGINE_MARKER = 'ivx-autonomous-growth-engine-2026-06-15';
/* ============================== shared helpers ============================== */
function nowIso() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
/* ============================== durable IO ============================== */
const STORE_ROOT = auditDir('growth-engine');
async function readState(file, fallback) {
    const full = path.join(STORE_ROOT, file);
    if (isDurableStoreConfigured())
        return readDurableJson(full, fallback);
    try {
        return JSON.parse(await readFile(full, 'utf8'));
    }
    catch {
        return fallback;
    }
}
async function writeState(file, value) {
    const full = path.join(STORE_ROOT, file);
    if (isDurableStoreConfigured()) {
        await writeDurableJson(full, value);
        return;
    }
    await mkdir(STORE_ROOT, { recursive: true });
    await writeFile(full, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(file, event) {
    const full = path.join(STORE_ROOT, file);
    try {
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(full, event);
            return;
        }
        await mkdir(STORE_ROOT, { recursive: true });
        await appendFile(full, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort; never break a write on log failure.
    }
}
const GATED_ACTIONS = {
    send_outreach: ['outbound_communication'],
    execute_securities_offering: ['securities', 'legal', 'money'],
    sign_contract: ['contract', 'legal'],
    move_funds: ['money'],
    deploy_module: ['deployment'],
};
/**
 * OWNER_CONTROL_GATES: classify an action. Read/derive/draft actions are free; anything
 * involving money, contracts, legal claims, securities, deployment, or outbound comms
 * requires an explicit owner approval before it can proceed.
 */
export function classifyOwnerGate(action) {
    const categories = GATED_ACTIONS[action] ?? [];
    const requiresOwnerApproval = categories.length > 0;
    return {
        action,
        requiresOwnerApproval,
        categories,
        reason: requiresOwnerApproval
            ? `Requires owner approval — involves: ${categories.join(', ')}.`
            : 'No owner approval required — this only generates or stages a draft artifact.',
    };
}
/** All actions that are hard-gated behind owner approval (for capability reporting). */
export function ownerApprovalRequiredActions() {
    return Object.keys(GATED_ACTIONS);
}
/** Composite rank: market + strategic fit + feasibility reward; capital requirement penalises. */
export function computeIdeaRank(scores) {
    const reward = scores.marketSize * 0.3 + scores.strategicFit * 0.3 + scores.feasibility * 0.25;
    const penalty = scores.capitalRequirement * 0.15;
    return clamp(reward - penalty + 10);
}
/** Deterministic concept seeds per category. Combined with the owner's focus phrase. */
const IDEA_SEEDS = {
    venture: {
        title: (f) => `${f} operating company`,
        summary: (f) => `Stand up an operating venture around ${f}: recurring-revenue model, lean team, and a path to bolt onto IVX's existing capital and distribution.`,
        base: { marketSize: 70, feasibility: 60, capitalRequirement: 55, strategicFit: 65 },
    },
    technology: {
        title: (f) => `${f} automation platform`,
        summary: (f) => `Build a technology platform that automates ${f}, sold as SaaS to mid-market operators and reusable internally across IVX portfolio companies.`,
        base: { marketSize: 75, feasibility: 55, capitalRequirement: 45, strategicFit: 60 },
    },
    real_estate: {
        title: (f) => `${f} real-estate vehicle`,
        summary: (f) => `Assemble an income-producing / value-add real-estate vehicle focused on ${f}, structured for co-investment and aligned with IVX's core mandate.`,
        base: { marketSize: 80, feasibility: 65, capitalRequirement: 80, strategicFit: 90 },
    },
    ai: {
        title: (f) => `AI copilot for ${f}`,
        summary: (f) => `Ship an AI copilot that compresses the workflow around ${f} — high gross margin, fast to iterate, strong wedge for cross-sell into IVX's network.`,
        base: { marketSize: 78, feasibility: 50, capitalRequirement: 40, strategicFit: 70 },
    },
    tokenization: {
        title: (f) => `Tokenized ${f} fund`,
        summary: (f) => `Design a tokenized investment vehicle for ${f} with fractional ownership and a programmable distribution waterfall — subject to securities/legal review.`,
        base: { marketSize: 72, feasibility: 45, capitalRequirement: 60, strategicFit: 85 },
    },
    jv: {
        title: (f) => `${f} joint venture`,
        summary: (f) => `Structure a JV around ${f} pairing IVX capital/operations with a partner's deal flow or platform, sharing economics and de-risking the build.`,
        base: { marketSize: 76, feasibility: 70, capitalRequirement: 50, strategicFit: 80 },
    },
};
const ALL_IDEA_CATEGORIES = ['venture', 'technology', 'real_estate', 'ai', 'tokenization', 'jv'];
/** Small deterministic jitter from the focus string so scores vary by topic but stay stable. */
function focusJitter(focus, salt) {
    let hash = salt;
    for (let i = 0; i < focus.length; i += 1)
        hash = (hash * 31 + focus.charCodeAt(i)) % 23;
    return hash - 11; // -11..+11
}
function buildIdeaScores(category, focus) {
    const base = IDEA_SEEDS[category].base;
    return {
        marketSize: clamp(base.marketSize + focusJitter(focus, 3)),
        feasibility: clamp(base.feasibility + focusJitter(focus, 7)),
        capitalRequirement: clamp(base.capitalRequirement + focusJitter(focus, 11)),
        strategicFit: clamp(base.strategicFit + focusJitter(focus, 13)),
    };
}
function buildRankReasons(scores) {
    return [
        `Market size ${scores.marketSize}/100 (weight 0.30).`,
        `Strategic fit ${scores.strategicFit}/100 (weight 0.30).`,
        `Feasibility ${scores.feasibility}/100 (weight 0.25).`,
        `Capital requirement ${scores.capitalRequirement}/100 (penalty 0.15).`,
    ];
}
/**
 * IDEA_ENGINE: generate ranked concepts across the requested categories for a focus
 * phrase. Deterministic + explainable (no fabricated external "AI scores"). Persists by
 * default so the owner can review the pipeline later.
 */
export async function generateIdeas(options = {}) {
    const focus = readTrimmed(options.focus) || 'premium real estate';
    const categories = options.categories?.length ? options.categories : ALL_IDEA_CATEGORIES;
    const limit = Math.max(1, Math.min(24, Number(options.limit) || categories.length));
    const createdAt = nowIso();
    const ideas = [];
    for (const category of categories) {
        const seed = IDEA_SEEDS[category];
        if (!seed)
            continue;
        const scores = buildIdeaScores(category, focus);
        ideas.push({
            id: createId('idea'),
            category,
            title: seed.title(focus),
            summary: seed.summary(focus),
            focus,
            scores,
            rank: computeIdeaRank(scores),
            rankReasons: buildRankReasons(scores),
            status: 'generated',
            createdAt,
        });
    }
    ideas.sort((a, b) => b.rank - a.rank);
    const limited = ideas.slice(0, limit);
    if (options.persist !== false && limited.length > 0) {
        const existing = await readState('ideas.json', []);
        await writeState('ideas.json', [...existing, ...limited]);
        await appendEvent('ideas.jsonl', { type: 'generate', count: limited.length, focus, at: createdAt });
    }
    return limited;
}
export async function listIdeas() {
    const ideas = await readState('ideas.json', []);
    return [...ideas].sort((a, b) => b.rank - a.rank);
}
/**
 * JV_DEAL_ENGINE: draft a JV structure with a partner map, economics, risk notes, and
 * next steps. Drafting is free; executing/signing is gated by OWNER_CONTROL_GATES.
 */
export async function draftJVDeal(options = {}) {
    const title = readTrimmed(options.title) || 'IVX joint venture';
    const partnerName = readTrimmed(options.partnerName) || 'Strategic partner (TBD)';
    const ivxEquity = Math.max(1, Math.min(99, Number(options.ivxEquityPct) || 60));
    const partnerEquity = 100 - ivxEquity;
    const createdAt = nowIso();
    const deal = {
        id: createId('jv'),
        title,
        thesis: `Pair IVX capital and operating capability with ${partnerName}'s deal flow to capture ${title.toLowerCase()} upside while sharing execution risk.`,
        partners: [
            { name: 'IVX Holdings', role: 'Capital + operations + governance', contribution: `${ivxEquity}% equity, capital, asset management` },
            { name: partnerName, role: 'Origination + local execution', contribution: readTrimmed(options.partnerContribution) || `${partnerEquity}% equity, sourcing, on-the-ground operations` },
        ],
        economics: {
            ivxEquityPct: ivxEquity,
            partnerEquityPct: partnerEquity,
            structure: `${ivxEquity}/${partnerEquity} equity JV with pari-passu pref then promote to the operating partner above hurdle.`,
            capitalStack: ['Senior debt (60–70% LTC)', 'IVX preferred equity', 'Partner common equity / co-invest'],
        },
        riskNotes: [
            'Partner execution risk — verify track record and references before committing capital.',
            'Market/interest-rate risk on the underlying assets.',
            'Governance: define decision rights, deadlock resolution, and exit triggers in the JV agreement.',
            'Legal/regulatory: have counsel review the JV agreement before signing.',
        ],
        nextSteps: [
            'Owner reviews and approves the structure.',
            'Run partner diligence (track record, financials, references).',
            'Engage counsel to paper the JV agreement (gated: contract).',
            'Fund the vehicle on owner approval (gated: money).',
        ],
        status: 'draft',
        ownerApprovalRequired: true,
        ownerGate: classifyOwnerGate('sign_contract'),
        createdAt,
    };
    const existing = await readState('jv-deals.json', []);
    await writeState('jv-deals.json', [...existing, deal]);
    await appendEvent('jv-deals.jsonl', { type: 'draft', id: deal.id, title, at: createdAt });
    return deal;
}
export async function listJVDeals() {
    const deals = await readState('jv-deals.json', []);
    return [...deals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/**
 * TOKENIZATION_ENGINE: draft a compliant tokenized-asset concept with a distribution
 * waterfall, investor terms, and explicit legal-review flags. This NEVER executes a
 * securities offering — that is hard-gated behind owner + legal approval.
 */
export async function draftTokenization(options = {}) {
    const assetName = readTrimmed(options.assetName) || 'IVX flagship asset';
    const raiseTarget = Math.max(100_000, Number(options.raiseTargetUsd) || 10_000_000);
    const pricePerToken = Math.max(1, Number(options.pricePerTokenUsd) || 100);
    const totalTokens = Math.max(1, Math.round(raiseTarget / pricePerToken));
    const targetIrr = Math.max(1, Math.min(50, Number(options.targetIrrPct) || 14));
    const createdAt = nowIso();
    const concept = {
        id: createId('tkn'),
        assetName,
        summary: `Fractional, tokenized ownership of ${assetName} via a programmable distribution waterfall. Targets a $${raiseTarget.toLocaleString('en-US')} raise across ${totalTokens.toLocaleString('en-US')} tokens.`,
        tokenStandard: 'ERC-3643 (permissioned security token) or equivalent compliant standard',
        totalTokens,
        pricePerTokenUsd: pricePerToken,
        investorTerms: {
            minInvestmentUsd: Math.max(pricePerToken, 1_000),
            targetIrrPct: targetIrr,
            holdPeriodMonths: 60,
            distributionFrequency: 'quarterly',
        },
        waterfall: [
            { tier: 1, name: 'Return of capital', description: 'Investors receive 100% of contributed capital back first.' },
            { tier: 2, name: 'Preferred return', description: `Investors receive a ${targetIrr}% preferred return before any promote.` },
            { tier: 3, name: 'Catch-up', description: 'Sponsor catch-up until the agreed profit split is reached.' },
            { tier: 4, name: 'Carried interest / promote', description: 'Remaining profits split per the promote schedule (e.g. 80/20 above hurdle).' },
        ],
        legalReviewFlags: [
            'Securities classification: likely a security — confirm exemption (Reg D 506(c) / Reg S / Reg A+) with counsel.',
            'KYC/AML and accredited-investor verification required before any subscription.',
            'Transfer restrictions and permissioned-token whitelist must be enforced on-chain.',
            'Jurisdictional review for each target investor market.',
            'No general solicitation or offering until counsel clears the structure.',
        ],
        securitiesOfferingExecuted: false,
        ownerApprovalRequired: true,
        ownerGate: classifyOwnerGate('execute_securities_offering'),
        status: 'draft',
        createdAt,
    };
    const existing = await readState('tokenization.json', []);
    await writeState('tokenization.json', [...existing, concept]);
    await appendEvent('tokenization.jsonl', { type: 'draft', id: concept.id, assetName, at: createdAt });
    return concept;
}
export async function listTokenizationConcepts() {
    const items = await readState('tokenization.json', []);
    return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'module';
}
/**
 * APP_AND_MODULE_CREATOR: turn an approved concept into a concrete build spec (module
 * name, routes, files, data model). This produces a SPEC only; generating real backend
 * routes / deploying is hard-gated by OWNER_CONTROL_GATES (`deploy_module`).
 */
export async function draftModuleSpec(conceptTitle, summary) {
    const title = readTrimmed(conceptTitle) || 'New IVX module';
    const slug = slugify(title);
    const createdAt = nowIso();
    const spec = {
        id: createId('mod'),
        conceptTitle: title,
        moduleName: slug,
        summary: readTrimmed(summary) || `Internal IVX module implementing "${title}" with owner-guarded routes and a durable store.`,
        proposedRoutes: [
            { method: 'POST', path: `/api/${slug}`, purpose: `Create a ${slug} record (owner-guarded).` },
            { method: 'GET', path: `/api/${slug}`, purpose: `List ${slug} records (owner-guarded).` },
            { method: 'GET', path: `/api/${slug}/:id`, purpose: `Fetch one ${slug} record (owner-guarded).` },
        ],
        proposedFiles: [
            `backend/services/ivx-${slug}.ts`,
            `backend/services/ivx-${slug}.test.ts`,
            `backend/api/owner-${slug}.ts`,
        ],
        dataModel: ['id: string', 'status: string', 'createdAt: ISO string', 'updatedAt: ISO string'],
        status: 'draft',
        ownerApprovalRequired: true,
        ownerGate: classifyOwnerGate('deploy_module'),
        createdAt,
    };
    const existing = await readState('module-specs.json', []);
    await writeState('module-specs.json', [...existing, spec]);
    await appendEvent('module-specs.jsonl', { type: 'draft', id: spec.id, moduleName: slug, at: createdAt });
    return spec;
}
export async function listModuleSpecs() {
    const specs = await readState('module-specs.json', []);
    return [...specs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/**
 * OUTREACH_PREP: draft an outreach message for an investor / buyer / JV partner. The
 * draft is STAGED only — sending is hard-gated by OWNER_CONTROL_GATES (`send_outreach`).
 */
export async function draftOutreachMessage(options = {}) {
    const audience = options.audience ?? 'investor';
    const recipientName = readTrimmed(options.recipientName) || 'there';
    const context = readTrimmed(options.context);
    const createdAt = nowIso();
    const role = audience === 'buyer' ? 'acquisition' : audience === 'jv_partner' ? 'co-investment / JV' : 'investment';
    const subject = `IVX Holdings — ${role} opportunity`;
    const body = [
        `Hi ${recipientName},`,
        '',
        `I'm reaching out from IVX Holdings about a current ${role} opportunity${context ? ` in ${context}` : ''}.`,
        '',
        'IVX deploys capital into vetted, income-producing and value-add real estate and adjacent ventures. ' +
            'If useful, I can share a short overview and the relevant materials.',
        '',
        'Would you be open to a brief introductory call?',
        '',
        'Best regards,',
        'IVX Holdings — Investor Relations',
        'investors@ivxholding.com',
        '',
        '— This is not an offer to sell securities. Reply STOP to opt out.',
    ].join('\n');
    const draft = {
        id: createId('out'),
        audience,
        recipientName,
        subject,
        body,
        status: 'draft',
        sent: false,
        ownerApprovalRequired: true,
        ownerGate: classifyOwnerGate('send_outreach'),
        createdAt,
    };
    const existing = await readState('outreach.json', []);
    await writeState('outreach.json', [...existing, draft]);
    await appendEvent('outreach.jsonl', { type: 'draft', id: draft.id, audience, at: createdAt });
    return draft;
}
export async function listOutreachDrafts() {
    const drafts = await readState('outreach.json', []);
    return [...drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/** Live capability report for the autonomous growth engine. */
export function getGrowthEngineCapabilities() {
    const durable = isDurableStoreConfigured();
    const secDiscoveryReady = true; // SEC EDGAR is a public source, no key required.
    const emailProviderConfigured = Boolean(readTrimmed(process.env.AWS_ACCESS_KEY_ID) && readTrimmed(process.env.AWS_SECRET_ACCESS_KEY));
    const remaining = [];
    if (!durable)
        remaining.push('Supabase service-role credentials for durable cross-deploy persistence (falls back to filesystem until attached).');
    if (!emailProviderConfigured)
        remaining.push('Email provider credentials (AWS SES) to ENABLE owner-approved outreach delivery — drafting works now.');
    return {
        marker: IVX_GROWTH_ENGINE_MARKER,
        generatedAt: nowIso(),
        modules: {
            ideaEngine: true,
            investorBuyerDiscovery: secDiscoveryReady,
            jvDealEngine: true,
            tokenizationEngine: true,
            autonomousSearch: secDiscoveryReady,
            appAndModuleCreator: true,
            outreachPrep: true,
            ownerControlGates: true,
        },
        ownerApprovalRequiredFor: ownerApprovalRequiredActions(),
        durablePersistence: durable,
        remainingRuntimeDependencies: remaining,
    };
}
/** Roll-up of everything the engine currently holds (for the owner dashboard). */
export async function getGrowthEngineOverview() {
    const [ideas, jv, tkn, mods, out] = await Promise.all([
        listIdeas(),
        listJVDeals(),
        listTokenizationConcepts(),
        listModuleSpecs(),
        listOutreachDrafts(),
    ]);
    return {
        marker: IVX_GROWTH_ENGINE_MARKER,
        ideas: ideas.length,
        jvDeals: jv.length,
        tokenizationConcepts: tkn.length,
        moduleSpecs: mods.length,
        outreachDrafts: out.length,
        capabilities: getGrowthEngineCapabilities(),
    };
}
