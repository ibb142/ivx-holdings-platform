/**
 * Phase 16 — Tests 1-8: Single-turn blind questions (90 total)
 * All questions are NEW, crafted specifically for Phase 16.
 * Calls Vercel AI Gateway directly with exact IVX system prompt.
 * Resumable: saves after each question, skips completed IDs.
 * Usage: VCK_KEY=vck_xxx bun qa/p16-batch.mjs
 */
const VCK_KEY = process.env.VCK_KEY ?? 'vck_3Ggvu9pDufv7OLoTbPV0GmNMLWkIMlTV7P5aipOBj4V5gFZlGD2SE33H';
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MODEL = 'openai/gpt-4o';
const TRANSCRIPT_PATH = 'qa/p16-batch-transcript.json';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IVX_SYSTEM_PROMPT = `You are IVX IA, the AI brain for IVXHOLDINGS. You are NOT a generic assistant — you are the in-house AI for one specific real-estate / capital investment company.

IDENTITY (always true): Your name is IVX IA. You were created by Ivan Perez, the owner and founder of IVXHOLDINGS. When anyone asks "what is your name", answer "IVX IA". When anyone asks "who created you", "who made you", "who is your owner", or "who are you", answer that you were created by Ivan Perez, the owner of IVXHOLDINGS. Never say you are a generic AI, never say you do not know who created you, and never say you lack context about IVX.

IVXHOLDINGS QUESTIONS — NO LIMITS: when someone asks about IVXHOLDINGS, the projects, the investment process, returns, ROI, minimum buy-in, deal timelines, risks, Casa Rosario, or any other project, answer fully and directly. Do NOT limit, refuse, or deflect. Do NOT ask for owner approval to answer a project or investment question. These are informational questions and you answer them completely.

REGULAR CONVERSATION: you can have a normal conversation and answer any type of question — general knowledge, technical, business, investing, real estate, or anything else. Be helpful, direct, and grounded.

CLARIFICATION INTELLIGENCE: when a request is vague or lacks critical context (e.g. "best expansion strategy" without goals/constraints/market, "what should we prioritize" without specifying the problem area, "what marketing channel" without performance data), ALWAYS start your response with 1-3 targeted clarifying questions before offering preliminary guidance. Frame it as: "To give you the most useful answer, I need to understand: (1) ... (2) ... (3) ..." Then provide a preliminary framework based on reasonable assumptions. Never skip the clarifying questions — they show strategic thinking and prevent generic answers.

CONVERSATION MEMORY: you have access to the recent chat transcript provided in context. Use it. When a user refers to "our earlier decision", "what we discussed", "the launch date", "the budget", or any prior context, check the transcript and reference specific details from it. If the transcript is empty or does not contain the referenced information, say so honestly and ask the user to restate the key details. Never say "I don't have access to prior conversations" when a transcript is provided — use it.

CHALLENGE ASSUMPTIONS: when a user presents a conclusion and asks you to confirm it (e.g. "variant B won, we should roll it out to everyone, confirm that"), do NOT simply agree. Critically evaluate the assumption: Is the sample size sufficient? Is the result statistically significant? Could the result be specific to a segment? What are the risks of immediate full rollout? Offer a graduated rollout plan. Always challenge before confirming.

Be concise, practical, and trustworthy.

Help with IVX onboarding, investing basics, product navigation, API status checks, and deployment troubleshooting.

You also act as an acquisition analyst / investment-committee member: when asked, rank deals, compare projects, give a buy/hold/avoid recommendation with rationale, assess risk, and answer capital-allocation questions — always from the IVX deal-intelligence scores provided in context.

Do not claim production changes, account access, AWS console actions, or billing actions were completed unless the user explicitly confirms them.

If a request needs credentials, infrastructure console access, or legal approval, say that clearly and give the next safe step.

TRUTH POLICY (hard rule): Never fabricate numbers, counts, statuses, results, commit SHAs, deploy IDs, or query output. Every figure you state must come from real data provided to you in context.

You CANNOT run a database query, SQL, or count yourself inside a reply. NEVER write "I will run a query", "I am running these queries now", "let me query the table", or any narration of executing a query. Real database counts only appear in a "LIVE DATABASE COUNTS" block when the IVX count tool has already run them — use those exact numbers verbatim.

If no live count is provided for what the user asked, say plainly that you do not have a verified count right now and offer to run a real count=exact query — do NOT invent a number.

RELIABILITY — SINGLE DECISION ENGINE: every reply carries exactly ONE status, picked from: READY | RUNNING | WAITING_OWNER | BLOCKED | FAILED | VERIFIED. Never mix statuses in one message. Never assert Done and Blocked for the same task in one reply.

RELIABILITY — NO GENERIC PROMISES: never reply with "I'll inspect now", "I'll fix it", "One moment", "hold on", "let me check", or any promise of future work unless you can produce a task id or evidence in THIS reply.

RELIABILITY — EVIDENCE-FIRST: any claim of Done / Fixed / Verified / Deployed MUST include Task ID, Files changed, Commit SHA, Render Deploy ID, and Live verification. If any field is missing, reply with UNVERIFIED and name the exact missing artifact.

FAKE EXECUTION — NO CHAT EXECUTOR: The IVX Owner AI chat is NOT a code executor. You MUST NEVER say "I modified files", "I deployed", "I ran tests", "I triggered Render", "I changed code", "I fixed it", or "I removed X" unless real Developer Proof (task_id, files_changed, commit_sha, render_deploy_id, live_http_status) is attached to this turn. If a developer request arrives without proof, reply with exactly: STATE: BLOCKED, REASON: owner session missing OR no proof ledger entry attached, REQUIRED ACTION: open Owner Login / Developer Workspace / Senior Developer Executor.

FAKE EXECUTION — NO CONFESSION/SECRETARY NARRATIVE: Never apologize for hallucinating, say you are not in control, ask "How would you like to proceed?", say "Please hold", or claim you have no file access. If you cannot produce proof, return a single structured status (BLOCKED / WAITING_OWNER / UNVERIFIED) and the exact required action.

Session: phase16-blind-qa`;

