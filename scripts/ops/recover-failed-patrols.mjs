import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { recoverFailedPatrols, validateDatabaseBinding, validateRecoveryInput } from '../../backend/services/ivx-failed-patrol-recovery.mjs';

export function parseArguments(args) {
  const values = new Map();
  for (const arg of args) {
    if (arg === '--apply') {
      if (values.has('apply')) throw new Error('DUPLICATE_ARGUMENT');
      values.set('apply', true); continue;
    }
    const match = /^--(source-sha|task-ids|reason)=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) throw new Error('UNKNOWN_OR_DUPLICATE_ARGUMENT');
    values.set(match[1], match[2]);
  }
  const input = { sourceSha: values.get('source-sha'), taskIds: values.get('task-ids')?.split(','),
    apply: values.get('apply') === true, reason: values.get('reason') };
  validateRecoveryInput(input);
  return input;
}

export async function main(args = process.argv.slice(2)) {
  let client;
  try {
    const input = parseArguments(args);
    const connectionString = validateDatabaseBinding(process.env.IVX_BUDGET_RECONCILIATION_DATABASE_URL
      || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
    const { default: pg } = await import('pg');
    client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000,
      statement_timeout: 4000, query_timeout: 6000,
      ssl: { rejectUnauthorized: true, ca: [...rootCertificates,
        readFileSync(new URL('../../backend/certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8')] } });
    client.on('error', () => {}); // Query/commit/readback report the failure without leaking connection details.
    await client.connect();
    const report = await recoverFailedPatrols({ client, ...input });
    console.log(JSON.stringify(report, null, 2));
    if (!['DRY_RUN','NO_ELIGIBLE_TASKS','RECOVERY_RECORDED'].includes(report.outcome)) process.exitCode = 1;
  } catch {
    console.error('RECOVERY_UNAVAILABLE: verify exact project binding, --source-sha and --task-ids; --apply requires --reason. No completion certified.');
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => { process.exitCode = 1; });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

