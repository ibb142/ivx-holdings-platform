/**
 * IVX Investor Discovery Engine — REAL named investors/buyers from public SEC filings.
 *
 * This is the LEGAL, verifiable alternative to harvesting private individuals'
 * personal contact data (which is illegal under GDPR/CCPA/TCPA and an App Store
 * rejection). Every U.S. Reg D private placement is filed publicly with the SEC on
 * Form D, and the full filing — including the issuer's real legal name, the real
 * names of its executives/directors/promoters (related persons), the business
 * address, the offering amount, the number of investors already in, and the filing
 * date — is a public record at sec.gov.
 *
 * This engine queries SEC EDGAR's full-text search for Form D filings, then parses
 * each filing's `primary_doc.xml` to extract REAL, attributable records. Nothing is
 * fabricated: every record carries a direct link to the official SEC filing so the
 * owner can verify it. Records with no real offering amount are kept null, never
 * invented.
 *
 * Two discovery classes (per the owner's request):
 *   - `buyers`    → high-value raises (default min offering $100K) — the
 *                   entities and principals actively deploying capital.
 *   - `jv_deals`  → any real investor entity (no minimum) filing Reg D offerings,
 *                   useful for JV / co-invest sourcing.
 *
 * Read-only. No personal mobile numbers, no scraped private data — only the
 * business contact information the filer chose to make public on a federal form.
 */

/** SEC requires a descriptive User-Agent with contact info on every request. */
const SEC_USER_AGENT = 'IVX Holdings investor-research contact@ivxholding.com';
const EDGAR_FULLTEXT_URL = 'https://efts.sec.gov/LATEST/search-index';
const SEC_ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';
const FETCH_TIMEOUT_MS = 15_000;
/** SEC fair-access guidance is ~10 req/s; we stay well under it. */
const DETAIL_FETCH_DELAY_MS = 140;

export type InvestorDiscoveryClass = 'buyers' | 'jv_deals';

/** A real person named on a public Form D filing (executive / director / promoter). */
export type RelatedPerson = {
  firstName: string;
  lastName: string;
  fullName: string;
  relationships: string[];
  city: string | null;
  stateOrCountry: string | null;
};

/** One real investor/buyer entity discovered from a public SEC Form D filing. */
export type DiscoveredInvestor = {
  /** SEC Central Index Key — the entity's permanent public id. */
  cik: string;
  /** Accession number of the filing (e.g. 0001035443-26-000002). */
  accessionNumber: string;
  /** Real legal entity name as filed. */
  entityName: string;
  entityType: string | null;
  jurisdiction: string | null;
  /** Real business contact info from the filing (public, not personal). */
  businessStreet: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
  businessPhone: string | null;
  /** Industry group declared on the filing (e.g. "Real Estate"). */
  industryGroup: string | null;
  /** Real named principals (executives/directors/promoters). */
  relatedPersons: RelatedPerson[];
  /** Total offering amount in USD (null when the filer marked it indefinite/unknown). */
  totalOfferingAmountUsd: number | null;
  totalAmountSoldUsd: number | null;
  minimumInvestmentUsd: number | null;
  /** Real count of investors already in the offering, if disclosed. */
  investorsAlreadyInvested: number | null;
  filingDate: string | null;
  dateOfFirstSale: string | null;
  /** Direct link to the official SEC filing — proof every record is real. */
  filingUrl: string;
};

export type InvestorDiscoveryResult = {
  ok: boolean;
  discoveryClass: InvestorDiscoveryClass;
  query: string;
  minOfferingUsd: number;
  source: string;
  fetchedAt: string;
  /** Total Form D hits the SEC reported for the query (may exceed returned). */
  totalFilingsMatched: number;
  scannedFilings: number;
  investors: DiscoveredInvestor[];
  resultCount: number;
  error: string | null;
  /** Compliance note attached to every result. */
  complianceNote: string;
};