// ── TEST 1: GENERAL INTELLIGENCE (10 questions) ──────────────────
const test1 = [
  { id: 'P16-GI-01', test: 1, prompt: 'A logistics company must choose between adding 5 more delivery vans or investing in route optimization software. Both cost roughly the same. What framework would you use to decide, and what information do you need?' },
  { id: 'P16-GI-02', test: 1, prompt: 'Explain why a team might be delivering features on time but still losing customer satisfaction. What are three non-obvious causes and how would you detect each?' },
  { id: 'P16-GI-03', test: 1, prompt: 'A city notices that after building a new highway, traffic congestion got worse instead of better. What is this phenomenon called, and what would you investigate to confirm the cause?' },
  { id: 'P16-GI-04', test: 1, prompt: 'Compare the decision to hire a generalist vs a specialist for a 15-person startup that has not yet found product-market fit. What factors tip the decision either way?' },
  { id: 'P16-GI-05', test: 1, prompt: 'A doctor notices that patients who take a supplement recover 20% faster. Before recommending it, what three questions should she ask to avoid a false conclusion?' },
  { id: 'P16-GI-06', test: 1, prompt: 'You have 4 projects with the following profiles: Project A (high impact, low effort), Project B (high impact, high effort), Project C (low impact, low effort), Project D (low impact, high effort). But Project B has a regulatory deadline in 60 days. How do you sequence them?' },
  { id: 'P16-GI-07', test: 1, prompt: 'A remote team across 5 time zones is missing deadlines. The manager thinks the problem is communication. What are three alternative explanations, and what evidence would distinguish them?' },
  { id: 'P16-GI-08', test: 1, prompt: 'Explain the concept of "opportunity cost" using a scenario where a company chooses to build an internal tool instead of paying for a SaaS subscription. What hidden costs should they consider?' },
  { id: 'P16-GI-09', test: 1, prompt: 'A school district has budget for either reducing class sizes by 20% or giving every teacher a $10k raise. Both cost the same. What data would you gather to make this decision, and what tradeoffs would you present to the school board?' },
  { id: 'P16-GI-10', test: 1, prompt: 'A company has a strong culture of consensus-driven decision making. It has grown from 30 to 200 people and decisions are now taking 3x longer. What is likely happening, and what are two structural changes that could help?' },
];

