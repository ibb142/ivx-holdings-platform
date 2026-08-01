import { describe, expect, test } from 'bun:test';
import {
  buildSeniorDeveloperTaskContract,
  classifySeniorDeveloperCapabilities,
  IVX_SENIOR_DEVELOPER_CAPABILITY_MARKER,
} from './ivx-senior-developer-capability-engine';

describe('IVX senior developer capability engine', () => {
  test('turns a vague build into an evidence-first code-generation contract', () => {
    const contract = buildSeniorDeveloperTaskContract('Build a simple owner alert center for important deal changes.');
    expect(contract.marker).toBe(IVX_SENIOR_DEVELOPER_CAPABILITY_MARKER);
    expect(contract.capabilities).toContain('vague_goal_code_generation');
    expect(contract.executionStages).toContain('implement_smallest_testable_vertical_slice');
    expect(contract.evidenceRequirements.map((entry) => entry.kind)).toContain('production_verification');
  });

  test('requires log signals and falsifiable hypotheses for a complex failure', () => {
    const contract = buildSeniorDeveloperTaskContract('Debug the API timeout by reading the logs, finding the root cause, fixing it, and deploying.');
    expect(contract.capabilities).toContain('log_driven_debugging');
    expect(contract.hypothesis.likelyCauses.length).toBeGreaterThan(1);
    expect(contract.evidenceRequirements.map((entry) => entry.kind)).toContain('log_signal');
    expect(contract.evidenceRequirements.map((entry) => entry.kind)).toContain('hypothesis');
  });

  test('defines boundaries and interfaces for an end-to-end feature', () => {
    const contract = buildSeniorDeveloperTaskContract('Architect and build a new investor onboarding workflow end-to-end.');
    expect(contract.capabilities).toContain('feature_architecture');
    expect(contract.architecture.boundaries).toContain('durable data');
    expect(contract.architecture.interfaces).toContain('failure contract');
  });

  test('adapts an unfamiliar problem without inventing unsupported dependencies', () => {
    const contract = buildSeniorDeveloperTaskContract('Solve this unfamiliar novel problem the system was not designed for.');
    expect(contract.capabilities).toContain('novel_problem_adaptation');
    expect(contract.adaptation.isNovel).toBe(true);
    expect(contract.adaptation.fallback).toContain('Stop before mutation');
  });

  test('always includes continuous build-test-verify evidence for execution requests', () => {
    const capabilities = classifySeniorDeveloperCapabilities('Fix the issue, run tests, deploy it, and verify production.');
    expect(capabilities).toContain('continuous_delivery');
  });
});
