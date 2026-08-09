/**
 * Phase 16 — Test 10: Dynamic reasoning (5 conversations × 4 turns each)
 * Each conversation starts with a problem, then introduces 3 pieces of new
 * evidence that change the situation. Tests whether IVX updates its reasoning.
 * Usage: VCK_KEY=vck_xxx bun qa/p16-dynamic.mjs <conv_index> [output_file]
 */
const VCK_KEY = process.env.VCK_KEY ?? 'vck_3Ggvu9pDufv7OLoTbPV0GmNMLWkIMlTV7P5aipOBj4V5gFZlGD2SE33H';
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MODEL = 'openai/gpt-4o';
const convIdx = parseInt(process.argv[2] ?? '0');
const outputFile = process.argv[3] ?? `qa/p16-dr-${convIdx}.json`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IVX_SYSTEM_PROMPT = `You are IVX IA, the AI brain for IVXHOLDINGS. You are NOT a generic assistant — you are the in-house AI for one specific real-estate / capital investment company.

IDENTITY (always true): Your name is IVX IA. You were created by Ivan Perez, the owner and founder of IVXHOLDINGS. When anyone asks "what is your name", answer "IVX IA". When anyone asks "who created you", "who made you", "who is your owner", or "who are you", answer that you were created by Ivan Perez, the owner of IVXHOLDINGS.

REGULAR CONVERSATION: you can have a normal conversation and answer any type of question — general knowledge, technical, business, investing, real estate, or anything else. Be helpful, direct, and grounded.

CLARIFICATION INTELLIGENCE: when a request is vague or lacks critical context, ALWAYS start your response with 1-3 targeted clarifying questions before offering preliminary guidance. Frame it as: "To give you the most useful answer, I need to understand: (1) ... (2) ... (3) ..." Then provide a preliminary framework based on reasonable assumptions.

CONVERSATION MEMORY: you have access to the recent chat transcript provided in context. Use it. When a user refers to prior context, check the transcript and reference specific details from it.

CHALLENGE ASSUMPTIONS: when a user presents a conclusion and asks you to confirm it, do NOT simply agree. Critically evaluate the assumption and offer a graduated rollout plan. Always challenge before confirming.

Be concise, practical, and trustworthy. Do not claim production changes, account access, or billing actions were completed unless the user explicitly confirms them.

TRUTH POLICY (hard rule): Never fabricate numbers, counts, statuses, results, commit SHAs, deploy IDs, or query output. Every figure you state must come from real data provided to you in context.

RELIABILITY — SINGLE DECISION ENGINE: every reply carries exactly ONE status, picked from: READY | RUNNING | WAITING_OWNER | BLOCKED | FAILED | VERIFIED.

RELIABILITY — NO GENERIC PROMISES: never reply with "I'll inspect now", "I'll fix it", "One moment", "hold on", or any promise of future work unless you can produce evidence in THIS reply.

FAKE EXECUTION — NO CHAT EXECUTOR: You MUST NEVER say "I modified files", "I deployed", "I ran tests", or "I fixed it" unless real Developer Proof is attached to this turn. If a developer request arrives without proof, reply with: STATE: BLOCKED, REASON: owner session missing OR no proof ledger entry attached.

Session: phase16-dynamic-reasoning`;

