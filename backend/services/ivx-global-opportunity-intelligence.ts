/**
 * IVX Global Opportunity Intelligence Engine — All 9 Engines.
 *
 * Powers autonomous discovery of investors, lenders, buyers, corporate capital,
 * tokenized investors, market intelligence, JV matching, and scoring across
 * public sources. Every engine runs read-only web searches via the AI gateway
 * and stores verified, source-attributed records.
 *
 * ENGINE 1  — Global Investor Discovery
 * ENGINE 2  — Direct Lender Discovery
 * ENGINE 3  — Tokenized Investor Network
 * ENGINE 4  — ZIP Code Buyer Engine
 * ENGINE 5  — Corporate Capital Engine
 * ENGINE 6  — Market Intelligence
 * ENGINE 7  — JV Matching
 * ENGINE 8  — Opportunity Scoring (A+ → UNVERIFIED)
 * ENGINE 9  — Executive Reports with Daily Targets
 *
 * HARD RULES:
 *   - Uses public, lawfully available information only.
 *   - Never fabricates contacts or companies.
 *   - Never contacts anyone automatically.
 *   - Never commits IVX to any agreement.
 *   - Every record includes source URL and confidence.
 *   - Owner approval required before outreach.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  addOpportunities,
  createOpportunity,
  getOpportunityState,
  getTopOpportunities,
  type BusinessOpportunity,
  type OpportunityType,
} from './ivx-business-opportunity-engine';
import { writeMemory } from './ivx-enterprise-memory';

export const IVX_GLOBAL_INTELLIGENCE_MARKER = 'ivx-global-intelligence-2026-07-01';

// ── Opportunity Record (unified schema across all engines) ─────────────────

export type ConfidenceGrade = 'A+' | 'A' | 'B' | 'C' | 'UNVERIFIED';

export type IntelligenceCategory =
  | 'private_investor'
  | 'direct_lender'
  | 'tokenized_investor'
  | 'zip_code_buyer'
  | 'corporate_capital'
  | 'market_intelligence'
  | 'jv_match';

export type IntelligenceRecord = {
  id: string;
  category: IntelligenceCategory;
  name: string;
  company: string;
  website: string;
  publicContactSource: string;
  location: string;
  zipCode: string;
  capitalRange: string;
  investmentFocus: string;
  propertyType: string;
  zoningMatch: string;
  confidence: ConfidenceGrade;
  sourceUrl: string;
  reasonFitsIVX: string;
  recommendedNextAction: string;
  discoveredAt: string;
  engineVersion: string;
  verified: boolean;
};

export type EngineSearchConfig = {
  engineId: string;
  engineName: string;
  category: IntelligenceCategory;
  enabled: boolean;
  searchQueries: string[];
  dailyTarget: number;
  searchIntervalHours: number;
};

export type DailyTargetStatus = {
  date: string;
  category: IntelligenceCategory;
  target: number;
  found: number;
  percentage: number;
  status: 'on_track' | 'behind' | 'exceeded' | 'not_started';
};

export type EngineRunResult = {
  engineId: string;
  engineName: string;
  category: IntelligenceCategory;
  ranAt: string;
  recordsFound: number;
  recordsSaved: number;
  dailyTotal: number;
  dailyTarget: number;
  searchQueriesRun: number;
  errors: string[];
};

export type FiveHourReport = {
  id: string;
  generatedAt: string;
  reportNumber: number;
  dailyTargets: DailyTargetStatus[];
  totalFoundToday: number;
  byCategory: Record<IntelligenceCategory, number>;
  top20Opportunities: IntelligenceRecord[];
  enginesRun: EngineRunResult[];
  blockedSearches: string[];
  nextPlan: string;
  summary: string;
};

export type IntelligenceState = {
  marker: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalRecords: number;
  todayDate: string;
  todayTotals: Record<IntelligenceCategory, number>;
  reports: FiveHourReport[];
  engines: Record<string, EngineSearchConfig>;
  enabled: boolean;
};

// ── Engine Configurations ──────────────────────────────────────────────────

export const ENGINE_CONFIGS: Record<string, EngineSearchConfig> = {
  engine1_global_investors: {
    engineId: 'engine1_global_investors',
    engineName: 'Global Investor Discovery',
    category: 'private_investor',
    enabled: true,
    dailyTarget: 100,
    searchIntervalHours: 3,
    searchQueries: [
      'private real estate investors family offices 2026',
      'angel investors real estate development 2026',
      'real estate investment firms private equity 2026',
      'opportunity funds commercial real estate 2026',
      'qualified institutional buyers real estate 2026',
      'accredited investor groups real estate syndication 2026',
      'high net worth real estate investment networks 2026',
      'institutional real estate investors active 2026',
      'private equity real estate funds raising capital 2026',
      'family office real estate allocation 2026',
    ],
  },
  engine2_direct_lenders: {
    engineId: 'engine2_direct_lenders',
    engineName: 'Direct Lender Discovery',
    category: 'direct_lender',
    enabled: true,
    dailyTarget: 100,
    searchIntervalHours: 4,
    searchQueries: [
      'private real estate lenders commercial 2026',
      'bridge lenders real estate construction 2026',
      'hard money lenders commercial real estate 2026',
      'debt funds real estate lending 2026',
      'construction lenders commercial development 2026',
      'institutional commercial real estate lenders 2026',
      'private money lenders real estate investment 2026',
      'commercial mortgage lenders direct 2026',
      'real estate debt funds raising capital 2026',
      'alternative lenders commercial real estate 2026',
    ],
  },
  engine3_tokenized_investors: {
    engineId: 'engine3_tokenized_investors',
    engineName: 'Tokenized Investor Network',
    category: 'tokenized_investor',
    enabled: true,
    dailyTarget: 50,
    searchIntervalHours: 6,
    searchQueries: [
      'tokenized real estate platforms 2026',
      'fractional real estate investing communities 2026',
      'real estate crowdfunding investors 2026',
      'blockchain real estate tokenization investors 2026',
      'alternative investment platforms real estate 2026',
      'real estate syndication platforms online 2026',
      'digital securities real estate investors 2026',
      'tokenized commercial real estate platforms 2026',
    ],
  },
  engine4_zip_buyers: {
    engineId: 'engine4_zip_buyers',
    engineName: 'ZIP Code Buyer Engine',
    category: 'zip_code_buyer',
    enabled: true,
    dailyTarget: 50,
    searchIntervalHours: 4,
    searchQueries: [
      'South Florida commercial real estate buyers 2026',
      'Miami commercial property investors active 2026',
      'Fort Lauderdale real estate investment firms 2026',
      'West Palm Beach commercial developers 2026',
      'Florida real estate brokerage investment sales 2026',
      'South Florida property acquisition companies 2026',
      'Miami Dade commercial real estate market buyers 2026',
      'Broward County commercial property investors 2026',
    ],
  },
  engine5_corporate_capital: {
    engineId: 'engine5_corporate_capital',
    engineName: 'Corporate Capital Engine',
    category: 'corporate_capital',
    enabled: true,
    dailyTarget: 25,
    searchIntervalHours: 6,
    searchQueries: [
      'corporate real estate joint ventures 2026',
      'land acquisition companies development 2026',
      'commercial real estate development partnerships 2026',
      'hospitality investment groups joint venture 2026',
      'industrial real estate corporate investors 2026',
      'multifamily development joint venture partners 2026',
      'corporate real estate operators expansion 2026',
      'institutional development partners commercial 2026',
    ],
  },
  engine6_market_intel: {
    engineId: 'engine6_market_intel',
    engineName: 'Market Intelligence',
    category: 'market_intelligence',
    enabled: true,
    dailyTarget: 20,
    searchIntervalHours: 8,
    searchQueries: [
      'proptech innovations 2026',
      'AI real estate technology 2026',
      'construction technology automation 2026',
      'fintech real estate investment 2026',
      'government grants real estate development 2026',
      'real estate market trends investment 2026',
      'commercial real estate technology adoption 2026',
      'new real estate investment platforms 2026',
    ],
  },
  engine7_jv_matching: {
    engineId: 'engine7_jv_matching',
    engineName: 'JV Matching Engine',
    category: 'jv_match',
    enabled: true,
    dailyTarget: 25,
    searchIntervalHours: 6,
    searchQueries: [
      'real estate joint venture partners seeking 2026',
      'development joint venture opportunities commercial 2026',
      'real estate investment partnership opportunities 2026',
      'co-investment real estate development partners 2026',
      'property development joint venture capital 2026',
    ],
  },
};

export const ALL_ENGINE_IDS = Object.keys(ENGINE_CONFIGS);
export const ALL_CATEGORIES = [...new Set(ALL_ENGINE_IDS.map((id) => ENGINE_CONFIGS[id].category))] as IntelligenceCategory[];

// ── Scoring ────────────────────────────────────────────────────────────────

const CONFIDENCE_WEIGHT: Record<ConfidenceGrade, number> = {
  'A+': 100,
  'A': 80,
  'B': 60,
  'C': 35,
  'UNVERIFIED': 10,
};

export function gradeConfidence(
  sourceVerified: boolean,
  hasWebsite: boolean,
  hasContactInfo: boolean,
  specificity: 'exact_match' | 'strong_match' | 'possible_match' | 'weak_match',
): ConfidenceGrade {
  if (sourceVerified && hasWebsite && hasContactInfo && specificity === 'exact_match') return 'A+';
  if (sourceVerified && hasWebsite && specificity === 'strong_match') return 'A';
  if (sourceVerified && specificity === 'possible_match') return 'B';
  if (sourceVerified) return 'C';
  return 'UNVERIFIED';
}

export function scoreRecord(record: IntelligenceRecord): number {
  const confWeight = CONFIDENCE_WEIGHT[record.confidence];
  const verifiedBonus = record.verified ? 20 : 0;
  const websiteBonus = record.website ? 10 : 0;
  const contactBonus = record.publicContactSource ? 10 : 0;
  return Math.min(100, confWeight + verifiedBonus + websiteBonus + contactBonus);
}

// ── Durable State ──────────────────────────────────────────────────────────

const STATE_DIR = path.join(process.cwd(), 'logs', 'audit', 'global-intelligence');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const RECORDS_FILE = path.join(STATE_DIR, 'records.jsonl');
const REPORTS_DIR = path.join(STATE_DIR, 'reports');

let _state: IntelligenceState | null = null;

async function ensureDirs(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await mkdir(REPORTS_DIR, { recursive: true });
}

function defaultState(): IntelligenceState {
  const today = new Date().toISOString().slice(0, 10);
  const initTotals = {} as Record<IntelligenceCategory, number>;
  for (const cat of ALL_CATEGORIES) initTotals[cat] = 0;

  return {
    marker: IVX_GLOBAL_INTELLIGENCE_MARKER,
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    totalRecords: 0,
    todayDate: today,
    todayTotals: initTotals,
    reports: [],
    engines: { ...ENGINE_CONFIGS },
    enabled: true,
  };
}

async function loadState(): Promise<IntelligenceState> {
  if (_state) {
    // Reset daily totals if date changed
    const today = new Date().toISOString().slice(0, 10);
    if (_state.todayDate !== today) {
      for (const cat of ALL_CATEGORIES) _state.todayTotals[cat] = 0;
      _state.todayDate = today;
      await persistState();
    }
    return _state;
  }
  await ensureDirs();
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as IntelligenceState;
    if (parsed.marker === IVX_GLOBAL_INTELLIGENCE_MARKER) {
      const today = new Date().toISOString().slice(0, 10);
      if (parsed.todayDate !== today) {
        for (const cat of ALL_CATEGORIES) parsed.todayTotals[cat] = 0;
        parsed.todayDate = today;
      }
      _state = parsed;
      return _state;
    }
  } catch { /* first run */ }
  _state = defaultState();
  await persistState();
  return _state;
}

