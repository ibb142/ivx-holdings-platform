import pg from 'pg';
import { reconcileUncertainBudget } from '../../backend/services/ivx-uncertain-budget-reconciliation.mjs';

// This manual operation is not added to a cron or public HTTP endpoint.
const ids = process.argv.find(arg => arg.startsWith('--reservation-ids='))?.split('=')[1]?.split(',');
const connectionString = process.env.IVX_BUDGET_RECONCILIATION_DATABASE_URL;
const binding = new URL(connectionString ?? 'postgres://unavailable');
const project = 'kvclcdjmjghndxsngfzb';
const direct = binding.hostname === `db.${project}.supabase.co`;
const pooler = binding.hostname.endsWith('.pooler.supabase.com')
  && decodeURIComponent(binding.username) === `postgres.${project}`;
if (!['postgres:', 'postgresql:'].includes(binding.protocol) || (!direct && !pooler)) {
  throw new Error('Verified project database binding required');
}
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 4000 });
try {
  await client.connect();
  const report = await reconcileUncertainBudget({ client, reservationIds: ids,
    gatewayKey: process.env.AI_GATEWAY_API_KEY, apply: process.argv.includes('--apply') });
  console.log(JSON.stringify(report));
  if (!['DRY_RUN', 'COHORT_RECONCILED'].includes(report.state)) process.exitCode = 1;
} catch {
  console.error('Budget reconciliation unavailable; no completion certified. Inspect durable receipt rows before retry.');
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
