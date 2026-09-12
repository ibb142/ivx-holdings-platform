import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../expo/lib/auth-context.tsx', import.meta.url), 'utf8');
const normalizerStart = source.indexOf('function normalizeLoginFailureMessage(');
const normalizerEnd = source.indexOf('\nfunction shouldAcceptResolvedRole(', normalizerStart);
if (normalizerStart < 0 || normalizerEnd < normalizerStart) throw new Error('Login normalizer not found');
const normalizer = source.slice(normalizerStart, normalizerEnd);

function failure(branch: 'session' | 'catch', message: string) {
  const anchor = branch === 'session'
    ? source.indexOf('      if (serverSessionUsable) {')
    : source.indexOf("      return { success: true, message: 'Login successful', traceId: trace.traceId };");
  const start = source.indexOf(branch === 'session' ? '        if (sessionError) {' : '    } catch (error: unknown) {', anchor);
  const end = source.indexOf(branch === 'session' ? '\n        resolvedSession = sessionData.session;' : '\n    } finally {', start);
  if (anchor < 0 || start < 0 || end < start) throw new Error('Login failure branch not found');
  const body = branch === 'session'
    ? source.slice(start, end)
    : source.slice(start + '    } catch (error: unknown) {'.length, end);
  const manualOwnerLoginRef = { current: true };
  const error = { message, name: 'AuthRetryableFetchError', code: 'auth_timeout', status: 503 };
  const result = runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `${normalizer}\n(function () {${body}\n})()`), {
    error, sessionError: error, manualOwnerLoginRef,
    trace: { checkpoint() {} }, extractAuthErrorMessage: (e: typeof error) => e.message,
  });
  return { result, manualOwnerLoginRef };
}

for (const branch of ['session', 'catch'] as const) {
  test(`${branch}: aborted Auth explains availability while preserving diagnostics and denying login`, () => {
    const { result, manualOwnerLoginRef } = failure(branch, 'Aborted');
    expect(result.success).toBe(false);
    expect(result.message).toContain('temporarily unavailable');
    expect(result.message).not.toBe('Aborted');
    expect(result.failureReason).toBe('service_unavailable');
    expect(result.supabaseErrorMessage).toBe('Aborted');
    expect(result.supabaseErrorCode).toBe('auth_timeout');
    expect(manualOwnerLoginRef.current).toBe(false);
  });
  test(`${branch}: unknown failure stays explicit and cannot become a successful session`, () => {
    const { result } = failure(branch, 'Session could not be installed on the device.');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Session could not be installed on the device.');
    expect(result.supabaseErrorMessage).toBe('Session could not be installed on the device.');
  });
}
