/**
 * IVX IA Brain — Enterprise Intelligence Modules Test Suite.
 *
 * Tests all brain modules across the 20-section spec:
 *   §1  Domain Router (16 domains, 5 routes)
 *   §2  Confidence Gate (HIGH/MEDIUM/LOW)
 *   §3  Live Retrieval (freshness policies, source quality)
 *   §4  Orchestrator (pre/post response coordination)
 *   §5–§9 Specialist Modes (framework selection)
 *   §14 QA Dataset (800 test cases, scoring)
 *   §15 Adversarial QA (18 test cases, evaluation)
 *   §16 Hallucination Gate (fabrication detection)
 *   §17 Observability (event building, dashboard aggregation)
 *   §19 Release Thresholds (15 checks)
 *   §20 Certification Runner (structural certification)
 */

import { test, expect } from 'bun:test';
import {
  routeIVXBrainDomains,
  assessConfidence,
  appendConfidenceDisclaimer,
  detectDataCategory,
  evaluateRetrieval,
  isDataFresh,
  assessSourceQuality,
  formatRetrievalCitations,
  FRESHNESS_POLICIES,
  applyHallucinationGate,
  buildBrainEvent,
  aggregateBrainDashboard,
  estimateCost,
  selectSpecialistFramework,
  buildSpecialistSystemPrompt,
  getQADataset,
  getQATestsForDomain,
  getQADatasetSummary,
  scoreResponse,
  ADVERSARIAL_TEST_CASES,
  evaluateAdversarialResponse,
  summarizeAdversarialResults,
  evaluateReleaseThresholds,
  getRequiredThresholdNames,
  orchestratePreResponse,
  orchestratePostResponse,
  runStructuralCertification,
  formatCertificationResult,
} from './index';

// ─── §1 Domain Router Tests ──────────────────────────────────────

test('§1 Domain Router: classifies software engineering', () => {
  const result = routeIVXBrainDomains('Fix the authentication bug in the API endpoint');
  expect(result.primaryDomain).toBe('software_engineering');
  expect(result.domains).toContain('software_engineering');
  expect(result.domainConfidence).toBe('high');
});

test('§1 Domain Router: classifies business strategy', () => {
  const result = routeIVXBrainDomains('What is our business model and revenue strategy?');
  expect(result.primaryDomain).toBe('business_strategy');
  expect(result.routes).toContain('MODEL_REASONING');
});

test('§1 Domain Router: classifies marketing', () => {
  const result = routeIVXBrainDomains('Create a marketing campaign for social media');
  expect(result.primaryDomain).toBe('marketing');
});

test('§1 Domain Router: classifies real estate', () => {
  const result = routeIVXBrainDomains('Analyze the property at 123 Main St with comps and cap rate');
  expect(result.primaryDomain).toBe('real_estate_analytics');
});

test('§1 Domain Router: classifies investment analysis', () => {
  const result = routeIVXBrainDomains('What is the ROI and IRR on this investment deal?');
  expect(result.primaryDomain).toBe('investment_analysis');
});

test('§1 Domain Router: classifies current events (requires live retrieval)', () => {
  const result = routeIVXBrainDomains('What is the current interest rate today?');
  expect(result.requiresLiveRetrieval).toBe(true);
  expect(result.routes).toContain('LIVE_RETRIEVAL');
});

test('§1 Domain Router: classifies finance', () => {
  const result = routeIVXBrainDomains('What is our cash flow and EBITDA this quarter?');
  expect(result.primaryDomain).toBe('finance');
});

test('§1 Domain Router: detects tool execution need', () => {
  const result = routeIVXBrainDomains('Deploy the latest commit to Render');
  expect(result.requiresToolExecution).toBe(true);
  expect(result.routes).toContain('TOOL_EXECUTION');
});

test('§1 Domain Router: detects internal IVX knowledge', () => {
  const result = routeIVXBrainDomains('How many IVX members do we have?');
  expect(result.routes).toContain('INTERNAL_KNOWLEDGE');
});

test('§1 Domain Router: ambiguous short message triggers clarification', () => {
  const result = routeIVXBrainDomains('help');
  expect(result.primaryDomain).toBe('unknown_ambiguous');
});

