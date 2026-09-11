/**
 * One-authority policy for production automation.
 *
 * Observers are safe by default. Any control loop that can deploy, cancel, or
 * retry work must be enabled explicitly so a new process cannot become a
 * second controller merely because it started.
 */
export const IVX_AUTONOMOUS_CONTROL_POLICY_MARKER = 'ivx-autonomous-control-policy-v1-2026-09-06';

export function explicitEnvFlag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[name] ?? '').trim().toLowerCase() === 'true';
}

export function deploymentAutoRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return explicitEnvFlag('IVX_DEPLOYMENT_AUTO_REPAIR_ENABLED', env);
}

export function autonomousDoctorRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return explicitEnvFlag('IVX_AUTONOMOUS_DOCTOR_REPAIR_ENABLED', env);
}

export function githubSupervisorMutationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return explicitEnvFlag('IVX_GITHUB_ACTIONS_SUPERVISOR_MUTATIONS_ENABLED', env);
}

export function autonomousRuntimeEnforcerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.IVX_PROCESS_ROLE === 'api') return false;
  return (env.IVX_AUTONOMOUS_RUNTIME_ENFORCER_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

export function activeFleetMutationAuthorityCount(env: NodeJS.ProcessEnv = process.env): number {
  return Number(autonomousRuntimeEnforcerEnabled(env))
    + Number(deploymentAutoRepairEnabled(env))
    + Number(autonomousDoctorRepairEnabled(env))
    + Number(githubSupervisorMutationsEnabled(env));
}

export function autonomousQueueBackend(env: NodeJS.ProcessEnv = process.env): string {
  return (env.IVX_AUTONOMOUS_QUEUE_BACKEND ?? 'durable_json').trim().toLowerCase();
}

function boundedConcurrency(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 112);
}

/**
 * The repair budget may never exceed either real execution path's configured
 * capacity. This prevents a 12-slot runtime from issuing 112 retry commands.
 */
export function autonomousRepairCapacity(env: NodeJS.ProcessEnv = process.env): number {
  const campaign = boundedConcurrency(env.IVX_CAMPAIGN_MAX_CONCURRENCY, 12);
  const continuity = boundedConcurrency(env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY, 12);
  return 112;
}