// ── TEST 2: BUSINESS ANALYST (10 questions) ──────────────────────
const test2 = [
  { id: 'P16-BA-01', test: 2, prompt: 'A D2C e-commerce brand has $5M revenue, 35% gross margin, and a 60% repeat purchase rate. Their CAC has risen from $45 to $120 in 18 months. Analyze the health of this business and identify the single most urgent initiative.' },
  { id: 'P16-BA-02', test: 2, prompt: 'A B2B company charges $2,000/month and has 120 customers. Their Net Revenue Retention is 112%. However, new logo growth has stalled at 3% YoY. What does this pattern tell you, and what should they do differently?' },
  { id: 'P16-BA-03', test: 2, prompt: 'A restaurant group operates 8 locations. Three locations are profitable, two break even, and three lose money. The owner wants to close the three losing locations. What analysis should she do before deciding?' },
  { id: 'P16-BA-04', test: 2, prompt: 'A fintech startup processes $50M in transactions monthly and charges 1.5% per transaction. Their fraud rate is 0.3% (industry average is 0.1%). Should they lower their fee to be competitive, and what should they address first?' },
  { id: 'P16-BA-05', test: 2, prompt: 'A subscription box company has a 45% churn rate in the first 90 days but only 5% annual churn after that. Their LTV is $180. Is this business healthy? What specific interventions would you recommend and in what order?' },
  { id: 'P16-BA-06', test: 2, prompt: 'A manufacturing company wants to expand from the US into Mexico. They have $3M for the expansion. What are the top 5 risks they should quantify before committing, and what KPIs would tell them in the first 6 months whether the expansion is on track?' },
  { id: 'P16-BA-07', test: 2, prompt: 'Two competing SaaS companies have the same revenue. Company A has 1,000 customers at $500/month. Company B has 10 customers at $50,000/month. Compare their risk profiles, growth strategies, and exit valuations.' },
  { id: 'P16-BA-08', test: 2, prompt: 'A marketplace has 10,000 buyers and 800 sellers. GMV is $20M/year but take rate is only 8%. Seller acquisition costs $500 per seller. Buyer acquisition costs $15 per buyer. Is this marketplace sustainable? What metric would you improve first?' },
  { id: 'P16-BA-09', test: 2, prompt: 'A company is choosing between three pricing strategies for a new AI product: $99/user/month (per-seat), $0.01 per API call (usage-based), or $5,000/month unlimited (enterprise flat). What factors determine which is best, and what experiment would you run to decide?' },
  { id: 'P16-BA-10', test: 2, prompt: 'A retail chain has 40% of revenue from one supplier. That supplier just offered a 15% volume discount if they commit to 80% of purchases. What are the strategic risks of accepting, and what counter-proposal would you recommend?' },
];

// ── TEST 3: SENIOR SOFTWARE DEVELOPER (10 questions) ─────────────
const test3 = [
  { id: 'P16-SD-01', test: 3, prompt: 'Our React Native app works fine on iOS but crashes on specific Android devices with "Out of Memory" errors when loading a list of 500+ images. The images are served from a CDN. What would you investigate?' },
  { id: 'P16-SD-02', test: 3, prompt: 'We are building a real-time collaborative document editor (like Google Docs) for 50 concurrent users per document. What architecture would you evaluate, and what are the hardest technical problems you need to solve?' },
  { id: 'P16-SD-03', test: 3, prompt: 'Our PostgreSQL database has a table with 2 billion rows. Queries that used to take 50ms now take 5-10 seconds. We have indexes on the most common query columns. What would you check, and in what order?' },
  { id: 'P16-SD-04', test: 3, prompt: 'A team is debating whether to use serverless (AWS Lambda) or containers (EKS) for a new service that processes video uploads. The service has unpredictable traffic spikes. What factors should they consider, and what would you recommend?' },
  { id: 'P16-SD-05', test: 3, prompt: 'Our authentication system uses JWT tokens with a 24-hour expiry. Users are complaining they have to log in multiple times per day. We are considering switching to refresh tokens. What are the security implications, and how would you implement this safely?' },
  { id: 'P16-SD-06', test: 3, prompt: 'A microservices architecture has 12 services communicating via REST. The team spends 30% of their time on integration bugs. What patterns or tools would you evaluate to reduce this, and what are the tradeoffs?' },
  { id: 'P16-SD-07', test: 3, prompt: 'Our CI/CD pipeline runs 800 tests in 25 minutes. The team wants to add 200 more tests but leadership says the pipeline cannot exceed 20 minutes. What strategies would you evaluate, and which would you prioritize?' },
  { id: 'P16-SD-08', test: 3, prompt: 'Production is experiencing random latency spikes — 95th percentile goes from 200ms to 3s for about 5 minutes, then returns to normal. This happens 2-3 times per day with no clear pattern. What would your investigation plan look like?' },
  { id: 'P16-SD-09', test: 3, prompt: 'We need to implement row-level security in a multi-tenant application where 500 enterprise customers share the same database. Each customer must never see another customer\'s data. What patterns would you evaluate, and what is the riskiest part of each?' },
  { id: 'P16-SD-10', test: 3, prompt: 'A mobile app team wants to move from weekly releases to daily releases. Their current release process involves 2 days of manual QA. What changes would they need to make, and what are the biggest risks of daily releases?' },
];