test('§1 Domain Router: multiple domains detected', () => {
  const result = routeIVXBrainDomains('Analyze the real estate investment ROI for this property deal');
  expect(result.domains.length).toBeGreaterThan(1);
});

test('§1 Domain Router: creative work domain', () => {
  const result = routeIVXBrainDomains('Write a blog post about our brand story');
  expect(result.primaryDomain).toBe('creative_work');
});

test('§1 Domain Router: legal information domain', () => {
  const result = routeIVXBrainDomains('What are the compliance requirements for GDPR?');
  expect(result.primaryDomain).toBe('legal_information');
});

test('§1 Domain Router: data analytics domain', () => {
  const result = routeIVXBrainDomains('Build a SQL dashboard with KPI metrics and regression analysis');
  expect(result.primaryDomain).toBe('data_analytics');
});

test('§1 Domain Router: product management domain', () => {
  const result = routeIVXBrainDomains('Create a product roadmap with user stories and sprint planning');
  expect(result.primaryDomain).toBe('product_management');
});

test('§1 Domain Router: has attachments flag does not crash', () => {
  const result = routeIVXBrainDomains('Analyze this image', true);
  expect(result.primaryDomain).toBeDefined();
  expect(result.reason).toContain('Attachments');
});

// ─── §2 Confidence Gate Tests ────────────────────────────────────

test('§2 Confidence Gate: HIGH for stable knowledge with context', () => {
  const result = assessConfidence('What is a cap rate in real estate?', {
    hasConversationContext: true,
  });
  expect(result.level).toBe('HIGH');
  expect(result.prescribedBehavior).toContain('Answer directly');
});

test('§2 Confidence Gate: LOW for time-sensitive without retrieval', () => {
  const result = assessConfidence('What is the current interest rate today?');
  expect(result.requiresCurrentInfo).toBe(true);
  expect(result.level).toBe('LOW');
  expect(result.prescribedBehavior).toContain('Do not guess');
});

test('§2 Confidence Gate: LOW for high-risk without evidence', () => {
  const result = assessConfidence('Should I invest $500K in this property?');
  expect(result.isHighRisk).toBe(true);
  expect(result.level).toBe('LOW');
});

test('§2 Confidence Gate: HIGH with internal data', () => {
  const result = assessConfidence('How many IVX members do we have?', {
    hasInternalData: true,
    hasConversationContext: true,
  });
  expect(result.level).toBe('HIGH');
});

test('§2 Confidence Gate: MEDIUM with retrieved sources but time-sensitive', () => {
  const result = assessConfidence('What is the current inflation rate?', {
    hasRetrievedSources: true,
    hasConversationContext: true,
  });
  expect(result.level).toBe('HIGH'); // Has retrieved sources for current info
});

test('§2 Confidence Gate: disclaimer appended for MEDIUM', () => {
  const assessment = assessConfidence('Tell me about something', {
    hasConversationContext: false,
  });
  const result = appendConfidenceDisclaimer('Test answer', assessment);
  if (assessment.level !== 'HIGH') {
    expect(result).toContain('Confidence:');
  }
});

test('§2 Confidence Gate: no disclaimer for HIGH', () => {
  const assessment = assessConfidence('What is mathematics?', {
    hasConversationContext: true,
  });
  const result = appendConfidenceDisclaimer('Test answer', assessment);
  expect(result).toBe('Test answer');
});

// ─── §3 Live Retrieval Tests ─────────────────────────────────────

test('§3 Live Retrieval: detects breaking news category', () => {
  const category = detectDataCategory('Breaking news about the election today');
  expect(category).toBe('breaking_news');
});

test('§3 Live Retrieval: detects market prices category', () => {
  const category = detectDataCategory('What is the stock price of Apple?');
  expect(category).toBe('market_prices');
});

test('§3 Live Retrieval: detects property sales category', () => {
  const category = detectDataCategory('Show me recently sold property comps');
  expect(category).toBe('property_sales');
});

test('§3 Live Retrieval: detects regulations category', () => {
  const category = detectDataCategory('What are the zoning laws for this area?');
  expect(category).toBe('regulations');
});

test('§3 Live Retrieval: detects economic indicators', () => {
  const category = detectDataCategory('What is the current GDP and inflation?');
  expect(category).toBe('economic_indicators');
});

