/**
 * IVX IA Brain — Domain Router (§1).
 *
 * Classifies every inbound message into one or more of the 16 domains
 * defined by the enterprise intelligence spec, then determines the
 * information requirement route (A–E).
 *
 * This module sits ABOVE the existing 5-branch `ivx-chat-intent-router`
 * and enriches its decision with domain + route metadata. The 5-branch
 * router remains the execution authority; this module adds the
 * enterprise-classification layer the spec requires.
 *
 * Pure — no I/O, no AI, fully unit-testable.
 */

export const IVX_BRAIN_DOMAIN_ROUTER_MARKER =
  'ivx-brain-domain-router-2026-08-07-v1';

/** The 16 domains from §1. */
export type IVXBrainDomain =
  | 'software_engineering'
  | 'business_strategy'
  | 'operations'
  | 'marketing'
  | 'sales'
  | 'finance'
  | 'investment_analysis'
  | 'real_estate_analytics'
  | 'legal_information'
  | 'customer_support'
  | 'product_management'
  | 'data_analytics'
  | 'general_knowledge'
  | 'current_events'
  | 'personal_productivity'
  | 'creative_work'
  | 'unknown_ambiguous';

/** The 5 information-requirement routes from §1. */
export type IVXBrainRoute =
  | 'INTERNAL_KNOWLEDGE'
  | 'MODEL_REASONING'
  | 'LIVE_RETRIEVAL'
  | 'TOOL_EXECUTION'
  | 'CLARIFICATION';

export type IVXBrainRoutingDecision = {
  /** Primary domain (first match). */
  primaryDomain: IVXBrainDomain;
  /** All matching domains (a message can span multiple). */
  domains: IVXBrainDomain[];
  /** All routes the message requires (a message can use multiple). */
  routes: IVXBrainRoute[];
  /** Whether the message is time-sensitive and requires live retrieval. */
  requiresLiveRetrieval: boolean;
  /** Whether the message requires a tool action. */
  requiresToolExecution: boolean;
  /** Whether the message is ambiguous enough to need clarification. */
  requiresClarification: boolean;
  /** Human-readable reason for the routing decision. */
  reason: string;
  /** Confidence in the domain classification. */
  domainConfidence: 'high' | 'medium' | 'low';
};

// ─── Domain Patterns ─────────────────────────────────────────────

