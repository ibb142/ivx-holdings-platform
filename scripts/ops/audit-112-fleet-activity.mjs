import { pathToFileURL } from 'node:url';

// A single database clock/snapshot, bounded active rows and no business writes.
// Status in ivx_agent_states is registry state, not current execution state.
export const FLEET_AUDIT_SQL = `
with active as materialized (
  select task_id, state, lease_holder, lease_expires_at,
    payload->>'title' as title, payload->>'taskType' as task_type,
    payload->>'lastHeartbeatAt' as last_heartbeat
  from public.ivx_autonomous_tasks
  where state in ('LEASED','RUNNING') and lease_expires_at > statement_timestamp()
  order by task_id limit 1001
)
select statement_timestamp() as "observedAt",
  coalesce((select jsonb_agg(jsonb_build_object(
    'agentId', agent_id, 'agentNumber', agent_number, 'name', agent_name,
    'registryStatus', status, 'heartbeatAt', last_heartbeat, 'lastTaskId', last_task_id
  ) order by agent_number) from public.ivx_agent_states), '[]'::jsonb) as agents,
  coalesce((select jsonb_agg(jsonb_build_object(
    'taskId', task_id, 'state', state, 'leaseHolder', lease_holder,
    'expiresAt', lease_expires_at, 'title', title, 'taskType', task_type,
    'heartbeatAt', last_heartbeat
  )) from active), '[]'::jsonb) as tasks`;

export function buildFleetAudit(snapshot) {
  const now = Date.parse(snapshot?.observedAt);
  const agents = snapshot?.agents, tasks = snapshot?.tasks;
  if (!Number.isFinite(now) || !Array.isArray(agents) || !Array.isArray(tasks) || tasks.length > 1000) throw Error('INCOMPLETE_FLEET_OBSERVATION');
  if (agents.length !== 112 || new Set(agents.map(a => a.agentNumber)).size !== 112
    || new Set(agents.map(a => a.agentId)).size !== 112
    || agents.some(a => !a.agentId || !Number.isInteger(a.agentNumber) || a.agentNumber < 1 || a.agentNumber > 112)) throw Error('INCOMPLETE_AGENT_REGISTRY');
  const fresh = at => { const age = now - Date.parse(at); return Number.isFinite(age) && age >= 0 && age <= 45_000; };
  const rows = agents.map(agent => {
    // Attribute a stolen task to the holder, never to its original assignment.
    const held = tasks.filter(t => t.leaseHolder === `agent:${agent.agentId}` && Date.parse(t.expiresAt) > now);
    const recent = held.filter(t => t.state === 'RUNNING' && fresh(t.heartbeatAt));
    const heartbeatAgeMs = now - Date.parse(agent.heartbeatAt);
    return { ...agent, heartbeatAgeMs: Number.isFinite(heartbeatAgeMs) ? heartbeatAgeMs : null,
      heartbeatFresh: fresh(agent.heartbeatAt), currentTasks: held,
      runningWithFreshLeaseHeartbeat: recent.length > 0,
      productiveEvidence: 'NOT_EVALUATED' };
  });
  return { observedAt: new Date(now).toISOString(), totalAgents: rows.length,
    registryHeartbeatsFresh: rows.filter(a => a.heartbeatFresh).length,
    agentsWithUnexpiredLeases: rows.filter(a => a.currentTasks.length).length,
    runningWithFreshLeaseHeartbeat: rows.filter(a => a.runningWithFreshLeaseHeartbeat).length,
    unmappedActiveTasks: tasks.filter(t => !agents.some(a => t.leaseHolder === `agent:${a.agentId}`)).length,
    verifiedProductiveAgents: null, measuredProductiveHours: null, certified: false,
    scope: 'Registry and current task leases. A heartbeat or lease is not proof of productive work or 20 hours.', agents: rows };
}

export async function runFleetAudit({ connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL, createClient } = {}) {
  if (!connectionString) throw Error('DATABASE_CONNECTION_NOT_CONFIGURED');
  const factory = createClient ?? (config => import('pg').then(({ Client }) => new Client(config)));
  const client = await factory({ connectionString, connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000, query_timeout: 6_500, application_name: 'ivx_fleet_read_only_audit' });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    // Transaction poolers may not preserve startup/session settings. Apply
    // limits in this transaction before sending the observation statement.
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const result = await client.query(FLEET_AUDIT_SQL);
    await client.query('COMMIT');
    return buildFleetAudit(result.rows[0]);
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFleetAudit().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    // Driver errors can contain connection URLs. Report an unavailable audit,
    // never a synthetic zero-agent result or a successful exit.
    const known = ['DATABASE_CONNECTION_NOT_CONFIGURED', 'INCOMPLETE_AGENT_REGISTRY', 'INCOMPLETE_FLEET_OBSERVATION'];
    const errorType = known.includes(error?.message) ? error.message : 'DATABASE_READ_FAILED';
    const sqlState = /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : undefined;
    console.error(JSON.stringify({ status: 'AUDIT_UNAVAILABLE', errorType, sqlState, certified: false })); process.exitCode = 1;
  });
}
