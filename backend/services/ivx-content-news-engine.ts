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
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const IVX_CONTENT_NEWS_MARKER = 'ivx-content-news-engine-2026-07-23';

// ─── Section 9: Organic Content Engine ─────────────────────────────

export type ContentCategory =
  | 'PROJECT_UPDATE' | 'CONSTRUCTION_PROGRESS' | 'OPPORTUNITY_EDUCATION'
  | 'MARKET_EDUCATION' | 'INVESTOR_FAQ' | 'BUYER_FAQ' | 'JV_FAQ'
  | 'TOKENIZATION_EDUCATION' | 'RISK_EXPLANATION' | 'LEADERSHIP_INSIGHTS'
  | 'TECHNOLOGY_UPDATE' | 'BEHIND_SCENES' | 'DEAL_DOCUMENT_EXPLANATION'
  | 'MANAGEMENT_INTERVIEW' | 'PROPERTY_VIDEO' | 'SHORT_SOCIAL_POST';

export type ContentStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PUBLISHED' | 'REJECTED';

export type ContentRecord = {
  contentId: string;
  category: ContentCategory;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  status: ContentStatus;
  promisesReturns: boolean;
  fabricatesProgress: boolean;
  createdAt: string;
  approvedAt: string | null;
  publishedAt: string | null;
  views: number;
  leads: number;
  registrations: number;
  qualifiedConversions: number;
};

export const BANNED_CONTENT_PHRASES: readonly string[] = [
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

export function containsBannedContentPhrases(text: string): {
  found: boolean;
  phrases: string[];
} {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const phrase of BANNED_CONTENT_PHRASES) {
    if (lower.includes(phrase)) found.push(phrase);
  }
  return { found: found.length > 0, phrases: found };
}

/**
 * Validate content for return promises and fabricated progress.
 */
