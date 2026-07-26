let _sb = null;
async function getSB() {
    if (_sb)
        return _sb;
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
        const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
        if (!url || !key)
            return null;
        _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
        return _sb;
    }
    catch {
        return null;
    }
}
function rowToEntry(row) {
    return {
        task_id: String(row.task_id ?? ''),
        chat_message_id: row.chat_message_id ?? null,
        requested_by: String(row.requested_by ?? ''),
        action_type: String(row.action_type ?? ''),
        files_changed: Array.isArray(row.files_changed) ? row.files_changed : [],
        git_diff_summary: row.git_diff_summary ?? null,
        tests_run: Array.isArray(row.tests_run) ? row.tests_run : null,
        test_result: row.test_result ?? null,
        typecheck_result: row.typecheck_result ?? null,
        commit_sha: row.commit_sha ?? null,
        commit_url: row.commit_url ?? null,
        render_deploy_id: row.render_deploy_id ?? null,
        render_deploy_status: row.render_deploy_status ?? null,
        live_url_tested: row.live_url_tested ?? null,
        live_http_status: typeof row.live_http_status === 'number' ? row.live_http_status : null,
        live_response_snippet: row.live_response_snippet ?? null,
        deployed_commit: row.deployed_commit ?? null,
        commit_match: Boolean(row.commit_match),
        final_status: row.final_status ?? 'UNVERIFIED',
        created_at: String(row.created_at ?? new Date().toISOString()),
        completed_at: row.completed_at ?? null,
    };
}
function entryToRow(entry) {
    return {
        task_id: entry.task_id,
        chat_message_id: entry.chat_message_id,
        requested_by: entry.requested_by,
        action_type: entry.action_type,
        files_changed: JSON.stringify(entry.files_changed),
        git_diff_summary: entry.git_diff_summary,
        tests_run: entry.tests_run ? JSON.stringify(entry.tests_run) : null,
        test_result: entry.test_result,
        typecheck_result: entry.typecheck_result,
        commit_sha: entry.commit_sha,
        commit_url: entry.commit_url,
        render_deploy_id: entry.render_deploy_id,
        render_deploy_status: entry.render_deploy_status,
        live_url_tested: entry.live_url_tested,
        live_http_status: entry.live_http_status,
        live_response_snippet: entry.live_response_snippet,
        deployed_commit: entry.deployed_commit,
        commit_match: entry.commit_match,
        final_status: entry.final_status,
        created_at: entry.created_at,
        completed_at: entry.completed_at,
    };
}
/**
 * Persist a Developer Proof entry to the Supabase developer_proof_ledger table.
 * Upserts by task_id. Returns true on success, false on failure (caller falls
 * back to in-memory ledger).
 */
export async function persistDeveloperProofToLedger(entry) {
    const sb = await getSB();
    if (!sb)
        return false;
    try {
        const { error } = await sb.from('developer_proof_ledger')
            .upsert(entryToRow(entry), { onConflict: 'task_id' })
            .eq('task_id', entry.task_id);
        if (error) {
            console.error('[DeveloperProofLedger] persist failed:', error.message);
            return false;
        }
        return true;
    }
    catch (err) {
        console.error('[DeveloperProofLedger] persist exception:', err instanceof Error ? err.message : 'unknown');
        return false;
    }
}
/**
 * Fetch a single proof entry by task_id from the Supabase ledger.
 */
export async function fetchDeveloperProofFromLedger(task_id) {
    const sb = await getSB();
    if (!sb)
        return null;
    try {
        const { data, error } = await sb.from('developer_proof_ledger')
            .select('*')
            .eq('task_id', task_id)
            .maybeSingle();
        if (error || !data)
            return null;
        return rowToEntry(data);
    }
    catch {
        return null;
    }
}
/**
 * Fetch the latest proof entry from the Supabase ledger (most recent created_at).
 */
export async function fetchLatestDeveloperProofFromLedger() {
    const sb = await getSB();
    if (!sb)
        return null;
    try {
        const { data, error } = await sb.from('developer_proof_ledger')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error || !data)
            return null;
        return rowToEntry(data);
    }
    catch {
        return null;
    }
}
/**
 * Fetch the full proof history from the Supabase ledger, newest-first.
 */
export async function fetchDeveloperProofHistoryFromLedger(limit = 100) {
    const sb = await getSB();
    if (!sb)
        return [];
    try {
        const { data, error } = await sb.from('developer_proof_ledger')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error || !Array.isArray(data))
            return [];
        return data.map(rowToEntry);
    }
    catch {
        return [];
    }
}