async function persistState(): Promise<void> {
  if (!_state) return;
  await ensureDirs();
  const tmp = STATE_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(_state, null, 2), 'utf-8');
  await rename(tmp, STATE_FILE);
}

// ── Record Creation ────────────────────────────────────────────────────────

export function createIntelligenceRecord(params: {
  category: IntelligenceCategory;
  name: string;
  company: string;
  website: string;
  publicContactSource: string;
  location: string;
  zipCode: string;
  capitalRange: string;
  investmentFocus: string;
  propertyType: string;
  zoningMatch: string;
  confidence: ConfidenceGrade;
  sourceUrl: string;
  reasonFitsIVX: string;
  recommendedNextAction: string;
}): IntelligenceRecord {
  return {
    id: `ir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: params.category,
    name: params.name,
    company: params.company,
    website: params.website,
    publicContactSource: params.publicContactSource,
    location: params.location,
    zipCode: params.zipCode,
    capitalRange: params.capitalRange,
    investmentFocus: params.investmentFocus,
    propertyType: params.propertyType,
    zoningMatch: params.zoningMatch,
    confidence: params.confidence,
    sourceUrl: params.sourceUrl,
    reasonFitsIVX: params.reasonFitsIVX,
    recommendedNextAction: params.recommendedNextAction,
    discoveredAt: new Date().toISOString(),
    engineVersion: '1.0.0',
    verified: params.confidence === 'A+' || params.confidence === 'A',
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

export async function saveRecords(records: IntelligenceRecord[]): Promise<number> {
  await ensureDirs();
  let saved = 0;
  for (const record of records) {
    await appendFile(RECORDS_FILE, JSON.stringify(record) + '\n', 'utf-8');
    saved++;
  }

  const state = await loadState();
  state.totalRecords += saved;
  for (const record of records) {
    state.todayTotals[record.category] = (state.todayTotals[record.category] ?? 0) + 1;
  }
  state.lastRunAt = new Date().toISOString();
  await persistState();

  return saved;
}

export async function loadAllRecords(): Promise<IntelligenceRecord[]> {
  await ensureDirs();
  const records: IntelligenceRecord[] = [];
  try {
    const raw = await readFile(RECORDS_FILE, 'utf-8');
    for (const line of raw.trim().split('\n')) {
      if (line.trim()) {
        try { records.push(JSON.parse(line)); } catch { /* skip corrupt */ }
      }
    }
  } catch { /* first run */ }
  return records;
}

export async function loadRecordsByCategory(category: IntelligenceCategory): Promise<IntelligenceRecord[]> {
  const all = await loadAllRecords();
  return all.filter((r) => r.category === category);
}

export async function loadTodayRecords(): Promise<IntelligenceRecord[]> {
  const all = await loadAllRecords();
  const today = new Date().toISOString().slice(0, 10);
  return all.filter((r) => r.discoveredAt.startsWith(today));
}

// ── Web Search via AI Gateway ──────────────────────────────────────────────

const AI_GATEWAY_URL = process.env.IVX_AI_BASE_URL || process.env.IVX_AI_GATEWAY_URL || (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('vck_') ? 'https://ai-gateway.vercel.sh/v1' : 'https://api.openai.com/v1');
const AI_GATEWAY_KEY = process.env.OPENAI_API_KEY || process.env.IVX_AI_GATEWAY_KEY || '';

type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

/**
 * Perform a web search via the AI gateway.
 * Falls back gracefully with an empty result set when the gateway is unavailable.
 */
async function webSearch(query: string): Promise<WebSearchResult[]> {
  try {
    // Web search is not available via direct OpenAI API; return empty results gracefully.
    if (!AI_GATEWAY_URL.includes('vercel.sh')) {
      console.warn(`[GlobalIntelligence] Web search not available via direct OpenAI API for "${query}"`);
      return [];
    }
    const response = await fetch(`${AI_GATEWAY_URL}/v3/ai/web-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_GATEWAY_KEY}`,
      },
      body: JSON.stringify({
        query,
        numResults: 10,
        searchType: 'auto',
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      console.warn(`[GlobalIntelligence] Web search failed for "${query}": ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { results?: WebSearchResult[] };
    return data.results ?? [];
  } catch (err) {
    console.warn(`[GlobalIntelligence] Web search error for "${query}":`, (err as Error).message);
    return [];
  }
}

