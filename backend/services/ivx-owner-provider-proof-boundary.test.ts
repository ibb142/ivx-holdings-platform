import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildOwnerTextModelInput, OWNER_TEXT_MODEL } from './ivx-owner-text-prompt';
import { buildSeniorEngineerSystemPrompt } from './ivx-senior-engineer-persona';

// Offline boundary test only. No provider requests or production credentials.
async function runFixture(failCandidate: boolean, failDiagnostics = false) {
  const source = readFileSync(new URL('../../scripts/ivx-owner-text-provider-proof.ts', import.meta.url), 'utf8')
    .replace(/^import .+;$/gm, '');
  const compiled = new Bun.Transpiler({ loader: 'ts', target: 'bun' })
    .transformSync(`async function run() { ${source} }; run();`);
  const state: { proof?: any; exitCode?: number } = {};
  let onDelta: ((delta: string) => void) | undefined;
  const diagnosticInputs: any[] = [];
  const fixtureAnswer = (request: string) => {
    const join = /joining (\S+) and (\S+)\.$/.exec(request);
    if (join) return join[1] + join[2];
    const sum = /Calculate (\d+) \+ (\d+)/.exec(request);
    if (sum) return String(Number(sum[1]) + Number(sum[2]));
    const reverse = /characters of (\w+)\./.exec(request);
    return reverse ? [...reverse[1]].reverse().join('') : 'fixture';
  };
  await runInNewContext(compiled, {
    buildOwnerTextModelInput, OWNER_TEXT_MODEL, buildSeniorEngineerSystemPrompt,
    randomUUID: () => '01234567-89ab-cdef-0123-456789abcdef',
    execFileSync: () => 'fixture-source-sha', mkdirSync() {},
    writeFileSync: (_path: string, data: string) => { state.proof = JSON.parse(data); },
    process: { env: { IVX_AI_GATEWAY_KEY: 'local-fixture-only' },
      set exitCode(value: number) { state.exitCode = value; } },
    console: { log() {} }, AbortSignal,
    runWithOwnerAIStreamCallback: async (callback: (s: string) => void, run: () => Promise<unknown>) => {
      onDelta = callback;
      try { return await run(); } finally { onDelta = undefined; }
    },
    requestIVXAIText: async (input: any) => {
      const request = input.messages.at(-1).content;
      const diagnostic = input.requestId.startsWith('owner-text-diagnostic-');
      if (diagnostic) {
        diagnosticInputs.push(input);
        if (failDiagnostics) throw new Error('fixture provider failure');
      }
      const incorrect = failCandidate && !diagnostic && request.includes('99a0314b');
      const text = incorrect ? 'b413a099' : fixtureAnswer(request);
      onDelta?.(text);
      return { text, providerMetadata: { source: 'remote_api', model: input.model,
        endpoint: 'fixture-endpoint', ivxAI: { requestId: input.requestId } } };
    },
  });
  return { ...state, diagnosticInputs };
}

test('successful diagnostics cannot convert a failed candidate into a certificate', async () => {
  const r = await runFixture(true);
  expect(r.exitCode).toBe(1);
  expect(r.proof.passed).toBe(false);
  expect(r.proof.phase4Certified).toBe(false);
  expect(r.proof.cases.at(-1).passed).toBe(false);
  expect(r.proof.failureDiagnostics).toHaveLength(2);
  expect(r.proof.failureDiagnostics.every((d: any) => d.matched)).toBe(true);
  expect(r.diagnosticInputs[0].messages).toHaveLength(1);
  expect(r.diagnosticInputs[1].messages).toHaveLength(13);
  for (const input of r.diagnosticInputs) {
    expect(input.model).toBe(OWNER_TEXT_MODEL);
    expect(input.maxOutputTokens).toBe(128);
    expect(JSON.stringify(input)).not.toContain('b4130a99');
  }
});

test('a successful candidate does not spend requests on diagnostics', async () => {
  const r = await runFixture(false);
  expect(r.proof.passed).toBe(true);
  expect(r.proof.cases).toHaveLength(9);
  expect(r.diagnosticInputs).toHaveLength(0);
  expect(r.exitCode).toBeUndefined();
});

test('diagnostic provider failures preserve the original failed gate', async () => {
  const r = await runFixture(true, true);
  expect(r.exitCode).toBe(1);
  expect(r.proof.error).toBe('REAL_PROVIDER_DID_NOT_SATISFY_CURRENT_REQUEST');
  expect(r.proof.failureDiagnostics).toHaveLength(2);
  expect(r.proof.failureDiagnostics.every((d: any) => d.error === 'DIAGNOSTIC_PROVIDER_CALL_FAILED')).toBe(true);
});
