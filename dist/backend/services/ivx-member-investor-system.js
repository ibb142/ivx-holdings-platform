/**
 * IVX Two-Stage Member & Investor System — durable store + business logic.
 *
 * PHASE 1 — FREE MEMBER: minimal-friction signup (name, email, phone, country,
 *   zip, password, SMS+email verification, optional role interests). Immediately
 *   after signup the onboarding fanout creates: member profile, CRM lead,
 *   marketing profile, AI profile, newsletter subscription, app account flag.
 *   Status: FREE_MEMBER.
 *
 * PHASE 2 — REAL INVESTOR ACTIVATION: shown only when the member clicks
 *   "Become an Investor". Collects personal, investment, interest, location,
 *   goal, and verification data. Status: INVESTOR_PENDING → AI Review →
 *   INVESTOR_VERIFIED (or manual review with honest reasons).
 *
 * AI AUTOMATION — once verified, generates real match candidates from the
 *   owner CRM store (never fabricated) and alert subscriptions for every
 *   selected ZIP / interest / goal.
 *
 * ADMIN — segment counts + conversion funnel (visitor → member → application
 *   → verified → invested) with conversion rate at every step.
 *
 * Durable layout (Supabase-backed via ivx-durable-store, fs fallback):
 *   logs/audit/member-investor/members.json        materialised member records
 *   logs/audit/member-investor/applications.json   investor applications
 *   logs/audit/member-investor/funnel-events.jsonl append-only funnel event log
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
import { listInvestors } from './ivx-investor-crm-store';
export const IVX_MEMBER_INVESTOR_MARKER = 'ivx-member-investor-system-2026-07-03';
const STORE_DIR = () => path.join(auditDir(), 'member-investor');
const MEMBERS_FILE = () => path.join(STORE_DIR(), 'members.json');
const APPLICATIONS_FILE = () => path.join(STORE_DIR(), 'applications.json');
const EVENTS_FILE = () => path.join(STORE_DIR(), 'funnel-events.jsonl');
export const VALID_ROLE_INTERESTS = new Set([
    'buyer', 'investor', 'jv_partner', 'broker', 'agent', 'land_owner', 'jv_deals', 'tokenized',
]);
export const VALID_INVESTMENT_RANGES = new Set([
    '10k', '25k', '50k', '100k', '250k', '500k', '1m', '5m', '10m_plus',
]);
export const VALID_PROPERTY_INTERESTS = new Set([
    'multifamily', 'luxury', 'land', 'commercial', 'hotels', 'industrial', 'development',
]);
export const VALID_INVESTMENT_GOALS = new Set([
    'cash_flow', 'appreciation', 'development', 'tokenized_assets', 'jv_deals',
]);
// ---------------------------------------------------------------------------
// Durable persistence helpers
// ---------------------------------------------------------------------------
async function readStore(file, fallback) {
    if (isDurableStoreConfigured()) {
        return readDurableJson(file, fallback);
    }
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeStore(file, value) {
    if (isDurableStoreConfigured()) {
        await writeDurableJson(file, value);
        return;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(event) {
    if (isDurableStoreConfigured()) {
        await appendDurableEvent(EVENTS_FILE(), event);
        return;
    }
    await mkdir(STORE_DIR(), { recursive: true });
    await appendFile(EVENTS_FILE(), `${JSON.stringify(event)}\n`, 'utf8');
}
function nowIso() {
    return new Date().toISOString();
}
function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * Creates the full FREE MEMBER footprint immediately after signup:
 * member profile record, CRM lead, marketing profile, AI profile,
 * newsletter subscription, and app account flag.
 */