const COMPLIANCE_NOTE =
  'Sourced from public U.S. SEC EDGAR Form D filings (Regulation D private placements). ' +
  'All names, companies, addresses, and amounts are public federal-filing data with a direct ' +
  'SEC link for verification. This is NOT personal/consumer data and contains no private mobile ' +
  'numbers. Any outreach must comply with securities solicitation rules, Fair Housing, AML/KYC, ' +
  'and applicable privacy/anti-spam law. Investor counts/amounts are as the filer disclosed.';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type InvestorDiscoveryOptions = {
  /** Free-text query (e.g. "real estate", "multifamily", a sponsor name). */
  query?: string;
  discoveryClass?: InvestorDiscoveryClass;
  /** Minimum total offering amount (USD). Defaults to $100K for `buyers`, $0 for `jv_deals`. */
  minOfferingUsd?: number;
  /** Max filings to fully parse (bounded for SEC fair-access). */
  limit?: number;
  /**
   * Filing URLs already in the pipeline. Discovery skips these BEFORE fetching
   * (no wasted SEC call) and pages deeper until it finds `limit` UNSEEN filings.
   * This is what lets every run surface fresh records instead of re-returning
   * the same top-relevance hits and deduping them all to zero.
   */
  excludeUrls?: ReadonlySet<string>;
  /** Max search pages (100 hits each) to walk while hunting for unseen filings. */
  maxPages?: number;
  /** Injectable for tests. */
  fetchImpl?: FetchLike;
  /** Injectable for tests (skip the polite delay). */
  delayMs?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

async function timeoutFetch(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract the text content of the FIRST occurrence of <tag>...</tag>. */
function firstTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? decodeXml(value) : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function toNumber(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Parse the `<relatedPersonsList>` block into real named principals. */
export function parseRelatedPersons(xml: string): RelatedPerson[] {
  const listMatch = xml.match(/<relatedPersonsList>([\s\S]*?)<\/relatedPersonsList>/i);
  if (!listMatch) return [];
  const block = listMatch[1];
  const people: RelatedPerson[] = [];
  const personRegex = /<relatedPersonInfo>([\s\S]*?)<\/relatedPersonInfo>/gi;
  let m: RegExpExecArray | null;
  while ((m = personRegex.exec(block)) !== null) {
    const chunk = m[1];
    const first = firstTag(chunk, 'firstName') ?? '';
    const last = firstTag(chunk, 'lastName') ?? '';
    const fullName = [first, last].filter(Boolean).join(' ').trim();
    if (!fullName) continue;
    const relationships: string[] = [];
    const relRegex = /<relationship>([\s\S]*?)<\/relationship>/gi;
    let r: RegExpExecArray | null;
    while ((r = relRegex.exec(chunk)) !== null) {
      const rel = decodeXml(r[1]);
      if (rel) relationships.push(rel);
    }
    people.push({
      firstName: first,
      lastName: last,
      fullName,
      relationships,
      city: firstTag(chunk, 'city'),
      stateOrCountry: firstTag(chunk, 'stateOrCountry'),
    });
  }
  return people;
}

/** Parse a Form D `primary_doc.xml` into a real investor record. */
export function parseFormD(xml: string, cik: string, accessionNumber: string, filingUrl: string): DiscoveredInvestor | null {
  const entityName = firstTag(xml, 'entityName');
  if (!entityName) return null;

  const issuerBlock = xml.match(/<primaryIssuer>([\s\S]*?)<\/primaryIssuer>/i)?.[1] ?? xml;
  const addressBlock = issuerBlock.match(/<issuerAddress>([\s\S]*?)<\/issuerAddress>/i)?.[1] ?? '';
  const offeringBlock = xml.match(/<offeringSalesAmounts>([\s\S]*?)<\/offeringSalesAmounts>/i)?.[1] ?? '';
  const investorsBlock = xml.match(/<investors>([\s\S]*?)<\/investors>/i)?.[1] ?? '';

  return {
    cik,
    accessionNumber,
    entityName,
    entityType: firstTag(issuerBlock, 'entityType'),
    jurisdiction: firstTag(issuerBlock, 'jurisdictionOfInc'),
    businessStreet: firstTag(addressBlock, 'street1'),
    businessCity: firstTag(addressBlock, 'city'),
    businessState: firstTag(addressBlock, 'stateOrCountry'),
    businessZip: firstTag(addressBlock, 'zipCode'),
    businessPhone: firstTag(issuerBlock, 'issuerPhoneNumber'),
    industryGroup: firstTag(xml, 'industryGroupType'),
    relatedPersons: parseRelatedPersons(xml),
    totalOfferingAmountUsd: toNumber(firstTag(offeringBlock, 'totalOfferingAmount')),
    totalAmountSoldUsd: toNumber(firstTag(offeringBlock, 'totalAmountSold')),
    minimumInvestmentUsd: toNumber(firstTag(xml, 'minimumInvestmentAccepted')),
    investorsAlreadyInvested: toNumber(firstTag(investorsBlock, 'totalNumberAlreadyInvested')),
    filingDate: null,
    dateOfFirstSale: firstTag(xml, 'dateOfFirstSale'),
    filingUrl,
  };
}

type EdgarHit = {
  cik: string;
  accessionNumber: string;
  fileDate: string | null;
  primaryDoc: string;
};

/** Parse the EDGAR full-text search response into filing pointers. */
function parseEdgarHits(json: unknown): { hits: EdgarHit[]; total: number } {
  const root = json as { hits?: { total?: { value?: number }; hits?: unknown[] } };
  const rawHits = Array.isArray(root.hits?.hits) ? root.hits!.hits! : [];
  const total = typeof root.hits?.total?.value === 'number' ? root.hits!.total!.value! : rawHits.length;
  const hits: EdgarHit[] = [];
  for (const raw of rawHits) {
    const hit = raw as { _id?: string; _source?: { ciks?: string[]; file_date?: string; adsh?: string } };
    const source = hit._source ?? {};
    const cik = Array.isArray(source.ciks) && source.ciks.length > 0 ? source.ciks[0] : null;
    const accession = source.adsh ?? (typeof hit._id === 'string' ? hit._id.split(':')[0] : null);
    const primaryDoc = typeof hit._id === 'string' && hit._id.includes(':') ? hit._id.split(':')[1] : 'primary_doc.xml';
    if (!cik || !accession) continue;
    hits.push({ cik, accessionNumber: accession, fileDate: source.file_date ?? null, primaryDoc });
  }
  return { hits, total };
}

/** Build the official SEC Archives URL for a filing's primary document. */
export function buildFilingUrl(cik: string, accessionNumber: string, primaryDoc: string): string {
  const cikTrimmed = String(Number(cik));
  const accNoDashes = accessionNumber.replace(/-/g, '');
  return `${SEC_ARCHIVES_BASE}/${cikTrimmed}/${accNoDashes}/${primaryDoc}`;
}

function defaultMinOffering(discoveryClass: InvestorDiscoveryClass): number {
  // $100K floor keeps real capital raises while matching the reality of
  // real-estate Form D filings — most offerings are small syndications.
  // The $1M floor rejected ~99.9% of filings (1 in 800), and after the first
  // run that 1 filing was already in the pipeline, so every subsequent run
  // saved 0. $100K keeps ~15-20% of filings (real capital, not noise).
  // Scoring still rewards larger offerings.
  return discoveryClass === 'buyers' ? 100_000 : 0;
}

/**
 * Discover real investor/buyer entities from public SEC Form D filings.
 * Returns honest `ok:false` + reason on a network/API failure; never throws.
 */
export async function discoverInvestors(options: InvestorDiscoveryOptions = {}): Promise<InvestorDiscoveryResult> {
  const discoveryClass: InvestorDiscoveryClass = options.discoveryClass ?? 'buyers';
  const query = (options.query ?? 'real estate').trim() || 'real estate';
  const minOfferingUsd = options.minOfferingUsd ?? defaultMinOffering(discoveryClass);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 60);
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const delayMs = options.delayMs ?? DETAIL_FETCH_DELAY_MS;
  const excludeUrls = options.excludeUrls ?? new Set<string>();
  // Page deeper (up to 30 pages x 100 = 3,000 hits) so a run can skip the
  // already-seen top hits and still reach fresh, unseen filings. The previous
  // cap of 8 pages (800 hits) often exhausted before finding new records after
  // the pipeline accumulated prior discoveries.
  const maxPages = Math.min(Math.max(options.maxPages ?? 30, 1), 50);
  const fetchedAt = nowIso();

  const base: InvestorDiscoveryResult = {
    ok: false,
    discoveryClass,
    query,
    minOfferingUsd,
    source: 'SEC EDGAR Form D (full-text search + primary_doc.xml)',
    fetchedAt,
    totalFilingsMatched: 0,
    scannedFilings: 0,
    investors: [],
    resultCount: 0,
    error: null,
    complianceNote: COMPLIANCE_NOTE,
  };

  if (typeof fetchImpl !== 'function') {
    return { ...base, error: 'No fetch implementation available in this runtime.' };
  }

  // EDGAR full-text search returns up to 100 hits per page. We sort by date
  // descending so every run surfaces the FRESHEST filings first instead of the
  // same top-relevance hits (which were already consumed in prior runs and
  // dedupe to 0). We page through results, skipping filings already in the
  // pipeline (excludeUrls) BEFORE fetching, so each run reaches fresh, unseen
  // filings. No date-range filter is applied because some specific queries
  // (e.g. "private equity real estate") return only a handful of total filings
  // across all years, and narrowing to 2024+ would exclude them entirely.
  const PAGE_SIZE = 100;
  const investors: DiscoveredInvestor[] = [];
  let scanned = 0;
  let total = 0;
  let firstPageError: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    if (investors.length >= limit) break;
    const from = page * PAGE_SIZE;
    let hits: EdgarHit[] = [];
    try {
      const searchUrl = `${EDGAR_FULLTEXT_URL}?q=${encodeURIComponent(`"${query}"`)}&forms=D&from=${from}&sort=date_bucket:desc`;
      const res = await timeoutFetch(fetchImpl, searchUrl);
      if (!res.ok) {
        if (page === 0) firstPageError = `SEC EDGAR search returned HTTP ${res.status}.`;
        break;
      }
      const json = (await res.json()) as unknown;
      const parsed = parseEdgarHits(json);
      hits = parsed.hits;
      if (page === 0) total = parsed.total;
    } catch (error) {
      if (page === 0) {
        const message = error instanceof Error ? error.message : 'unknown error';
        firstPageError = `SEC EDGAR search failed: ${message}`;
      }
      break;
    }

    if (hits.length === 0) break; // No more pages.

    for (const hit of hits) {
      if (investors.length >= limit) break;
      const filingUrl = buildFilingUrl(hit.cik, hit.accessionNumber, hit.primaryDoc);
      // Skip filings already in the pipeline WITHOUT spending a SEC fetch.
      if (excludeUrls.has(filingUrl)) continue;
      scanned += 1;
      try {
        const res = await timeoutFetch(fetchImpl, filingUrl, { headers: { Accept: 'application/xml' } });
        if (!res.ok) continue;
        const xml = await res.text();
        const record = parseFormD(xml, hit.cik, hit.accessionNumber, filingUrl);
        if (!record) continue;
        record.filingDate = hit.fileDate;
        if (minOfferingUsd > 0) {
          const amount = record.totalOfferingAmountUsd;
          if (amount === null || amount < minOfferingUsd) continue;
        }
        investors.push(record);
      } catch {
        // Skip an unreadable filing; never throw the whole scan.
      }
      if (delayMs > 0 && investors.length < limit) {
        await sleep(delayMs);
      }
    }
  }

  if (firstPageError) {
    return { ...base, error: firstPageError };
  }

  investors.sort((a, b) => (b.totalOfferingAmountUsd ?? 0) - (a.totalOfferingAmountUsd ?? 0));

  return {
    ...base,
    ok: true,
    totalFilingsMatched: total,
    scannedFilings: scanned,
    investors,
    resultCount: investors.length,
  };
}