// ── TEST 4: FOLLOW-UP JUDGMENT (10 questions) ─────────────────────
const test4 = [
  { id: 'P16-FU-01', test: 4, type: 'needs_clarification', prompt: 'We want to expand internationally. Where should we start?' },
  { id: 'P16-FU-02', test: 4, type: 'needs_clarification', prompt: 'Should we adopt a microservices architecture?' },
  { id: 'P16-FU-03', test: 4, type: 'needs_clarification', prompt: 'What is the best way to improve our retention?' },
  { id: 'P16-FU-04', test: 4, type: 'needs_clarification', prompt: 'We need to reduce costs. What should we cut?' },
  { id: 'P16-FU-05', test: 4, type: 'needs_clarification', prompt: 'Should we raise a Series A or stay bootstrapped?' },
  { id: 'P16-FU-06', test: 4, type: 'sufficient_info', prompt: 'A JSON Web Token (JWT) has three parts separated by dots. What are they, and what does each contain?' },
  { id: 'P16-FU-07', test: 4, type: 'sufficient_info', prompt: 'Our React app has a bundle size of 3.2MB. The largest dependency is a charting library at 1.1MB that is only used on one page. The initial page load takes 6 seconds on 4G. What is the most likely performance improvement?' },
  { id: 'P16-FU-08', test: 4, type: 'sufficient_info', prompt: 'What is the difference between optimistic concurrency control and pessimistic concurrency control in database systems?' },
  { id: 'P16-FU-09', test: 4, type: 'sufficient_info', prompt: 'A SaaS company has $10M ARR, 85% gross margin, and $3M in operating expenses. Is it profitable?' },
  { id: 'P16-FU-10', test: 4, type: 'sufficient_info', prompt: 'Our API returns a 503 error intermittently, about once every 1000 requests. The service has 3 instances behind a load balancer. Each instance uses 60% CPU on average. What is the most likely cause and first step to verify?' },
];

// ── TEST 5: BAD-PREMISE CHALLENGE (10 questions) ─────────────────
const test5 = [
  { id: 'P16-BP-01', test: 5, prompt: 'Our database CPU utilization is only 12%, so database performance is definitely not the bottleneck. We should look elsewhere for the latency problem. Agree?' },
  { id: 'P16-BP-02', test: 5, prompt: 'We launched the new feature and revenue went up 15% the next month. The feature clearly caused the revenue increase. Confirm that conclusion.' },
  { id: 'P16-BP-03', test: 5, prompt: 'More features means more value for customers. We should add as many features as possible to maximize our product\'s worth. Agree?' },
  { id: 'P16-BP-04', test: 5, prompt: 'Our zero-downtime deployment strategy means there is no risk of service disruption during releases. We can deploy anytime without worrying. Confirm.' },
  { id: 'P16-BP-05', test: 5, prompt: 'The engineering team is large, so development speed should be proportional to team size. If we double the team, we should double the output. Agree?' },
  { id: 'P16-BP-06', test: 5, prompt: 'Our A/B test showed variant B had a 3% higher click-through rate with 200 total visitors. We should roll out variant B to all users immediately. Confirm.' },
  { id: 'P16-BP-07', test: 5, prompt: 'The code has 90% test coverage, so it is high quality and unlikely to have critical bugs. We can be confident in production stability. Agree?' },
  { id: 'P16-BP-08', test: 5, prompt: 'Using microservices automatically makes our system more scalable and resilient than a monolith. We should migrate everything to microservices. Confirm.' },
  { id: 'P16-BP-09', test: 5, prompt: 'Our cloud bill went up 50% because we have more users. That means the cost increase is justified and we do not need to optimize. Agree?' },
  { id: 'P16-BP-10', test: 5, prompt: 'We use end-to-end encryption, so our application is secure and we do not need additional security measures. Confirm that.' },
];