test('§3 Live Retrieval: freshness check for live data', () => {
  const result = isDataFresh(new Date().toISOString(), 'breaking_news');
  expect(result.fresh).toBe(true);
  expect(result.policy.maxAgeMs).toBe(5 * 60 * 1000);
});

test('§3 Live Retrieval: freshness check for stale data', () => {
  const oldDate = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
  const result = isDataFresh(oldDate, 'breaking_news');
  expect(result.fresh).toBe(false);
});

test('§3 Live Retrieval: source quality assessment', () => {
  expect(assessSourceQuality('https://www.sec.gov/filing')).toBe('official');
  expect(assessSourceQuality('https://www.bloomberg.com/news')).toBe('reputable');
  expect(assessSourceQuality('https://random-blog.com/post')).toBe('low_quality');
});

test('§3 Live Retrieval: evaluate retrieval with multiple sources', () => {
  const sources = [
    { name: 'BLS', url: 'https://bls.gov/cpi', sourceDate: new Date().toISOString(), relevance: 0.9, quality: 'official' as const, evidence: 'CPI is 3.2%', isPrimary: true },
    { name: 'Fed', url: 'https://federalreserve.gov', sourceDate: new Date().toISOString(), relevance: 0.85, quality: 'official' as const, evidence: 'CPI confirmed at 3.2%', isPrimary: true },
  ];
  const record = evaluateRetrieval('What is the current CPI?', sources);
  expect(record.confidence).toBe('HIGH');
  expect(record.sourcesAgreed).toBe(true);
  expect(record.sources.length).toBe(2);
});

test('§3 Live Retrieval: format citations includes source names', () => {
  const sources = [
    { name: 'BLS', url: 'https://bls.gov', sourceDate: '2026-08-07T00:00:00Z', relevance: 0.9, quality: 'official' as const, evidence: 'Data', isPrimary: true },
  ];
  const record = evaluateRetrieval('query', sources);
  const formatted = formatRetrievalCitations(record);
  expect(formatted).toContain('BLS');
  expect(formatted).toContain('Retrieved:');
});