const conversations = [
  { id: 'P16-DR-1', description: 'API latency optimization — initial diagnosis, then 3 evidence changes', turns: [
    'Our API response time increased from 200ms to 800ms over the last month. We have not changed any code. What is your initial diagnosis and recommendation?',
    'New evidence: We just discovered that our database grew from 10GB to 50GB in the same period. The growth is in one table that stores user activity logs. Does this change your diagnosis?',
    'New evidence: We also found that the slow queries all involve a full-text search on that activity log table. The search uses a LIKE query with leading wildcards. No full-text index exists. Update your recommendation.',
    'Final evidence: We discovered that a logging library was accidentally set to DEBUG level in production 5 weeks ago, causing 10x more activity log inserts than normal. After fixing the log level, the table is still 50GB. What is your final recommendation?',
  ]},
  { id: 'P16-DR-2', description: 'Revenue decline analysis — market, product, then competitive shift', turns: [
    'Our revenue dropped 12% last quarter after 3 years of consistent 8% quarterly growth. We have not changed pricing or product. What is your initial analysis?',
    'New evidence: Our customer satisfaction scores actually went UP from 45 to 55 NPS. Our churn rate stayed at 3%. How does this change the analysis?',
    'New evidence: We discovered that our average contract value dropped from $50k to $38k. The number of customers stayed the same. New customers are signing smaller deals. Update your analysis.',
    'Final evidence: A new competitor entered the market 6 months ago with a similar product at 40% lower price. Our sales team has been offering discounts to close deals. What is your final recommendation?',
  ]},
  { id: 'P16-DR-3', description: 'Infrastructure scaling — initial plan, then changing constraints', turns: [
    'We need to scale our web application from 10,000 daily users to 100,000 daily users in 6 months. Current architecture: single PostgreSQL database, 2 web servers behind a load balancer, no caching layer. What is your scaling plan?',
    'New evidence: Our database already runs at 70% CPU during peak hours at 10,000 users. Read-to-write ratio is 20:1. Does this change your scaling plan?',
    'New evidence: Our traffic is extremely spiky — 60% of daily traffic comes in a 2-hour window. The current servers handle 500 concurrent connections max. Update your plan.',
    'Final evidence: The engineering team has 4 developers and no DevOps engineer. The budget for infrastructure is $15k/month (currently $4k/month). What is your final, realistic scaling plan?',
  ]},
  { id: 'P16-DR-4', description: 'Customer retention crisis — symptoms, root cause shifts, final picture', turns: [
    'Our 90-day customer retention dropped from 85% to 65% over the last 2 quarters. We have not changed the onboarding flow. What is your initial analysis of likely causes?',
    'New evidence: The retention drop is concentrated in customers acquired through paid search. Organic and referral channels have stable 88% retention. How does this change your analysis?',
    'New evidence: We changed our paid search ad copy 2 quarters ago to emphasize "free trial" instead of "enterprise-grade". Conversion went up 40% but the new customers have lower feature adoption. Update your analysis.',
    'Final evidence: The customers acquired through the new ad copy have a 20% lower rate of completing the onboarding wizard. Only 30% use the core feature within the first week, vs 75% for organic customers. What is your final recommendation?',
  ]},
  { id: 'P16-DR-5', description: 'Build vs buy decision — initial, then changing financial and technical evidence', turns: [
    'We need a customer data platform (CDP). Building it internally would take 6 months and cost $300k. Buying a SaaS solution costs $8k/month. Our revenue is $4M/year. What is your initial recommendation?',
    'New evidence: We have 3 engineers who could build it, but they are also responsible for our core product. Taking them off core product work would delay our next major release by 2 months, which is worth an estimated $200k in delayed revenue. Update your analysis.',
    'New evidence: The SaaS solution we evaluated requires data to flow through their servers. We are in a regulated industry (healthcare) and this creates a compliance risk. Building internally keeps data in our infrastructure. How does this change the recommendation?',
    'Final evidence: We found an alternative SaaS that offers HIPAA-compliant on-premise deployment at $12k/month. However, it would take 1 month to integrate vs 6 months to build. The alternative also has a 3-year contract minimum. What is your final recommendation?',
  ]},
];

const conv = conversations[convIdx];
if (!conv) { console.error(`No conversation at index ${convIdx}`); process.exit(1); }
console.log(`Running ${conv.id}: ${conv.description}`);
const history = [];
const turns = [];
const conversationId = `p16-dr-${convIdx}-${Date.now()}`;

for (let i = 0; i < conv.turns.length; i++) {
  const startedAt = performance.now();
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VCK_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: IVX_SYSTEM_PROMPT }, ...history, { role: 'user', content: conv.turns[i] }], max_tokens: 1500, temperature: 0.7 }),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const data = await res.json().catch(() => ({}));
    const answer = data.choices?.[0]?.message?.content ?? '';
    const messageId = data.id ?? null;
    turns.push({ turn: i+1, prompt: conv.turns[i], answer, source: 'vercel_ai_gateway', provider: 'openai', model: data.model ?? MODEL, endpoint: GATEWAY_URL, status: res.status, latencyMs, ok: res.ok && answer.length > 0, generationId: messageId, conversationId });
    history.push({ role: 'user', content: conv.turns[i] });
    history.push({ role: 'assistant', content: answer });
    console.log(`  [Turn ${i+1}/${conv.turns.length}] status=${res.status} latency=${latencyMs}ms len=${answer.length}`);
  } catch (err) {
    turns.push({ turn: i+1, prompt: conv.turns[i], answer: '', source: 'error', model: MODEL, endpoint: GATEWAY_URL, status: 0, latencyMs: Math.round(performance.now() - startedAt), ok: false, error: err.message, conversationId });
    console.log(`  [Turn ${i+1}] ERROR: ${err.message}`);
  }
  await sleep(500);
}

const output = { id: conv.id, description: conv.description, turns, runAt: new Date().toISOString(), conversationId };
await Bun.write(outputFile, JSON.stringify(output, null, 2));
console.log(`Saved to ${outputFile}`);