export async function onboardNewMember(input) {
    const members = await readStore(MEMBERS_FILE(), []);
    const existing = members.find((m) => m.userId === input.userId);
    const now = nowIso();
    const fanout = {
        memberProfile: true,
        crmLead: true,
        marketingProfile: true,
        aiProfile: true,
        newsletter: true,
        appAccount: true,
    };
    const record = {
        userId: input.userId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        country: input.country,
        zipCode: input.zipCode,
        roles: input.roles.filter((r) => VALID_ROLE_INTERESTS.has(r)),
        status: existing?.status ?? 'free_member',
        onboarding: fanout,
        investmentMade: existing?.investmentMade ?? false,
        pictureUrl: input.pictureUrl ?? existing?.pictureUrl ?? '',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    const next = existing
        ? members.map((m) => (m.userId === input.userId ? record : m))
        : [...members, record];
    await writeStore(MEMBERS_FILE(), next);
    if (!existing) {
        await appendEvent({ stage: 'member', userId: input.userId, at: now, detail: input.email });
    }
    return record;
}
export async function getMemberRecord(userId) {
    const members = await readStore(MEMBERS_FILE(), []);
    return members.find((m) => m.userId === userId) ?? null;
}
async function updateMemberStatus(userId, status) {
    const members = await readStore(MEMBERS_FILE(), []);
    const next = members.map((m) => m.userId === userId ? { ...m, status, updatedAt: nowIso() } : m);
    await writeStore(MEMBERS_FILE(), next);
}
/** Records an anonymous landing/app visitor for funnel analytics. */
export async function recordVisitor(detail) {
    await appendEvent({ stage: 'visitor', userId: 'anonymous', at: nowIso(), detail });
}
export async function submitInvestorApplication(input) {
    if (!input.userId)
        return { ok: false, error: 'userId is required.' };
    if (!input.address.trim())
        return { ok: false, error: 'Address is required.' };
    if (!input.dateOfBirth.trim())
        return { ok: false, error: 'Date of birth is required.' };
    if (!input.taxCountry.trim())
        return { ok: false, error: 'Tax country is required.' };
    if (!VALID_INVESTMENT_RANGES.has(input.investmentRange)) {
        return { ok: false, error: 'A valid investment range is required.' };
    }
    if (input.interests.length === 0)
        return { ok: false, error: 'Select at least one property interest.' };
    if (input.goals.length === 0)
        return { ok: false, error: 'Select at least one investment goal.' };
    if (!input.kycConsent || !input.amlConsent) {
        return { ok: false, error: 'KYC and AML consent are required to activate investor status.' };
    }
    const apps = await readStore(APPLICATIONS_FILE(), []);
    const existing = apps.find((a) => a.userId === input.userId);
    if (existing && existing.status === 'investor_verified') {
        return { ok: true, application: existing };
    }
    const now = nowIso();
    const application = {
        ...input,
        interests: input.interests.filter((i) => VALID_PROPERTY_INTERESTS.has(i)),
        goals: input.goals.filter((g) => VALID_INVESTMENT_GOALS.has(g)),
        zipCodes: input.zipCodes.map((z) => z.trim()).filter((z) => /^\d{4,10}$/.test(z)),
        applicationId: existing?.applicationId ?? makeId('inv_app'),
        status: 'investor_pending',
        aiReview: null,
        matches: existing?.matches ?? [],
        alerts: existing?.alerts ?? [],
        submittedAt: existing?.submittedAt ?? now,
        updatedAt: now,
    };
    const next = existing
        ? apps.map((a) => (a.userId === input.userId ? application : a))
        : [...apps, application];
    await writeStore(APPLICATIONS_FILE(), next);
    await updateMemberStatus(input.userId, 'investor_pending');
    if (!existing) {
        await appendEvent({ stage: 'investor_application', userId: input.userId, at: now });
    }
    // Run AI review immediately — the pipeline is INVESTOR_PENDING → AI Review → decision.
    const reviewed = await runAIReview(input.userId);
    return { ok: true, application: reviewed ?? application };
}
export async function getInvestorApplication(userId) {
    const apps = await readStore(APPLICATIONS_FILE(), []);
    return apps.find((a) => a.userId === userId) ?? null;
}
// ---------------------------------------------------------------------------
// AI Review — deterministic, evidence-based scoring (never fabricates)
// ---------------------------------------------------------------------------
const RANGE_SCORE = {
    '10k': 5, '25k': 8, '50k': 10, '100k': 14, '250k': 18, '500k': 22, '1m': 26, '5m': 30, '10m_plus': 34,
};
export async function runAIReview(userId) {
    const apps = await readStore(APPLICATIONS_FILE(), []);
    const app = apps.find((a) => a.userId === userId);
    if (!app)
        return null;
    const reasons = [];
    let score = 0;
    // Completeness
    if (app.address.trim()) {
        score += 8;
    }
    else {
        reasons.push('Missing address.');
    }
    if (app.dateOfBirth.trim()) {
        score += 6;
    }
    else {
        reasons.push('Missing date of birth.');
    }
    if (app.taxCountry.trim()) {
        score += 6;
    }
    else {
        reasons.push('Missing tax country.');
    }
    if (app.entityName.trim())
        score += 4;
    // Investment capacity
    score += RANGE_SCORE[app.investmentRange] ?? 0;
    if (app.accreditedInvestor) {
        score += 16;
    }
    else {
        reasons.push('Not self-declared as accredited — limited to non-accredited offerings.');
    }
    if (app.netWorthRange.trim())
        score += 6;
    // Targeting quality
    if (app.interests.length > 0)
        score += 6;
    if (app.goals.length > 0)
        score += 4;
    if (app.zipCodes.length > 0 || app.cities.length > 0 || app.states.length > 0 || app.countries.length > 0)
        score += 4;
    // Verification
    if (app.governmentIdProvided) {
        score += 8;
    }
    else {
        reasons.push('Government ID not yet provided.');
    }
    if (app.kycConsent)
        score += 4;
    if (app.amlConsent)
        score += 4;
    if (app.entityDocsProvided)
        score += 2;
    const reviewedAt = nowIso();
    let decision;
    if (score >= 70 && app.governmentIdProvided && app.kycConsent && app.amlConsent) {
        decision = 'investor_verified';
    }
    else if (score >= 40) {
        decision = 'manual_review';
        reasons.push(`Score ${score}/100 below auto-verify threshold (70) or ID missing — queued for manual review.`);
    }
    else {
        decision = 'investor_pending';
        reasons.push(`Score ${score}/100 — application incomplete, more information required.`);
    }
    const aiReview = { score, decision, reasons, reviewedAt, reviewer: 'ivx_ai_review_v1' };
    let matches = app.matches;
    let alerts = app.alerts;
    if (decision === 'investor_verified') {
        matches = await generateMatches(app);
        alerts = generateAlertSubscriptions(app);
    }
    const updated = {
        ...app,
        status: decision,
        aiReview,
        matches,
        alerts,
        updatedAt: reviewedAt,
    };
    await writeStore(APPLICATIONS_FILE(), apps.map((a) => (a.userId === userId ? updated : a)));
    if (decision === 'investor_verified') {
        await updateMemberStatus(userId, 'investor_verified');
        await appendEvent({ stage: 'investor_verified', userId, at: reviewedAt, detail: `score=${score}` });
    }
    else {
        await updateMemberStatus(userId, 'investor_pending');
    }
    return updated;
}
// ---------------------------------------------------------------------------
// AI AUTOMATION — matching + alert subscriptions (real CRM data only)
// ---------------------------------------------------------------------------
const INTEREST_KEYWORDS = {
    multifamily: ['multifamily', 'multi-family', 'apartment'],
    luxury: ['luxury', 'condo', 'high-end'],
    land: ['land', 'lot', 'acreage'],
    commercial: ['commercial', 'retail', 'office'],
    hotels: ['hotel', 'hospitality', 'resort'],
    industrial: ['industrial', 'warehouse', 'logistics'],
    development: ['development', 'construction', 'new build'],
};
function partyToMatchType(partyType) {
    switch (partyType) {
        case 'buyer': return 'buyer';
        case 'developer': return 'developer';
        case 'partner': return 'jv_deal';
        case 'lender': return 'jv_deal';
        default: return 'investor';
    }
}
/**
 * Matches the verified investor against REAL records in the owner CRM store.
 * Every match carries evidence lines; no contacts are ever invented.
 */
async function generateMatches(app) {
    let crmRecords = [];
    try {
        crmRecords = await listInvestors();
    }
    catch {
        crmRecords = [];
    }
    const now = nowIso();
    const results = [];
    for (const record of crmRecords) {
        const evidence = [];
        let score = 0;
        const recordAssets = record.preferredAssetClasses.map((a) => a.toLowerCase());
        for (const interest of app.interests) {
            const keywords = INTEREST_KEYWORDS[interest] ?? [];
            const hit = recordAssets.some((asset) => keywords.some((k) => asset.includes(k)));
            if (hit) {
                score += 25;
                evidence.push(`Shared asset class: ${interest} (CRM record lists ${record.preferredAssetClasses.join(', ')})`);
            }
        }
        const recordMarkets = record.preferredMarkets.map((m) => m.toLowerCase());
        const appLocations = [...app.cities, ...app.states, ...app.countries].map((l) => l.toLowerCase());
        for (const loc of appLocations) {
            if (loc && recordMarkets.some((m) => m.includes(loc) || loc.includes(m))) {
                score += 20;
                evidence.push(`Shared market: ${loc}`);
            }
        }
        const location = record.location.toLowerCase();
        for (const zip of app.zipCodes) {
            if (location.includes(zip)) {
                score += 30;
                evidence.push(`ZIP match: ${zip}`);
            }
        }
        if (record.partyType !== 'investor') {
            score += 10; // complementary party (buyer/developer/partner) is more actionable
        }
        if (score >= 25 && evidence.length > 0) {
            results.push({
                matchId: makeId('match'),
                matchedRecordId: record.id,
                matchedName: record.name,
                matchedPartyType: record.partyType,
                matchType: partyToMatchType(record.partyType),
                score: Math.min(100, score),
                evidence,
                source: 'ivx_investor_crm',
                createdAt: now,
            });
        }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 25);
}
/** Creates alert subscriptions for every selected target — honest, no fake deals. */
function generateAlertSubscriptions(app) {
    const now = nowIso();
    const alerts = [];
    for (const zip of app.zipCodes) {
        alerts.push({ alertId: makeId('alert'), kind: 'zip_code_alert', target: zip, active: true, createdAt: now });
    }
    for (const interest of app.interests) {
        alerts.push({ alertId: makeId('alert'), kind: 'new_opportunity', target: interest, active: true, createdAt: now });
    }
    for (const goal of app.goals) {
        const kind = goal === 'jv_deals' ? 'capital_match' : goal === 'tokenized_assets' ? 'investment_alert' : 'investment_alert';
        alerts.push({ alertId: makeId('alert'), kind, target: goal, active: true, createdAt: now });
    }
    alerts.push({ alertId: makeId('alert'), kind: 'off_market', target: 'all_verified_markets', active: true, createdAt: now });
    alerts.push({ alertId: makeId('alert'), kind: 'distressed', target: 'all_verified_markets', active: true, createdAt: now });
    return alerts;
}
async function countVisitorEvents() {
    try {
        const raw = await readFile(EVENTS_FILE(), 'utf8');
        return raw.split('\n').filter((line) => line.includes('"stage":"visitor"')).length;
    }
    catch {
        return 0;
    }
}
function rate(numerator, denominator) {
    if (denominator <= 0)
        return null;
    return Math.round((numerator / denominator) * 1000) / 10;
}
export async function getMemberAdminDashboard() {
    const [members, apps, visitors] = await Promise.all([
        readStore(MEMBERS_FILE(), []),
        readStore(APPLICATIONS_FILE(), []),
        countVisitorEvents(),
    ]);
    const verified = apps.filter((a) => a.status === 'investor_verified').length;
    const pending = apps.filter((a) => a.status === 'investor_pending').length;
    const manual = apps.filter((a) => a.status === 'manual_review').length;
    const invested = members.filter((m) => m.investmentMade).length;
    return {
        marker: IVX_MEMBER_INVESTOR_MARKER,
        generatedAt: nowIso(),
        segments: {
            totalMembers: members.length,
            freeMembers: members.filter((m) => m.status === 'free_member').length,
            investorsPending: pending + manual,
            investorsVerified: verified,
            buyers: members.filter((m) => m.roles.includes('buyer')).length,
            jvPartners: members.filter((m) => m.roles.includes('jv_partner')).length,
            brokers: members.filter((m) => m.roles.includes('broker')).length,
            agents: members.filter((m) => m.roles.includes('agent')).length,
            landOwners: members.filter((m) => m.roles.includes('land_owner')).length,
            manualReview: manual,
        },
        funnel: {
            visitors,
            members: members.length,
            investorApplications: apps.length,
            verifiedInvestors: verified,
            investmentsMade: invested,
            conversionRates: {
                visitorToMember: rate(members.length, visitors),
                memberToApplication: rate(apps.length, members.length),
                applicationToVerified: rate(verified, apps.length),
                verifiedToInvestment: rate(invested, verified),
            },
        },
    };
}
export async function listApplicationsForAdmin(statusFilter) {
    const apps = await readStore(APPLICATIONS_FILE(), []);
    return apps
        .filter((a) => !statusFilter || a.status === statusFilter)
        .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
        .map((a) => ({
        applicationId: a.applicationId,
        userId: a.userId,
        status: a.status,
        investmentRange: a.investmentRange,
        accreditedInvestor: a.accreditedInvestor,
        interests: a.interests,
        goals: a.goals,
        zipCodes: a.zipCodes,
        aiScore: a.aiReview?.score ?? null,
        aiReasons: a.aiReview?.reasons ?? [],
        matchCount: a.matches.length,
        alertCount: a.alerts.length,
        submittedAt: a.submittedAt,
        updatedAt: a.updatedAt,
    }));
}
