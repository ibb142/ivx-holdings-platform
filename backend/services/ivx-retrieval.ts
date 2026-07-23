/**
 * IVX Enterprise Retrieval — Phase 4
 *
 * Retrieval pipeline across GitHub, Render, Supabase, IVX docs, chat history,
 * task proof ledger, investor/buyer/property/deal records, and uploaded documents.
 *
 * Pipeline: QUERY UNDERSTANDING → SOURCE SELECTION → SEARCH → FILTER BY PERMISSIONS
 *           → RERANK → DEDUPLICATE → CONTEXT COMPRESSION → SOURCE CITATION
 *
 * Every factual answer must identify its source when retrieval was used.
 */

// ─── Types ────────────────────────────────────────────────────────

export type IVXRetrievalSource =
  | 'github_code'
  | 'github_issues'
  | 'github_commits'
  | 'render_logs'
  | 'supabase_schema'
  | 'supabase_records'
  | 'ivx_documentation'
  | 'chat_history'
  | 'task_proof_ledger'
  | 'investor_records'
  | 'buyer_records'
  | 'property_records'
  | 'deal_records'
  | 'messages'
  | 'media'
  | 'reports'
  | 'uploaded_documents';

export type IVXRetrievalResult = {
  source: IVXRetrievalSource;
  content: string;
  relevanceScore: number;
  url: string | null;
  metadata: Record<string, unknown>;
  freshness: 'live' | 'cached' | 'stale';
  timestamp: string | null;
};

export type IVXRetrievalQuery = {
  query: string;
  sources?: IVXRetrievalSource[];
  userRole: 'owner' | 'member' | 'anonymous';
  maxResults?: number;
  requireFresh?: boolean;
};

export type IVXRetrievalPipelineResult = {
  results: IVXRetrievalResult[];
  citations: IVXCitation[];
  totalSearched: number;
  pipelineStages: string[];
  queryUnderstanding: IVXQueryUnderstanding;
};

export type IVXCitation = {
  source: IVXRetrievalSource;
  reference: string;
  url: string | null;
  freshness: 'live' | 'cached' | 'stale';
};

export type IVXQueryUnderstanding = {
  intent: string;
  keywords: string[];
  entities: string[];
  suggestedSources: IVXRetrievalSource[];
};

// ─── Query Understanding ──────────────────────────────────────────

export function understandQuery(query: string): IVXQueryUnderstanding {
  const text = query.toLowerCase();
  const keywords = text
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const entities: string[] = [];
  const suggestedSources: IVXRetrievalSource[] = [];

  // Detect entity types
  if (/\b(deal|jv|joint venture|investment|roi|capital)\b/.test(text)) {
    entities.push('deal');
    suggestedSources.push('deal_records', 'supabase_records');
  }
  if (/\b(investor|accred|kyc)\b/.test(text)) {
    entities.push('investor');
    suggestedSources.push('investor_records', 'supabase_records');
  }
  if (/\b(buyer|purchase|budget)\b/.test(text)) {
    entities.push('buyer');
    suggestedSources.push('buyer_records');
  }
  if (/\b(property|parcel|address|location)\b/.test(text)) {
    entities.push('property');
    suggestedSources.push('property_records', 'deal_records');
  }
  if (/\b(code|function|file|api|endpoint|backend|frontend)\b/.test(text)) {
    entities.push('code');
    suggestedSources.push('github_code');
  }
  if (/\b(commit|push|merge|pr|pull request)\b/.test(text)) {
    entities.push('commit');
    suggestedSources.push('github_commits');
  }
  if (/\b(issue|bug|error|crash|fail)\b/.test(text)) {
    entities.push('issue');
    suggestedSources.push('github_issues', 'render_logs');
  }
  if (/\b(log|deploy|render|runtime)\b/.test(text)) {
    entities.push('log');
    suggestedSources.push('render_logs');
  }
  if (/\b(schema|table|column|database|migration)\b/.test(text)) {
    entities.push('schema');
    suggestedSources.push('supabase_schema');
  }
  if (/\b(proof|evidence|verify|verified|ledger)\b/.test(text)) {
    entities.push('proof');
    suggestedSources.push('task_proof_ledger');
  }
  if (/\b(chat|conversation|message|history)\b/.test(text)) {
    entities.push('chat');
    suggestedSources.push('chat_history');
  }
  if (/\b(document|doc|manual|guide)\b/.test(text)) {
    entities.push('documentation');
    suggestedSources.push('ivx_documentation');
  }

  // Determine intent
  let intent = 'informational';
  if (/\b(fix|debug|error|crash|broken)\b/.test(text)) intent = 'debugging';
  else if (/\b(analyze|review|audit|inspect)\b/.test(text)) intent = 'analysis';
  else if (/\b(create|build|implement|generate|add)\b/.test(text)) intent = 'creation';
  else if (/\b(deploy|commit|push|upload)\b/.test(text)) intent = 'deployment';
  else if (/\b(what is|explain|describe|how does)\b/.test(text)) intent = 'explanation';

  return { intent, keywords, entities, suggestedSources };
}