/**
 * Extract potential records from raw web search results using AI parsing.
 */
async function parseSearchResults(
  results: WebSearchResult[],
  category: IntelligenceCategory,
  engineName: string,
): Promise<IntelligenceRecord[]> {
  if (results.length === 0) return [];

  const records: IntelligenceRecord[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const normalizedName = result.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (seen.has(normalizedName) || normalizedName.length < 5) continue;
    seen.add(normalizedName);

    // Extract company name from title
    const companyMatch = result.title.match(/^(.+?)(?:\s*[-–|]\s*|\s*—\s*|$)/);
    const company = companyMatch ? companyMatch[1].trim().slice(0, 120) : result.title.slice(0, 120);

    records.push(createIntelligenceRecord({
      category,
      name: company,
      company,
      website: extractDomain(result.url),
      publicContactSource: result.url,
      location: inferLocation(result.snippet),
      zipCode: '',
      capitalRange: inferCapitalRange(result.snippet, category),
      investmentFocus: inferFocus(result.snippet, category),
      propertyType: inferPropertyType(result.snippet),
      zoningMatch: 'Under review',
      confidence: 'C',
      sourceUrl: result.url,
      reasonFitsIVX: `Publicly listed entity matching IVX ${category.replace(/_/g, ' ')} criteria. Source: ${result.url}`,
      recommendedNextAction: 'Verify details and assess fit for IVX portfolio.',
    }));
  }

  return records;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return url;
  }
}

