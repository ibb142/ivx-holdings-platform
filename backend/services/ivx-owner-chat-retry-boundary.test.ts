import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../expo/app/ivx/chat.tsx', import.meta.url), 'utf8');

async function execute(branch: 'local' | 'background', error?: Error) {
  let code: string;
  if (branch === 'local') {
    const start = source.indexOf('          void assistantReplyMutation.mutateAsync(');
    const end = source.indexOf('\n        } else {', start);
    if (start < 0 || end < start) throw new Error('Local chat invocation not found');
    code = source.slice(start, end);
  } else {
    const start = source.indexOf('      const triggerAssistant');
    const end = source.indexOf('\n\n      // The optimistic owner row', start);
    if (start < 0 || end < start) throw new Error('Background chat invocation not found');
    code = source.slice(start, end) + '\nvoid ' + source.slice(start, end).match(/const (\w+) = async/)![1] + '();';
  }
  const calls: unknown[] = [], failures: unknown[] = [];
  const trace = { fail: (...args: unknown[]) => failures.push(args) };
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(code), {
    clientId: 'same-request', effectiveText: 'owner command', mode: 'send_and_ai', watchdogTraceId: 'trace',
    wdLF: trace, watchdogTrace: trace, console: { log() {} },
    assistantReplyMutation: { mutateAsync: async (args: unknown) => {
      calls.push(args);
      if (error) throw error;
    } },
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return { calls, failures };
}

for (const branch of ['local', 'background'] as const) {
  test(`${branch}: exhausted transport failure cannot restart the entire AI mutation`, async () => {
    const result = await execute(branch, Object.assign(new Error('AUTH_SERVICE_UNAVAILABLE'), { diagnostics: { statusCode: 503 } }));
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({ requestId: 'same-request', text: 'owner command' });
    expect(result.failures).toHaveLength(1);
    expect(JSON.stringify(result.failures)).toContain('AUTH_SERVICE_UNAVAILABLE');
  });
  test(`${branch}: successful mutation runs once without a failure report`, async () => {
    const result = await execute(branch);
    expect(result.calls).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
  });
}
