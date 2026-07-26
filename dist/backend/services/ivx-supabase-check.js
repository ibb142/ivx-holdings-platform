/**
 * IVX "Check Supabase" staged diagnostic (owner-only).
 *
 * Runs a REAL, observable workflow against the live Supabase project and returns
 * each stage as discrete execution evidence — never a generic "please wait":
 *   1. connection    → DNS/HTTPS reachability of the project REST host
 *   2. authentication → service-role key accepted by PostgREST
 *   3. query          → live SELECT against the authoritative jv_deals table
 *   4. response       → row count + sample shape from the query response
 *   5. verification   → cross-check the row count is internally consistent
 *   6. completion     → overall pass/fail summary
 *
 * Each stage records started/finished timestamps, duration, an honest status
 * (ok / failed / skipped), a human detail line, and (where relevant) the real
 * HTTP status — so the owner can watch the whole thing stream on the tablet.
 *
 * Read-only. The service-role key is never returned. On missing config the
 * stages fail honestly with the exact missing env var.
 */
import { listAgentRuns } from './ivx-agent-activity-store';
import { recordMetricSample } from './ivx-metrics-store';
export const IVX_SUPABASE_CHECK_MARKER = 'ivx-supabase-check-2026-05-31';
const TABLE = 'jv_deals';
const FETCH_TIMEOUT_MS = 9000;
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveConfig() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    const key = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
    const missing = [];
    if (!url)
        missing.push('EXPO_PUBLIC_SUPABASE_URL');
    if (!key)
        missing.push('SUPABASE_SERVICE_ROLE_KEY');
    return { url, key, missing };
}
/** Mask a Supabase host so we never echo the full project ref verbatim. */
function maskHost(url) {
    try {
        const host = new URL(url).host;
        const [ref, ...rest] = host.split('.');
        if (!ref)
            return host;
        const maskedRef = ref.length <= 6 ? `${ref.slice(0, 2)}***` : `${ref.slice(0, 4)}***${ref.slice(-2)}`;
        return [maskedRef, ...rest].join('.');
    }
    catch {
        return null;
    }
}
function nowIso() {
    return new Date().toISOString();
}
function finalizeStage(draft, startedIso) {
    const finished = Date.now();
    return {
        name: draft.name,
        title: draft.title,
        status: draft.status,
        detail: draft.detail,
        httpStatus: draft.httpStatus,
        startedAt: startedIso,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - draft.startedAt,
    };
}
/**
 * Execute the staged Supabase check. Always resolves (never throws) — a failure
 * at any stage is recorded honestly and downstream stages are marked skipped.
 */