// ─── Source Selection ─────────────────────────────────────────────

export function selectSources(
  understanding: IVXQueryUnderstanding,
  userRole: 'owner' | 'member' | 'anonymous',
  explicitSources?: IVXRetrievalSource[],
): IVXRetrievalSource[] {
  if (explicitSources && explicitSources.length > 0) {
    return filterByPermissions(explicitSources, userRole);
  }
  return filterByPermissions(understanding.suggestedSources, userRole);
}

function filterByPermissions(
  sources: IVXRetrievalSource[],
  userRole: 'owner' | 'member' | 'anonymous',
): IVXRetrievalSource[] {
  const ownerOnly: IVXRetrievalSource[] = [
    'render_logs',
    'supabase_schema',
    'task_proof_ledger',
    'investor_records',
    'buyer_records',
  ];

  if (userRole === 'owner') {
    return [...new Set(sources)]; // Owner can access everything
  }

  if (userRole === 'member') {
    return sources.filter((s) => !ownerOnly.includes(s));
  }

  // Anonymous — very restricted
  return sources.filter((s) =>
    ['ivx_documentation', 'deal_records', 'property_records'].includes(s),
  );
}

// ─── Mock Search (real implementations would call APIs) ───────────

/**
 * Search a specific source. In production, this calls the real API.
 * For now, returns structured results that the pipeline processes.
 */
export function searchSource(
  source: IVXRetrievalSource,
  query: string,
  _maxResults: number = 10,
): IVXRetrievalResult[] {
  // Real implementations would call GitHub API, Supabase REST, Render API, etc.
  // This is the interface the pipeline uses; concrete searchers are injected.
  return [];
}

// ─── Reranking ────────────────────────────────────────────────────

export function rerankResults(
  results: IVXRetrievalResult[],
  query: string,
): IVXRetrievalResult[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  const scored = results.map((r) => {
    const contentLower = r.content.toLowerCase();
    let score = r.relevanceScore;

    // Boost: exact keyword matches in content
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        score += 0.1;
      }
    }

    // Boost: live freshness
    if (r.freshness === 'live') {
      score += 0.05;
    }

    // Boost: owner-requested sources
    if (r.source === 'github_code' || r.source === 'render_logs') {
      score += 0.03;
    }

    return { ...r, relevanceScore: Math.min(1.0, score) };
  });

  return scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// ─── Deduplication ────────────────────────────────────────────────

