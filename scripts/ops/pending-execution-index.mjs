import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { candidates, validateConnection, renderKey } from './autonomous-db-sync.mjs';

const indexName = 'public.idx_ivx_agent_exec_pending_discovery';
export const expectedDefinition = "CREATE INDEX idx_ivx_agent_exec_pending_discovery ON public.ivx_agent_executions USING btree (workflow, task_type, started_at NULLS FIRST, task_id) INCLUDE (run_id, agent_id, agent_number, final_status) WHERE (final_status = ANY (ARRAY['pending'::text, 'running'::text]))";

async function inspect(db) {
  const result = await db.query(`SELECT i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i WHERE i.indexrelid=to_regclass($1)`, [indexName]);
  if (result.rows.length > 1) throw new Error('index_identity_ambiguous');
  return result.rows[0] ?? null;
}

/** Rebuild only this exact, unusable index left by an interrupted concurrent build. */
export async function repairPendingExecutionIndex(db) {
  const lock = await db.query("SELECT pg_try_advisory_lock(hashtextextended('ivx-pending-execution-index-v1',0)) AS acquired");
  if (lock.rows[0]?.acquired !== true) throw new Error('index_maintenance_already_running');
  try {
    const before = await inspect(db);
    if (before && before.definition !== expectedDefinition) throw new Error('index_definition_mismatch');
    if (before?.indisvalid && before?.indisready) return { status: 'already_valid', before, after: before };
    const active = await db.query("SELECT pid FROM pg_stat_progress_create_index WHERE relid='public.ivx_agent_executions'::regclass LIMIT 1");
    if (active.rows.length) throw new Error('index_maintenance_already_running');
    if (before) await db.query('DROP INDEX CONCURRENTLY public.idx_ivx_agent_exec_pending_discovery');
    const sql = await readFile(new URL('../../supabase/repair-functions/ivx-pending-execution-index.sql', import.meta.url), 'utf8');
    await db.query(sql);
    const after = await inspect(db);
    if (!after?.indisvalid || !after?.indisready || after.definition !== expectedDefinition) throw new Error('index_verification_failed');
    return { status: before ? 'rebuilt_invalid' : 'created', before, after };
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtextextended('ivx-pending-execution-index-v1',0))");
  }
}

export function sessionConnection(raw) {
  const original = validateConnection(raw);
  if (!original) return null;
  // A session pool preserves the advisory lock and session timeouts. Never use
  // a transaction pool for these session-scoped maintenance guarantees.
  if (original.host.endsWith('.pooler.supabase.com') && original.port === 6543) original.port = 5432;
  if (original.port !== 5432) return null;
  return { ...original, query_timeout: 0, statement_timeout: 1_800_000, application_name: 'ivx-pending-index-maintenance' };
}

async function readEnv(serviceId,key) {
  const env = {}; let cursor = ''; const seen = new Set();
  for (let page=0;page<20;page++) {
    const r = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('render_env_read_failed');
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('render_env_response_invalid');
    for (const item of rows) { const value = item.envVar ?? item; if (typeof value.key==='string' && typeof value.value==='string') env[value.key]=value.value; }
    if (rows.length<100) return env;
    cursor=rows.at(-1)?.cursor;
    if (!cursor || seen.has(cursor)) throw new Error('render_env_pagination_incomplete');
    seen.add(cursor);
  }
  throw new Error('render_env_pagination_limit');
}

async function productionConnection() {
  const sources = [{ id: 'github_actions', env: process.env }];
  const key = await renderKey();
  for (const id of ['srv-d7t9ivreo5us73ftose0','srv-d9i15fg4n6ts73bn00j0']) {
    const r = await fetch(`https://api.render.com/v1/services/${id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('render_service_read_failed');
    const service = await r.json();
    if (service.ownerId !== 'tea-d7plj9beo5us73ch3ukg' || service.repo !== 'https://github.com/ibb142/ivx-holdings-platform') throw new Error('render_service_identity_mismatch');
    sources.push({ id, env: await readEnv(id,key) });
  }
  const seen = new Set();
  let attempts = 0;
  for (const source of sources) for (const candidate of candidates(source.env)) {
    const config = sessionConnection(candidate.value);
    if (!config || seen.has(candidate.value)) continue;
    seen.add(candidate.value);
    if (++attempts > 6) throw new Error('database_connection_attempt_budget_exhausted');
    for (const secret of [candidate.value,config.password]) console.log('::add-mask::'+secret.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
    const db = new pg.Client(config);
    db.on('error', () => console.error('database_connection_error'));
    try {
      await db.connect();
      await db.query("SET statement_timeout='12s'");
      const stop = await db.query("SELECT active FROM public.ivx_agent_controls WHERE control_name='emergency_stop' LIMIT 2");
      if (stop.rows.length !== 1 || typeof stop.rows[0].active !== 'boolean') throw new Error('owner_stop_unverified');
      if (stop.rows[0].active) throw new Error('owner_stop_active');
      await db.query("SET statement_timeout='30min'");
      await db.query("SET lock_timeout='5s'");
      console.log(JSON.stringify({ connection: 'verified', source: source.id, sessionMode: true }));
      return db;
    } catch (error) {
      await db.end().catch(() => {});
      if (['owner_stop_active','owner_stop_unverified'].includes(error.message)) throw error;
      console.log(JSON.stringify({ connection: 'unavailable', source: source.id, code: /^[A-Z0-9]{5,20}$/.test(error.code ?? '') ? error.code : 'connection_failed' }));
    }
  }
  throw new Error('no_verified_same_project_session_connection');
}

export async function main() {
  if (process.env.GITHUB_REPOSITORY !== 'ibb142/ivx-holdings-platform' || process.env.GITHUB_REF !== 'refs/heads/main'
    || !['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')
    || process.env.IVX_APPLY_PENDING_INDEX !== 'true') throw new Error('production_workflow_authority_required');
  const db = await productionConnection();
  try {
    const startedAt = new Date().toISOString();
    console.log(JSON.stringify({ operation: 'pending_index', startedAt }));
    const result = await repairPendingExecutionIndex(db);
    const plan = (await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
      SELECT task_id,run_id,agent_id,agent_number,workflow,task_type,final_status,started_at
      FROM public.ivx_agent_executions WHERE final_status IN ('pending','running')
      AND workflow='ivx-112-real-execution-certificate' AND task_type='real_execution_certification'
      ORDER BY started_at ASC NULLS FIRST,task_id ASC LIMIT 300`)).rows[0]['QUERY PLAN'][0];
    const receipt = { ...result, startedAt, finishedAt: new Date().toISOString(), sourceSha: process.env.GITHUB_SHA, plan };
    await mkdir('qa/evidence/fleet-ha',{recursive:true});
    await writeFile('qa/evidence/fleet-ha/pending-index-production.json', JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt));
  } finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  const message = String(error.message);
  console.error(/^[a-z_]+$/.test(message) ? message : 'pending_index_maintenance_failed');
  process.exitCode = 1;
});