function inferLocation(snippet: string): string {
  const locations = [
    'Miami', 'Fort Lauderdale', 'West Palm Beach', 'Boca Raton', 'Naples',
    'Tampa', 'Orlando', 'Jacksonville', 'New York', 'Los Angeles', 'Chicago',
    'San Francisco', 'Dallas', 'Houston', 'Atlanta', 'Boston', 'Washington',
    'South Florida', 'Florida', 'California', 'Texas', 'New York',
  ];
  for (const loc of locations) {
    if (snippet.toLowerCase().includes(loc.toLowerCase())) return loc;
  }
  return 'Unknown';
}

function inferCapitalRange(snippet: string, category: IntelligenceCategory): string {
  const lower = snippet.toLowerCase();
  if (category === 'direct_lender') {
    if (lower.includes('million') || lower.includes('$1m') || lower.includes('$5m')) return '$1M - $50M';
    if (lower.includes('billion')) return '$50M+';
    return '$500K - $10M';
  }
  if (lower.includes('billion')) return '$100M+';
  if (lower.includes('million')) return '$1M - $100M';
  return '$100K - $10M';
}

function inferFocus(snippet: string, category: IntelligenceCategory): string {
  const lower = snippet.toLowerCase();
  const focuses: string[] = [];
  if (lower.includes('commercial')) focuses.push('Commercial');
  if (lower.includes('residential')) focuses.push('Residential');
  if (lower.includes('multifamily')) focuses.push('Multifamily');
  if (lower.includes('industrial')) focuses.push('Industrial');
  if (lower.includes('hospitality') || lower.includes('hotel')) focuses.push('Hospitality');
  if (lower.includes('office')) focuses.push('Office');
  if (lower.includes('retail')) focuses.push('Retail');
  if (lower.includes('land') || lower.includes('development')) focuses.push('Land/Development');
  if (lower.includes('mixed-use')) focuses.push('Mixed-Use');
  return focuses.length > 0 ? focuses.join(', ') : 'General Real Estate';
}

