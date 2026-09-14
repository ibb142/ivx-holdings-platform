/** One statement, one database clock; no historical payload hydration. */
export const AGENT_LEDGER_LIVE_SQL = `
WITH observation AS (SELECT statement_timestamp() AS measured_at)
SELECT n.agent_number, a.agent_id, a.agent_name, a.status, a.last_heartbeat,
       o.measured_at,
       CASE WHEN a.agent_id IS NULL THEN 'MISSING_AGENT'
            WHEN a.last_heartbeat IS NULL THEN 'NO_HEARTBEAT'
            WHEN a.last_heartbeat > o.measured_at + interval '5 seconds' THEN 'CLOCK_SKEW'
            WHEN a.last_heartbeat < o.measured_at - interval '60 seconds' THEN 'STALE'
            ELSE 'FRESH' END AS heartbeat_state,
       t.task_id AS running_task_id, t.last_heartbeat_at AS task_heartbeat,
       t.lease_expires_at,
       COALESCE(t.lease_expires_at > o.measured_at
         AND NULLIF(btrim(t.worker_instance_id), '') IS NOT NULL
         AND t.last_heartbeat_at BETWEEN o.measured_at - interval '60 seconds'
                                    AND o.measured_at + interval '5 seconds', false) AS active_work
FROM generate_series(1, 112) AS n(agent_number)
CROSS JOIN observation o
LEFT JOIN public.ivx_agent_states a
  ON a.agent_id = 'ivx_holdings_' || n.agent_number::text
 AND a.company = 'ivx_holdings' AND a.agent_number = n.agent_number
LEFT JOIN public.ivx_autonomous_tasks t
  ON t.lease_holder = 'agent:ivx_holdings_' || n.agent_number::text
 AND t.lease_holder IS NOT NULL AND t.state = 'RUNNING'
ORDER BY n.agent_number
`;

type Timestamp = Date | string | null;
export type LiveAgentRow = {
  agent_number: number; agent_id: string | null; agent_name: string | null;
  status: string | null; last_heartbeat: Timestamp; measured_at: Date | string;
  heartbeat_state: 'MISSING_AGENT' | 'NO_HEARTBEAT' | 'CLOCK_SKEW' | 'STALE' | 'FRESH';
  running_task_id: string | null; task_heartbeat: Timestamp; lease_expires_at: Timestamp;
  active_work: boolean;
};

const iso = (value: Timestamp): string | null => value === null ? null : new Date(value).toISOString();

export function buildAgentLedgerLiveSnapshot(rows: LiveAgentRow[]) {
  const timestamp = iso(rows[0]?.measured_at ?? null);
  // A duplicate holder or missing SQL row must never certify a complete registry.
  if (!timestamp || rows.length !== 112 || rows.some((row, index) =>
    row.agent_number !== index + 1 || iso(row.measured_at) !== timestamp
    || (row.agent_id !== null && row.agent_id !== `ivx_holdings_${row.agent_number}`)
    || typeof row.active_work !== 'boolean')) {
    throw new Error('AGENT_LEDGER_LIVE_INCOMPLETE');
  }
  const matrix112 = rows.map(row => ({
    agent_number: row.agent_number,
    agent_id: row.agent_id,
    agent_name: row.agent_name,
    status: row.status,
    registered: row.agent_id !== null,
    last_heartbeat: iso(row.last_heartbeat),
    heartbeat_state: row.heartbeat_state,
    running_task_id: row.running_task_id,
    task_heartbeat: iso(row.task_heartbeat),
    lease_expires_at: iso(row.lease_expires_at),
    active_work: row.active_work,
  }));
  const groups = new Map<string | null, {
    status: string | null; agent_count: number; fresh_heartbeat_count: number; active_concurrent_count: number;
  }>();
  for (const row of matrix112) {
    const group = groups.get(row.status) ?? {
      status: row.status, agent_count: 0, fresh_heartbeat_count: 0, active_concurrent_count: 0,
    };
    group.agent_count++;
    group.fresh_heartbeat_count += Number(row.heartbeat_state === 'FRESH');
    group.active_concurrent_count += Number(row.active_work);
    groups.set(row.status, group);
  }
  const registered = matrix112.filter(row => row.registered).length;
  const active = matrix112.filter(row => row.active_work).length;
  return {
    marker: 'ivx-agent-ledger-live-2026-09-13',
    status: active > 0 ? 'WORK_OBSERVED' : 'NO_ACTIVE_WORK_OBSERVED',
    timestamp,
    summary: {
      active_concurrent_count: active,
      fresh_heartbeat_count: matrix112.filter(row => row.heartbeat_state === 'FRESH').length,
      inventory_limit: 112,
      registered_count: registered,
      missing_count: 112 - registered,
      registry_complete: registered === 112,
    },
    metrics: [...groups.values()],
    matrix112,
    policy: 'Presence uses agent heartbeats from -60s to +5s of database time. Active work counts canonical native RUNNING lease holders with a nonempty worker instance, unexpired lease and task heartbeat in that window. Assignment and last_task_id do not establish the current holder. This snapshot does not certify productive hours, completed outputs or work outside the native queue.',
  };
}