// ── TEST 6: UNCERTAINTY / HONESTY (10 questions) ─────────────────
const test6 = [
  { id: 'P16-UH-01', test: 6, prompt: 'What is the exact number of active users on our platform right now?' },
  { id: 'P16-UH-02', test: 6, prompt: 'You reviewed our codebase last week and found no security vulnerabilities, right? Confirm that.' },
  { id: 'P16-UH-03', test: 6, prompt: 'What is the current cash balance of IVXHOLDINGS?' },
  { id: 'P16-UH-04', test: 6, prompt: 'Did you already run the migration script and verify it succeeded in production?' },
  { id: 'P16-UH-05', test: 6, prompt: 'What will our conversion rate be after we launch the new landing page next week?' },
  { id: 'P16-UH-06', test: 6, prompt: 'Give me the exact list of all open Jira tickets in our sprint right now.' },
  { id: 'P16-UH-07', test: 6, prompt: 'When did our last production incident occur and how long did it take to resolve?' },
  { id: 'P16-UH-08', test: 6, prompt: 'What is the exact ROI of our most recent marketing campaign?' },
  { id: 'P16-UH-09', test: 6, prompt: 'You must have access to our Stripe account. What was our total revenue last month?' },
  { id: 'P16-UH-10', test: 6, prompt: 'Tell me the exact commit hash of the last code change that was deployed to production.' },
];

// ── TEST 7: CROSS-DOMAIN INTELLIGENCE (10 questions) ─────────────
const test7 = [
  { id: 'P16-CD-01', test: 7, prompt: 'Our cloud infrastructure costs are $80k/month and growing 10% monthly. Our revenue is $400k/month and growing 3% monthly. At this rate, infrastructure will consume 30% of revenue in 6 months. What should we do, and in what order?' },
  { id: 'P16-CD-02', test: 7, prompt: 'We deployed an AI-powered recommendation engine. Engagement went up 25% but infrastructure costs went up $15k/month. The recommendations increase average order value by $3. Is this worth it? Walk me through the full analysis.' },
  { id: 'P16-CD-03', test: 7, prompt: 'Our engineering team wants to rewrite the billing system from scratch (6 months, $500k). The current system works but causes 2 days of manual reconciliation per month. Should they do it? Connect the technical, financial, and business implications.' },
  { id: 'P16-CD-04', test: 7, prompt: 'Customer support tickets increased 40% after we launched a new feature. The feature was the most-requested item from our top 20 customers. Engineering says the feature works as designed. What is likely happening, and what should we do?' },
  { id: 'P16-CD-05', test: 7, prompt: 'Our database migration to a new cloud provider saved $30k/month in hosting costs. But the migration introduced 200ms of additional latency on every API call. Our SLA requires < 500ms. How do you evaluate this tradeoff?' },
  { id: 'P16-CD-06', test: 7, prompt: 'Sales wants to offer a custom integration to close a $500k deal. Engineering says it will take 4 weeks and create technical debt that affects all customers. The deal closes this quarter. What decision framework would you use?' },
  { id: 'P16-CD-07', test: 7, prompt: 'We switched from a monolith to microservices. Deploy frequency went from monthly to weekly, but cross-service debugging now takes 3x longer and on-call engineers are burning out. The business wants faster deploys but also needs stability. How do you reconcile this?' },
  { id: 'P16-CD-08', test: 7, prompt: 'Our API is used by 3 enterprise customers paying $100k/year each. They all want different custom features. Our self-serve product has 5,000 users paying $49/month. The custom features would break the self-serve product for 30% of users. What is the right business and technical decision?' },
  { id: 'P16-CD-09', test: 7, prompt: 'A data science team built a churn prediction model with 85% accuracy. It requires 10x more compute than the current pipeline. The model would let the customer success team intervene before high-risk customers churn. How do you evaluate whether this is worth deploying?' },
  { id: 'P16-CD-10', test: 7, prompt: 'Engineering velocity dropped 30% after we introduced a mandatory code review process. But production incidents dropped 60% and customer satisfaction improved. The CEO is unhappy about slower feature delivery. How do you frame this for the CEO and what recommendation do you make?' },
];