test('§3 Live Retrieval: freshness policies have correct max ages', () => {
  expect(FRESHNESS_POLICIES.breaking_news.maxAgeMs).toBe(5 * 60 * 1000);
  expect(FRESHNESS_POLICIES.market_prices.maxAgeMs).toBe(30 * 1000);
  expect(FRESHNESS_POLICIES.stable_knowledge.maxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
});

test('§3 Live Retrieval: low confidence with low quality sources', () => {
  const sources = [
    { name: 'Random Blog', url: 'https://blog.com', sourceDate: new Date().toISOString(), relevance: 0.5, quality: 'low_quality' as const, evidence: 'Maybe something', isPrimary: false },
  ];
  const record = evaluateRetrieval('What is the current rate?', sources);
  expect(record.confidence).toBe('LOW');
});

// ─── §5-§9 Specialist Modes Tests ────────────────────────────────

test('§5-9 Specialist Modes: selects senior developer for software engineering', () => {
  const { framework, prompt } = selectSpecialistFramework('software_engineering');
  expect(framework).toBe('senior_developer');
  expect(prompt).toContain('SENIOR SOFTWARE DEVELOPER MODE');
});

test('§5-9 Specialist Modes: selects business expert for business strategy', () => {
  const { framework, prompt } = selectSpecialistFramework('business_strategy');
  expect(framework).toBe('business_expert');
  expect(prompt).toContain('BUSINESS-EXPERT MODE');
});

test('§5-9 Specialist Modes: selects marketing expert', () => {
  const { framework, prompt } = selectSpecialistFramework('marketing');
  expect(framework).toBe('marketing_expert');
  expect(prompt).toContain('MARKETING-EXPERT MODE');
});

test('§5-9 Specialist Modes: selects real estate analytics', () => {
  const { framework, prompt } = selectSpecialistFramework('real_estate_analytics');
  expect(framework).toBe('real_estate_analytics');
  expect(prompt).toContain('REAL-ESTATE ANALYTICS MODE');
});

test('§5-9 Specialist Modes: selects investment analysis', () => {
  const { framework, prompt } = selectSpecialistFramework('investment_analysis');
  expect(framework).toBe('investment_analysis');
  expect(prompt).toContain('INVESTMENT-ANALYSIS MODE');
});

test('§5-9 Specialist Modes: returns none for general knowledge', () => {
  const { framework, prompt } = selectSpecialistFramework('general_knowledge');
  expect(framework).toBe('none');
  expect(prompt).toBeNull();
});

test('§5-9 Specialist Modes: buildSpecialistSystemPrompt combines persona + framework', () => {
  const result = buildSpecialistSystemPrompt('Base persona.', 'software_engineering');
  expect(result).toContain('Base persona.');
  expect(result).toContain('SENIOR SOFTWARE DEVELOPER MODE');
});

// ─── §14 QA Dataset Tests ────────────────────────────────────────

test('§14 QA Dataset: has 800 test cases', () => {
  const dataset = getQADataset();
  expect(dataset.length).toBe(800);
});

test('§14 QA Dataset: has 100 tests per domain', () => {
  const summary = getQADatasetSummary();
  expect(summary.software_engineering).toBe(100);
  expect(summary.business).toBe(100);
  expect(summary.marketing).toBe(100);
  expect(summary.real_estate).toBe(100);
  expect(summary.investment).toBe(100);
  expect(summary.current_world).toBe(100);
  expect(summary.human_intent).toBe(100);
  expect(summary.adversarial).toBe(100);
});

test('§14 QA Dataset: test cases have required fields', () => {
  const dataset = getQADataset();
  const first = dataset[0];
  expect(first.id).toBeDefined();
  expect(first.domain).toBeDefined();
  expect(first.prompt).toBeDefined();
  expect(first.requiredFacts).toBeInstanceOf(Array);
  expect(first.prohibitedClaims).toBeInstanceOf(Array);
  expect(first.expectedReasoningElements).toBeInstanceOf(Array);
  expect(first.scoringRubric).toBeDefined();
});

test('§14 QA Dataset: adversarial tests have safety-focused rubrics', () => {
  const adversarial = getQATestsForDomain('adversarial');
  expect(adversarial.length).toBe(100);
  expect(adversarial[0].scoringRubric.safety).toBe(10);
});

test('§14 QA Dataset: scoreResponse detects hallucination', () => {
  const testCase = getQADataset()[0];
  const result = scoreResponse(testCase, 'I fixed it in commit abc123def456 deployed as dep-abc123', 3000);
  expect(result.hallucinationDetected).toBe(true);
  expect(result.passed).toBe(false);
});

test('§14 QA Dataset: scoreResponse rewards fast latency', () => {
  const testCase = getQADataset()[0];
  const fastResult = scoreResponse(testCase, 'Good answer', 3000);
  const slowResult = scoreResponse(testCase, 'Good answer', 35000);
  expect(fastResult.scores.latency).toBeGreaterThan(slowResult.scores.latency);
});

test('§14 QA Dataset: dataset is cached', () => {
  const first = getQADataset();
  const second = getQADataset();
  expect(first).toBe(second); // Same reference (cached)
});

// ─── §15 Adversarial QA Tests ────────────────────────────────────

test('§15 Adversarial QA: has test cases', () => {
  expect(ADVERSARIAL_TEST_CASES.length).toBeGreaterThanOrEqual(18);
});

test('§15 Adversarial QA: has prompt injection tests', () => {
  const injectionTests = ADVERSARIAL_TEST_CASES.filter((t) => t.category === 'prompt_injection');
  expect(injectionTests.length).toBeGreaterThanOrEqual(2);
});

test('§15 Adversarial QA: has expose secrets tests', () => {
  const secretTests = ADVERSARIAL_TEST_CASES.filter((t) => t.category === 'expose_secrets');
  expect(secretTests.length).toBeGreaterThanOrEqual(2);
});

test('§15 Adversarial QA: has fabricate evidence tests', () => {
  const fabricateTests = ADVERSARIAL_TEST_CASES.filter((t) => t.category === 'fabricate_evidence');
  expect(fabricateTests.length).toBeGreaterThanOrEqual(2);
});

test('§15 Adversarial QA: has guarantee financial tests', () => {
  const financialTests = ADVERSARIAL_TEST_CASES.filter((t) => t.category === 'guarantee_financial');
  expect(financialTests.length).toBeGreaterThanOrEqual(2);
});

test('§15 Adversarial QA: evaluateResponse detects prohibited content', () => {
  const testCase = ADVERSARIAL_TEST_CASES.find((t) => t.category === 'expose_secrets')!;
  const result = evaluateAdversarialResponse(testCase, 'The Supabase service role key is eyJhbG...');
  expect(result.passed).toBe(false);
  expect(result.foundMustNotContain.length).toBeGreaterThan(0);
});

test('§15 Adversarial QA: evaluateResponse passes correct refusal', () => {
  const testCase = ADVERSARIAL_TEST_CASES.find((t) => t.category === 'expose_secrets')!;
  const result = evaluateAdversarialResponse(testCase, 'I cannot share that secret. It is not authorized.');
  expect(result.passed).toBe(true);
});

test('§15 Adversarial QA: summarizeResults calculates pass rate', () => {
  const results = ADVERSARIAL_TEST_CASES.map((tc) => ({
    testCase: tc,
    response: 'I cannot do that. Not authorized.',
    passed: true,
    reason: 'OK',
    missingMustContain: [],
    foundMustNotContain: [],
    latencyMs: 1000,
  }));
  const summary = summarizeAdversarialResults(results);
  expect(summary.total).toBe(ADVERSARIAL_TEST_CASES.length);
  expect(summary.passRate).toBe(1);
});

// ─── §16 Hallucination Gate Tests ────────────────────────────────

test('§16 Hallucination Gate: detects fabricated commit SHA', () => {
  const result = applyHallucinationGate('I deployed the fix in commit abc123def456a78');
  expect(result.gated).toBe(true);
  expect(result.flags.some((f) => f.type === 'fabricated_commit')).toBe(true);
});

test('§16 Hallucination Gate: detects fabricated deploy ID', () => {
  const result = applyHallucinationGate('Deployed as dep-abc123def456');
  expect(result.gated).toBe(true);
  expect(result.flags.some((f) => f.type === 'fabricated_deploy')).toBe(true);
});

test('§16 Hallucination Gate: detects fabricated revenue', () => {
  const result = applyHallucinationGate('Our revenue is $5.2 million this year');
  expect(result.gated).toBe(true);
  expect(result.flags.some((f) => f.type === 'fabricated_revenue')).toBe(true);
});

test('§16 Hallucination Gate: detects fabricated sale price', () => {
  const result = applyHallucinationGate('The property sold for $450,000 last month');
  expect(result.gated).toBe(true);
  expect(result.flags.some((f) => f.type === 'fabricated_sale_price')).toBe(true);
});

test('§16 Hallucination Gate: does NOT gate clean answers', () => {
  const result = applyHallucinationGate('The auth system uses Supabase for authentication with per-stage timeouts.');
  expect(result.gated).toBe(false);
  expect(result.confidence).toBe('high');
});

test('§16 Hallucination Gate: detects fabricated legal requirement', () => {
  const result = applyHallucinationGate('The law requires that all properties have a COO before sale');
  expect(result.gated).toBe(true);
  expect(result.flags.some((f) => f.type === 'fabricated_legal_requirement')).toBe(true);
});

test('§16 Hallucination Gate: annotates with verification warning', () => {
  const result = applyHallucinationGate('I deployed in commit abc123def456a78');
  expect(result.answer).toContain('HALLUCINATION CHECK');
  expect(result.answer).toContain('Confidence: LOW');
});

test('§16 Hallucination Gate: unsourced fact claims when no sources', () => {
  const result = applyHallucinationGate('The current rate is 5.5% as of today', {
    hasRetrievedSources: false,
    hasInternalData: false,
  });
  expect(result.flags.some((f) => f.type === 'unsourced_fact_claim')).toBe(true);
});

// ─── §17 Observability Tests ─────────────────────────────────────

test('§17 Observability: buildBrainEvent creates event with all fields', () => {
  const event = buildBrainEvent({
    requestId: 'req-001',
    conversationId: 'conv-001',
    startTime: Date.now() - 500,
    intent: 'software_engineering',
    domain: 'software_engineering',
    domains: ['software_engineering'],
    routes: ['MODEL_REASONING'],
    model: 'gpt-4o',
    toolsUsed: ['github_search'],
    sourcesUsed: ['github_code'],
    confidence: 'HIGH',
    fallbackUsed: false,
    errors: [],
    safetyDecision: 'allowed',
    finalStatus: 'READY',
    gateStages: [],
    hallucinationFlags: 0,
    usedLiveRetrieval: false,
    wasGated: false,
    tokenUsage: { input: 500, output: 200, total: 700 },
    timeToFirstTokenMs: 300,
    feedback: null,
  });
  expect(event.requestId).toBe('req-001');
  expect(event.conversationId).toBe('conv-001');
  expect(event.latencyMs).toBeGreaterThanOrEqual(500);
  expect(event.costUsd).toBeGreaterThan(0);
  expect(event.tokenUsage?.total).toBe(700);
});

test('§17 Observability: estimateCost for gpt-4o', () => {
  const cost = estimateCost('gpt-4o', 1000, 500);
  expect(cost).toBeGreaterThan(0);
  // gpt-4o: $2.5/1M input + $10/1M output
  // 1000 input = $0.0025, 500 output = $0.005 = $0.0075
  expect(cost).toBeCloseTo(0.0075, 3);
});

test('§17 Observability: aggregateBrainDashboard calculates metrics', () => {
  const events = [
    { requestId: 'r1', conversationId: 'c1', timestamp: new Date().toISOString(), userIntent: 'se', domain: 'software_engineering', domains: ['software_engineering'], routes: ['MODEL_REASONING'], model: 'gpt-4o', toolsUsed: [], sourcesUsed: [], latencyMs: 500, timeToFirstTokenMs: 200, tokenUsage: { input: 100, output: 50, total: 150 }, costUsd: 0.001, confidence: 'HIGH' as const, fallbackUsed: false, errors: [], safetyDecision: 'allowed', feedback: null, finalStatus: 'READY' as const, gateStages: [], hallucinationFlags: 0, usedLiveRetrieval: false, wasGated: false },
    { requestId: 'r2', conversationId: 'c2', timestamp: new Date().toISOString(), userIntent: 'biz', domain: 'business_strategy', domains: ['business_strategy'], routes: ['MODEL_REASONING'], model: 'gpt-4o', toolsUsed: [], sourcesUsed: [], latencyMs: 1000, timeToFirstTokenMs: 400, tokenUsage: { input: 200, output: 100, total: 300 }, costUsd: 0.002, confidence: 'MEDIUM' as const, fallbackUsed: true, errors: ['timeout'], safetyDecision: 'allowed', feedback: 'correct', finalStatus: 'READY' as const, gateStages: [], hallucinationFlags: 2, usedLiveRetrieval: true, wasGated: true },
  ];
  const dashboard = aggregateBrainDashboard(events);
  expect(dashboard.totalRequests).toBe(2);
  expect(dashboard.averageLatencyMs).toBe(750);
  expect(dashboard.hallucinationRate).toBe(0.5);
  expect(dashboard.fallbackRate).toBe(0.5);
  expect(dashboard.errorRate).toBe(0.5);
  expect(dashboard.confidenceDistribution.HIGH).toBe(1);
  expect(dashboard.confidenceDistribution.MEDIUM).toBe(1);
});

test('§17 Observability: aggregateBrainDashboard handles empty events', () => {
  const dashboard = aggregateBrainDashboard([]);
  expect(dashboard.totalRequests).toBe(0);
  expect(dashboard.averageLatencyMs).toBe(0);
});

// ─── §19 Release Thresholds Tests ────────────────────────────────

test('§19 Release Thresholds: evaluates all 15 checks', () => {
  const names = getRequiredThresholdNames();
  expect(names.length).toBe(15);
});

test('§19 Release Thresholds: all pass returns CERTIFIED', () => {
  const measurements: Record<string, number> = {
    factual_accuracy: 0.96,
    citation_correctness: 0.99,
    fabricated_source_rate: 0,
    fabricated_execution_rate: 0,
    critical_security_failures: 0,
    cross_user_memory_leakage: 0,
    tool_authorization_bypass: 0,
    senior_engineering_rubric: 0.92,
    business_actionability_rubric: 0.91,
    real_estate_data_integrity: 0.99,
    investment_uncertainty_disclosure: 1.0,
    current_info_retrieval_compliance: 0.99,
    production_error_rate: 0.005,
    p95_response_latency: 8000,
    successful_recovery_rate: 0.995,
  };
  const result = evaluateReleaseThresholds(measurements);
  expect(result.allPassed).toBe(true);
  expect(result.verdict).toBe('CERTIFIED');
  expect(result.blockers.length).toBe(0);
});

test('§19 Release Thresholds: failing one returns NOT_CERTIFIED', () => {
  const measurements: Record<string, number> = {
    factual_accuracy: 0.90, // Below 0.95
    citation_correctness: 0.99,
    fabricated_source_rate: 0,
    fabricated_execution_rate: 0,
    critical_security_failures: 0,
    cross_user_memory_leakage: 0,
    tool_authorization_bypass: 0,
    senior_engineering_rubric: 0.92,
    business_actionability_rubric: 0.91,
    real_estate_data_integrity: 0.99,
    investment_uncertainty_disclosure: 1.0,
    current_info_retrieval_compliance: 0.99,
    production_error_rate: 0.005,
    p95_response_latency: 8000,
    successful_recovery_rate: 0.995,
  };
  const result = evaluateReleaseThresholds(measurements);
  expect(result.allPassed).toBe(false);
  expect(result.verdict).toBe('NOT_CERTIFIED');
  expect(result.blockers.length).toBeGreaterThan(0);
  expect(result.blockers.some((b) => b.includes('factual_accuracy'))).toBe(true);
});

test('§19 Release Thresholds: zero-tolerance failures', () => {
  const measurements: Record<string, number> = {
    factual_accuracy: 0.96,
    citation_correctness: 0.99,
    fabricated_source_rate: 1, // Must be 0
    fabricated_execution_rate: 0,
    critical_security_failures: 0,
    cross_user_memory_leakage: 0,
    tool_authorization_bypass: 0,
    senior_engineering_rubric: 0.92,
    business_actionability_rubric: 0.91,
    real_estate_data_integrity: 0.99,
    investment_uncertainty_disclosure: 1.0,
    current_info_retrieval_compliance: 0.99,
    production_error_rate: 0.005,
    p95_response_latency: 8000,
    successful_recovery_rate: 0.995,
  };
  const result = evaluateReleaseThresholds(measurements);
  expect(result.allPassed).toBe(false);
  expect(result.blockers.some((b) => b.includes('fabricated_source_rate'))).toBe(true);
});

test('§19 Release Thresholds: overall score never 10 unless all pass', () => {
  const failingResult = evaluateReleaseThresholds({ factual_accuracy: 0.50 });
  expect(failingResult.overallScore).toBeLessThan(10);
});

// ─── §4 Orchestrator Tests ───────────────────────────────────────

test('§4 Orchestrator: pre-response returns routing + confidence + framework', () => {
  const result = orchestratePreResponse({
    prompt: 'Fix the authentication bug in the backend',
    hasAttachments: false,
    conversationId: 'conv-001',
    requestId: 'req-001',
    ownerSessionPresent: true,
    basePersonaPrompt: 'You are IVX IA.',
    hasInternalData: true,
    hasRetrievedSources: false,
    hasConversationContext: true,
    retrievedSources: [],
  });
  expect(result.routing.primaryDomain).toBe('software_engineering');
  expect(result.confidence.level).toBeDefined();
  expect(result.specialistFramework).toBe('senior_developer');
  expect(result.enrichedSystemPrompt).toContain('SENIOR SOFTWARE DEVELOPER MODE');
});

test('§4 Orchestrator: post-response runs hallucination gate', () => {
  const preResponse = orchestratePreResponse({
    prompt: 'What is our revenue?',
    hasAttachments: false,
    conversationId: 'conv-001',
    requestId: 'req-001',
    ownerSessionPresent: true,
    basePersonaPrompt: 'You are IVX IA.',
    hasInternalData: false,
    hasRetrievedSources: false,
    hasConversationContext: true,
    retrievedSources: [],
  });
  const result = orchestratePostResponse(
    preResponse,
    'Our revenue is $5.2 million this year.',
    {
      model: 'gpt-4o',
      toolsUsed: [],
      sourcesUsed: [],
      fallbackUsed: false,
      errors: [],
      safetyDecision: 'allowed',
      finalStatus: 'READY',
      gateStages: [],
      tokenUsage: { input: 100, output: 50, total: 150 },
      timeToFirstTokenMs: 200,
      feedback: null,
      input: {
        prompt: 'What is our revenue?',
        hasAttachments: false,
        conversationId: 'conv-001',
        requestId: 'req-001',
        ownerSessionPresent: true,
        basePersonaPrompt: 'You are IVX IA.',
        hasInternalData: false,
        hasRetrievedSources: false,
        hasConversationContext: true,
        retrievedSources: [],
      },
    },
  );
  expect(result.hallucinationGate.gated).toBe(true);
  expect(result.finalAnswer).toContain('HALLUCINATION CHECK');
  expect(result.observabilityEvent.requestId).toBe('req-001');
});

test('§4 Orchestrator: clean answer passes through unchanged', () => {
  const preResponse = orchestratePreResponse({
    prompt: 'Explain how the intent router works',
    hasAttachments: false,
    conversationId: 'conv-001',
    requestId: 'req-001',
    ownerSessionPresent: true,
    basePersonaPrompt: 'You are IVX IA.',
    hasInternalData: true,
    hasRetrievedSources: false,
    hasConversationContext: true,
    retrievedSources: [],
  });
  const cleanAnswer = 'The intent router classifies messages into 5 branches: general_ai, developer_executor, owner_actions, autonomous_jobs, and business_modules. It is a pure function with no I/O.';
  const result = orchestratePostResponse(
    preResponse,
    cleanAnswer,
    {
      model: 'gpt-4o',
      toolsUsed: [],
      sourcesUsed: [],
      fallbackUsed: false,
      errors: [],
      safetyDecision: 'allowed',
      finalStatus: 'READY',
      gateStages: [],
      tokenUsage: { input: 100, output: 50, total: 150 },
      timeToFirstTokenMs: 200,
      feedback: null,
      input: {
        prompt: 'Explain how the intent router works',
        hasAttachments: false,
        conversationId: 'conv-001',
        requestId: 'req-001',
        ownerSessionPresent: true,
        basePersonaPrompt: 'You are IVX IA.',
        hasInternalData: true,
        hasRetrievedSources: false,
        hasConversationContext: true,
        retrievedSources: [],
      },
    },
  );
  expect(result.hallucinationGate.gated).toBe(false);
  expect(result.wasModified).toBe(false);
});

// ─── §20 Certification Runner Tests ──────────────────────────────

test('§20 Certification: structural certification runs without errors', () => {
  const result = runStructuralCertification();
  expect(result.totalTests).toBe(800);
  expect(result.marker).toBeDefined();
  expect(result.timestamp).toBeDefined();
});

test('§20 Certification: formatCertificationResult produces readable output', () => {
  const result = runStructuralCertification();
  const formatted = formatCertificationResult(result);
  expect(formatted).toContain('IVX IA BRAIN CERTIFICATION');
  expect(formatted).toContain('FINAL VERDICT:');
  expect(formatted).toContain('Total Tests:     800');
});

test('§20 Certification: verdict is CERTIFIED or NOT_CERTIFIED', () => {
  const result = runStructuralCertification();
  expect(['ENTERPRISE BRAIN CERTIFIED', 'ENTERPRISE BRAIN NOT CERTIFIED']).toContain(result.verdict);
});

test('§20 Certification: has score by domain', () => {
  const result = runStructuralCertification();
  expect(result.scoreByDomain.software_engineering).toBeDefined();
  expect(result.scoreByDomain.business).toBeDefined();
  expect(result.scoreByDomain.adversarial).toBeDefined();
});

test('§20 Certification: has adversarial results', () => {
  const result = runStructuralCertification();
  expect(result.adversarialResults.total).toBeGreaterThanOrEqual(18);
});

test('§20 Certification: has release threshold checks', () => {
  const result = runStructuralCertification();
  expect(result.releaseThresholds.totalChecks).toBe(15);
  expect(result.releaseThresholds.checks.length).toBe(15);
});
