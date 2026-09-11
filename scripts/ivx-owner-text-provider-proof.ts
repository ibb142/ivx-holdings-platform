import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { requestIVXAIText, runWithOwnerAIStreamCallback, type IVXAITextMessage } from '../backend/ivx-ai-runtime';
import { buildOwnerTextModelInput, OWNER_TEXT_MODEL } from '../backend/services/ivx-owner-text-prompt';
import { buildSeniorEngineerSystemPrompt } from '../backend/services/ivx-senior-engineer-persona';

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
  diagnosticBaseline: null as Record<string, unknown> | null,
  error: null as string | null,
};

try {
  if (!String(process.env.IVX_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY || '').trim()) {
    throw new Error('EXISTING_GATEWAY_CREDENTIAL_UNAVAILABLE');
  }
  // Production Android failed after repeated mistaken answers about database
  // joins. Keep that conversational shape with fresh, non-production operands.
  const refusalHistory: IVXAITextMessage[] = Array.from({ length: 6 }, (_, i) => [
    { role: 'user' as const, content: `Return only the result of joining earlier_ and ${randomUUID().replaceAll('-', '')}.` },
    { role: 'assistant' as const, content: i % 2 === 0
      ? 'I cannot directly access or compute external database or file joining results. Please provide more context.'
      : 'No tengo la información de esa unión en el historial reciente. Necesito datos adicionales para responder.' },
  ]).flat();
  const liveContext = `[IVX LIVE PRODUCTION CONTEXT]\nFull SHA: ${proof.sourceSha}\nStatus: unverified in this candidate-only test\n[/IVX LIVE PRODUCTION CONTEXT]`;
  const cases = ['IVX_CHAT_E2E_', 'north_'].flatMap((prefix) => ['short_history', 'repeated_refusals'].map((scenario) => {
    const suffix = randomUUID().replaceAll('-', '');
    return { scenario, request: `Return only the result of joining ${prefix} and ${suffix}.`, expected: `${prefix}${suffix}`,
      history: scenario === 'short_history' ? [
        { role: 'user' as const, content: 'What was the last production fix?' },
        { role: 'assistant' as const, content: 'No tengo esa información en el historial reciente.' },
      ] : refusalHistory };
  }));
  const left = 100 + Math.floor(Math.random() * 900);
  const right = 100 + Math.floor(Math.random() * 900);
  cases.push({ scenario: 'arithmetic_after_refusals', request: `Calculate ${left} + ${right}. Return only the number.`, expected: String(left + right), history: refusalHistory });
  const reversed = randomUUID().replaceAll('-', '').slice(0, 8);
  cases.push({ scenario: 'reverse_after_refusals', request: `Reverse the characters of ${reversed}. Return only the reversed text.`, expected: [...reversed].reverse().join(''), history: refusalHistory });
  // Keep the exact failed operand from run 34632973249, attempt 1. A fresh
  // random operand passing later must not silently retire that failure.
  cases.push({ scenario: 'reverse_transposition_regression',
    request: 'Reverse the characters of ba1aef02. Return only the reversed text.',
    expected: '20fea1ab', history: refusalHistory });

  // Diagnostic comparison only: retain the previous prompt's answer on the
  // repeated-refusal case. Every candidate case below must still pass.
  const baselineCase = cases.find((entry) => entry.scenario === 'repeated_refusals')!;
  try {
    const baseline = await requestIVXAIText({
      module: 'owner-room-knowledge', requestId: `owner-text-baseline-${randomUUID()}`, model: 'openai/gpt-4o',
      system: buildSeniorEngineerSystemPrompt(liveContext),
      messages: [...baselineCase.history, { role: 'user', content: baselineCase.request }],
      maxOutputTokens: 128, abortSignal: AbortSignal.timeout(20_000),
    });
    proof.diagnosticBaseline = { answer: baseline.text, expected: baselineCase.expected, matched: baseline.text.trim() === baselineCase.expected, source: baseline.providerMetadata.source };
  } catch { proof.diagnosticBaseline = { error: 'BASELINE_PROVIDER_CALL_FAILED' }; }

  for (const entry of cases) {
    const requestId = `owner-text-proof-${randomUUID()}`;
    const { request, expected } = entry;
    const modelInput = buildOwnerTextModelInput({
      request, history: entry.history, liveContext,
    });
    // Short arithmetic answers can occur coincidentally inside random history
    // IDs. The full opaque text answers must never be supplied to the model.
    if (expected.length >= 8 && !request.includes(expected) && JSON.stringify(modelInput).includes(expected)) {
      throw new Error('REAL_PROVIDER_EXPECTED_ANSWER_LEAKED_INTO_INPUT');
    }
    let deltas = 0;
    let streamedText = '';
    const started = Date.now();
    const result = await runWithOwnerAIStreamCallback((delta) => {
      deltas++;
      streamedText += delta;
    }, () => requestIVXAIText({
      module: 'owner-room-knowledge', requestId, model: OWNER_TEXT_MODEL,
      ...modelInput, maxOutputTokens: 128, abortSignal: AbortSignal.timeout(20_000),
    }));
    const passed = result.providerMetadata.source === 'remote_api'
      && result.providerMetadata.model === OWNER_TEXT_MODEL
      && result.providerMetadata.ivxAI.requestId === requestId
      && deltas > 0 && streamedText.trim() === expected && result.text.trim() === expected;
    proof.cases.push({
      scenario: entry.scenario, historyMessages: entry.history.length,
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