export function deduplicateResults(results: IVXRetrievalResult[]): IVXRetrievalResult[] {
  const seen = new Set<string>();
  const deduped: IVXRetrievalResult[] = [];

  for (const r of results) {
    // Dedupe by content hash (first 200 chars)
    const contentHash = r.content.slice(0, 200).toLowerCase().trim();
    const key = `${r.source}:${contentHash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return deduped;
}

// ─── Context Compression ──────────────────────────────────────────

export function compressResults(
  results: IVXRetrievalResult[],
  maxTokens: number = 2000,
): IVXRetrievalResult[] {
  const compressed: IVXRetrievalResult[] = [];
  let usedTokens = 0;

  for (const r of results) {
    const tokens = Math.ceil(r.content.length / 4);
    if (usedTokens + tokens > maxTokens) {
      const remaining = maxTokens - usedTokens;
      if (remaining > 50) {
        const charLimit = remaining * 4;
        compressed.push({
          ...r,
          content: r.content.slice(0, charLimit) + '…[compressed]',
        });
      }
      break;
    }
    compressed.push(r);
    usedTokens += tokens;
  }

  return compressed;
}

// ─── Source Citation ──────────────────────────────────────────────

export function buildCitations(results: IVXRetrievalResult[]): IVXCitation[] {
  return results.map((r) => ({
    source: r.source,
    reference: String(r.metadata.title || r.metadata.id || r.source),
    url: r.url,
    freshness: r.freshness,
  }));
}

// ─── Full Pipeline ────────────────────────────────────────────────

export function runRetrievalPipeline(
  query: IVXRetrievalQuery,
  searchers?: Map<IVXRetrievalSource, (query: string, max: number) => IVXRetrievalResult[]>,
): IVXRetrievalPipelineResult {
  const stages: string[] = [];

  // 1. Query Understanding
  stages.push('QUERY_UNDERSTANDING');
  const queryUnderstanding = understandQuery(query.query);

  // 2. Source Selection
  stages.push('SOURCE_SELECTION');
  const sources = selectSources(queryUnderstanding, query.userRole, query.sources);

  // 3. Search
  stages.push('SEARCH');
  let allResults: IVXRetrievalResult[] = [];
  for (const source of sources) {
    const searcher = searchers?.get(source);
    const results = searcher ? searcher(query.query, query.maxResults || 10) : searchSource(source, query.query, query.maxResults || 10);
    allResults.push(...results);
  }

  // 4. Filter by Permissions (already done in source selection, but double-check)
  stages.push('PERMISSION_FILTER');
  allResults = allResults.filter((r) => {
    if (query.userRole === 'owner') return true;
    if (query.userRole === 'member') {
      return !['render_logs', 'supabase_schema', 'task_proof_ledger', 'investor_records', 'buyer_records'].includes(r.source);
    }
    return ['ivx_documentation', 'deal_records', 'property_records'].includes(r.source);
  });

  // 5. Rerank
  stages.push('RERANK');
  allResults = rerankResults(allResults, query.query);

  // 6. Deduplicate
  stages.push('DEDUPLICATE');
  allResults = deduplicateResults(allResults);

  // 7. Context Compression
  stages.push('CONTEXT_COMPRESSION');
  allResults = compressResults(allResults, 2000);

  // 8. Source Citation
  stages.push('SOURCE_CITATION');
  const citations = buildCitations(allResults);

  // Freshness rules
  if (query.requireFresh) {
    // Mark non-live results as stale
    allResults = allResults.map((r) => {
      if (r.freshness !== 'live') {
        return { ...r, freshness: 'stale' as const };
      }
      return r;
    });
  }

  return {
    results: allResults.slice(0, query.maxResults || 20),
    citations,
    totalSearched: sources.length,
    pipelineStages: stages,
    queryUnderstanding,
  };
}

// ─── Freshness Rules ──────────────────────────────────────────────

export function checkFreshnessRules(input: {
  source: IVXRetrievalSource;
  timestamp: string | null;
  requireLive: boolean;
}): { fresh: boolean; label: 'live' | 'cached' | 'stale'; reason: string } {
  if (!input.timestamp) {
    return { fresh: false, label: 'stale', reason: 'No timestamp available' };
  }

  const age = Date.now() - new Date(input.timestamp).getTime();
  const fiveMinutes = 5 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;

  if (age < fiveMinutes) {
    return { fresh: true, label: 'live', reason: 'Less than 5 minutes old' };
  }

  if (age < oneHour) {
    return { fresh: !input.requireLive, label: 'cached', reason: 'Less than 1 hour old' };
  }

  return { fresh: false, label: 'stale', reason: 'More than 1 hour old — must be re-verified' };
}

export const IVX_RETRIEVAL_MARKER = 'ivx-enterprise-retrieval-2026-07-23-v1';
