import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { clientOptions, parseArgs, runRecovery } from './recover-failed-patrols.mjs';

export const PREFLIGHT_SQL = `select jsonb_build_object(
  'budget',public.ivx_ai_budget_status(),
  'connections',coalesce((select jsonb_agg(to_jsonb(s)) from (
    select application_name,usename,backend_type,state,count(*)::int as connections,
      count(*) filter (where state='idle' and pid<>pg_backend_pid()
        and application_name not ilike '%supabase%'
        and application_name not ilike '%pooler%')::int as selected_by_unsafe_filter
    from pg_stat_activity where datname=current_database()
    group by application_name,usename,backend_type,state
    order by count(*) desc,application_name,usename,backend_type,state limit 40
  ) s),'[]'::jsonb)
) as snapshot`;

export function budgetBlockers(budget) {
  const money = value => typeof value === 'string' && /^\d{1,18}$/.test(value);
  if (!budget || typeof budget.enabled !== 'boolean'
    || !Number.isSafeInteger(budget.requestsActive) || budget.requestsActive < 0
    || !Number.isSafeInteger(budget.maxConcurrent) || budget.maxConcurrent < 1
    || !money(budget.dailyLimitNano) || BigInt(budget.dailyLimitNano) === 0n
    || !money(budget.settledUpperNano) || !money(budget.unsettledLiabilityNano)) {
    return ['BUDGET_OBSERVATION_INVALID'];
  }
  const blockers = [];
  if (!budget.enabled) blockers.push('BUDGET_NOT_ACTIVATED');
  if (budget.requestsActive >= budget.maxConcurrent) blockers.push('GLOBAL_CAPACITY_EXCEEDED');
  if (BigInt(budget.settledUpperNano) + BigInt(budget.unsettledLiabilityNano) >= BigInt(budget.dailyLimitNano)) {
    blockers.push('GLOBAL_DAILY_BUDGET_EXCEEDED');
  }
  return blockers;
}

export async function readPreflight(client) {
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    const { rows } = await client.query(PREFLIGHT_SQL);
    const snapshot = rows[0]?.snapshot;
    if (!snapshot || !Array.isArray(snapshot.connections)) throw Error('PREFLIGHT_INCOMPLETE');
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function runPipeline(client, options) {
  // No writes occur if any prerequisite read fails. An idle connection is not
  // evidence of a leak, and a missing generation ID is not proof of zero cost.
  const before = await readPreflight(client);
  const blockers = budgetBlockers(before.budget);
  const tasks = await runRecovery(client, { ...options, apply: options.apply && blockers.length === 0 });
  const report = {
    mode: options.apply ? 'LIVE_APPLY' : 'DRY_RUN_PREVIEW',
    state: blockers.length ? 'BLOCKED' : tasks.errors.length ? 'RECOVERY_INCOMPLETE'
      : options.apply ? (tasks.applied.length ? 'TARGETED_RECOVERY_APPLIED' : 'NO_TASKS_RECOVERED') : 'PREVIEW_COMPLETE',
    before, blockers, tasks, connectionsTerminated: 0, financialRowsChanged: 0,
    deploymentPerformed: false, zeroRuntimeErrorsCertified: false,
  };
  // Native worker admission still checks the live budget when executing a task.
  // This earlier snapshot is diagnostic, not a reservation or capacity guarantee.
  return report;
}

export function pipelineClientOptions(env) {
  return clientOptions({
    IVX_PATROL_RECOVERY_DATABASE_URL: env.IVX_PATROL_RECOVERY_DATABASE_URL
      || env.IVX_BUDGET_RECONCILIATION_DATABASE_URL || env.SUPABASE_DB_URL || env.DATABASE_URL,
  });
}

export async function main(args = process.argv.slice(2), env = process.env, Client = pg.Client, log = console.log) {
  if (args.length === 1 && args[0] === '--help') {
    log('Preview: ./scripts/ops/force-live-deployment.sh [--limit=1..10]');
    log('Apply: ./scripts/ops/force-live-deployment.sh --apply --task-ids=ID[,ID] --reason="verified recovery"');
    log('Budget and connection checks are read-only. No deployment or runtime certification is performed.');
    return 0;
  }
  const options = parseArgs(args);
  const client = new Client(pipelineClientOptions(env));
  try {
    await client.connect();
    const report = await runPipeline(client, options);
    log(JSON.stringify(report, null, 2));
    return report.blockers.length || report.tasks.errors.length ? 1
      : options.apply && report.tasks.applied.length === 0 ? 2 : 0;
  } finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    const candidate = String(error.code ?? error.message ?? '').split(':')[0];
    const code = /^[A-Z0-9_]{3,64}$/.test(candidate) ? candidate : 'RECOVERY_UNAVAILABLE';
    console.error(JSON.stringify({ ok: false, code,
      message: 'Preflight or recovery did not complete. No zero-error or deployment claim is supported.' }));
    process.exitCode = 1;
  });
}