const DOMAIN_PATTERNS: ReadonlyArray<{
  domain: IVXBrainDomain;
  patterns: RegExp[];
  weight: number;
}> = [
  {
    domain: 'software_engineering',
    weight: 10,
    patterns: [
      /\b(code|function|api|endpoint|backend|frontend|typescript|swift|kotlin|python|bug|crash|error|deploy|commit|pr|pull request|merge|test|tsc|lint|build|gradle|xcode|npm|bun|yarn|supabase|render|github|docker|sql|migration|schema|refactor|debug|stacktrace|compile|bundle)\b/i,
      /\b(fix|patch|implement|architect|design pattern|unit test|integration test|e2e|ci\/cd|pipeline|infrastructure|devops)\b/i,
    ],
  },
  {
    domain: 'business_strategy',
    weight: 8,
    patterns: [
      /\b(business (model|strategy|plan)|revenue model|pricing strategy|go.?to.?market|market (sizing|entry|positioning)|competitive (advantage|landscape)|moat|unit economics|burn rate|runway|pivot|scalability|growth strategy|partnership|acquisition|merger)\b/i,
      /\b(business (plan|case|canvas)|value proposition|customer segment|distribution channel|key resource|key activity|cost structure|revenue stream)\b/i,
    ],
  },
  {
    domain: 'operations',
    weight: 7,
    patterns: [
      /\b(operations|workflow|process|supply chain|logistics|inventory|fulfillment|sop|standard operating procedure|quality (control|assurance)|lean|six sigma|bottleneck|throughput|capacity|automation|operational efficiency)\b/i,
    ],
  },
  {
    domain: 'marketing',
    weight: 7,
    patterns: [
      /\b(marketing|campaign|brand(ing)?|positioning|messaging|advertis|seo|sem|social media|content (strategy|marketing)|email marketing|funnel|conversion rate|ctr|cpc|cpm|roas|landing page|a\/b test|copywriting|tagline|slogan|brand guidelines|persona|target audience|demographic|psychographic)\b/i,
    ],
  },
  {
    domain: 'sales',
    weight: 6,
    patterns: [
      /\b(sales|pipeline|lead (generation|scoring|qualification)|crm|prospect|outreach|cold call|warm intro|demo|discovery call|proposal|quote|negotiat|closing|win rate|sales cycle|quota|forecast|deal (stage|velocity)|sdr|ae|account (executive|manager))\b/i,
    ],
  },
  {
    domain: 'finance',
    weight: 8,
    patterns: [
      /\b(financ|budget|cash flow|p&l|profit and loss|balance sheet|income statement|revenue|expense|ebitda|gross margin|net margin|forecast|projection|variance|audit|tax|accounting|bookkeeping|accounts (receivable|payable)|payroll|capex|opex|amortization|depreciation)\b/i,
    ],
  },
  {
    domain: 'investment_analysis',
    weight: 7,
    patterns: [
      /\b(invest(ment|or)|roi|irr|npv|cash on cash|cap rate|yield|dividend|portfolio|asset allocation|risk (adjusted return|tolerance)|diversification|due diligence|valuation|comparable|multiples|ebitda multiple|price to earnings|p\/e|base case|upside|downside|sensitivity analysis|scenario analysis|time horizon|liquidity|exit (strategy|multiple))\b/i,
    ],
  },
  {
    domain: 'real_estate_analytics',
    weight: 9,
    patterns: [
      /\b(property|real estate|parcel|land|acre|sqft|square feet|comparable|comp|sold (price|date)|asking price|listing|mls|appraisal|assessment|zoning|permit|entitlement|development|construction|rehab|flip|wholesale|brrrr|rental|cap rate|noi|operating expense|vacancy rate|cash on cash|amortization schedule|dti|ltv|closing cost|title|escrow)\b/i,
    ],
  },
  {
    domain: 'legal_information',
    weight: 6,
    patterns: [
      /\b(legal|law|regulation|compliance|contract|agreement|terms? of service|privacy policy|gdpr|ccpa|hipaa|fiduciary|liability|indemnification|warranty|intellectual property|trademark|copyright|patent|nda|non.?disclosure|clause|provision|jurisdiction|governing law|dispute resolution|arbitration|mediation)\b/i,
    ],
  },
  {
    domain: 'customer_support',
    weight: 5,
    patterns: [
      /\b(customer (support|service|success)|help desk|ticket|zendesk|intercom|faq|knowledge base|sla|response time|resolution time|escalation|refund|return|complaint|onboarding|churn|retention|nps|csat|customer satisfaction)\b/i,
    ],
  },
  {
    domain: 'product_management',
    weight: 7,
    patterns: [
      /\b(product (management|roadmap|backlog|strategy)|feature|user story|epic|sprint|agile|scrum|kanban|jira|stakeholder|requirement|spec|specification|prd|product requirements|mvp|prototype|wireframe|mockup|ux|ui|user (research|journey|persona)|a\/b test|analytics|kpi|okr)\b/i,
    ],
  },
  {
    domain: 'data_analytics',
    weight: 11,
    patterns: [
      /\b(data (analytics|science|pipeline|warehouse|lake|etl|viz)|sql|query|dashboard|metabase|tableau|power bi|looker|grafana|metric|kpi|statistic|regression|correlation|distribution|histogram|outlier|anomaly|forecast|trend|cohort|segmentation|clustering|classification|machine learning|model training|inference)\b/i,
    ],
  },
  {
    domain: 'general_knowledge',
    weight: 3,
    patterns: [
      /\b(what is|explain|describe|define|how does|tell me about|who is|when was|where is|history of|origin of|meaning of)\b/i,
    ],
  },
  {
    domain: 'current_events',
    weight: 6,
    patterns: [
      /\b(news|today|latest|current|recent|breaking|just (happened|announced)|this (week|month|year)|2026|upcoming|election|fed (rate|decision)|interest rate|inflation|cpi|jobs report|gdp|market (today|update)|stock (market|price) (today|now))\b/i,
      /\b(right now|as of (today|now)|live (data|price|rate))\b/i,
    ],
  },
  {
    domain: 'personal_productivity',
    weight: 4,
    patterns: [
      /\b(schedule|calendar|reminder|task|to.?do|productivity|time management|prioriti|deadline|focus|pomodoro|goal (setting|tracking)|habit|routine|agenda|meeting notes|action item|follow.?up)\b/i,
    ],
  },
  {
    domain: 'creative_work',
    weight: 8,
    patterns: [
      /\b(write|writing|draft|essay|article|blog post|story|script|screenplay|novel|poem|song|lyrics|video (script|idea)|creative|brainstorm|ideate|concept|naming|tagline|slogan|design idea|logo (idea|concept)|brand (name|identity))\b/i,
    ],
  },
];

// ─── Route Indicators ────────────────────────────────────────────

const LIVE_RETRIEVAL_PATTERNS: RegExp[] = [
  /\b(today|now|current|latest|recent|live|real.?time|up to date|breaking)\b/i,
  /\b(news|market (price|rate|update)|interest rate|stock price|exchange rate|weather|flight|traffic)\b/i,
  /\b(law|regulation|policy|compliance|requirement) (in|for|on|as of) \d{4}\b/i,
  /\b(app store|google play|apple|google) (policy|guideline|requirement|rule)s?\b/i,
  /\b(api (documentation|docs|reference)|sdk (docs|documentation))\b/i,
  /\b(competitor|competition|rival) (analysis|comparison|news)\b/i,
];

