/**
 * Tests for the IVX runtime activation missions and verdict evaluation.
 * Run: bun test qa/ivx-runtime-activation.test.ts
 */
import { test, expect } from 'bun:test';
import { IVX_PHASE2_120_ITEMS, IVX_PHASE2_SUMMARY, PHASE2_WORKSTREAMS } from './ivx-phase2-mission';
import { IVX_PHASE34_500_ITEMS, IVX_PHASE34_SUMMARY, WORKSTREAMS, EVIDENCE_GATES } from './ivx-phase3-4-500-mission';
import { evaluateActivation, type ActivationCertificate } from './ivx-runtime-orchestrator';

function baseCertificate(): ActivationCertificate {
  return {
    currentMainSha: 'a'.repeat(40),
    commandAgentsTotal: 12,
    commandAgentsActive: 12,
    workersTotal: 100,
    workersActive: 100,
    uniqueWorkerIds: Array.from({ length: 100 }, (_, i) => `ivx_holdings_${13 + i}`),
    phase2Active: true,
    phase3Active: true,
    phase4Active: true,
    phase2Counts: { total: 120, pass: 120, fail: 0, blocked: 0 },
    phase3Counts: { total: 475, pass: 475, fail: 0, blocked: 0 },
    phase4Counts: { total: 25, pass: 25, fail: 0, blocked: 0 },
    simulatedRuns: 0,
    fakeSuccessRuns: 0,
    failedActivationWorkers: [],
    artifactCount: 736,
    workflowRunId: '1234567890',
  };
}

test('phase2 mission: 120 unique items, 12 workstreams, 10 gates', () => {
  expect(IVX_PHASE2_120_ITEMS.length).toBe(120);
  expect(new Set(IVX_PHASE2_120_ITEMS.map((x) => x.id)).size).toBe(120);
  expect(PHASE2_WORKSTREAMS.length).toBe(12);
  expect(IVX_PHASE2_SUMMARY.totalItems).toBe(120);
  expect(IVX_PHASE2_SUMMARY.gates).toBe(10);
});

test('phase2 mission: every workstream has at least one real attempt assignment', () => {
  for (const [workstream] of PHASE2_WORKSTREAMS) {
    const items = IVX_PHASE2_120_ITEMS.filter((x) => x.workstream === workstream);
    expect(items.length).toBe(10);
  }
});

test('phase2 mission: all 100 workers IA-013..IA-112 receive at least one item', () => {
  const assigned = new Set(IVX_PHASE2_120_ITEMS.map((x) => x.workerAgentNumber));
  for (let n = 13; n <= 112; n += 1) expect(assigned.has(n)).toBe(true);
});

test('phase2 mission: simulated success is never allowed', () => {
  expect(IVX_PHASE2_120_ITEMS.every((x) => x.simulatedSuccessAllowed === false)).toBe(true);
});

test('phase34 mission: 500 unique items, 25 workstreams, 20 gates', () => {
  expect(IVX_PHASE34_500_ITEMS.length).toBe(500);
  expect(new Set(IVX_PHASE34_500_ITEMS.map((x) => x.id)).size).toBe(500);
  expect(WORKSTREAMS.length).toBe(25);
  expect(EVIDENCE_GATES.length).toBe(20);
  expect(IVX_PHASE34_SUMMARY.totalAgentsInMission).toBe(112);
});

test('phase34 mission: all 100 workers IA-013..IA-112 receive at least one item', () => {
  const assigned = new Set(IVX_PHASE34_500_ITEMS.map((x) => x.workerAgentNumber));
  for (let n = 13; n <= 112; n += 1) expect(assigned.has(n)).toBe(true);
});

test('phase34 mission: gate-20 items are exactly the Phase 4 items (25)', () => {
  const phase4 = IVX_PHASE34_500_ITEMS.filter((x) => x.gate.startsWith('Phase 4'));
  expect(phase4.length).toBe(25);
  expect(new Set(phase4.map((x) => x.workstream)).size).toBe(25);
});

test('verdict: full certificate passes', () => {
  expect(evaluateActivation(baseCertificate()).verdict).toBe('PASS');
});

test('verdict: fails on missing workflowRunId', () => {
  const cert = { ...baseCertificate(), workflowRunId: null };
  const res = evaluateActivation(cert);
  expect(res.verdict).toBe('FAIL');
  expect(res.reasons.some((r) => r.includes('workflowRunId'))).toBe(true);
});

test('verdict: fails on 20 active workers', () => {
  const cert = { ...baseCertificate(), workersActive: 20, uniqueWorkerIds: baseCertificate().uniqueWorkerIds.slice(0, 20) };
  expect(evaluateActivation(cert).verdict).toBe('FAIL');
});

test('verdict: fails on simulated runs', () => {
  const cert = { ...baseCertificate(), simulatedRuns: 1 };
  const res = evaluateActivation(cert);
  expect(res.verdict).toBe('FAIL');
  expect(res.reasons.some((r) => r.includes('simulatedRuns'))).toBe(true);
});

test('verdict: fails when a worker number is missing from uniqueWorkerIds', () => {
  const ids = baseCertificate().uniqueWorkerIds.filter((_, i) => i !== 50);
  const cert = { ...baseCertificate(), uniqueWorkerIds: ids };
  const res = evaluateActivation(cert);
  expect(res.verdict).toBe('FAIL');
  expect(res.reasons.some((r) => r.includes('missing worker'))).toBe(true);
});

test('verdict: fails when a phase is inactive', () => {
  const cert = { ...baseCertificate(), phase4Active: false };
  const res = evaluateActivation(cert);
  expect(res.verdict).toBe('FAIL');
  expect(res.reasons.some((r) => r.includes('phase4'))).toBe(true);
});

test('verdict: fails on artifactCount below 100', () => {
  const cert = { ...baseCertificate(), artifactCount: 22 };
  const res = evaluateActivation(cert);
  expect(res.verdict).toBe('FAIL');
  expect(res.reasons.some((r) => r.includes('artifactCount'))).toBe(true);
});
