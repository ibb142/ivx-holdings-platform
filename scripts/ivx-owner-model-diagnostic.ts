import { createGateway } from 'ai';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { requestIVXAIText, runWithOwnerAIStreamCallback, type IVXAITextMessage } from '../backend/ivx-ai-runtime';
import { buildOwnerTextModelInput } from '../backend/services/ivx-owner-text-prompt';

// Bounded diagnostic only: same inputs, one call per model/case, no retry and
// no production data, task execution, writes, auth session, or certification.
const proof = { sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), scope: 'owner_text_model_comparison', phase4Certified: false,
  productionRowsTouched: 0, maximumCalls: 10, catalog: [] as unknown[],
  cases: [] as Record<string, unknown>[], completed: false, error: null as string | null };
try {
  const key = process.env.IVX_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error('CREDENTIAL_UNAVAILABLE');
  const catalog = await createGateway({ apiKey: key }).getAvailableModels();
  const requested = ['openai/gpt-4o', 'openai/gpt-4.1'];
  const models = requested.map(id => catalog.models.find(m => m.id === id));
  if (models.some(model => !model)) throw new Error('CATALOG_MODEL_UNAVAILABLE');
  proof.catalog = models.map(model => ({ id: model!.id, pricing: model!.pricing }));
  const history: IVXAITextMessage[] = Array.from({ length: 6 }, (_, i) => [
    { role: 'user' as const, content: `Return only the result of joining earlier_ and ${randomUUID().replaceAll('-', '')}.` },
    { role: 'assistant' as const, content: i % 2 === 0
      ? 'I cannot directly access or compute external database or file joining results. Please provide more context.'
      : 'No tengo la información de esa unión en el historial reciente. Necesito datos adicionales para responder.' },
  ]).flat();
  const literals = ['ba1aef02', '11aa22bb', randomUUID().replaceAll('-', '').slice(0, 8)];
  const cases = literals.map((literal, i) => ({ scenario: ['retained_failure', 'repeated_characters', 'fresh_literal'][i],
    request: `Reverse the characters of ${literal}. Return only the reversed text.`, expected: [...literal].reverse().join('') }));
  const suffix = randomUUID().replaceAll('-', '');
  cases.push({ scenario: 'fresh_join', request: `Return only the result of joining north_ and ${suffix}.`, expected: `north_${suffix}` });
  cases.push({ scenario: 'arithmetic', request: 'Calculate 763 + 284. Return only the number.', expected: '1047' });
  for (const entry of cases) {
    const modelInput = buildOwnerTextModelInput({ request: entry.request, history,
      liveContext: '[IVX LIVE PRODUCTION CONTEXT]\nStatus: unverified; isolated diagnostic.\n[/IVX LIVE PRODUCTION CONTEXT]' });
    if (entry.expected.length >= 8 && !entry.request.includes(entry.expected) && JSON.stringify(modelInput).includes(entry.expected)) {
      throw new Error('EXPECTED_ANSWER_LEAK');
    }
    for (const selected of models) {
      const model = selected!.id;
      const requestId = `owner-model-diagnostic-${randomUUID()}`;
      const started = Date.now();
      let deltas = 0;
      let streamedText = '';
      try {
        const result = await runWithOwnerAIStreamCallback(delta => { deltas++; streamedText += delta; },
          () => requestIVXAIText({ module: 'owner-room-knowledge', requestId, model,
            ...modelInput, maxOutputTokens: 128, abortSignal: AbortSignal.timeout(20_000) }));
        proof.cases.push({ ...entry, model, requestId, answer: result.text, streamedText, deltas,
          elapsedMs: Date.now() - started, source: result.providerMetadata.source,
          actualModel: result.providerMetadata.model, endpoint: result.providerMetadata.endpoint,
          passed: result.providerMetadata.source === 'remote_api' && result.providerMetadata.model === model
            && result.providerMetadata.ivxAI.requestId === requestId && deltas > 0
            && result.text.trim() === entry.expected && streamedText.trim() === entry.expected });
      } catch { proof.cases.push({ ...entry, model, requestId, elapsedMs: Date.now() - started,
        passed: false, error: 'PROVIDER_CALL_FAILED' }); }
    }
  }
  proof.completed = true;
} catch (error) {
  const code = error instanceof Error ? error.message : '';
  proof.error = /^(CREDENTIAL_UNAVAILABLE|CATALOG_MODEL_UNAVAILABLE|EXPECTED_ANSWER_LEAK)$/.test(code) ? code : 'DIAGNOSTIC_SETUP_FAILED';
  process.exitCode = 1;
} finally {
  mkdirSync('qa/evidence/owner-model-diagnostic', { recursive: true });
  writeFileSync('qa/evidence/owner-model-diagnostic/comparison.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}
