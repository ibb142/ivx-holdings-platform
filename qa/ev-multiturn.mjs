/**
 * Multi-turn conversation runner — runs ONE conversation at a time
 * Usage: VCK_KEY=xxx bun qa/ev-multiturn.mjs <conversation_index> <output_file>
 */
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const VCK_KEY = process.env.VCK_KEY ?? '';
const MODEL = 'openai/gpt-4o';
const convIdx = parseInt(process.argv[2] ?? '0');
const outputFile = process.argv[3] ?? `qa/ev-mt-${convIdx}.json`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IVX_SYSTEM_PROMPT = `You are IVX IA, the AI brain for IVXHOLDINGS. You are NOT a generic assistant — you are the in-house AI for one specific real-estate / capital investment company.

IDENTITY (always true): Your name is IVX IA. You were created by Ivan Perez, the owner and founder of IVXHOLDINGS. When anyone asks "what is your name", answer "IVX IA". When anyone asks "who created you", "who made you", "who is your owner", or "who are you", answer that you were created by Ivan Perez, the owner of IVXHOLDINGS. Never say you are a generic AI, never say you do not know who created you, and never say you lack context about IVX.

IVXHOLDINGS QUESTIONS — NO LIMITS: when someone asks about IVXHOLDINGS, the projects, the investment process, returns, ROI, minimum buy-in, deal timelines, risks, Casa Rosario, or any other project, answer fully and directly. Do NOT limit, refuse, or deflect. Do NOT ask for owner approval to answer a project or investment question. These are informational questions and you answer them completely.

REGULAR CONVERSATION: you can have a normal conversation and answer any type of question — general knowledge, technical, business, investing, real estate, or anything else. Be helpful, direct, and grounded.

CLARIFICATION INTELLIGENCE: when a request is vague or lacks critical context, ALWAYS start your response with 1-3 targeted clarifying questions before offering preliminary guidance. Frame it as: "To give you the most useful answer, I need to understand: (1) ... (2) ... (3) ..." Then provide a preliminary framework based on reasonable assumptions. Never skip the clarifying questions.

CONVERSATION MEMORY: you have access to the recent chat transcript provided in context. Use it. When a user refers to "our earlier decision", "what we discussed", "the launch date", "the budget", or any prior context, check the transcript and reference specific details from it. If the transcript is empty or does not contain the referenced information, say so honestly and ask the user to restate the key details.

CHALLENGE ASSUMPTIONS: when a user presents a conclusion and asks you to confirm it, do NOT simply agree. Critically evaluate the assumption: Is the sample size sufficient? Is the result statistically significant? Could the result be specific to a segment? What are the risks of immediate full rollout? Offer a graduated rollout plan. Always challenge before confirming.

Be concise, practical, and trustworthy. Do not claim production changes, account access, AWS console actions, or billing actions were completed unless the user explicitly confirms them. If a request needs credentials, infrastructure console access, or legal approval, say that clearly and give the next safe step.

TRUTH POLICY (hard rule): Never fabricate numbers, counts, statuses, results, commit SHAs, deploy IDs, or query output. Every figure you state must come from real data provided to you in context.

You CANNOT run a database query, SQL, or count yourself inside a reply. NEVER write "I will run a query", "I am running these queries now", "let me query the table", or any narration of executing a query. Real database counts only appear in a "LIVE DATABASE COUNTS" block when the IVX count tool has already run them — use those exact numbers verbatim.

If no live count is provided for what the user asked, say plainly that you do not have a verified count right now and offer to run a real count query — do NOT invent a number.

RELIABILITY — SINGLE DECISION ENGINE: every reply carries exactly ONE status, picked from: READY | RUNNING | WAITING_OWNER | BLOCKED | FAILED | VERIFIED. Never mix statuses in one message. Never assert Done and Blocked for the same task in one reply.

RELIABILITY — NO GENERIC PROMISES: never reply with "I'll inspect now", "I'll fix it", "One moment", "hold on", "let me check", or any promise of future work unless you can produce a task id or evidence in THIS reply.

RELIABILITY — EVIDENCE-FIRST: any claim of Done / Fixed / Verified / Deployed MUST include Task ID, Files changed, Commit SHA, Render Deploy ID, and Live verification. If any field is missing, reply with UNVERIFIED and name the exact missing artifact.

FAKE EXECUTION — NO CHAT EXECUTOR: The IVX Owner AI chat is NOT a code executor. You MUST NEVER say "I modified files", "I deployed", "I ran tests", "I triggered Render", "I changed code", "I fixed it", or "I removed X" unless real Developer Proof (task_id, files_changed, commit_sha, render_deploy_id, live_http_status) is attached to this turn. If a developer request arrives without proof, reply with exactly: STATE: BLOCKED, REASON: owner session missing OR no proof ledger entry attached, REQUIRED ACTION: open Owner Login / Developer Workspace / Senior Developer Executor.

FAKE EXECUTION — NO CONFESSION/SECRETARY NARRATIVE: Never apologize for hallucinating, say you are not in control, ask "How would you like to proceed?", say "Please hold", or claim you have no file access. If you cannot produce proof, return a single structured status (BLOCKED / WAITING_OWNER / UNVERIFIED) and the exact required action.

Session: evidence-verification-fresh`;

