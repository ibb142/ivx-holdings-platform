/**
 * IVX IA Chat Senior Intelligence & Narrative QA Battery — FAST RESUME
 * Resumes from qa/narrative-qa-transcript.json and uses a shorter delay.
 */

const API_BASE = 'https://api.ivxholding.com';
const ENDPOINT = `${API_BASE}/api/public/chat`;
const TRANSCRIPT_PATH = 'qa/narrative-qa-transcript.json';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  await Bun.write(TRANSCRIPT_PATH, JSON.stringify({ runAt: new Date().toISOString(), total: results.length, results }, null, 2));
}

async function chat({ message, clientId, sessionId }) {
  const startedAt = performance.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ivx-client-id': clientId },
    body: JSON.stringify({ message, clientId, sessionId }),
  });
  const latencyMs = performance.now() - startedAt;
  const data = await res.json().catch(() => ({ ok: false, source: 'parse_error', answer: `HTTP ${res.status}: failed to parse response` }));
  return { data, latencyMs, status: res.status };
}

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

let results = await loadPartial();
const completedIds = new Set(results.map((r) => r.id));

for (let i = 0; i < questions.length; i += 1) {
  const q = questions[i];
  if (completedIds.has(q.id)) {
    console.log(`[${i + 1}/${questions.length}] ${q.id} SKIP (already completed)`);
    continue;
  }
  const sessionId = `narrative-qa-${q.id}`;
  const clientId = `narrative-qa-${q.id}-${Date.now()}`;
  const { data, latencyMs, status } = await chat({ message: q.prompt, clientId, sessionId });
  results.push({
    id: q.id,
    category: q.category,
    prompt: q.prompt,
    sessionId,
    clientId,
    status,
    latencyMs: Math.round(latencyMs),
    source: data.source ?? null,
    model: data.model ?? null,
    answer: data.answer ?? '',
    ok: data.ok ?? false,
    rateLimitRemaining: data.rateLimitRemaining ?? null,
    rateLimitResetAt: data.rateLimitResetAt ?? null,
    timestamp: data.timestamp ?? new Date().toISOString(),
  });
  console.log(`[${i + 1}/${questions.length}] ${q.id} ${q.category} source=${data.source ?? 'unknown'} status=${status} latency=${Math.round(latencyMs)}ms len=${(data.answer ?? '').length}`);
  await saveTranscript(results);
  await sleep(200); // fast resume delay
}

await saveTranscript(results);
console.log(`Transcript saved to ${TRANSCRIPT_PATH} (${results.length}/${questions.length})`);
