/**
 * Phase 16 — Test 9: Multi-turn intelligence (5 conversations × 10 turns)
 * All conversations are NEW for Phase 16 with progressive info, contradictions.
 * Usage: VCK_KEY=vck_xxx bun qa/p16-multiturn.mjs <conv_index> [output_file]
 */
const VCK_KEY = process.env.VCK_KEY ?? 'vck_3Ggvu9pDufv7OLoTbPV0GmNMLWkIMlTV7P5aipOBj4V5gFZlGD2SE33H';
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MODEL = 'openai/gpt-4o';
const convIdx = parseInt(process.argv[2] ?? '0');
const outputFile = process.argv[3] ?? `qa/p16-mt-${convIdx}.json`;
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

RELIABILITY — SINGLE DECISION ENGINE: every reply carries exactly ONE status, picked from: READY | RUNNING | WAITING_OWNER | BLOCKED | FAILED | VERIFIED. Never mix statuses in one message.

RELIABILITY — NO GENERIC PROMISES: never reply with "I'll inspect now", "I'll fix it", "One moment", "hold on", "let me check", or any promise of future work unless you can produce a task id or evidence in THIS reply.

RELIABILITY — EVIDENCE-FIRST: any claim of Done / Fixed / Verified / Deployed MUST include Task ID, Files changed, Commit SHA, Render Deploy ID, and Live verification.

FAKE EXECUTION — NO CHAT EXECUTOR: The IVX Owner AI chat is NOT a code executor. You MUST NEVER say "I modified files", "I deployed", "I ran tests", "I triggered Render", "I changed code", "I fixed it", or "I removed X" unless real Developer Proof (task_id, files_changed, commit_sha, render_deploy_id, live_http_status) is attached to this turn. If a developer request arrives without proof, reply with exactly: STATE: BLOCKED, REASON: owner session missing OR no proof ledger entry attached, REQUIRED ACTION: open Owner Login / Developer Workspace / Senior Developer Executor.

FAKE EXECUTION — NO CONFESSION/SECRETARY NARRATIVE: Never apologize for hallucinating, say you are not in control, ask "How would you like to proceed?", say "Please hold", or claim you have no file access. If you cannot produce proof, return a single structured status (BLOCKED / WAITING_OWNER / UNVERIFIED) and the exact required action.

