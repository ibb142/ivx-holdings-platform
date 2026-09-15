import { publicFeedRead } from './ivx-public-feed-postgres';

const metrics = ['likes', 'comments', 'shares', 'saves'] as const;
type Metric = typeof metrics[number];
export type FeedEngagementCounts = Record<string, Record<Metric, number>>;
type CountRow = { project_id: string; metric: Metric; amount: string };
type RestResult = { data: Array<{ project_id: string }> | null; error?: unknown; count?: number | null };
type RestQuery = PromiseLike<RestResult> & {
  in(column: string, values: string[]): RestQuery;
  eq(column: string, value: boolean): RestQuery;
  is(column: string, value: null): RestQuery;
};
type RestClient = { from(table: string): { select(columns: string, options: { count: 'exact' }): RestQuery } };

// Match the existing UUID indexes without casting the indexed columns to text.
// Aggregate before transfer: at most four rows per requested video, using one
// checkout and the existing publicFeedRead role/transaction/deadline boundary.
export const FEED_ENGAGEMENT_COUNTS_SQL = metrics.map(metric => `
  select project_id::text as project_id, '${metric}'::text as metric, count(*)::text as amount
  from public.project_${metric}
  where project_id = any($1::uuid[])
    ${metric === 'comments' ? 'and is_approved = true and deleted_at is null' : ''}
  group by project_id`).join('\nunion all\n');

export async function readFeedEngagementCounts(sb: RestClient, ids: string[]): Promise<FeedEngagementCounts> {
  const unique = [...new Set(ids)];
  if (unique.length > 200 || unique.some(id => typeof id !== 'string' || !id || id.length > 100)) {
    throw new Error('INVALID_FEED_ENGAGEMENT_IDENTITIES');
  }
  const counts: FeedEngagementCounts = Object.fromEntries(unique.map(id => [id, { likes: 0, comments: 0, shares: 0, saves: 0 }]));
  if (unique.length === 0) return counts;
  const result = await publicFeedRead<CountRow>(FEED_ENGAGEMENT_COUNTS_SQL, [unique], async () => {
    // Retain REST only when direct PostgreSQL was not selected. A failed SQL
    // operation is never replayed through REST. Failed/truncated reads are not zero.
    const results = await Promise.all(metrics.map(async metric => {
      let query = sb.from(`project_${metric}`).select('project_id', { count: 'exact' }).in('project_id', unique);
      if (metric === 'comments') query = query.eq('is_approved', true).is('deleted_at', null);
      const { data, error, count } = await query;
      if (error || !Array.isArray(data)) throw new Error('FEED_ENGAGEMENT_UNAVAILABLE');
      if ((typeof count === 'number' && count !== data.length) || (count == null && data.length >= 1000)) {
        throw new Error('FEED_ENGAGEMENT_INCOMPLETE');
      }
      const amounts = new Map<string, number>();
      for (const row of data) {
        if (!unique.includes(row.project_id)) throw new Error('INVALID_FEED_ENGAGEMENT_RESULT');
        amounts.set(row.project_id, (amounts.get(row.project_id) ?? 0) + 1);
      }
      return [...amounts].map(([project_id, amount]) => ({ project_id, metric, amount: String(amount) }));
    }));
    return { data: results.flat(), error: null };
  });
  if (result.error || !Array.isArray(result.data)) throw new Error('FEED_ENGAGEMENT_UNAVAILABLE');
  const seen = new Set<string>();
  for (const row of result.data) {
    const key = `${row.project_id}:${row.metric}`;
    if (!unique.includes(row.project_id) || !metrics.includes(row.metric) || seen.has(key)
      || typeof row.amount !== 'string' || !/^\d+$/.test(row.amount)
      || !Number.isSafeInteger(Number(row.amount))) throw new Error('INVALID_FEED_ENGAGEMENT_RESULT');
    seen.add(key);
    counts[row.project_id][row.metric] = Number(row.amount);
  }
  return counts;
}
