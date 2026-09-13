import pg from 'pg';
import { reconcileUncertainBudget } from '../../backend/services/ivx-uncertain-budget-reconciliation.mjs';

const PROJECT = 'kvclcdjmjghndxsngfzb';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const USAGE = 'Use --reservation-ids=<full UUIDs> and optionally --apply; default is dry-run.';

class ReconciliationConfigurationError extends Error {}

function requireConfiguration(condition, message) {
  if (!condition) throw new ReconciliationConfigurationError(message);
}

export function parseBudgetReconciliationOptions(argv, env) {
  requireConfiguration(Array.isArray(argv) && argv.every(arg => typeof arg === 'string'
    && (arg === '--apply' || arg.startsWith('--reservation-ids='))),
    `INVALID_ARGUMENTS: ${USAGE}`);
  const idArguments = argv.filter(arg => arg.startsWith('--reservation-ids='));
  requireConfiguration(idArguments.length === 1 && argv.filter(arg => arg === '--apply').length <= 1,
    `INVALID_ARGUMENTS: ${USAGE}`);
  const reservationIds = idArguments[0].slice('--reservation-ids='.length)
    .split(',').map(id => id.trim().toLowerCase());
  requireConfiguration(reservationIds.length >= 1 && reservationIds.length <= 112
    && reservationIds.every(id => UUID.test(id))
    && new Set(reservationIds).size === reservationIds.length,
    'INVALID_RESERVATION_IDS: Supply 1–112 distinct full reservation UUIDs, not task IDs or abbreviations.');

  const connectionString = env.IVX_BUDGET_RECONCILIATION_DATABASE_URL;
  requireConfiguration(typeof connectionString === 'string' && connectionString.trim().length > 0,
    'DATABASE_BINDING_MISSING: Configure IVX_BUDGET_RECONCILIATION_DATABASE_URL in the trusted operator environment.');
  let projectMatches = false;
  try {
    const binding = new URL(connectionString);
    const direct = binding.hostname === `db.${PROJECT}.supabase.co`;
    const pooler = binding.hostname.endsWith('.pooler.supabase.com')
      && decodeURIComponent(binding.username) === `postgres.${PROJECT}`;
    projectMatches = ['postgres:', 'postgresql:'].includes(binding.protocol) && (direct || pooler);
  } catch { /* URL parser errors can contain credentials; do not expose them. */ }
  requireConfiguration(projectMatches,
    'DATABASE_BINDING_INVALID: A PostgreSQL connection bound to the reviewed Supabase project is required.');
  const gatewayKey = env.AI_GATEWAY_API_KEY;
  requireConfiguration(typeof gatewayKey === 'string' && gatewayKey.trim().length > 0,
    'PROVIDER_KEY_MISSING: Configure AI_GATEWAY_API_KEY in the trusted operator environment.');
  requireConfiguration(gatewayKey.startsWith('vck_'),
    'PROVIDER_KEY_INVALID: AI_GATEWAY_API_KEY must use the key format required by the existing verifier.');

  return { reservationIds, apply: argv.includes('--apply'), connectionString, gatewayKey };
}

export async function runBudgetReconciliationCli({
  argv = process.argv.slice(2),
  env = process.env,
  createClient = options => new pg.Client(options),
  reconcile = reconcileUncertainBudget,
  log = value => console.log(value),
  error = value => console.error(value),
} = {}) {
  let client;
  try {
    // Reject ambiguous modes, wrong IDs and missing credentials before checkout.
    const options = parseBudgetReconciliationOptions(argv, env);
    client = createClient({ connectionString: options.connectionString,
      connectionTimeoutMillis: 5000, statement_timeout: 4000 });
    await client.connect();
    const report = await reconcile({ client, reservationIds: options.reservationIds,
      gatewayKey: options.gatewayKey, apply: options.apply });
    log(JSON.stringify(report));
    // A preview with blocked receipts is useful evidence, but is not an eligible cohort.
    return report.state === 'COHORT_RECONCILED'
      || (report.state === 'DRY_RUN' && Array.isArray(report.blocked) && report.blocked.length === 0) ? 0 : 1;
  } catch (cause) {
    error(cause instanceof ReconciliationConfigurationError ? cause.message
      : 'Budget reconciliation unavailable; no completion certified. Inspect durable receipt rows before retry.');
    return 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