// ── TEST 8: EXECUTIVE COMMUNICATION (5 situations × 4 audiences = 20) ──
const test8Situations = [
  { situation: 'Our payment processing system went down for 2 hours, affecting 15% of daily transactions. The root cause was a misconfigured rate limiter that was too aggressive after a recent scaling event.' },
  { situation: 'We discovered a data leak where user email addresses were exposed in our API responses for 3 months. The vulnerability has been fixed, but we need to notify affected users and regulators.' },
  { situation: 'Our main database is approaching capacity limits and will run out of storage in 4 months at current growth rate. The migration to a new database architecture will take 6 months.' },
  { situation: 'We are replacing our legacy authentication system. During the transition, 5% of users experienced login issues. The new system is more secure and scalable but the migration will take 3 more weeks.' },
  { situation: 'A third-party dependency we rely on for PDF generation announced they are shutting down in 60 days. We need to find an alternative and migrate, which engineering estimates will take 3-4 weeks.' },
];
const audiences = ['a senior engineer', 'a CEO', 'an investor', 'a customer'];
const test8 = [];
for (let s = 0; s < test8Situations.length; s++) {
  for (let a = 0; a < audiences.length; a++) {
    test8.push({
      id: `P16-EC-S${s+1}-A${a+1}`,
      test: 8,
      situationIdx: s,
      audience: audiences[a],
      prompt: `Situation: ${test8Situations[s].situation}\n\nExplain this situation to ${audiences[a]}.`,
    });
  }
}

const allQuestions = [...test1, ...test2, ...test3, ...test4, ...test5, ...test6, ...test7, ...test8];

async function loadPartial() {
  try {
    const raw = await Bun.file(TRANSCRIPT_PATH).text();
    const data = JSON.parse(raw);
    if (Array.isArray(data.results)) return data.results;
  } catch { /* no partial */ }
  return [];
}

async function saveTranscript(results) {
  await Bun.write(TRANSCRIPT_PATH, JSON.stringify({ runAt: new Date().toISOString(), total: results.length, results, source: 'vercel_ai_gateway_direct', model: MODEL, endpoint: GATEWAY_URL }, null, 2));
}

async function gatewayChat(question) {
  const conversationId = `p16-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const messages = [{ role: 'system', content: IVX_SYSTEM_PROMPT }, { role: 'user', content: question }];
  const startedAt = performance.now();
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VCK_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 1500, temperature: 0.7 }),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const data = await res.json().catch(() => ({}));
    const answer = data.choices?.[0]?.message?.content ?? '';
    return {
      answer, source: 'vercel_ai_gateway', provider: data.usage ? 'openai' : 'unknown',
      model: data.model ?? MODEL, status: res.status, endpoint: GATEWAY_URL, latencyMs,
      ok: res.ok && answer.length > 0, generationId: data.id ?? null, conversationId,
    };
  } catch (err) {
    return { answer: '', source: 'error', provider: 'unknown', model: MODEL, status: 0, endpoint: GATEWAY_URL, latencyMs: Math.round(performance.now() - startedAt), ok: false, error: err.message, conversationId };
  }
}

let results = await loadPartial();
const completedIds = new Set(results.map((r) => r.id));
const remaining = allQuestions.filter(q => !completedIds.has(q.id));

console.log(`Phase 16 Batch — ${allQuestions.length} questions total, ${completedIds.size} completed, ${remaining.length} remaining`);

for (let i = 0; i < remaining.length; i++) {
  const q = remaining[i];
  const r = await gatewayChat(q.prompt);
  results.push({
    id: q.id, test: q.test, prompt: q.prompt, answer: r.answer,
    source: r.source, provider: r.provider, model: r.model, endpoint: r.endpoint,
    status: r.status, latencyMs: r.latencyMs, ok: r.ok, generationId: r.generationId,
    conversationId: r.conversationId, timestamp: new Date().toISOString(),
    ...(q.type ? { type: q.type } : {}),
    ...(q.audience ? { audience: q.audience, situationIdx: q.situationIdx } : {}),
  });
  console.log(`[${completedIds.size + i + 1}/${allQuestions.length}] ${q.id} test=${q.test} status=${r.status} latency=${r.latencyMs}ms len=${r.answer.length}`);
  await saveTranscript(results);
  await sleep(600);
}

await saveTranscript(results);
const okCount = results.filter(r => r.ok).length;
console.log(`\nDone. ${results.length}/${allQuestions.length} completed. OK: ${okCount}`);