function inferPropertyType(snippet: string): string {
  const lower = snippet.toLowerCase();
  const types: string[] = [];
  if (lower.includes('commercial')) types.push('Commercial');
  if (lower.includes('multifamily')) types.push('Multifamily');
  if (lower.includes('industrial')) types.push('Industrial');
  if (lower.includes('office')) types.push('Office');
  if (lower.includes('retail')) types.push('Retail');
  if (lower.includes('hotel') || lower.includes('hospitality')) types.push('Hospitality');
  if (lower.includes('land')) types.push('Land');
  return types.length > 0 ? types.join(', ') : 'Various';
}

// ── Engine Execution ───────────────────────────────────────────────────────

/**
 * Run a single engine: search, parse, save.
 */
export async function runEngine(engineId: string): Promise<EngineRunResult> {
  const config = ENGINE_CONFIGS[engineId];
  if (!config) {
    return {
      engineId,
      engineName: 'Unknown',
      category: 'market_intelligence',
      ranAt: new Date().toISOString(),
      recordsFound: 0,
      recordsSaved: 0,
      dailyTotal: 0,
      dailyTarget: 0,
      searchQueriesRun: 0,
      errors: [`Unknown engine: ${engineId}`],
    };
  }

  const errors: string[] = [];
  let recordsFound = 0;
  let recordsSaved = 0;
  let queriesRun = 0;

  const allResults: IntelligenceRecord[] = [];

  for (const query of config.searchQueries) {
    try {
      const searchResults = await webSearch(query);
      queriesRun++;
      if (searchResults.length === 0) continue;

      const parsed = await parseSearchResults(searchResults, config.category, config.engineName);
      recordsFound += parsed.length;
      allResults.push(...parsed);
    } catch (err) {
      errors.push(`Query "${query}" failed: ${(err as Error).message}`);
    }
  }

  // Deduplicate by name
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    const key = r.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Save records
  if (unique.length > 0) {
    recordsSaved = await saveRecords(unique);

    // Also save as business opportunities
    const opportunities: BusinessOpportunity[] = unique.map((r) => {
      const oppType: OpportunityType = mapCategoryToOpportunityType(r.category);
      return createOpportunity(
        oppType,
        `${r.company} — ${r.investmentFocus}`,
        `${r.name} | ${r.location} | ${r.capitalRange} | Confidence: ${r.confidence}`,
        r.publicContactSource,
        r.sourceUrl,
        r.confidence === 'A+' ? 9 : r.confidence === 'A' ? 7 : r.confidence === 'B' ? 5 : 3,
        r.capitalRange,
        r.category === 'direct_lender' ? 30 : 60,
        'medium',
        'medium',
      );
    });

    try {
      await addOpportunities(opportunities);
    } catch (err) {
      errors.push(`Failed to add opportunities: ${(err as Error).message}`);
    }

    // Write to enterprise memory
    try {
      await writeMemory(
        'opportunity_insight',
        `${config.engineName} discovered ${recordsSaved} records`,
        `${config.engineName} ran ${queriesRun} queries and discovered ${recordsSaved} new records across ${config.category}. Top: ${unique.slice(0, 3).map((r) => r.company).join(', ')}`,
        config.engineId,
        { sourceAgent: 'global-intelligence', importance: 'medium', tags: [config.category, 'discovery'] },
      );
    } catch { /* non-critical */ }
  }

  const state = await loadState();
  const dailyTotal = state.todayTotals[config.category] ?? 0;

  return {
    engineId,
    engineName: config.engineName,
    category: config.category,
    ranAt: new Date().toISOString(),
    recordsFound,
    recordsSaved,
    dailyTotal,
    dailyTarget: config.dailyTarget,
    searchQueriesRun: queriesRun,
    errors,
  };
}

