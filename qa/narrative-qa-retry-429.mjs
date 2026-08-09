/**
 * Retry only 429-failed entries from qa/narrative-qa-transcript.json
 * with the proper 1500ms delay to avoid rate limits.
 */

const API_BASE = 'https://api.ivxholding.com';
const ENDPOINT = `${API_BASE}/api/public/chat`;
const TRANSCRIPT_PATH = 'qa/narrative-qa-transcript.json';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadTranscript() {
  const raw = await Bun.file(TRANSCRIPT_PATH).text();
  return JSON.parse(raw);
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

const transcript = await loadTranscript();
let results = transcript.results;
const failed = results.filter((r) => r.status === 429 || !r.answer);
console.log(`Retrying ${failed.length} failed entries...`);

for (let i = 0; i < failed.length; i += 1) {
  const r = failed[i];
  const sessionId = `narrative-qa-${r.id}`;
  const clientId = `narrative-qa-${r.id}-retry-${Date.now()}`;
  const { data, latencyMs, status } = await chat({ message: r.prompt, clientId, sessionId });
  const idx = results.findIndex((x) => x.id === r.id);
  if (idx >= 0) {
    results[idx] = {
      id: r.id,
      category: r.category,
      prompt: r.prompt,
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
    };
  }
  console.log(`[${i + 1}/${failed.length}] ${r.id} ${r.category} status=${status} latency=${Math.round(latencyMs)}ms len=${(data.answer ?? '').length}`);
  await saveTranscript(results);
  await sleep(1500);
}

await saveTranscript(results);
console.log(`Retry complete. ${results.filter((r) => r.status === 200 && r.answer).length}/${results.length} have answers.`);
