import { VERSIONED_MISSION_PREFIXES } from './ivx-autonomous-mission-scope';

export const PLANNING_STARTED_STATES = [
  'LEASED', 'RUNNING', 'PAUSED', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS',
  'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING',
] as const;

const projection = 'task_id, idempotency_key, assigned_agent_number, state, created_at';
const afterCursor = '($1::timestamptz IS NULL OR (created_at, task_id) > ($1::timestamptz, $2::text))';
const families = [...VERSIONED_MISSION_PREFIXES].sort();
// With these ASCII prefixes, [prefix, prefix-with-final-semicolon) is exactly
// LIKE 'prefix%' in text_pattern_ops ordering. Explicit bounds also work in
// parameterized plans; values and timestamps never become SQL source text.
if (families.some(prefix => !/^[a-z0-9-]+:$/.test(prefix))) {
  throw new Error('Unsupported planning mission prefix');
}
const upper = (prefix: string) => `${prefix.slice(0, -1)};`;
const outsideFamilies = [
  `idempotency_key ~<~ '${families[0]}'`,
  ...families.slice(1).map((prefix, index) =>
    `(idempotency_key ~>=~ '${upper(families[index])}' AND idempotency_key ~<~ '${prefix}')`),
  `idempotency_key ~>=~ '${upper(families[families.length - 1])}'`,
];
const currentDeployment = families.map(prefix =>
  `(idempotency_key ~>=~ ('${prefix}' || $4::text || ':') AND idempotency_key ~<~ ('${prefix}' || $4::text || ';'))`,
);
const predicates = [
  // Separate prefix ranges let each branch use the covering B-tree directly
  // instead of a bitmap OR that must visit the historical payload heap.
  ...outsideFamilies,
  ...currentDeployment,
  'state = ANY($5::text[])',
];

// Any row in the global first N occurs in the first N of a matching branch.
// Bound branches before UNION removes overlap, then apply the same ordering
// globally. Keep native timestamp precision through both sorts and the cursor.
// Held eligibility can retain a broad estimate even after ANALYZE. Resolve it
// before sorting, so an estimated early LIMIT cannot choose a
// full chronological scan of expired historical leases. Project no payloads.
const scopedSql = `WITH held_candidates AS MATERIALIZED (
SELECT ${projection} FROM public.ivx_autonomous_tasks
WHERE lease_holder IS NOT NULL AND (CASE
  WHEN state = 'QUEUED' OR lease_expires_at IS NULL THEN 'infinity'::timestamptz
  ELSE lease_expires_at END) > now() AND ${afterCursor}
), candidates AS MATERIALIZED (
${predicates.map(predicate => `(SELECT ${projection}
FROM public.ivx_autonomous_tasks
WHERE (${predicate}) AND ${afterCursor}
ORDER BY created_at, task_id LIMIT $3)`).join('\nUNION\n')}
UNION
(SELECT ${projection} FROM held_candidates ORDER BY created_at, task_id LIMIT $3)
)
SELECT task_id, idempotency_key, assigned_agent_number, state, created_at::text AS created_at
FROM candidates ORDER BY candidates.created_at, task_id LIMIT $3`;

export function buildAutonomousPlanningPageQuery(
  sourceSha: string | undefined,
  cursor?: { createdAt: string; taskId: string },
  limit = 1000,
): { text: string; values: unknown[] } {
  if (sourceSha !== undefined && !/^[a-f0-9]{40}$/i.test(sourceSha)) {
    throw new Error('Invalid planning source SHA');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Invalid planning page size');
  }
  const values: unknown[] = [cursor?.createdAt ?? null, cursor?.taskId ?? null, limit];
  if (sourceSha === undefined) {
    return {
      text: `SELECT task_id, idempotency_key, assigned_agent_number, state, created_at::text AS created_at
FROM public.ivx_autonomous_tasks WHERE ${afterCursor}
ORDER BY ivx_autonomous_tasks.created_at, task_id LIMIT $3`,
      values,
    };
  }
  return { text: scopedSql, values: [...values, sourceSha, [...PLANNING_STARTED_STATES]] };
}