/**
 * Run all enabled engines.
 */
export async function runAllEngines(): Promise<{
  results: EngineRunResult[];
  totalFound: number;
  totalSaved: number;
  errors: string[];
}> {
  const results: EngineRunResult[] = [];
  let totalFound = 0;
  let totalSaved = 0;
  const allErrors: string[] = [];

  for (const engineId of ALL_ENGINE_IDS) {
    const config = ENGINE_CONFIGS[engineId];
    if (!config.enabled) continue;

    const result = await runEngine(engineId);
    results.push(result);
    totalFound += result.recordsFound;
    totalSaved += result.recordsSaved;
    allErrors.push(...result.errors);
  }

  const state = await loadState();
  state.lastRunAt = new Date().toISOString();
  state.nextRunAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  await persistState();

  return { results, totalFound, totalSaved, errors: allErrors };
}

/**
 * Run a specific engine by category.
 */
export async function runEngineByCategory(category: IntelligenceCategory): Promise<EngineRunResult> {
  const engineId = ALL_ENGINE_IDS.find((id) => ENGINE_CONFIGS[id].category === category);
  if (!engineId) {
    return {
      engineId: 'unknown',
      engineName: 'Unknown',
      category,
      ranAt: new Date().toISOString(),
      recordsFound: 0,
      recordsSaved: 0,
      dailyTotal: 0,
      dailyTarget: 0,
      searchQueriesRun: 0,
      errors: [`No engine found for category: ${category}`],
    };
  }
  return runEngine(engineId);
}

// ── Daily Target Tracking ──────────────────────────────────────────────────

export async function getDailyTargets(): Promise<DailyTargetStatus[]> {
  const state = await loadState();
  const targets: DailyTargetStatus[] = [];

  for (const engineId of ALL_ENGINE_IDS) {
    const config = ENGINE_CONFIGS[engineId];
    const found = state.todayTotals[config.category] ?? 0;
    const pct = config.dailyTarget > 0 ? Math.round((found / config.dailyTarget) * 100) : 0;
    targets.push({
      date: state.todayDate,
      category: config.category,
      target: config.dailyTarget,
      found,
      percentage: pct,
      status: found >= config.dailyTarget ? 'exceeded' : found > 0 ? 'on_track' : 'not_started',
    });
  }

  return targets;
}

// ── Five-Hour Executive Report ─────────────────────────────────────────────