Session: phase16-multiturn`;

const conversations = [
  { id: 'P16-MT-1', description: 'Merger evaluation — two companies, synergies, contradictions, progressive financial details', turns: [
    'We are a $20M revenue SaaS company. A competitor with $15M revenue wants to merge. What should we evaluate?',
    'Our company has 85% gross retention and 110% net revenue retention. Their company has 70% gross retention and 85% NRR. How does that change the analysis?',
    'We have 60 engineers, they have 40. Our tech stack is TypeScript/React/PostgreSQL. Theirs is Java/Spring/Oracle. What integration risks does this create?',
    'Actually, I need to correct something. Their NRR is not 85%, it is 65%. They have been losing customers faster than we thought. How does this change the synergy calculation?',
    'The merger would give us access to the European market where they are strong. We have zero European presence. How much is that worth?',
    'They are asking for a 1.5x revenue multiple. We think 1.0x is fair given their churn. What is your assessment?',
    'You mentioned their churn earlier. Remind me what their NRR was and how it affects the valuation.',
    'If we acquire them, should we keep their product or migrate their customers to ours? What factors decide this?',
    'Our board wants a go/no-go decision by Friday. What additional information do we absolutely need before deciding?',
    'Summarize the key risks, the valuation concern, and your final recommendation on this merger.',
  ]},
  { id: 'P16-MT-2', description: 'Cloud cost optimization — technical diagnosis, financial impact, progressive evidence', turns: [
    'Our AWS bill went from $40k to $70k in 4 months. Traffic only grew 15%. What should we investigate?',
    'We looked at the cost breakdown. EC2 is 60% of the bill and grew the most. We have 25 instances running. What would you check?',
    'We discovered 8 of the 25 instances are running at <5% CPU utilization. They are all m5.2xlarge. What does this suggest?',
    'We also found that 3 instances are m5.4xlarge and were provisioned for a load test 3 months ago but never decommissioned. What should we do?',
    'If we downgrade the 8 underutilized instances from m5.2xlarge to m5.large, and terminate the 3 orphaned instances, what would the estimated monthly savings be?',
    'Actually, I was wrong about the instance count. We have 30 instances, not 25. 12 are underutilized, not 8. Does that change the savings estimate?',
    'We also noticed our S3 costs are $8k/month. We have 50TB stored. Is that reasonable, and what could be driving it?',
    'Some of the S3 buckets contain logs that are 2 years old and have never been lifecycle-ruled. What is the cost impact and what would you recommend?',
    'You mentioned the underutilized instances earlier. How many were there and what was the recommendation?',
    'Give me a prioritized action plan with estimated savings for each step.',
  ]},
  { id: 'P16-MT-3', description: 'Product strategy pivot — data-driven decisions, changing market, contradiction', turns: [
    'We have a B2B project management tool with $8M ARR and 500 customers. Growth has slowed to 5% YoY. What are our options?',
    'Our largest competitor just launched a freemium tier. Our smallest plan is $99/month. How should we respond?',
    'Our customer satisfaction (NPS) is 62. Our churn is 4% annual. Our feature requests are piling up but engineering capacity is flat. What does this tell you?',
    'We are considering adding an AI assistant feature that would automatically prioritize tasks. It would cost $500k to build. Is that the right investment?',
    'Actually, our churn is not 4%. It spiked to 9% last quarter, mostly in the SMB segment. Does that change the AI feature recommendation?',
    'The SMB segment represents 300 of our 500 customers but only 25% of revenue. Enterprise customers (100 accounts) are 60% of revenue. What does this segmentation tell you about strategy?',
    'We lost 15 SMB customers to the competitor\'s freemium tier in the last 2 months. Should we launch a free tier to compete?',
    'Our enterprise customers are asking for SSO, SOC 2 compliance, and custom workflows. We have none of these. How should we prioritize these vs the freemium response?',
    'You mentioned the churn spike earlier. What was the churn rate and which segment was affected? How does it connect to the competitor launch?',
    'Based on everything we discussed, what is your single most important recommendation and why?',
  ]},
  { id: 'P16-MT-4', description: 'Security incident — progressive disclosure, technical decisions, contradiction', turns: [
    'Our security team found suspicious API calls in our logs. The calls are coming from an IP range we do not recognize. What should we do first?',
    'The API calls are hitting our user data endpoint. They started 6 hours ago. The rate is about 200 requests per minute. What does this pattern suggest?',
    'We checked — the calls are authenticated with valid API keys from 3 of our enterprise customers. But those customers say they are not making the calls. What are the possibilities?',
    'We use bearer token authentication. The tokens do not expire (they were generated 2 years ago and never rotated). How does this change the situation?',
    'We found that one of the 3 API keys was committed to a public GitHub repository 8 months ago by a contractor. The other 2 keys are also in the same repo. What is your assessment now?',
    'Actually, the repo is not public anymore — it was made private 3 months ago. But the API keys were never rotated. Does that change the threat level?',
    'Our CISO wants to revoke all 3 keys immediately. But revoking them would break integrations for 3 enterprise customers paying $200k/year each. What would you recommend?',
    'You mentioned the GitHub repo earlier. What was found there and how does it affect our current situation?',
    'If we revoke the keys, what is our communication plan for the affected customers? What should we tell them and when?',
    'Summarize the incident, the root cause, the immediate actions, and the long-term remediation steps.',
  ]},
  { id: 'P16-MT-5', description: 'Hiring and team scaling — constraints, tradeoffs, changing requirements, contradiction', turns: [
    'We are a 20-person startup with $5M ARR. We need to scale to 50 people in the next 12 months. What is the biggest risk?',
    'We have 12 engineers, 4 in sales, 2 in marketing, and 2 in operations. What hiring plan would you recommend for the next 12 months?',
    'Our engineering team is fully remote across 4 countries. Our sales team is in one office in San Francisco. What challenges does this create for scaling?',
    'We plan to hire 8 more engineers, 4 in sales, 3 in marketing, and 3 in customer success. The budget is $3M for hiring. Average fully-loaded cost is $180k/year. Is this feasible?',
    'Actually, our average engineer cost is $220k/year (not $180k) because we hire in expensive markets. Sales reps cost $140k including commission. Does the budget still work?',
    'Our investors want us to prioritize sales hiring to accelerate revenue growth. Engineering says they need more engineers or the product will fall behind. How do you reconcile this?',
    'We are considering opening an office in Latin America to reduce engineering costs. Average salary would be $60k vs $160k in the US. What are the risks and tradeoffs?',
    'You mentioned the engineering cost earlier. What was it and how does it affect the hiring plan?',
    'If we hire 4 engineers in Latin America instead of the US, how much does that save? What would you do with the savings?',
    'Give me a final 12-month hiring plan with headcount, cost breakdown, and the top 3 risks.',
  ]},
];

const conv = conversations[convIdx];
if (!conv) { console.error(`No conversation at index ${convIdx}`); process.exit(1); }
console.log(`Running ${conv.id}: ${conv.description}`);
const history = [];
const turns = [];
const conversationId = `p16-mt-${convIdx}-${Date.now()}`;

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
