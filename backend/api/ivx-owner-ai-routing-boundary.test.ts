import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { classifyIntent } from '../services/ivx-authoritative-intent-router';
import { parseOwnerTaskStatusCommand, readOwnerTaskStatus } from '../services/ivx-owner-task-status';
import { ownerTextFailure } from '../services/ivx-owner-text-failure';

// Execute the production entry function, replacing I/O at its boundary. Importing
// the giant route would initialize unrelated runtime modules and global mocks.
// This covers routing/persistence/error contracts, not live provider execution.
const source = readFileSync(new URL('./ivx-owner-ai.ts', import.meta.url), 'utf8');
const entry = source.slice(source.indexOf('async function executeIVXOwnerAIRequestInternal('));
const statusStart = source.indexOf('function getErrorStatus(');
const statusFunction = source.slice(statusStart, source.indexOf('\nfunction isHealthProbe', statusStart));
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(statusFunction + '\n' + entry);

async function invoke(message: string, storageFailure = false) {
  const writes: string[] = [], decisions: string[] = [];
  let externalCalls = 0;
  const unavailable = Object.assign(new Error('Task storage unavailable'), { status: 503, code: 'STORAGE_UNAVAILABLE' });
  const context = {
    Response, Date, Error, console: { log() {}, error() {} },
    readTrimmedString: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    getOwnerAIModel: () => 'fixture', parseOwnerTaskStatusCommand, readOwnerTaskStatus,
    resolveIVXIdentityAnswer: () => null, detectClassificationQuestion: () => null,
    detectIdentityOrCapabilityQuestion: () => null, extractImageAttachmentsFromBody: () => [],
    classifyIntent: (input: Parameters<typeof classifyIntent>[0]) => {
      const decision = classifyIntent(input); decisions.push(decision.selectedRoute); return decision;
    },
    resolveOwnerTables: async () => { if (storageFailure) throw unavailable; return { schema: 'ivx' }; },
    ensureOwnerConversation: async () => ({ id: 'owner-room' }),
    readPostgresTaskById: async (taskId: string) => ({ taskId, state: 'RUNNING' }),
    getSeniorDeveloperJob: async () => null,
    insertMessage: async (_client: unknown, _tables: unknown, input: { body: string }) => {
      writes.push(input.body); return { id: `saved-${writes.length}` };
    },
    IVX_OWNER_AI_PROFILE: { name: 'IVX IA' }, DEPLOYMENT_MARKER: 'fixture',
    createRequestId: () => 'unexpected-new-request',
    ownerOnlyJson: (body: unknown, status = 200) => Response.json(body, { status }),
    ownerAIAuthUnavailableResponse: () => null, classifyOwnerAIFailure: () => 'unknown',
    fetch: async () => { externalCalls++; throw new Error('No liveness/provider shortcut allowed'); },
  };
  const execute = runInNewContext(code + '\nexecuteIVXOwnerAIRequestInternal', context);
  const response: Response = await execute(new Request('https://api.invalid/api/ivx/owner-ai'),
    { userId: 'owner', client: {} }, { message, requestId: 'original-request' });
  return { response, body: await response.json(), writes, decisions, externalCalls };
}

test('screenshot /status command produces a persisted visible answer without a model or worker execution', async () => {
  const result = await invoke('/status --task="task_framework_patch_block_18_final"');
  expect(result.response.status).toBe(200);
  expect(result.body.selectedTool).toBe('task_status');
  expect(result.body.answer).toContain('Status: RUNNING');
  expect(result.body.assistantPersisted).toBe(true);
  expect(result.writes).toEqual(['/status --task="task_framework_patch_block_18_final"', result.body.answer]);
  expect(result.externalCalls).toBe(0);
});

test('a malformed status query never reaches storage or another route', async () => {
  const result = await invoke('/status --task=x --deploy', true);
  expect(result.response.status).toBe(400); expect(result.writes).toHaveLength(0);
  expect(result.decisions).toHaveLength(0); expect(result.externalCalls).toBe(0);
});

test('the exact audit/fix request reaches developer routing instead of returning a liveness proof', async () => {
  const result = await invoke('Can you audit ivx ia have a lot issue to connect to autonomous or to be senior developer fix this now deep audit deep QA', true);
  expect(result.decisions).toEqual(['DEVELOPER_WORKER']); expect(result.externalCalls).toBe(0);
  expect(result.response.status).toBe(503);
  expect(result.body).toMatchObject({ ok: false, status: 'error', code: 'STORAGE_UNAVAILABLE', requestId: 'original-request' });
});

test('both production text error branches expose admission failure without creating a replacement request', async () => {
  for (const marker of ['// ── Knowledge requests', '// ── Manual answer mode']) {
    const start = source.indexOf('} catch (llmError) {', source.indexOf(marker)) + '} catch (llmError) {'.length;
    const end = source.indexOf('\n    }\n', start);
    const branch = source.slice(start, end).replace(/\n      }\s*$/, '');
    const execute = runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(
      `async function executeFailure(llmError) { ${branch} }`) + '\nexecuteFailure', {
      ownerTextFailure, Error, console: { error() {} }, requestId: 'original-request',
      body: { requestId: 'original-request' }, conversation: { id: 'owner-room' },
      readTrimmedString: (value: string) => value, createRequestId: () => { throw new Error('ID changed'); },
      authoritativeDecision: { intent: 'conversation' }, DEPLOYMENT_MARKER: 'fixture',
      buildRouterDebug: (value: unknown) => value,
      buildOwnerAIResponsePayload: (safe: object, metadata: object) => ({ ...safe, ...metadata }),
      ownerOnlyJson: (body: unknown, status: number) => Response.json(body, { status }),
    });
    const response: Response = await execute(new Error('Global AI budget: durable admission unavailable'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, status: 'error',
      requestId: 'original-request', traceId: 'original-request',
      code: 'IVX_AI_BUDGET_ADMISSION_UNAVAILABLE', providerRequestState: 'not_started',
      error: 'Global AI budget: durable admission unavailable', selectedTool: null });
  }
});

test('health probe fallback stays canonical without fabricating a provider result', () => {
  const probeStart = source.indexOf('const probePayload: IVXOwnerAIHealthProbeResponse = {');
  const probeEnd = source.indexOf('\n        };', probeStart);

  expect(probeStart).toBeGreaterThan(-1);
  expect(probeEnd).toBeGreaterThan(probeStart);
  const probeBranch = source.slice(probeStart, probeEnd);
  expect(probeBranch).toContain("model: aiResult?.model ?? 'ivx_health_probe_unavailable'");
  expect(probeBranch).toContain("source: aiResult?.source ?? 'local_app_brain'");
  expect(probeBranch).toContain('provider: aiResult?.provider');
  expect(probeBranch).not.toContain("provider: aiResult?.provider ?? 'chatgpt'");
});