export function validateContent(input: {
  category: ContentCategory;
  title: string;
  body: string;
  summary: string;
  tags?: string[];
}): {
  valid: boolean;
  violations: string[];
  record: ContentRecord;
} {
  const violations: string[] = [];
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

  const record: ContentRecord = {
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

// ─── Daily Content Target ──────────────────────────────────────────

export type DailyContentTarget = {
  date: string;
  detailedArticle: number;      // target: 1
  shortSocialPosts: number;     // target: 2-3
  projectUpdate: number;        // target: 1
  shortFormVideoConcept: number; // target: 1
  investorFaq: number;          // target: 1
  buyerOrJvFaq: number;         // target: 1
};

export function getDefaultDailyContentTarget(): DailyContentTarget {
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

// ─── Section 10: News & Technology Scanner ─────────────────────────

export type NewsCategory =
  | 'AI_ENGINEERING' | 'MOBILE_TECH' | 'REAL_ESTATE_TECH'
  | 'PROPERTY_MANAGEMENT' | 'INVESTMENT_PLATFORMS' | 'TOKENIZATION'
  | 'PAYMENTS' | 'IDENTITY_VERIFICATION' | 'KYC_AML' | 'CRM_SYSTEMS'
  | 'DATA_PROVIDERS' | 'CONSTRUCTION_TECH' | 'INVESTOR_COMMUNICATION'
  | 'CYBERSECURITY' | 'CLOUD_INFRASTRUCTURE' | 'REGULATORY_ANNOUNCEMENT'
  | 'MAJOR_RE_TRANSACTION' | 'LENDING_TRENDS' | 'CAPITAL_MARKETS';

export type NewsRecord = {
  newsId: string;
  title: string;
  source: string;
  sourceUrl: string;
  date: string;
  category: NewsCategory;
  summary: string;
  whyItMattersToIVX: string;
  potentialUse: string;
  risk: string;
  estimatedCost: string | null;
  implementationComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  recommendedAction: string;
  confidence: number;
  createdAt: string;
};

export function createNewsRecord(input: {
  title: string;
  source: string;
  sourceUrl: string;
  date: string;
  category: NewsCategory;
  summary: string;
  whyItMattersToIVX: string;
  potentialUse: string;
  risk: string;
  estimatedCost?: string | null;
  implementationComplexity?: NewsRecord['implementationComplexity'];
  recommendedAction: string;
  confidence: number;
}): NewsRecord {
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

// ─── Section 11: Opportunity Matching ──────────────────────────────

export type IVXOpportunity = {
  opportunityId: string;
  title: string;
  location: string;
  projectType: string;
  capitalRequired: number;
  minInvestment: number;
  targetROI: number;
  holdPeriodYears: number;
  riskProfile: string;
  constructionStage: string;
  targetExit: string;
  tokenizedEligible: boolean;
  marketingStatus: string;
};

export type OpportunityMatch = {
  prospectId: string;
  opportunity: IVXOpportunity;
  matchScore: number; // 0-100
  matchReasons: string[];
  missingInformation: string[];
  contactEligibility: string;
  recommendedNextAction: string;
};

/**
 * Match a prospect against an IVX opportunity using location, project type,
 * capital range, deal size, geography, and risk profile.
 */
export function matchProspectToOpportunity(input: {
  prospect: {
    prospectId: string;
    geographicFocus: string[];
    propertyTypes: string[];
    publiclyStatedCapitalRange: string | null;
    publiclyStatedDealSize: string | null;
    investmentOrBuyerFocus: string | null;
    contactPermissionStatus: string;
  };
  opportunity: IVXOpportunity;
}): OpportunityMatch {
  const { prospect, opportunity } = input;
  const reasons: string[] = [];
  const missing: string[] = [];
  let score = 0;

  // Geographic match (0-30)
  const oppLocation = opportunity.location.toLowerCase();
  const geoFocus = prospect.geographicFocus.map(g => g.toLowerCase());
  if (geoFocus.some(g => oppLocation.includes(g) || g.includes(oppLocation.split(',')[0]))) {
    score += 30;
    reasons.push(`Geographic match: prospect focuses on ${prospect.geographicFocus.join(', ')} — opportunity in ${opportunity.location}`);
  } else if (geoFocus.length === 0) {
    missing.push('Prospect geographic focus not specified');
  } else {
    reasons.push(`Geographic mismatch: prospect focuses on ${prospect.geographicFocus.join(', ')} — opportunity in ${opportunity.location}`);
  }

  // Property/deal type match (0-25)
  const oppType = opportunity.projectType.toLowerCase();
  const propTypes = prospect.propertyTypes.map(p => p.toLowerCase());
  if (propTypes.some(p => oppType.includes(p) || p.includes(oppType))) {
    score += 25;
    reasons.push(`Property type match: prospect interested in ${prospect.propertyTypes.join(', ')}`);
  } else if (propTypes.length === 0) {
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
    } else if (parseInt(rangeLower) >= opportunity.minInvestment) {
      score += 15;
      reasons.push(`Capital range potentially compatible`);
    }
  } else {
    missing.push('Prospect capital range not publicly stated');
  }

  // Investment focus match (0-15)
  if (prospect.investmentOrBuyerFocus) {
    const focus = prospect.investmentOrBuyerFocus.toLowerCase();
    if (focus.includes('real estate') || focus.includes('property') || focus.includes('development')) {
      score += 15;
      reasons.push(`Investment focus aligns with real estate`);
    }
  } else {
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

let contentCache: ContentRecord[] | null = null;
let newsCache: NewsRecord[] | null = null;

async function loadContent(): Promise<ContentRecord[]> {
  if (contentCache) return contentCache;
  if (isDurableStoreConfigured()) {
    contentCache = await readDurableJson<ContentRecord[]>(CONTENT_FILE, []);
    return contentCache;
  }
  try {
    contentCache = JSON.parse(await readFile(CONTENT_FILE, 'utf8')) as ContentRecord[];
    return contentCache;
  } catch {
    contentCache = [];
    return contentCache;
  }
}

async function saveContent(records: ContentRecord[]): Promise<void> {
  contentCache = records;
  if (isDurableStoreConfigured()) {
    await writeDurableJson(CONTENT_FILE, records);
    return;
  }
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(CONTENT_FILE, JSON.stringify(records, null, 2), 'utf8');
}

export async function saveContentRecord(record: ContentRecord): Promise<ContentRecord> {
  const records = await loadContent();
  records.push(record);
  await saveContent(records);
  return record;
}

export async function listContent(filter?: {
  category?: ContentCategory;
  status?: ContentStatus;
}): Promise<ContentRecord[]> {
  const records = await loadContent();
  let filtered = records;
  if (filter?.category) filtered = filtered.filter(r => r.category === filter.category);
  if (filter?.status) filtered = filtered.filter(r => r.status === filter.status);
  return filtered;
}

export async function approveContent(contentId: string): Promise<ContentRecord | null> {
  const records = await loadContent();
  const idx = records.findIndex(r => r.contentId === contentId);
  if (idx < 0) return null;
  records[idx] = { ...records[idx], status: 'APPROVED', approvedAt: new Date().toISOString() };
  await saveContent(records);
  return records[idx];
}

export async function publishContent(contentId: string): Promise<ContentRecord | null> {
  const records = await loadContent();
  const idx = records.findIndex(r => r.contentId === contentId);
  if (idx < 0) return null;
  if (records[idx].status !== 'APPROVED') return null;
  records[idx] = { ...records[idx], status: 'PUBLISHED', publishedAt: new Date().toISOString() };
  await saveContent(records);
  return records[idx];
}

async function loadNews(): Promise<NewsRecord[]> {
  if (newsCache) return newsCache;
  if (isDurableStoreConfigured()) {
    newsCache = await readDurableJson<NewsRecord[]>(NEWS_FILE, []);
    return newsCache;
  }
  try {
    newsCache = JSON.parse(await readFile(NEWS_FILE, 'utf8')) as NewsRecord[];
    return newsCache;
  } catch {
    newsCache = [];
    return newsCache;
  }
}

async function saveNews(records: NewsRecord[]): Promise<void> {
  newsCache = records;
  if (isDurableStoreConfigured()) {
    await writeDurableJson(NEWS_FILE, records);
    return;
  }
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(NEWS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

export async function saveNewsRecord(record: NewsRecord): Promise<NewsRecord> {
  const records = await loadNews();
  records.push(record);
  await saveNews(records);
  return record;
}

export async function listNews(filter?: {
  category?: NewsCategory;
  limit?: number;
}): Promise<NewsRecord[]> {
  const records = await loadNews();
  let filtered = records;
  if (filter?.category) filtered = filtered.filter(r => r.category === filter.category);
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (filter?.limit) return filtered.slice(0, filter.limit);
  return filtered;
}

// ─── Content Performance Metrics ───────────────────────────────────

export type ContentPerformanceMetrics = {
  totalContent: number;
  published: number;
  drafts: number;
  pendingApproval: number;
  rejected: number;
  totalViews: number;
  totalLeads: number;
  totalRegistrations: number;
  totalQualifiedConversions: number;
  contentToLeadConversionRate: number;
  byCategory: Record<string, number>;
};

export async function getContentPerformanceMetrics(): Promise<ContentPerformanceMetrics> {
  const records = await loadContent();
  const published = records.filter(r => r.status === 'PUBLISHED');
  const totalViews = published.reduce((sum, r) => sum + r.views, 0);
  const totalLeads = published.reduce((sum, r) => sum + r.leads, 0);
  const totalRegistrations = published.reduce((sum, r) => sum + r.registrations, 0);
  const totalQualifiedConversions = published.reduce((sum, r) => sum + r.qualifiedConversions, 0);

  const byCategory: Record<string, number> = {};
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
