/**
 * IVX Test Reporter
 *
 * Structured wrapper around the senior-dev `test_run` tool. Produces a
 * proof-grade summary suitable for the Live Work Visibility panel.
 */
import { executeSeniorDevTool } from './ivx-senior-dev-tools';
export const IVX_TEST_REPORTER_MARKER = 'ivx-test-reporter-2026-05-28';
export async function runStructuredTestReport(suite) {
    const startedAt = new Date();
    try {
        const raw = await executeSeniorDevTool('test_run', { suite });
        const finishedAt = new Date();
        return {
            ok: raw.ok === true,
            marker: IVX_TEST_REPORTER_MARKER,
            suite,
            exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : null,
            durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : finishedAt.getTime() - startedAt.getTime(),
            stdoutHead: (raw.stdout ?? '').slice(0, 2000),
            stderrHead: (raw.stderr ?? '').slice(0, 2000),
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            error: raw.error,
        };
    }
    catch (error) {
        const finishedAt = new Date();
        return {
            ok: false,
            marker: IVX_TEST_REPORTER_MARKER,
            suite,
            exitCode: null,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            stdoutHead: '',
            stderrHead: '',
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            error: error instanceof Error ? error.message : 'test_run failed',
        };
    }
}
