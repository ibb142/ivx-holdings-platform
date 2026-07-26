/**
 * IVX Content Engine + News/Technology Scanner + Opportunity Matcher
 *
 * Section 9: Organic content engine (daily articles, social posts, project updates,
 *   video concepts, investor/buyer FAQs)
 * Section 10: Technology and news scanner (AI, mobile, real-estate tech, tokenization,
 *   payments, KYC/AML, CRM, cybersecurity, cloud, regulatory, lending trends)
 * Section 11: Opportunity matching (prospects ↔ canonical IVX deals)
 *
 * HARD RULES:
 *   - No content may promise returns or fabricate project progress
 *   - No technology is automatically installed or purchased — recommendations only
 *   - Matching uses only real canonical IVX opportunities
 */
import { randomUUID } from 'crypto';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, } from './ivx-durable-store';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_CONTENT_NEWS_MARKER = 'ivx-content-news-engine-2026-07-23';
export const BANNED_CONTENT_PHRASES = [
    'guaranteed return',
    'guaranteed ROI',
    'risk-free',
    'no risk investment',
    'can\'t lose',
    'sure thing',
    'guaranteed profit',
    'guaranteed income',
    'guaranteed appreciation',
    '100% safe',
    'can\'t go wrong',
    'fail-proof',
];
export function containsBannedContentPhrases(text) {
    const lower = text.toLowerCase();
    const found = [];
    for (const phrase of BANNED_CONTENT_PHRASES) {
        if (lower.includes(phrase))
            found.push(phrase);
    }
    return { found: found.length > 0, phrases: found };
}
/**
 * Validate content for return promises and fabricated progress.
 */
export function validateContent(input) {
    const violations = [];
    const bannedCheck = containsBannedContentPhrases(`${input.title} ${input.body} ${input.summary}`);
    if (bannedCheck.found) {
        violations.push(`Banned phrases detected: ${bannedCheck.phrases.join(', ')}`);
    }
    // Check for fabricated progress claims
    const progressClaims = ['completed', 'finished', 'delivered', 'sold out', 'fully leased'];
    const lowerBody = input.body.toLowerCase();
    const fabricatedProgress = progressClaims.some(claim => lowerBody.includes(claim)) &&
        !lowerBody.includes('planned') && !lowerBody.includes('scheduled') &&
        !lowerBody.includes('projected');
    const record = {
        contentId: `content-${randomUUID()}`,
        category: input.category,
        title: input.title,
        body: input.body,
        summary: input.summary,
        tags: input.tags ?? [],
        status: violations.length > 0 ? 'REJECTED' : 'DRAFT',
        promisesReturns: bannedCheck.found,
        fabricatesProgress: fabricatedProgress,
        createdAt: new Date().toISOString(),
        approvedAt: null,
        publishedAt: null,
        views: 0,
        leads: 0,
        registrations: 0,
        qualifiedConversions: 0,
    };
    if (fabricatedProgress) {
        violations.push('Content appears to claim project completion without qualification — verify all progress claims.');
    }
    return { valid: violations.length === 0, violations, record };
}
export function getDefaultDailyContentTarget() {
    return {
        date: new Date().toISOString().slice(0, 10),
        detailedArticle: 1,
        shortSocialPosts: 3,
        projectUpdate: 1,
        shortFormVideoConcept: 1,
        investorFaq: 1,
        buyerOrJvFaq: 1,
    };
}
export function createNewsRecord(input) {
    return {
        newsId: `news-${randomUUID()}`,
        title: input.title,
        source: input.source,
        sourceUrl: input.sourceUrl,
        date: input.date,
        category: input.category,
        summary: input.summary,
        whyItMattersToIVX: input.whyItMattersToIVX,
        potentialUse: input.potentialUse,
        risk: input.risk,
        estimatedCost: input.estimatedCost ?? null,
        implementationComplexity: input.implementationComplexity ?? 'UNKNOWN',
        recommendedAction: input.recommendedAction,
        confidence: Math.max(0, Math.min(1, input.confidence)),
        createdAt: new Date().toISOString(),
    };
}
/**
 * Match a prospect against an IVX opportunity using location, project type,
 * capital range, deal size, geography, and risk profile.
 */
