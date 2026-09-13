import { getObserverPool } from '../../backend/services/ivx-database-pools';
import { emergencyStopPostgresConfig } from '../../backend/services/ivx-emergency-stop-postgres';
import { queryWithPostgresDeadline } from '../../backend/services/ivx-postgres-deadline';
import { inspectFailedAgentRecovery, validateFailedAgentRecoveryInput,
  type FailedAgentRecoveryRow } from '../../backend/services/ivx-failed-agent-recovery';

export function parseRecoveryArguments(args: string[]) {
  if (args.length !== 2 || args.some(arg => !/^--(run-id|agent-numbers)=.+$/.test(arg))
    || new Set(args.map(arg => arg.slice(0, arg.indexOf('=')))).size !== 2) {
    throw new Error('Usage: bun scripts/ops/reconcile-failed-agents.ts --run-id=RUN --agent-numbers=1,18');
  }
  const value = (key: string) => args.find(arg => arg.startsWith(`--${key}=`))!.slice(key.length + 3);
  const numbers = value('agent-numbers').split(',');
  if (numbers.some(n => !/^[1-9][0-9]{0,2}$/.test(n))) throw new Error('INVALID_RECOVERY_AGENT_NUMBERS');
  const input = { runId: value('run-id'), agentNumbers: numbers.map(Number) };
  validateFailedAgentRecoveryInput(input);
  return input;
}

if (import.meta.main) {
  let pool: ReturnType<typeof getObserverPool> | undefined;
  try {
    const input = parseRecoveryArguments(process.argv.slice(2));
    emergencyStopPostgresConfig(); // Same-project binding check, without an authority mutation.
    pool = getObserverPool(process.env, 'telemetry');
    const report = await inspectFailedAgentRecovery(input, (sql, values) =>
      queryWithPostgresDeadline<FailedAgentRecoveryRow>(pool!, sql, values, 'service_role'));
    console.log(JSON.stringify(report, null, 2));
  } catch {
    console.error('RECOVERY_DIAGNOSTIC_UNAVAILABLE: supply an explicit run and agent numbers; verify database binding. No retry or recovery certified.');
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end().catch(() => { process.exitCode = 1; });
  }
}