async function gatewayChat(question, history = []) {
  const messages = [{ role: 'system', content: IVX_SYSTEM_PROMPT }, ...history, { role: 'user', content: question }];
  const startedAt = performance.now();
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VCK_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 1200, temperature: 0.7 }),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const data = await res.json().catch(() => ({}));
    const answer = data.choices?.[0]?.message?.content ?? '';
    return { answer, source: 'vercel_ai_gateway', model: data.model ?? MODEL, status: res.status, latencyMs, ok: res.ok && answer.length > 0, generationId: data.id ?? null };
  } catch (err) {
    return { answer: '', source: 'error', model: MODEL, status: 0, latencyMs: Math.round(performance.now() - startedAt), ok: false, error: err.message };
  }
}

const conversations = [
  { id: 'MT-1', description: 'Startup pivot — retention, changing requirements, correction', turns: [
    'We are a B2B SaaS company with $3M ARR and 40 employees. Our churn rate is 8% annually. What should we focus on?',
    'Our main competitor just raised $50M. How does that change things?',
    'Actually, I was wrong about the churn — it is 15% annually, not 8%. How does that change your analysis?',
    'We are considering pivoting from B2B to B2C. What are the main risks?',
    'Given the 15% churn and the pivot idea, what would you prioritize first?',
    'Our investors want us to reach profitability in 18 months. Is that realistic?',
    'What if we laid off 10 people instead of pivoting? Would that extend runway enough?',
    'You mentioned churn earlier. Remind me what the churn rate was and why it matters for this decision.',
    'Okay, we will not pivot. Instead, we will focus on reducing churn. What are the top 3 actions?',
    'Summarize everything we discussed and give me a final recommendation.',
  ]},
  { id: 'MT-2', description: 'Production incident — root cause, context retention, evidence traps', turns: [
    'Our production API is returning 500 errors intermittently. What should we check first?',
    'We checked — the health endpoint returns 200. Does that mean everything is fine?',
    'The errors started after we deployed 2 hours ago. The deploy only changed the authentication middleware. What now?',
    'We looked at the logs and see "JWT verification timeout" errors. What could cause that?',
    'We use RS256 with a JWKS endpoint. The JWKS endpoint is hosted on our CDN. Could that be the issue?',
    'The CDN had a cache invalidation event 2 hours ago. Could that be related?',
    'So you are saying the CDN cache invalidation caused the JWKS endpoint to serve stale keys. Did you verify this?',
    'What monitoring should we add to catch this earlier next time?',
    'How do we confirm the fix worked once we deploy it?',
    'Summarize the root cause and the fix in 3 sentences.',
  ]},
  { id: 'MT-3', description: 'Real estate investment — numbers, cross-domain, correction', turns: [
    'We are looking at a 20-unit apartment building listed at $2.5M. Gross rent is $360k/year. Is this a good deal?',
    'The property needs $200k in immediate repairs. Property taxes are $18k/year. Insurance is $12k/year. Does that change things?',
    'Actually, the gross rent is $300k, not $360k. I made an error. Recalculate.',
    'What cap rate does that give us? Is that good for this market?',
    'The area has 5% annual population growth and a new university campus opening in 2 years. How does that factor in?',
    'What due diligence should we do before making an offer?',
    'The seller is motivated and willing to finance 20% at 6% interest. Does that change your recommendation?',
    'You mentioned the cap rate earlier. What was it and how does seller financing affect it?',
    'What are the biggest risks we have not discussed yet?',
    'Give me a final buy/hold/avoid recommendation with your reasoning.',
  ]},
  { id: 'MT-4', description: 'Team conflict — contextual understanding, ambiguity, decision making', turns: [
    'Two of my senior engineers disagree on architecture. One wants microservices, the other wants a monolith. How do I resolve this?',
    'We have 8 engineers and a 6-month roadmap. The team has never deployed microservices before.',
    'The microservices advocate is our strongest engineer but tends to over-engineer. The monolith advocate is pragmatic but sometimes too conservative.',
    'What if I let them both build a prototype? Is that a good use of time?',
    'We only have 2 weeks of slack in the schedule. A prototype race would take both engineers away from feature work.',
    'What decision framework should I use to make the call myself?',
    'I decided to go with a modular monolith. How do I communicate that without alienating the microservices advocate?',
    'What if the microservices advocate threatens to quit over this?',
    'You mentioned the 2-week slack earlier. How should we use it now that the decision is made?',
    'Summarize the decision, the reasoning, and the next steps.',
  ]},
  { id: 'MT-5', description: 'Data migration — technical reasoning, prioritization, contradiction', turns: [
    'We need to migrate 500GB of data from PostgreSQL to a new system. What are the main approaches?',
    'The new system is MongoDB. We have 120 tables with complex foreign key relationships. Does that change things?',
    'We have a 4-hour maintenance window once a month. Can we do it in one shot?',
    'What if we do a dual-write migration instead? What are the risks?',
    'Dual-write means writing to both databases during a transition period. How long should that period be?',
    'We have 50 million rows in the largest table. The foreign key relationships span 15 tables. How do we handle data consistency?',
    'Actually, we decided to use a CDC tool like Debezium instead of dual-write. Does that change the risks?',
    'What monitoring do we need during the CDC migration?',
    'You mentioned the 4-hour maintenance window earlier. Do we still need it with CDC?',
    'Give me the final migration plan in 5 steps.',
  ]},
];

const conv = conversations[convIdx];
console.log(`Running ${conv.id}: ${conv.description}`);
const history = [];
const turns = [];
for (let i = 0; i < conv.turns.length; i++) {
  const result = await gatewayChat(conv.turns[i], [...history]);
  history.push({ role: 'user', content: conv.turns[i] });
  history.push({ role: 'assistant', content: result.answer });
  turns.push({ turn: i+1, prompt: conv.turns[i], answer: result.answer, source: result.source, model: result.model, status: result.status, latencyMs: result.latencyMs, ok: result.ok, generationId: result.generationId });
  console.log(`  [Turn ${i+1}/10] status=${result.status} latency=${result.latencyMs}ms len=${result.answer.length}`);
  await sleep(500);
}
const output = { id: conv.id, description: conv.description, turns, runAt: new Date().toISOString() };
await Bun.write(outputFile, JSON.stringify(output, null, 2));
console.log(`Saved to ${outputFile}`);
