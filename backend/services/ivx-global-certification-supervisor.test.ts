/**
 * Regression tests for the IVX GLOBAL CERTIFICATION SUPERVISOR (owner mandate
 * 2026-08-28).
 *
 * Owner-verified bug: on SHA 42a985d1, "112 Agent Utilization Repair" reported
 * SUCCESS while "Live Brain E2E Builder" (and QA Suite, E2E, Control Tower,
 * 10/10, ...) reported FAILURE on the SAME SHA — and Autonomous still declared
 * the system healthy. These tests pin the correct supervisor behavior:
 *
 *   112 IA = SUCCESS + Live Brain E2E = FAILURE  =>  GLOBAL RED + AUTO-REPAIR DISPATCH
 */
import { describe, expect, test } from 'bun:test';
import {
  computeGlobalCertification,
  REQUIRED_CERTIFICATION_WORKFLOWS,
  IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER,
  type GlobalCertificationInput,
  type SupervisorGateRun,
} from './ivx-global-certification-supervisor';

const MAIN_SHA = 'a'.repeat(40);
const OLD_SHA = '1'.repeat(40);

function allSuccessRuns(mainSha: string, branch: string = 'main'): SupervisorGateRun[] {
  return REQUIRED_CERTIFICATION_WORKFLOWS.map((workflow, index) => ({
    workflow: workflow.name,
    runId: 1000 + index,
    headSha: mainSha,
    headBranch: branch,
    status: 'completed',
    conclusion: 'success',
  }));
}

function baseInput(overrides: Partial<GlobalCertificationInput>): GlobalCertificationInput {
  return {
    mainSha: MAIN_SHA,
    productionSha: MAIN_SHA,
    productionHealthy: true,
    runs: allSuccessRuns(MAIN_SHA),
    collector: 'github_actions_api',
    collectorError: null,
    ...overrides,
  };
}

describe('IVX Global Certification Supervisor — same-SHA global supervision', () => {
  test('OWNER SCENARIO: 112 IA SUCCESS + Live Brain E2E FAILURE on same SHA => GLOBAL RED + repair mission dispatched', () => {
    const runs = allSuccessRuns(MAIN_SHA);
    // Simulate the exact verified bug: 112 IA green, Live Brain E2E red.
    runs.push({
      workflow: 'IVX Live Brain E2E Builder V3',
      runId: 4242,
      headSha: MAIN_SHA,
      headBranch: 'main',
      status: 'completed',
      conclusion: 'failure',
    });
    // Replace the required E2E gate's success with the Live Brain failure to
    // emulate the same-SHA cross-workflow conflict the owner reported.
    const e2e = runs.find((run) => run.workflow === 'IVX E2E Acceptance Pipeline');
    if (e2e) e2e.conclusion = 'failure';

    const result = computeGlobalCertification(baseInput({ runs }));

    expect(result.status).toBe('RED');
    expect(result.certified).toBe(false);
    expect(result.failedRequired).toContain('IVX E2E Acceptance Pipeline');
    expect(result.repairMissions.length).toBeGreaterThan(0);
    expect(result.repairMissions[0].mainSha).toBe(MAIN_SHA);
    expect(result.repairMissions[0].conclusion).toBe('failure');
  });

  test('ALL required gates SUCCESS on MAIN_SHA + production parity => GREEN and certified', () => {
    const result = computeGlobalCertification(baseInput({}));
    expect(result.status).toBe('GREEN');
    expect(result.certified).toBe(true);
    expect(result.failedRequired).toHaveLength(0);
    expect(result.repairMissions).toHaveLength(0);
    expect(result.shaParity.ok).toBe(true);
  });

  test('SAME-SHA invariant: a required SUCCESS on an older SHA => RED (certification RED, not GREEN)', () => {
    const runs = allSuccessRuns(MAIN_SHA);
    const qa = runs.find((run) => run.workflow === 'IVX QA Suite');
    if (qa) qa.headSha = OLD_SHA; // QA last ran on a different SHA
    const result = computeGlobalCertification(baseInput({ runs }));
    expect(result.status).toBe('RED');
    expect(result.certified).toBe(false);
    expect(result.shaParity.ok).toBe(false);
    expect(result.shaParity.violations.some((violation) => violation.includes('IVX QA Suite'))).toBe(true);
  });

  test('production /health commit != MAIN_SHA => RED (production SHA parity)', () => {
    const result = computeGlobalCertification(baseInput({ productionSha: OLD_SHA }));
    expect(result.status).toBe('RED');
    expect(result.certified).toBe(false);
    const parityGate = result.gates.find((gate) => gate.gate === 'PRODUCTION_PARITY');
    expect(parityGate?.state).toBe('RED');
  });

  test('cancelled / timed_out / startup_failure conclusions => RED', () => {
    for (const conclusion of ['cancelled', 'timed_out', 'startup_failure']) {
      const runs = allSuccessRuns(MAIN_SHA);
      const radar = runs.find((run) => run.workflow === 'IVX Autonomous Radar Self-Heal');
      if (radar) radar.conclusion = conclusion;
      const result = computeGlobalCertification(baseInput({ runs }));
      expect(result.status).toBe('RED');
      expect(result.certified).toBe(false);
    }
  });

  test('missing or skipped required gate => PENDING, never GREEN (fail-closed)', () => {
    const missing = computeGlobalCertification(baseInput({ runs: allSuccessRuns(MAIN_SHA).slice(0, 10) }));
    expect(missing.status).toBe('PENDING');
    expect(missing.certified).toBe(false);

    const runs = allSuccessRuns(MAIN_SHA);
    const reels = runs.find((run) => run.workflow === 'IVX Reels Live Certificate');
    if (reels) reels.conclusion = 'skipped';
    const skipped = computeGlobalCertification(baseInput({ runs }));
    expect(skipped.status).toBe('PENDING');
    expect(skipped.certified).toBe(false);
  });

  test('collector unavailable => PENDING, never GREEN (fail-closed)', () => {
    const result = computeGlobalCertification(baseInput({ collector: 'unavailable', collectorError: 'GITHUB_TOKEN missing' }));
    expect(result.status).toBe('PENDING');
    expect(result.certified).toBe(false);
    expect(result.collectorError).toContain('GITHUB_TOKEN');
  });

  test('production /health unknown => PENDING (parity not proven)', () => {
    const result = computeGlobalCertification(baseInput({ productionSha: null, productionHealthy: null }));
    expect(result.status).toBe('PENDING');
    expect(result.certified).toBe(false);
  });

  test('in-progress required gate => PENDING until completion', () => {
    const runs = allSuccessRuns(MAIN_SHA);
    const nervous = runs.find((run) => run.workflow === 'IVX Autonomous Nervous System');
    if (nervous) {
      nervous.status = 'in_progress';
      nervous.conclusion = null;
    }
    const result = computeGlobalCertification(baseInput({ runs }));
    expect(result.status).toBe('PENDING');
    expect(result.certified).toBe(false);
  });

  test('policy marker and gate inventory are stable', () => {
    expect(IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER).toBe('ivx-global-certification-supervisor-v1-2026-08-28');
    const result = computeGlobalCertification(baseInput({}));
    // 14 required workflows + production parity gate.
    expect(result.gates).toHaveLength(REQUIRED_CERTIFICATION_WORKFLOWS.length + 1);
    expect(result.policy).toContain('OWNER-GATED');
  });
});