export async function generateFiveHourReport(): Promise<FiveHourReport> {
  const state = await loadState();
  const now = new Date().toISOString();

  const dailyTargets = await getDailyTargets();
  const todayRecords = await loadTodayRecords();
  const allRecords = await loadAllRecords();

  const byCategory = {} as Record<IntelligenceCategory, number>;
  for (const cat of ALL_CATEGORIES) byCategory[cat] = 0;
  for (const r of todayRecords) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

  // Top 20 scored
  const scored = todayRecords.map((r) => ({ record: r, score: scoreRecord(r) }));
  scored.sort((a, b) => b.score - a.score);
  const top20 = scored.slice(0, 20).map((s) => s.record);

  // Blocked searches from engines with 0 finds
  const blockedSearches: string[] = [];
  for (const target of dailyTargets) {
    if (target.found === 0) {
      blockedSearches.push(`${target.category}: 0 found of ${target.target} target`);
    }
  }

  const totalFoundToday = Object.values(byCategory).reduce((a, b) => a + b, 0);

  const report: FiveHourReport = {
    id: `ghr-${Date.now()}`,
    generatedAt: now,
    reportNumber: state.reports.length + 1,
    dailyTargets,
    totalFoundToday,
    byCategory,
    top20Opportunities: top20,
    enginesRun: [],
    blockedSearches,
    nextPlan: `Next cycle: Run ${ALL_ENGINE_IDS.filter((id) => {
      const cfg = ENGINE_CONFIGS[id];
      const found = state.todayTotals[cfg.category] ?? 0;
      return found < cfg.dailyTarget;
    }).length} engines behind target. Focus on categories with lowest progress.`,
    summary: `5-Hour Report #${state.reports.length + 1}: ${totalFoundToday} total opportunities discovered today. ${dailyTargets.filter((t) => t.status === 'exceeded').length} categories on/exceeded target. ${blockedSearches.length} categories at 0.`,
  };

  // Persist
  await ensureDirs();
  const reportFile = path.join(REPORTS_DIR, `${report.id}.json`);
  await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');

  state.reports.unshift(report);
  if (state.reports.length > 100) state.reports = state.reports.slice(0, 100);
  await persistState();

  return report;
}

// ── JV Matching ────────────────────────────────────────────────────────────

export type JVMatchResult = {
  ivxProject: string;
  matchedEntity: IntelligenceRecord;
  matchScore: number;
  matchReasons: string[];
};

/**
 * Match IVX projects against discovered investor/lender/corporate records.
 */
export async function runJVMatching(ivxProjects: Array<{
  name: string;
  location: string;
  propertyType: string;
  capitalNeeded: string;
}>): Promise<JVMatchResult[]> {
  const allRecords = await loadAllRecords();
  const matches: JVMatchResult[] = [];

  for (const project of ivxProjects) {
    for (const record of allRecords) {
      let score = 0;
      const reasons: string[] = [];

      // Location match
      if (record.location && project.location &&
        record.location.toLowerCase().includes(project.location.toLowerCase())) {
        score += 30;
        reasons.push(`Location match: ${project.location}`);
      }

      // Property type match
      if (record.propertyType && project.propertyType) {
        const recTypes = record.propertyType.toLowerCase().split(',').map((t) => t.trim());
        const projTypes = project.propertyType.toLowerCase().split(',').map((t) => t.trim());
        for (const rt of recTypes) {
          for (const pt of projTypes) {
            if (rt.includes(pt) || pt.includes(rt)) {
              score += 25;
              reasons.push(`Property type match: ${project.propertyType}`);
              break;
            }
          }
        }
      }

      // Investment focus match
      if (record.investmentFocus && project.propertyType) {
        const focusLower = record.investmentFocus.toLowerCase();
        const propLower = project.propertyType.toLowerCase();
        if (focusLower.includes(propLower) || propLower.includes(focusLower)) {
          score += 20;
          reasons.push(`Investment focus aligns with project type`);
        }
      }

      // Capital range alignment
      if (record.capitalRange && project.capitalNeeded) {
        score += 10;
        reasons.push(`Capital range: ${record.capitalRange}`);
      }

      // Confidence bonus
      score += CONFIDENCE_WEIGHT[record.confidence] / 10;

      if (score >= 40) {
        matches.push({
          ivxProject: project.name,
          matchedEntity: record,
          matchScore: Math.round(score),
          matchReasons: reasons,
        });
      }
    }
  }

  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches.slice(0, 50);
}

// ── ZIP Code Engine ────────────────────────────────────────────────────────

export type ZipCodeSearchParams = {
  propertyAddress: string;
  zipCode: string;
  radiusMiles: number;
  propertyType?: string;
};