const TOOL_EXECUTION_PATTERNS: RegExp[] = [
  /\b(deploy|commit|push|merge|build|run (test|check|audit)|create (record|issue|ticket)|update|delete|execute)\b/i,
  /\b(supabase (table|record|query|schema)|github (issue|pr|commit)|render (deploy|log))\b/i,
  /^\s*\/(time-now|room-status|supabase-tables|storage-diagnostics|knowledge-reindex|create-record|update-record|delete-record|run-query|upload-file|read-file)\b/i,
];

const CLARIFICATION_PATTERNS: RegExp[] = [
  /\b(it|that|this|the (thing|stuff|issue|problem))\b\s*$/i,
  /^(help|what|how|why)\s*$/i,
  /\b(can you (do|help|fix|handle) (it|that|this))\b/i,
];

// ─── Router ──────────────────────────────────────────────────────

function classifyDomains(text: string): Array<{ domain: IVXBrainDomain; weight: number }> {
  const matches: Array<{ domain: IVXBrainDomain; weight: number }> = [];
  for (const entry of DOMAIN_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        matches.push({ domain: entry.domain, weight: entry.weight });
        break;
      }
    }
  }
  if (matches.length === 0) {
    return [{ domain: 'unknown_ambiguous', weight: 0 }];
  }
  return matches.sort((a, b) => b.weight - a.weight);
}

function detectLiveRetrievalNeed(text: string): boolean {
  return LIVE_RETRIEVAL_PATTERNS.some((p) => p.test(text));
}

function detectToolExecutionNeed(text: string): boolean {
  return TOOL_EXECUTION_PATTERNS.some((p) => p.test(text));
}

function detectClarificationNeed(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 10) return true;
  return CLARIFICATION_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Classify a message into domains and routes per §1 of the enterprise
 * brain spec. Pure, deterministic, no I/O.
 *
 * @param prompt The user's message text.
 * @param hasAttachments Whether image/file attachments accompany the message.
 */
export function routeIVXBrainDomains(
  prompt: string,
  hasAttachments: boolean = false,
): IVXBrainRoutingDecision {
  const text = prompt.trim();
  const domainMatches = classifyDomains(text);
  const primaryDomain = domainMatches[0]?.domain ?? 'unknown_ambiguous';
  const domains = domainMatches.map((m) => m.domain);

  const requiresLiveRetrieval = detectLiveRetrievalNeed(text);
  const requiresToolExecution = detectToolExecutionNeed(text);
  const isAmbiguous = domains[0] === 'unknown_ambiguous';
  const requiresClarification = !isAmbiguous && detectClarificationNeed(text) && !requiresToolExecution;

  const routes: IVXBrainRoute[] = [];

  // Internal knowledge applies when the message is about IVX systems/data
  const isIVXInternal = /\b(ivx|ivxholding|owner|member|investor|buyer|deal|property|reel|chat)\b/i.test(text);
  if (isIVXInternal) {
    routes.push('INTERNAL_KNOWLEDGE');
  }

  // Model reasoning is the default for most questions
  if (primaryDomain !== 'unknown_ambiguous' || !requiresToolExecution) {
    routes.push('MODEL_REASONING');
  }

  // Live retrieval when time-sensitive
  if (requiresLiveRetrieval) {
    routes.push('LIVE_RETRIEVAL');
  }

  // Tool execution when action-oriented
  if (requiresToolExecution) {
    routes.push('TOOL_EXECUTION');
  }

  // Clarification when ambiguous
  if (requiresClarification) {
    routes.push('CLARIFICATION');
  }

  // Deduplicate routes preserving order
  const seenRoutes = new Set<IVXBrainRoute>();
  const uniqueRoutes = routes.filter((r) => {
    if (seenRoutes.has(r)) return false;
    seenRoutes.add(r);
    return true;
  });

  const topWeight = domainMatches[0]?.weight ?? 0;
  const domainConfidence: 'high' | 'medium' | 'low' =
    topWeight >= 8
      ? 'high'
      : topWeight >= 5
        ? 'medium'
        : 'low';

  const reason = `Primary domain: ${primaryDomain}. Routes: ${uniqueRoutes.join(', ')}. Confidence: ${domainConfidence}.${hasAttachments ? ' Attachments present — multimodal analysis may apply.' : ''}`;

  return {
    primaryDomain,
    domains,
    routes: uniqueRoutes,
    requiresLiveRetrieval,
    requiresToolExecution,
    requiresClarification,
    reason,
    domainConfidence,
  };
}
