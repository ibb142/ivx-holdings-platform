/**
 * Tests for the IVX Execution Trace & Audit System (TASK 3).
 *
 * Verifies every action is traceable with the full linked record (tool name,
 * request id, timestamp, task id, conversation id, raw output, linked claim)
 * and that retrieval works ACROSS SESSIONS — i.e. a value written via the
 * public API is read back from the durable store by a fresh read, exactly the
 * way a new process would re-hydrate it.
 *
 * Pure filesystem I/O, no AI/network → runs anywhere.
 */
import { describe, expect, test } from 'bun:test';
import { IVX_EXECUTION_TRACE_MARKER, serializeRawOutput, recordExecutionTrace, getExecutionTrace, getTracesByRequestId, getTracesByConversationId, getTracesByTaskId, listExecutionTraces, summarizeExecutionTraces, } from './ivx-execution-trace-store';
function uniqueSuffix() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
describe('serializeRawOutput', () => {
    test('serializes objects to pretty JSON', () => {
        const { text, truncated } = serializeRawOutput({ ok: true, rows: 3 });
        expect(text).toContain('"ok": true');
        expect(text).toContain('"rows": 3');
        expect(truncated).toBe(false);
    });
    test('passes strings through unchanged', () => {
        const { text, truncated } = serializeRawOutput('HTTP 200 OK');
        expect(text).toBe('HTTP 200 OK');
        expect(truncated).toBe(false);
    });
    test('null/undefined become empty string', () => {
        expect(serializeRawOutput(null).text).toBe('');
        expect(serializeRawOutput(undefined).text).toBe('');
    });
    test('caps very large output + flags truncation', () => {
        const big = 'x'.repeat(20000);
        const { text, truncated } = serializeRawOutput(big);
        expect(truncated).toBe(true);
        expect(text.length).toBeLessThan(big.length);
        expect(text).toContain('truncated');
    });
});
describe('recordExecutionTrace + linked retrieval', () => {
    test('records every required field and returns a trace id', async () => {
        const requestId = `req_${uniqueSuffix()}`;
        const id = await recordExecutionTrace({
            toolName: 'ivx_self_developer_runtime',
            requestId,
            taskId: `task_${uniqueSuffix()}`,
            conversationId: `conv_${uniqueSuffix()}`,
            rawOutput: { jobId: 'job-1', passed: true },
            rawOutputRef: 'logs/audit/job-1.json',
            linkedClaim: 'Validation passed in production.',
        });
        expect(id).toStartWith('trace_');
        const trace = await getExecutionTrace(id);
        expect(trace).not.toBeNull();
        expect(trace?.toolName).toBe('ivx_self_developer_runtime');
        expect(trace?.requestId).toBe(requestId);
        expect(trace?.taskId).toContain('task_');
        expect(trace?.conversationId).toContain('conv_');
        expect(trace?.rawOutput).toContain('job-1');
        expect(trace?.rawOutputRef).toBe('logs/audit/job-1.json');
        expect(trace?.linkedClaim).toBe('Validation passed in production.');
        expect(typeof trace?.timestamp).toBe('string');
    });
    test('retrieves all traces for a request id (across a fresh durable read)', async () => {
        const requestId = `req_${uniqueSuffix()}`;
        await recordExecutionTrace({ toolName: 'tool_a', requestId, rawOutput: 'a' });
        await recordExecutionTrace({ toolName: 'tool_b', requestId, rawOutput: 'b' });
        // Fresh read from the durable store — what a new session/process would see.
        const traces = await getTracesByRequestId(requestId);
        expect(traces.length).toBe(2);
        const tools = traces.map((t) => t.toolName).sort();
        expect(tools).toEqual(['tool_a', 'tool_b']);
    });
    test('retrieves traces by conversation id and task id', async () => {
        const conversationId = `conv_${uniqueSuffix()}`;
        const taskId = `task_${uniqueSuffix()}`;
        await recordExecutionTrace({
            toolName: 'capital_workflow',
            requestId: `req_${uniqueSuffix()}`,
            conversationId,
            taskId,
            rawOutput: { step: 'rank' },
            linkedClaim: 'Ranked CRM candidates.',
        });
        const byConversation = await getTracesByConversationId(conversationId);
        expect(byConversation.length).toBe(1);
        expect(byConversation[0].linkedClaim).toBe('Ranked CRM candidates.');
        const byTask = await getTracesByTaskId(taskId);
        expect(byTask.length).toBe(1);
        expect(byTask[0].taskId).toBe(taskId);
    });
    test('blank / missing optional fields normalize to null without throwing', async () => {
        const requestId = `req_${uniqueSuffix()}`;
        const id = await recordExecutionTrace({
            toolName: '   ',
            requestId,
            taskId: '   ',
            conversationId: undefined,
        });
        const trace = await getExecutionTrace(id);
        expect(trace?.toolName).toBe('unknown_tool');
        expect(trace?.taskId).toBeNull();
        expect(trace?.conversationId).toBeNull();
        expect(trace?.linkedClaim).toBeNull();
    });
    test('unknown ids return empty / null', async () => {
        expect(await getExecutionTrace('does-not-exist')).toBeNull();
        expect(await getTracesByRequestId('nope')).toEqual([]);
        expect(await getTracesByConversationId('')).toEqual([]);
        expect(await getTracesByTaskId('')).toEqual([]);
    });
});
describe('summarizeExecutionTraces', () => {
    test('returns the durable marker and consistent totals', async () => {
        const requestId = `req_${uniqueSuffix()}`;
        await recordExecutionTrace({ toolName: 'summary_tool', requestId, linkedClaim: 'x' });
        const summary = await summarizeExecutionTraces();
        expect(summary.marker).toBe(IVX_EXECUTION_TRACE_MARKER);
        expect(summary.total).toBeGreaterThanOrEqual(1);
        expect(summary.uniqueRequests).toBeGreaterThanOrEqual(1);
        expect(summary.withLinkedClaim).toBeGreaterThanOrEqual(1);
        // byTool counts are consistent with the recorded tool.
        expect(summary.byTool.summary_tool).toBeGreaterThanOrEqual(1);
    });
    test('list is bounded and newest-first', async () => {
        const traces = await listExecutionTraces(5);
        expect(traces.length).toBeLessThanOrEqual(5);
        for (let i = 1; i < traces.length; i += 1) {
            expect(traces[i - 1].timestamp >= traces[i].timestamp).toBe(true);
        }
    });
});