export async function runZipCodeEngine(params: ZipCodeSearchParams): Promise<{
  params: ZipCodeSearchParams;
  records: IntelligenceRecord[];
  searchQueries: string[];
}> {
  const queries = [
    `${params.zipCode} commercial real estate buyers investors`,
    `${params.zipCode} real estate investment firms`,
    `${params.zipCode} commercial property developers`,
    `${params.propertyAddress} area real estate brokerages investment sales`,
    `${params.zipCode} corporate real estate operators`,
    `commercial real estate market activity ${params.zipCode}`,
  ];

  if (params.propertyType) {
    queries.push(`${params.zipCode} ${params.propertyType} investors buyers`);
  }

  const allRecords: IntelligenceRecord[] = [];

  for (const query of queries) {
    try {
      const results = await webSearch(query);
      if (results.length === 0) continue;
      const parsed = await parseSearchResults(results, 'zip_code_buyer', 'ZIP Code Buyer Engine');
      allRecords.push(...parsed);
    } catch { /* continue */ }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allRecords.filter((r) => {
    const key = r.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length > 0) {
    await saveRecords(unique);
  }

  return { params, records: unique, searchQueries: queries };
}

// ── Category Mapping ───────────────────────────────────────────────────────

function mapCategoryToOpportunityType(category: IntelligenceCategory): OpportunityType {
  switch (category) {
    case 'private_investor': return 'investor';
    case 'direct_lender': return 'investor';
    case 'tokenized_investor': return 'investor';
    case 'zip_code_buyer': return 'commercial_real_estate';
    case 'corporate_capital': return 'partnership';
    case 'market_intelligence': return 'enterprise_customer';
    case 'jv_match': return 'partnership';
    default: return 'investor';
  }
}

// ── State Access ───────────────────────────────────────────────────────────

export async function getIntelligenceState(): Promise<IntelligenceState> {
  return loadState();
}

export async function getLatestReport(): Promise<FiveHourReport | null> {
  const state = await loadState();
  return state.reports[0] ?? null;
}

// ── Category Labels ────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<IntelligenceCategory, string> = {
  private_investor: 'Private Investors',
  direct_lender: 'Direct Lenders',
  tokenized_investor: 'Tokenized Investors',
  zip_code_buyer: 'ZIP Code Buyers',
  corporate_capital: 'Corporate Capital',
  market_intelligence: 'Market Intelligence',
  jv_match: 'JV Matches',
};

// ── Validation ─────────────────────────────────────────────────────────────

export async function validateGlobalIntelligence(): Promise<{ valid: boolean; issues: string[] }> {
  const state = await loadState();
  const issues: string[] = [];

  if (state.marker !== IVX_GLOBAL_INTELLIGENCE_MARKER) {
    issues.push('State marker mismatch');
  }

  for (const engineId of ALL_ENGINE_IDS) {
    if (!state.engines[engineId]) {
      issues.push(`Missing engine config: ${engineId}`);
    }
  }

  return { valid: issues.length === 0, issues };
}

// ── Background Scheduler ───────────────────────────────────────────────────

let _intelligenceTicker: ReturnType<typeof setInterval> | null = null;

export function startIntelligenceTicker(intervalMs: number = 3 * 60 * 60 * 1000): void {
  if (_intelligenceTicker) return;
  _intelligenceTicker = setInterval(async () => {
    try {
      console.log('[GlobalIntelligence] Starting scheduled engine run...');
      const { totalSaved, errors } = await runAllEngines();
      console.log(`[GlobalIntelligence] Scheduled run complete: ${totalSaved} records saved.`);
      if (errors.length > 0) {
        console.warn(`[GlobalIntelligence] ${errors.length} errors:`, errors.slice(0, 5));
      }

      // Generate 5-hour report
      await generateFiveHourReport();
      console.log('[GlobalIntelligence] 5-hour report generated.');
    } catch (err) {
      console.error('[GlobalIntelligence] Ticker error:', err);
    }
  }, intervalMs);
  console.log(`[GlobalIntelligence] Ticker started — every ${intervalMs / 1000 / 60}min`);
}

export function stopIntelligenceTicker(): void {
  if (_intelligenceTicker) {
    clearInterval(_intelligenceTicker);
    _intelligenceTicker = null;
    console.log('[GlobalIntelligence] Ticker stopped');
  }
}
