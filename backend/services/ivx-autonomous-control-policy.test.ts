import { describe, expect, test } from 'bun:test';
import {
  activeFleetMutationAuthorityCount,
  autonomousDoctorRepairEnabled,
  autonomousQueueBackend,
  autonomousRepairCapacity,
  autonomousRuntimeEnforcerEnabled,
  deploymentAutoRepairEnabled,
  explicitEnvFlag,
  githubSupervisorMutationsEnabled,
} from './ivx-autonomous-control-policy';
import {
  getDeploymentState,
  startAutonomousMonitor,
  stopAutonomousMonitor,
} from './ivx-enterprise-deployment-engine';

describe('IVX autonomous one-authority policy', () => {
  test('API role cannot execute fleet work even with a legacy enforcer flag', () => {
    expect(autonomousRuntimeEnforcerEnabled({ IVX_PROCESS_ROLE: 'api', IVX_AUTONOMOUS_RUNTIME_ENFORCER_ENABLED: 'true' })).toBe(false);
    expect(autonomousRuntimeEnforcerEnabled({ IVX_PROCESS_ROLE: 'worker', IVX_AUTONOMOUS_RUNTIME_ENFORCER_ENABLED: 'true' })).toBe(true);
  });
  test('all secondary mutation loops fail closed by default', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(deploymentAutoRepairEnabled(env)).toBe(false);
    expect(autonomousDoctorRepairEnabled(env)).toBe(false);
    expect(githubSupervisorMutationsEnabled(env)).toBe(false);
  });

  test('only an exact true value enables a mutation loop', () => {
    expect(explicitEnvFlag('FLAG', { FLAG: 'true' })).toBe(true);
    expect(explicitEnvFlag('FLAG', { FLAG: ' TRUE ' })).toBe(true);
    expect(explicitEnvFlag('FLAG', { FLAG: '1' })).toBe(false);
    expect(explicitEnvFlag('FLAG', { FLAG: 'on' })).toBe(false);
  });

  test('repair capacity cannot exceed the smallest real execution path', () => {
    expect(autonomousRepairCapacity({})).toBe(12);
    expect(autonomousRepairCapacity({
      IVX_CAMPAIGN_MAX_CONCURRENCY: '112',
      IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY: '12',
    })).toBe(12);
    expect(autonomousRepairCapacity({
      IVX_CAMPAIGN_MAX_CONCURRENCY: '999',
      IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY: '999',
    })).toBe(112);
  });

  test('exactly one runtime authority is active in the safe default', () => {
    expect(autonomousRuntimeEnforcerEnabled({})).toBe(true);
    expect(activeFleetMutationAuthorityCount({})).toBe(1);
    expect(activeFleetMutationAuthorityCount({
      IVX_AUTONOMOUS_DOCTOR_REPAIR_ENABLED: 'true',
    })).toBe(2);
    expect(activeFleetMutationAuthorityCount({
      IVX_DEPLOYMENT_AUTO_REPAIR_ENABLED: 'true',
    })).toBe(2);
    expect(autonomousQueueBackend({})).toBe('durable_json');
    expect(autonomousQueueBackend({ IVX_AUTONOMOUS_QUEUE_BACKEND: ' POSTGRES_ATOMIC ' })).toBe('postgres_atomic');
  });

  test('deployment monitor does not arm without explicit opt-in', () => {
    const previous = process.env.IVX_DEPLOYMENT_AUTO_REPAIR_ENABLED;
    delete process.env.IVX_DEPLOYMENT_AUTO_REPAIR_ENABLED;
    try {
      expect(startAutonomousMonitor(1_000)).toBe(false);
      expect(getDeploymentState().autonomousMode).toBe(false);
    } finally {
      stopAutonomousMonitor();
      if (previous === undefined) delete process.env.IVX_DEPLOYMENT_AUTO_REPAIR_ENABLED;
      else process.env.IVX_DEPLOYMENT_AUTO_REPAIR_ENABLED = previous;
    }
  });
});
