import { describe, expect, test } from 'bun:test';
import {
  IVX_PROJECT_VISION,
  buildAutonomousMissionContext,
  evaluateFleetActivationEvidence,
  getProjectCompletionMandate,
  type FleetActivationEvidence,
} from './ivx-project-vision';

const certifiedEvidence: FleetActivationEvidence = {
  registeredAgents: 112,
  distinctActiveAgents: 112,
  distinctActiveLeases: 112,
  freshHeartbeats: 112,
  knownWorkerIdentities: 7,
  deployedConcurrency: 112,
  mutationAuthorities: 1,
  queueBackend: 'postgres_atomic',
  staleAgents: 0,
  blockedAgents: 0,
  emergencyStop: false,
};

describe('IVX executable project vision', () => {
  test('encodes the canonical 12 command + 100 execution fleet', () => {
    expect(IVX_PROJECT_VISION.fleetModel).toMatchObject({
      totalAgents: 112,
      commandAgents: 12,
      executionAgents: 100,
    });
    const mandate = getProjectCompletionMandate();
    expect(mandate.autonomousConstitution.join(' ')).toContain('single production control authority');
    expect(mandate.runtimeTruthContract.join(' ')).toContain('distinct valid lease');
  });

  test('certifies only complete simultaneous live evidence', () => {
    expect(evaluateFleetActivationEvidence(certifiedEvidence)).toEqual({
      certified: true,
      requiredAgents: 112,
      blockers: [],
    });
  });

  test('rejects a 112-name registry backed by only 12 slots and a JSON queue', () => {
    const result = evaluateFleetActivationEvidence({
      ...certifiedEvidence,
      distinctActiveAgents: 12,
      distinctActiveLeases: 12,
      freshHeartbeats: 12,
      deployedConcurrency: 12,
      queueBackend: 'durable_json',
    });
    expect(result.certified).toBe(false);
    expect(result.blockers).toContain('DISTINCT_ACTIVE_AGENTS:12/112');
    expect(result.blockers).toContain('DEPLOYED_CONCURRENCY:12/112');
    expect(result.blockers).toContain('QUEUE_BACKEND:durable_json');
  });

  test('rejects multiple controllers even when all 112 appear active', () => {
    const result = evaluateFleetActivationEvidence({ ...certifiedEvidence, mutationAuthorities: 3 });
    expect(result.certified).toBe(false);
    expect(result.blockers).toContain('MUTATION_AUTHORITIES:3/1');
  });

  test('injects fleet truth, owner control, data, and scale gates into every mission', () => {
    const context = buildAutonomousMissionContext('Audit the current gap.');
    expect(context).toContain('12 command agents');
    expect(context).toContain('100 execution agents');
    expect(context).toContain('RUNTIME TRUTH:');
    expect(context).toContain('atomic row queue');
    expect(context).toContain('Owner pause');
  });
});