export function matchProspectToOpportunity(input) {
    const { prospect, opportunity } = input;
    const reasons = [];
    const missing = [];
    let score = 0;
    // Geographic match (0-30)
    const oppLocation = opportunity.location.toLowerCase();
    const geoFocus = prospect.geographicFocus.map(g => g.toLowerCase());
    if (geoFocus.some(g => oppLocation.includes(g) || g.includes(oppLocation.split(',')[0]))) {
        score += 30;
        reasons.push(`Geographic match: prospect focuses on ${prospect.geographicFocus.join(', ')} — opportunity in ${opportunity.location}`);
    }
    else if (geoFocus.length === 0) {
        missing.push('Prospect geographic focus not specified');
    }
    else {
        reasons.push(`Geographic mismatch: prospect focuses on ${prospect.geographicFocus.join(', ')} — opportunity in ${opportunity.location}`);
    }
    // Property/deal type match (0-25)
    const oppType = opportunity.projectType.toLowerCase();
    const propTypes = prospect.propertyTypes.map(p => p.toLowerCase());
    if (propTypes.some(p => oppType.includes(p) || p.includes(oppType))) {
        score += 25;
        reasons.push(`Property type match: prospect interested in ${prospect.propertyTypes.join(', ')}`);
    }
    else if (propTypes.length === 0) {
        missing.push('Prospect property type preferences not specified');
    }
    // Capital range match (0-20)
    if (prospect.publiclyStatedCapitalRange) {
        const rangeLower = prospect.publiclyStatedCapitalRange.toLowerCase();
        if (rangeLower.includes('m') || rangeLower.includes('million')) {
            const nums = rangeLower.match(/\d+/g);
            if (nums) {
                const maxCapital = Math.max(...nums.map(Number)) * 1000000;
                if (maxCapital >= opportunity.minInvestment) {
                    score += 20;
                    reasons.push(`Capital range match: prospect stated ${prospect.publiclyStatedCapitalRange} — minimum is $${opportunity.minInvestment}`);
                }
            }
        }
        else if (parseInt(rangeLower) >= opportunity.minInvestment) {
            score += 15;
            reasons.push(`Capital range potentially compatible`);
        }
    }
    else {
        missing.push('Prospect capital range not publicly stated');
    }
    // Investment focus match (0-15)
    if (prospect.investmentOrBuyerFocus) {
        const focus = prospect.investmentOrBuyerFocus.toLowerCase();
        if (focus.includes('real estate') || focus.includes('property') || focus.includes('development')) {
            score += 15;
            reasons.push(`Investment focus aligns with real estate`);
        }
    }
    else {
        missing.push('Prospect investment focus not specified');
    }
    // Risk profile match (0-10)
    if (opportunity.riskProfile.toLowerCase().includes('moderate') || opportunity.riskProfile.toLowerCase().includes('low')) {
        score += 10;
        reasons.push(`Risk profile: ${opportunity.riskProfile}`);
    }
    const contactEligibility = prospect.contactPermissionStatus === 'EMAIL_ELIGIBLE'
        ? 'ELIGIBLE'
        : prospect.contactPermissionStatus === 'DO_NOT_CONTACT' || prospect.contactPermissionStatus === 'UNSUBSCRIBED' || prospect.contactPermissionStatus === 'SUPPRESSED'
            ? 'BLOCKED'
            : 'REVIEW_REQUIRED';
    const recommendedNextAction = score >= 60 && contactEligibility === 'ELIGIBLE'
        ? 'Initiate outreach with opportunity details'
        : score >= 40
            ? 'Gather more information before outreach'
            : 'Archive — insufficient match';
    return {
        prospectId: prospect.prospectId,
        opportunity,
        matchScore: Math.min(100, score),
        matchReasons: reasons,
        missingInformation: missing,
        contactEligibility,
        recommendedNextAction,
    };
}
// ─── Durable Storage ───────────────────────────────────────────────
const STORE_DIR = auditDir('growth-engine');
const CONTENT_FILE = path.join(STORE_DIR, 'content.json');
const NEWS_FILE = path.join(STORE_DIR, 'news.json');
let contentCache = null;
let newsCache = null;
async function loadContent() {
    if (contentCache)
        return contentCache;
    if (isDurableStoreConfigured()) {
        contentCache = await readDurableJson(CONTENT_FILE, []);
        return contentCache;
    }
    try {
        contentCache = JSON.parse(await readFile(CONTENT_FILE, 'utf8'));
        return contentCache;
    }
    catch {
        contentCache = [];
        return contentCache;
    }
}
async function saveContent(records) {
    contentCache = records;
    if (isDurableStoreConfigured()) {
        await writeDurableJson(CONTENT_FILE, records);
        return;
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(CONTENT_FILE, JSON.stringify(records, null, 2), 'utf8');
}
export async function saveContentRecord(record) {
    const records = await loadContent();
    records.push(record);
    await saveContent(records);
    return record;
}
export async function listContent(filter) {
    const records = await loadContent();
    let filtered = records;
    if (filter?.category)
        filtered = filtered.filter(r => r.category === filter.category);
    if (filter?.status)
        filtered = filtered.filter(r => r.status === filter.status);
    return filtered;
}
export async function approveContent(contentId) {
    const records = await loadContent();
    const idx = records.findIndex(r => r.contentId === contentId);
    if (idx < 0)
        return null;
    records[idx] = { ...records[idx], status: 'APPROVED', approvedAt: new Date().toISOString() };
    await saveContent(records);
    return records[idx];
}
export async function publishContent(contentId) {
    const records = await loadContent();
    const idx = records.findIndex(r => r.contentId === contentId);
    if (idx < 0)
        return null;
    if (records[idx].status !== 'APPROVED')
        return null;
    records[idx] = { ...records[idx], status: 'PUBLISHED', publishedAt: new Date().toISOString() };
    await saveContent(records);
    return records[idx];
}
async function loadNews() {
    if (newsCache)
        return newsCache;
    if (isDurableStoreConfigured()) {
        newsCache = await readDurableJson(NEWS_FILE, []);
        return newsCache;
    }
    try {
        newsCache = JSON.parse(await readFile(NEWS_FILE, 'utf8'));
        return newsCache;
    }
    catch {
        newsCache = [];
        return newsCache;
    }
}
async function saveNews(records) {
    newsCache = records;
    if (isDurableStoreConfigured()) {
        await writeDurableJson(NEWS_FILE, records);
        return;
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(NEWS_FILE, JSON.stringify(records, null, 2), 'utf8');
}
export async function saveNewsRecord(record) {
    const records = await loadNews();
    records.push(record);
    await saveNews(records);
    return record;
}
export async function listNews(filter) {
    const records = await loadNews();
    let filtered = records;
    if (filter?.category)
        filtered = filtered.filter(r => r.category === filter.category);
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (filter?.limit)
        return filtered.slice(0, filter.limit);
    return filtered;
}
export async function getContentPerformanceMetrics() {
    const records = await loadContent();
    const published = records.filter(r => r.status === 'PUBLISHED');
    const totalViews = published.reduce((sum, r) => sum + r.views, 0);
    const totalLeads = published.reduce((sum, r) => sum + r.leads, 0);
    const totalRegistrations = published.reduce((sum, r) => sum + r.registrations, 0);
    const totalQualifiedConversions = published.reduce((sum, r) => sum + r.qualifiedConversions, 0);
    const byCategory = {};
    for (const r of records) {
        byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    }
    return {
        totalContent: records.length,
        published: published.length,
        drafts: records.filter(r => r.status === 'DRAFT').length,
        pendingApproval: records.filter(r => r.status === 'PENDING_APPROVAL').length,
        rejected: records.filter(r => r.status === 'REJECTED').length,
        totalViews,
        totalLeads,
        totalRegistrations,
        totalQualifiedConversions,
        contentToLeadConversionRate: totalViews > 0 ? (totalLeads / totalViews) * 100 : 0,
        byCategory,
    };
}
