import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { requestIVXAIText, runWithOwnerAIStreamCallback } from '../backend/ivx-ai-runtime';
import { buildOwnerTextModelInput } from '../backend/services/ivx-owner-text-prompt';

// Candidate prompt -> real provider only. No owner session, database, tools,
// task execution, deployment or cross-replica deduplication is certified here.
const proof = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(),
  scope: 'candidate_owner_text_prompt_real_provider',
  productionRowsTouched: 0,
  phase4Certified: false,
  passed: false,
  cases: [] as Array<Record<string, unknown>>,
  error: null as string | null,
};

try {
  if (!String(process.env.IVX_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY || '').trim()) {
    throw new Error('EXISTING_GATEWAY_CREDENTIAL_UNAVAILABLE');
  }
  for (const prefix of ['IVX_CHAT_E2E_', 'north_']) {
    const suffix = randomUUID().replaceAll('-', '');
    const requestId = `owner-text-proof-${randomUUID()}`;
    const request = `Return only the result of joining ${prefix} and ${suffix}.`;
    const modelInput = buildOwnerTextModelInput({
      request,
      history: [
        { role: 'user', content: 'What was the last production fix?' },
        { role: 'assistant', content: 'No tengo esa información en el historial reciente.' },
      ],
    });
    let deltas = 0;
    let streamedText = '';
    const started = Date.now();
    const result = await runWithOwnerAIStreamCallback((delta) => {
      deltas++;
      streamedText += delta;
    }, () => requestIVXAIText({
      module: 'owner-room-knowledge', requestId, model: 'openai/gpt-4o',
      ...modelInput, maxOutputTokens: 128, abortSignal: AbortSignal.timeout(20_000),
    }));
    const expected = `${prefix}${suffix}`;
    const passed = result.providerMetadata.source === 'remote_api'
      && result.providerMetadata.ivxAI.requestId === requestId
      && deltas > 0 && streamedText.trim() === expected && result.text.trim() === expected;
    proof.cases.push({
      requestId, request, expected, answer: result.text, streamedText, deltas,
      source: result.providerMetadata.source, model: result.providerMetadata.model,
      endpoint: result.providerMetadata.endpoint, elapsedMs: Date.now() - started, passed,
    });
    if (!passed) throw new Error('REAL_PROVIDER_DID_NOT_SATISFY_CURRENT_REQUEST');
  }
  proof.passed = true;
} catch (error) {
  // Do not serialize SDK exceptions, request headers or credential material.
  proof.error = error instanceof Error && /^(EXISTING_GATEWAY|REAL_PROVIDER)/.test(error.message)
    ? error.message : 'REAL_PROVIDER_CALL_FAILED';
  process.exitCode = 1;
} finally {
  mkdirSync('qa/evidence/owner-text', { recursive: true });
  writeFileSync('qa/evidence/owner-text/provider-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}
