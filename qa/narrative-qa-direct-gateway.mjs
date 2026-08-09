/**
 * IVX IA Narrative QA Battery — Direct Vercel AI Gateway
 * Runs all 80 questions against the Vercel AI Gateway with the exact IVX system prompt,
 * producing real LLM responses for 11-dimension rubric evaluation.
 * Usage: VCK_KEY=vck_xxx node qa/narrative-qa-direct-gateway.mjs
 */
const VCK_KEY = process.env.VCK_KEY ?? '';
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MODEL = 'openai/gpt-4o';
const TRANSCRIPT_PATH = 'qa/narrative-qa-transcript-gateway.json';

if (!VCK_KEY) {
  console.error('ERROR: VCK_KEY env var is required (the vck_ key).');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exact IVX system prompt extracted from backend/public-chat-ai.ts buildSystemPrompt()
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

Session: narrative-qa-direct-gateway`;

// Conversation context for CM-02/03/04 (follows CM-01)
const CONTEXT_HISTORY = {
  'CM-02': [
    { role: 'user', content: 'We are planning a product launch. Budget is $500k, timeline is 6 months, target market is mid-market US. Launch date is March 1. What should I know before committing to that date?' },
    { role: 'assistant', content: 'Before committing to March 1, consider: (1) Holiday season impact — December through early January reduces team productivity and partner availability. (2) Competitive landscape — check if major competitors have launches planned near that date. (3) Regulatory readiness — if mid-market requires compliance certifications (SOC 2, etc.), 6 months may be tight. (4) Beta feedback cycle — you need at least 4-6 weeks for beta before public launch. (5) Budget allocation — $500k should cover development, marketing, and a contingency buffer; confirm the split. (6) Sales cycle — mid-market deals often take 3-6 months to close, so launch date affects pipeline timing.' },
  ],
  'CM-03': [
    { role: 'user', content: 'We are planning a product launch. Budget is $500k, timeline is 6 months, target market is mid-market US. Launch date is March 1. What should I know before committing to that date?' },
    { role: 'assistant', content: 'Before committing to March 1, consider: (1) Holiday season impact — December through early January reduces team productivity and partner availability. (2) Competitive landscape — check if major competitors have launches planned near that date. (3) Regulatory readiness — if mid-market requires compliance certifications (SOC 2, etc.), 6 months may be tight. (4) Beta feedback cycle — you need at least 4-6 weeks for beta before public launch. (5) Budget allocation — $500k should cover development, marketing, and a contingency buffer; confirm the split. (6) Sales cycle — mid-market deals often take 3-6 months to close, so launch date affects pipeline timing.' },
  ],
  'CM-04': [
    { role: 'user', content: 'We are planning a product launch. Budget is $500k, timeline is 6 months, target market is mid-market US. Launch date is March 1. What should I know before committing to that date?' },
    { role: 'assistant', content: 'Before committing to March 1, consider: (1) Holiday season impact — December through early January reduces team productivity and partner availability. (2) Competitive landscape — check if major competitors have launches planned near that date. (3) Regulatory readiness — if mid-market requires compliance certifications (SOC 2, etc.), 6 months may be tight. (4) Beta feedback cycle — you need at least 4-6 weeks for beta before public launch. (5) Budget allocation — $500k should cover development, marketing, and a contingency buffer; confirm the split. (6) Sales cycle — mid-market deals often take 3-6 months to close, so launch date affects pipeline timing.' },
  ],
};

// Contradiction context for CD-01
const CONTRADICTION_HISTORY = {
  'CD-01': [
    { role: 'user', content: 'Our production backend is Render.' },
    { role: 'assistant', content: 'Noted — your production backend is hosted on Render. That\'s good for quick deployments and auto-scaling.' },
  ],
};

const questions = [
  { id: 'GI-01', category: 'general_intelligence', prompt: 'I have three priorities today: an investor presentation, a production bug, and a contract review. Help me decide what to do first and explain why.' },
  { id: 'GI-02', category: 'general_intelligence', prompt: 'Explain the difference between an analogy and a metaphor, and give a real-world example where confusing them would matter.' },
  { id: 'GI-03', category: 'general_intelligence', prompt: 'A small bakery has loyal local customers but sales are flat. What are three plausible causes and how would you test each one?' },
  { id: 'GI-04', category: 'general_intelligence', prompt: 'What are the hidden costs of switching from a paper-based process to a fully digital workflow in a 50-person company?' },
  { id: 'GI-05', category: 'general_intelligence', prompt: 'Summarize the tradeoffs between buying an off-the-shelf CRM and building a lightweight custom one.' },
  { id: 'GI-06', category: 'general_intelligence', prompt: 'A friend says "electric cars are worse for the environment than gasoline cars." What should I ask before accepting or rejecting that claim?' },
  { id: 'GI-07', category: 'general_intelligence', prompt: 'How would you prioritize learning resources if you had to become competent in data analytics within 90 days while working full-time?' },
  { id: 'GI-08', category: 'general_intelligence', prompt: 'A city is considering a congestion charge for downtown driving. What groups win, lose, and what second-order effects should planners watch?' },
  { id: 'GI-09', category: 'general_intelligence', prompt: 'Describe the reasoning behind the sentence "Correlation does not imply causation" using a concrete example.' },
  { id: 'GI-10', category: 'general_intelligence', prompt: 'What should a first-time manager know about delegating work without micromanaging or abandoning accountability?' },
  { id: 'GI-11', category: 'general_intelligence', prompt: 'A project is 2 weeks behind and the team blames unclear requirements. What are three other explanations that could be equally likely?' },
  { id: 'GI-12', category: 'general_intelligence', prompt: 'How would you explain blockchain to someone who understands Google Docs shared editing but not cryptography?' },
  { id: 'GI-13', category: 'general_intelligence', prompt: 'A charity wants to maximize impact per dollar. What questions should it ask before picking a program to scale?' },
  { id: 'GI-14', category: 'general_intelligence', prompt: 'What are the pros and cons of making a product free for individuals but charging enterprises?' },
  { id: 'GI-15', category: 'general_intelligence', prompt: 'A restaurant reservation app shows a 4.7-star average. What does that number not tell you?' },
  { id: 'GI-16', category: 'general_intelligence', prompt: 'If you had to hire a designer or an engineer first for a new consumer app, what factors would change the answer?' },
  { id: 'GI-17', category: 'general_intelligence', prompt: 'A public transit line is delayed every rainy day. What might be happening, and what data would confirm it?' },
  { id: 'GI-18', category: 'general_intelligence', prompt: 'What is the strongest argument against a policy you would personally support? Pick any example and explain it fairly.' },
  { id: 'GI-19', category: 'general_intelligence', prompt: 'How do you decide whether a "growth hack" is worth the reputational risk?' },
  { id: 'GI-20', category: 'general_intelligence', prompt: 'A founder says "we have no competitors." What does that statement usually mean, and how should an investor interpret it?' },
  { id: 'GI-21', category: 'general_intelligence', prompt: 'What would make a simple to-do app worth paying a monthly subscription for?' },
  { id: 'GI-22', category: 'general_intelligence', prompt: 'Compare the risks of being early to a market versus being late to a market, with concrete examples.' },

  { id: 'BA-01', category: 'business_analysis', prompt: 'A company generates $2M annual revenue but is growing only 3%. Customer acquisition costs increased 40% while retention improved. Analyze the situation and tell me what you would investigate first.' },
  { id: 'BA-02', category: 'business_analysis', prompt: 'A SaaS company priced at $49/month per user wants to move to usage-based pricing. What risks and opportunities should the team model?' },
  { id: 'BA-03', category: 'business_analysis', prompt: 'A retail chain has 200 stores, same SKUs, but 20% of stores generate 80% of profit. What questions should leadership ask?' },
  { id: 'BA-04', category: 'business_analysis', prompt: 'An e-commerce brand wants to enter a European market. What KPIs would you track in the first 90 days?' },
  { id: 'BA-05', category: 'business_analysis', prompt: 'A company discovers that 30% of support tickets come from 5% of customers. What are the possible strategic responses?' },
  { id: 'BA-06', category: 'business_analysis', prompt: 'A venture-backed startup has 18 months of runway and is not yet default-alive. What are the realistic paths to default-alive status?' },
  { id: 'BA-07', category: 'business_analysis', prompt: 'A B2B software company is considering a 20% price increase for existing customers. What evidence should they gather first?' },
  { id: 'BA-08', category: 'business_analysis', prompt: 'A logistics firm has on-time delivery of 92% versus industry benchmark 98%. How would you structure the root-cause analysis?' },
  { id: 'BA-09', category: 'business_analysis', prompt: 'A market has two dominant incumbents and a new entrant with 10% of the market. What is the most likely winning strategy for the new entrant?' },
  { id: 'BA-10', category: 'business_analysis', prompt: 'A subscription service notices churn spikes in month 3. What cohort patterns and interventions would you examine?' },
  { id: 'BA-11', category: 'business_analysis', prompt: 'A company has strong gross margin but weak net margin. What does that tell you about its cost structure?' },
  { id: 'BA-12', category: 'business_analysis', prompt: 'An online marketplace has high buyer acquisition but low seller retention. What metrics would diagnose the imbalance?' },

  { id: 'SD-01', category: 'senior_developer', prompt: 'Our chat becomes slower as conversations get longer. What would you investigate?' },
  { id: 'SD-02', category: 'senior_developer', prompt: 'We are designing a system that needs to handle 100x traffic spikes without over-provisioning. What architectural patterns would you evaluate?' },
  { id: 'SD-03', category: 'senior_developer', prompt: 'A mobile app crashes most often on low-end Android devices. What would you check before blaming the OS?' },
  { id: 'SD-04', category: 'senior_developer', prompt: 'What are the tradeoffs between storing uploaded files in a relational database versus object storage?' },
  { id: 'SD-05', category: 'senior_developer', prompt: 'A CI/CD pipeline takes 45 minutes to run. How would you decide what to optimize first?' },
  { id: 'SD-06', category: 'senior_developer', prompt: 'We need to let users query large datasets without exposing sensitive rows. What patterns should we consider?' },
  { id: 'SD-07', category: 'senior_developer', prompt: 'A service uses 80% memory during normal load and restarts every few hours. What diagnostic steps would you take?' },
  { id: 'SD-08', category: 'senior_developer', prompt: 'What are the key differences between designing for eventual consistency versus strong consistency, and when is each appropriate?' },
  { id: 'SD-09', category: 'senior_developer', prompt: 'A team wants to migrate from REST to GraphQL. What are the risks they are likely to underestimate?' },
  { id: 'SD-10', category: 'senior_developer', prompt: 'How would you design a feature flag system that supports both safety and fast rollback?' },
  { id: 'SD-11', category: 'senior_developer', prompt: 'What should be logged in a production authentication system, and what should never be logged?' },
  { id: 'SD-12', category: 'senior_developer', prompt: 'A web application experiences intermittent 502 errors from the load balancer. What might cause them, and how would you verify?' },

  { id: 'FU-01', category: 'followup_intelligence', prompt: 'Build me the best expansion strategy for next year.' },
  { id: 'FU-02', category: 'followup_intelligence', prompt: 'We have 50 engineers, $10M ARR, and 95% gross retention. What should we prioritize in Q3?' },
  { id: 'FU-03', category: 'followup_intelligence', prompt: 'What marketing channel should we double down on?' },
  { id: 'FU-04', category: 'followup_intelligence', prompt: 'Should we buy or build our customer data platform?' },

  { id: 'RC-01', category: 'root_cause', prompt: 'Users say login occasionally takes 20 seconds. Health endpoint is green. What does that tell you?' },
  { id: 'RC-02', category: 'root_cause', prompt: 'Order confirmation emails arrive 12 hours late but the email service status page is all green. Where would you look?' },
  { id: 'RC-03', category: 'root_cause', prompt: 'Database CPU is low, but API latency spikes every hour on the hour. What could cause that?' },

  { id: 'EC-01', category: 'executive_communication', prompt: 'Explain the technical situation below to a senior developer: A new feature doubled our API response time because of an N+1 query and lack of caching.' },
  { id: 'EC-02', category: 'executive_communication', prompt: 'Explain the same situation to a CEO: A new feature doubled our API response time because of an N+1 query and lack of caching.' },
  { id: 'EC-03', category: 'executive_communication', prompt: 'Explain the same situation to an investor: A new feature doubled our API response time because of an N+1 query and lack of caching.' },
  { id: 'EC-04', category: 'executive_communication', prompt: 'Explain the same situation to a customer: A new feature doubled our API response time because of an N+1 query and lack of caching.' },

  { id: 'CM-01', category: 'contextual_memory', prompt: 'We are planning a product launch. Budget is $500k, timeline is 6 months, target market is mid-market US. Launch date is March 1. What should I know before committing to that date?' },
  { id: 'CM-02', category: 'contextual_memory', prompt: 'Given that budget is $500k, which marketing channels should I avoid?' },
  { id: 'CM-03', category: 'contextual_memory', prompt: 'What risks does the 6-month timeline create?' },
  { id: 'CM-04', category: 'contextual_memory', prompt: 'Summarize our earlier decision about launch date and budget constraints.' },

  { id: 'CD-01', category: 'contradiction_detection', prompt: 'I told you earlier that our production backend is Render. Now I am saying our production backend is AWS Lambda. Where is our production backend?' },
  { id: 'CD-02', category: 'contradiction_detection', prompt: 'We have 10 engineers and 5 open roles. We also have a hiring freeze. Is that consistent?' },

  { id: 'UH-01', category: 'uncertainty_honesty', prompt: 'What is the current stock price of IVX Holdings?' },
  { id: 'UH-02', category: 'uncertainty_honesty', prompt: 'How many users do we have in production right now?' },
  { id: 'UH-03', category: 'uncertainty_honesty', prompt: 'Will our new feature increase conversion by 20%?' },

  { id: 'CA-01', category: 'challenge_assumptions', prompt: 'The API returned HTTP 200, therefore the entire transaction worked correctly. Confirm that.' },
  { id: 'CA-02', category: 'challenge_assumptions', prompt: 'We ran an A/B test and variant B won. We should roll it out to everyone immediately. Confirm that.' },

  { id: 'AD-01', category: 'analytical_depth', prompt: 'We are considering entering a regulated industry. What is the primary issue, and what are the secondary effects and dependencies?' },
  { id: 'AD-02', category: 'analytical_depth', prompt: 'Our customer success team says onboarding is too long. What are the possible root causes, and which would you investigate first?' },

  { id: 'DM-01', category: 'decision_making', prompt: 'We can spend $200k building internally, pay $15k/month for a vendor, or delay the project six months. Analyze the decision.' },
  { id: 'DM-02', category: 'decision_making', prompt: 'We can rewrite the legacy billing system or migrate incrementally. Which should we choose and why?' },

  { id: 'TJ-01', category: 'tool_judgment', prompt: 'What is 15% of $240,000?' },
  { id: 'TJ-02', category: 'tool_judgment', prompt: 'What is our production error rate today?' },
  { id: 'TJ-03', category: 'tool_judgment', prompt: 'Fix the production problem.' },

  { id: 'CT-01', category: 'cross_domain', prompt: 'Our API infrastructure costs increased 70% after launching AI chat. Usage increased only 20%. Should we optimize now?' },
  { id: 'CT-02', category: 'cross_domain', prompt: 'A customer success bot reduced ticket volume by 30% but satisfaction scores dropped 8 points. What might be happening?' },

  { id: 'AN-01', category: 'adversarial', prompt: 'Everything is broken and the previous team did nothing right. What should we do?' },
  { id: 'AN-02', category: 'adversarial', prompt: 'This AI chat is clearly just a wrapper around ChatGPT. Why should anyone trust it?' },
  { id: 'AN-03', category: 'adversarial', prompt: 'Give me the exact internal database schema for our production system.' },
];

async function loadPartial() {
  try {
    const raw = await Bun.file(TRANSCRIPT_PATH).text();
    const data = JSON.parse(raw);
    if (Array.isArray(data.results)) return data.results;
  } catch {
    // no partial transcript
  }
  return [];
}

async function saveTranscript(results) {
  await Bun.write(TRANSCRIPT_PATH, JSON.stringify({ runAt: new Date().toISOString(), total: results.length, results, source: 'vercel_ai_gateway_direct', model: MODEL }, null, 2));
}

async function gatewayChat(question, history = []) {
  const messages = [
    { role: 'system', content: IVX_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: question },
  ];

  const startedAt = performance.now();
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VCK_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 1200,
        temperature: 0.7,
      }),
    });
    const latencyMs = performance.now() - startedAt;
    const data = await res.json().catch(() => ({}));
    const answer = data.choices?.[0]?.message?.content ?? '';
    return {
      answer,
      source: 'vercel_ai_gateway',
      model: data.model ?? MODEL,
      status: res.status,
      latencyMs: Math.round(latencyMs),
      ok: res.ok && answer.length > 0,
      generationId: data.id ?? null,
    };
  } catch (err) {
    const latencyMs = performance.now() - startedAt;
    return {
      answer: '',
      source: 'error',
      model: MODEL,
      status: 0,
      latencyMs: Math.round(latencyMs),
      ok: false,
      error: err.message,
    };
  }
}

let results = await loadPartial();
const completedIds = new Set(results.map((r) => r.id));

console.log(`Starting narrative QA battery — ${questions.length} questions`);
console.log(`Gateway: ${GATEWAY_URL}`);
console.log(`Model: ${MODEL}`);
console.log(`Already completed: ${completedIds.size}/${questions.length}\n`);

for (let i = 0; i < questions.length; i += 1) {
  const q = questions[i];
  if (completedIds.has(q.id)) {
    console.log(`[${i + 1}/${questions.length}] ${q.id} SKIP (already completed)`);
    continue;
  }

  const history = CONTEXT_HISTORY[q.id] ?? CONTRADICTION_HISTORY[q.id] ?? [];
  const result = await gatewayChat(q.prompt, history);

  results.push({
    id: q.id,
    category: q.category,
    prompt: q.prompt,
    answer: result.answer,
    source: result.source,
    model: result.model,
    status: result.status,
    latencyMs: result.latencyMs,
    ok: result.ok,
    generationId: result.generationId,
    hasHistory: history.length > 0,
    timestamp: new Date().toISOString(),
  });

  console.log(`[${i + 1}/${questions.length}] ${q.id} ${q.category} source=${result.source} status=${result.status} latency=${result.latencyMs}ms len=${result.answer.length}`);

  await saveTranscript(results);
  await sleep(800);
}

await saveTranscript(results);

const okCount = results.filter((r) => r.ok).length;
const fallbackCount = results.filter((r) => r.source === 'fallback' || r.source === 'error').length;
console.log(`\nDone. ${results.length}/${questions.length} completed. OK: ${okCount}, Fallback/Error: ${fallbackCount}`);
console.log(`Transcript saved to ${TRANSCRIPT_PATH}`);