export async function runSupabaseCheck() {
    const overallStart = Date.now();
    const startedAt = new Date(overallStart).toISOString();
    const stages = [];
    const { url, key, missing } = resolveConfig();
    const projectHostMasked = url ? maskHost(url) : null;
    let rowCount = null;
    let ok = true;
    const pushStage = (draft, startedIso) => {
        stages.push(finalizeStage(draft, startedIso));
    };
    // ---- Stage 1: connection ----
    {
        const s = Date.now();
        const startedIso = new Date(s).toISOString();
        if (missing.length > 0) {
            ok = false;
            pushStage({ name: 'connection', title: 'Connection', status: 'failed', detail: `Supabase not configured. Missing backend env: ${missing.join(', ')}.`, httpStatus: null, startedAt: s }, startedIso);
            // Everything downstream is skipped.
            for (const next of ['authentication', 'query', 'response', 'verification']) {
                const ns = Date.now();
                pushStage({ name: next, title: titleFor(next), status: 'skipped', detail: 'Skipped — Supabase is not configured.', httpStatus: null, startedAt: ns }, new Date(ns).toISOString());
            }
            const cs = Date.now();
            pushStage({ name: 'completion', title: 'Completion', status: 'failed', detail: `Check aborted: ${missing.join(', ')} not set on the backend runtime.`, httpStatus: null, startedAt: cs }, new Date(cs).toISOString());
            return assemble(stages, ok, startedAt, overallStart, projectHostMasked, rowCount);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(`${url}/rest/v1/`, {
                method: 'GET',
                signal: controller.signal,
                headers: { apikey: key, Accept: 'application/json' },
            });
            pushStage({ name: 'connection', title: 'Connection', status: 'ok', detail: `Reached ${projectHostMasked ?? 'project host'} over HTTPS.`, httpStatus: response.status, startedAt: s }, startedIso);
        }
        catch (error) {
            ok = false;
            const reason = error instanceof Error ? error.message : 'network error';
            pushStage({ name: 'connection', title: 'Connection', status: 'failed', detail: `Could not reach the Supabase host: ${reason}.`, httpStatus: null, startedAt: s }, startedIso);
            for (const next of ['authentication', 'query', 'response', 'verification']) {
                const ns = Date.now();
                pushStage({ name: next, title: titleFor(next), status: 'skipped', detail: 'Skipped — host unreachable.', httpStatus: null, startedAt: ns }, new Date(ns).toISOString());
            }
            const cs = Date.now();
            pushStage({ name: 'completion', title: 'Completion', status: 'failed', detail: 'Check failed at connection.', httpStatus: null, startedAt: cs }, new Date(cs).toISOString());
            return assemble(stages, ok, startedAt, overallStart, projectHostMasked, rowCount);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    // ---- Stages 2-4: authentication + query + response in one authenticated call ----
    let queryHttpStatus = null;
    let queryBody = null;
    let queryFailed = false;
    {
        const authStart = Date.now();
        const authStartedIso = new Date(authStart).toISOString();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const endpoint = `${url}/rest/v1/${TABLE}?select=id&limit=5`;
            const response = await fetch(endpoint, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    Accept: 'application/json',
                    Prefer: 'count=exact',
                },
            });
            queryHttpStatus = response.status;
            // Stage 2: authentication — 401/403 means the key was rejected.
            if (response.status === 401 || response.status === 403) {
                ok = false;
                queryFailed = true;
                pushStage({ name: 'authentication', title: 'Authentication', status: 'failed', detail: `Service-role key rejected (HTTP ${response.status}).`, httpStatus: response.status, startedAt: authStart }, authStartedIso);
            }
            else {
                pushStage({ name: 'authentication', title: 'Authentication', status: 'ok', detail: 'Service-role key accepted by PostgREST.', httpStatus: response.status, startedAt: authStart }, authStartedIso);
            }
            // Stage 3: query
            const qStart = Date.now();
            const qStartedIso = new Date(qStart).toISOString();
            if (queryFailed) {
                pushStage({ name: 'query', title: 'Query', status: 'skipped', detail: 'Skipped — authentication failed.', httpStatus: null, startedAt: qStart }, qStartedIso);
            }
            else if (!response.ok) {
                ok = false;
                queryFailed = true;
                pushStage({ name: 'query', title: 'Query', status: 'failed', detail: `SELECT on public.${TABLE} returned HTTP ${response.status}.`, httpStatus: response.status, startedAt: qStart }, qStartedIso);
            }
            else {
                pushStage({ name: 'query', title: 'Query', status: 'ok', detail: `SELECT id FROM public.${TABLE} LIMIT 5 (count=exact).`, httpStatus: response.status, startedAt: qStart }, qStartedIso);
            }
            // Read the body + content-range for the response stage.
            const contentRange = response.headers.get('content-range');
            try {
                queryBody = await response.json();
            }
            catch {
                queryBody = null;
            }
            // Stage 4: response
            const rStart = Date.now();
            const rStartedIso = new Date(rStart).toISOString();
            if (queryFailed) {
                pushStage({ name: 'response', title: 'Response', status: 'skipped', detail: 'Skipped — query did not run.', httpStatus: null, startedAt: rStart }, rStartedIso);
            }
            else {
                rowCount = parseCount(contentRange, queryBody);
                const sample = Array.isArray(queryBody) ? `${queryBody.length} row(s) sampled` : 'no array body';
                pushStage({ name: 'response', title: 'Response', status: 'ok', detail: `Response parsed: ${rowCount ?? 'unknown'} total row(s) in ${TABLE}; ${sample}.`, httpStatus: queryHttpStatus, startedAt: rStart }, rStartedIso);
            }
        }
        catch (error) {
            ok = false;
            queryFailed = true;
            const reason = error instanceof Error ? error.message : 'request error';
            // Whatever hadn't been pushed yet for auth/query/response gets honest entries.
            if (!stages.some((st) => st.name === 'authentication')) {
                pushStage({ name: 'authentication', title: 'Authentication', status: 'failed', detail: `Auth request errored: ${reason}.`, httpStatus: null, startedAt: authStart }, authStartedIso);
            }
            for (const next of ['query', 'response']) {
                if (!stages.some((st) => st.name === next)) {
                    const ns = Date.now();
                    pushStage({ name: next, title: titleFor(next), status: 'failed', detail: `Failed: ${reason}.`, httpStatus: null, startedAt: ns }, new Date(ns).toISOString());
                }
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
    // ---- Stage 5: verification ----
    {
        const vStart = Date.now();
        const vStartedIso = new Date(vStart).toISOString();
        if (queryFailed) {
            ok = false;
            pushStage({ name: 'verification', title: 'Verification', status: 'skipped', detail: 'Skipped — no successful response to verify.', httpStatus: null, startedAt: vStart }, vStartedIso);
        }
        else if (rowCount === null) {
            pushStage({ name: 'verification', title: 'Verification', status: 'ok', detail: 'Connection + auth + query verified; row count not exposed by PostgREST (no count header).', httpStatus: null, startedAt: vStart }, vStartedIso);
        }
        else {
            const sampleLen = Array.isArray(queryBody) ? queryBody.length : 0;
            const consistent = sampleLen <= rowCount;
            if (!consistent)
                ok = false;
            pushStage({ name: 'verification', title: 'Verification', status: consistent ? 'ok' : 'failed', detail: consistent ? `Verified: ${rowCount} total row(s); sample of ${sampleLen} is consistent.` : `Inconsistent: sample ${sampleLen} exceeds reported total ${rowCount}.`, httpStatus: null, startedAt: vStart }, vStartedIso);
        }
    }
    // ---- Stage 6: completion ----
    {
        const cStart = Date.now();
        const cStartedIso = new Date(cStart).toISOString();
        pushStage({ name: 'completion', title: 'Completion', status: ok ? 'ok' : 'failed', detail: ok ? `Supabase check passed end-to-end${rowCount !== null ? ` · ${rowCount} row(s) in ${TABLE}` : ''}.` : 'Supabase check completed with failures — see stages above.', httpStatus: null, startedAt: cStart }, cStartedIso);
    }
    return assemble(stages, ok, startedAt, overallStart, projectHostMasked, rowCount);
}
function titleFor(name) {
    switch (name) {
        case 'connection': return 'Connection';
        case 'authentication': return 'Authentication';
        case 'query': return 'Query';
        case 'response': return 'Response';
        case 'verification': return 'Verification';
        case 'completion': return 'Completion';
    }
}
/** Parse the total row count from the PostgREST content-range header, else array length. */
function parseCount(contentRange, body) {
    if (contentRange && contentRange.includes('/')) {
        const total = contentRange.split('/').pop();
        if (total && total !== '*') {
            const n = Number.parseInt(total, 10);
            if (Number.isFinite(n))
                return n;
        }
    }
    return Array.isArray(body) ? body.length : null;
}
function assemble(stages, ok, startedAt, overallStart, projectHostMasked, rowCount) {
    const finished = Date.now();
    const failedCount = stages.filter((s) => s.status === 'failed').length;
    // Metric: live Supabase REST query latency + success (from the real query stage).
    const queryStage = stages.find((s) => s.name === 'query');
    if (queryStage && queryStage.status !== 'skipped') {
        recordMetricSample({
            kind: 'supabase_query',
            latencyMs: queryStage.durationMs,
            success: queryStage.status === 'ok',
            statusCode: queryStage.httpStatus,
            detail: `jv_deals · ${queryStage.status}`,
        });
    }
    const summary = ok
        ? `All ${stages.length} stages passed. Supabase is reachable, authenticated, and queryable.`
        : `${failedCount} of ${stages.length} stage(s) failed. See the failing stage for the exact reason.`;
    return {
        marker: IVX_SUPABASE_CHECK_MARKER,
        ok,
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - overallStart,
        projectHostMasked,
        table: TABLE,
        rowCount,
        stages,
        summary,
    };
}
/**
 * Run the Supabase check AND record it as a background-agent run so it appears in
 * the live work queue with proof. Returns the full staged result.
 */
export async function runTrackedSupabaseCheck() {
    const { withAgentRun } = await import('./ivx-agent-activity-store');
    return withAgentRun({
        kind: 'supabase_check',
        label: 'Check Supabase',
        why: 'Owner requested a live Supabase connectivity + data check.',
        detail: 'Connection → authentication → query → response → verification → completion.',
        proofOf: (result) => result.ok
            ? `Passed all ${result.stages.length} stages${result.rowCount !== null ? ` · ${result.rowCount} row(s) in ${result.table}` : ''}.`
            : `Failed: ${result.summary}`,
    }, runSupabaseCheck);
}
/** Re-export so the live-work aggregator can read recent agent runs without an extra import. */
export { listAgentRuns };
