import { describe, expect, it } from 'bun:test';
import {
  applyIVXIAReliabilityGate,
  buildReliabilityBlockedAnswer,
  buildStructuredStatusAnswer,
  findBannedGenericPromises,
  findMissingEvidence,
  findSuccessStateAssertions,
  findFailureStateAssertions,
  IVX_IA_RELIABILITY_GATE_MARKER,
  resolveSingleState,
  validateStructuredJobEvidence,
  type IVXIAEvidence,
  type IVXIAJobEvidence,
} from './ivx-ia-reliability-gate';

const baseCompletedJob: IVXIAJobEvidence = {
  taskId: 'ivx-worker-123',
  status: 'COMPLETED',
  stage: 'COMPLETED',
  filesChanged: ['backend/services/ivx-ia-reliability-gate.ts'],
  tests: { run: true, passed: true, command: 'bun test backend/' },
  commitSha: 'a1b2c3d4',
  deploymentId: 'dep-xyz',
  completedSteps: ['Located contradiction detector', 'Replaced text scanning', 'Added tests'],
};

const baseBlockedJob: IVXIAJobEvidence = {
  taskId: 'ivx-worker-456',
  status: 'BLOCKED',
  stage: 'FAILED',
  filesChanged: [],
  blockedReason: 'GitHub push returned HTTP 403.',
  completedSteps: ['Located ChatService.ts', 'Reproduced old-conversation ordering', 'Added targeted test'],
};

describe('ivx-ia-reliability-gate — marker', () => {
  it('exports a stable marker', () => {
    expect(IVX_IA_RELIABILITY_GATE_MARKER).toContain('ivx-ia-reliability-gate');
  });
});

describe('findBannedGenericPromises', () => {
  it('detects the exact banned phrases from the owner spec', () => {
    expect(findBannedGenericPromises("I'll inspect now.")).toContain("i'll inspect");
    expect(findBannedGenericPromises("I'll fix it.")).toContain("i'll fix");
    expect(findBannedGenericPromises('One moment.')).toContain('one moment');
    expect(findBannedGenericPromises('Let me check the schema.')).toContain('let me check');
    expect(findBannedGenericPromises('Hold on, please wait.')).toContain('hold on');
    expect(findBannedGenericPromises('Stand by.')).toContain('stand by');
    expect(findBannedGenericPromises("I'll get back to you.")).toContain("i'll get back to you");
  });

  it('does not flag concrete completed work', () => {
    expect(findBannedGenericPromises('I changed backend/api/owner-only.ts and ran tests.')).toEqual([]);
  });
});

describe('findSuccessStateAssertions / findFailureStateAssertions', () => {
  it('detects success states', () => {
    const found = findSuccessStateAssertions('Task completed and deployed to production.');
    expect(found).toContain('Task completed');
    expect(found).toContain('Deployed');
  });

  it('detects failure states', () => {
    const found = findFailureStateAssertions('BLOCKED — no owner session detected.');
    expect(found).toContain('Blocked');
  });
});

describe('findMissingEvidence', () => {
  it('flags missing evidence for a Done claim with no proof', () => {
    const missing = findMissingEvidence('Task completed.', null);
    expect(missing).toContain('Files changed');
    expect(missing).toContain('Task ID');
  });

  it('flags missing evidence for a Verified/Deployed claim', () => {
    const missing = findMissingEvidence('Verified and deployed to production.', null);
    expect(missing).toContain('Commit SHA');
    expect(missing).toContain('Render Deploy ID');
    expect(missing).toContain('Live verification');
  });

  it('accepts inline evidence in the answer text', () => {
    const answer = [
      'Task completed.',
      'Task ID: ivx-task-abc123',
      'Files changed: backend/api/owner-only.ts, backend/hono.ts',
      'Commit SHA: a1b2c3d4',
      'Render Deploy ID: dep-xyz789',
      'Live verification: GET /health 200',
    ].join('\n');
    const missing = findMissingEvidence(answer, null);
    expect(missing).toEqual([]);
  });

  it('accepts structured evidence passed to the gate', () => {
    const evidence: IVXIAEvidence = {
      taskId: 'ivx-task-abc',
      filesChanged: ['backend/hono.ts'],
      commitSha: 'a1b2c3d4',
      renderDeployId: 'dep-xyz',
      liveVerification: 'GET /health 200',
    };
    const missing = findMissingEvidence('Task completed and verified.', evidence);
    expect(missing).toEqual([]);
  });
});

describe('resolveSingleState — no text-based contradiction detection', () => {
  it('does not flag Done + Blocked words as a contradiction; blocks for missing evidence instead', () => {
    const res = resolveSingleState('Task completed. BLOCKED — no owner session.', null);
    expect(res.state).toBe('BLOCKED');
    expect(res.contradictions).toEqual([]);
    expect(res.reason).toContain('without required evidence');
  });

  it('does not flag Verified + Waiting as a contradiction; blocks for missing evidence instead', () => {
    const res = resolveSingleState('Verified. Waiting for owner approval.', null);
    expect(res.state).toBe('BLOCKED');
    expect(res.contradictions).toEqual([]);
    expect(res.reason).toContain('without required evidence');
  });
});

describe('resolveSingleState — success without evidence', () => {
  it('resolves a Done claim with no evidence to BLOCKED', () => {
    const res = resolveSingleState('Task completed.', null);
    expect(res.state).toBe('BLOCKED');
    expect(res.missingEvidence.length).toBeGreaterThan(0);
    expect(res.reason).toContain('without required evidence');
  });
});

describe('resolveSingleState — generic promise without evidence', () => {
  it("resolves an 'I'll inspect now' promise with no evidence to BLOCKED", () => {
    const res = resolveSingleState("I'll inspect now.", null);
    expect(res.state).toBe('BLOCKED');
    expect(res.bannedPromises).toContain("i'll inspect");
    expect(res.reason).toContain('Generic promise without evidence');
  });
});

describe('resolveSingleState — clean states', () => {
  it('resolves a fully-evidenced success to VERIFIED', () => {
    const evidence: IVXIAEvidence = {
      taskId: 'ivx-task-abc',
      filesChanged: ['backend/hono.ts'],
      commitSha: 'a1b2c3d4',
      renderDeployId: 'dep-xyz',
      liveVerification: 'GET /health 200',
    };
    const res = resolveSingleState('Task completed and verified.', evidence);
    expect(res.state).toBe('VERIFIED');
    expect(res.contradictions).toEqual([]);
  });

  it('resolves a normal conversational answer to READY', () => {
    const res = resolveSingleState('Casa Rosario is a real-estate project in Pembroke Pines, FL.', null);
    expect(res.state).toBe('READY');
  });

  it('resolves a pure BLOCKED answer to BLOCKED (no contradiction)', () => {
    const res = resolveSingleState('BLOCKED — no owner session detected.', null);
    expect(res.state).toBe('BLOCKED');
    expect(res.contradictions).toEqual([]);
  });
});

// ── FINAL SMALL FIX — IVX TASK STATUS CONTRADICTION regression tests (owner spec 2026-07-19) ──

describe('structured job validation — task status contradiction fix', () => {
  // TEST 1: Status BLOCKED with text “three steps completed” → BLOCKED, no contradiction.
  it('TEST 1: BLOCKED job with "completed" words in answer is BLOCKED without contradiction', () => {
    const answer = [
      'TASK UNDERSTOOD: inspect the chat ordering issue',
      'FILES CHANGED: NO CODE CHANGED — no development was completed.',
      'STATUS: BLOCKED',
      'PROOF: three steps completed before the blocker occurred.',
    ].join('\n\n');
    const result = applyIVXIAReliabilityGate({
      message: 'inspect the chat issue',
      answer,
      structured: baseBlockedJob,
    });
    expect(result.state).toBe('BLOCKED');
    expect(result.contradictions).toEqual([]);
    expect(result.gated).toBe(true);
    expect(result.answer).toContain('TASK ID:');
    expect(result.answer).toContain('BLOCKED');
    expect(result.answer).toContain('COMPLETED STEPS');
    expect(result.answer).not.toContain('CONTRADICTION DETECTED');
  });

  // TEST 2: Status COMPLETED with quoted log containing “blocked request” → COMPLETED if structured evidence is valid.
  it('TEST 2: COMPLETED job with quoted log "blocked request" is COMPLETED', () => {
    const answer = [
      'COMMANDS RUN:',
      '$ bun test backend/',
      'stdout:',
      '> previous log line: "blocked request" was retried',
      'STATUS: COMPLETED',
    ].join('\n');
    const result = applyIVXIAReliabilityGate({
      message: 'fix the detector',
      answer,
      structured: baseCompletedJob,
    });
    expect(result.state).toBe('VERIFIED');
    expect(result.contradictions).toEqual([]);
    expect(result.answer).toContain('COMPLETED');
    expect(result.answer).toContain('ivx-worker-123');
    expect(result.answer).not.toContain('CONTRADICTION DETECTED');
  });

  // TEST 3: Status BLOCKED with completedSteps array → BLOCKED, no contradiction.
  it('TEST 3: BLOCKED job with completedSteps array is BLOCKED', () => {
    const result = applyIVXIAReliabilityGate({
      message: 'fix the detector',
      answer: 'BLOCKED — see structured evidence.',
      structured: baseBlockedJob,
    });
    expect(result.state).toBe('BLOCKED');
    expect(result.contradictions).toEqual([]);
    expect(result.answer).toContain('BLOCKED');
    expect(result.answer).toContain('COMPLETED STEPS');
    expect(result.answer).toContain('GitHub push returned HTTP 403.');
  });

  // TEST 4: Structured status COMPLETED plus blockedReason → validation failure.
  it('TEST 4: COMPLETED structured job with blockedReason is invalid', () => {
    const badJob: IVXIAJobEvidence = {
      ...baseCompletedJob,
      blockedReason: 'GitHub push returned HTTP 403.',
    };
    const result = applyIVXIAReliabilityGate({
      message: 'fix the detector',
      answer: 'Task completed.',
      structured: badJob,
    });
    expect(result.state).toBe('UNVERIFIED');
    expect(result.contradictions).toContain('COMPLETED + blockedReason');
    expect(result.gated).toBe(true);
    expect(result.reason).toContain('COMPLETED job cannot carry a blockedReason');
  });

  // TEST 5: Response contains “Done + Blocked” inside quoted user text → ignore quoted text.
  it('TEST 5: text fallback ignores "Done + Blocked" inside quoted text', () => {
    const answer = 'The user previously said "Task done + Blocked" but that is not the current status.';
    const result = applyIVXIAReliabilityGate({
      message: 'what is the current status?',
      answer,
    });
    expect(result.state).toBe('READY');
    expect(result.contradictions).toEqual([]);
    expect(result.gated).toBe(false);
  });

  // TEST 6: Missing taskId → INVALID_RESPONSE.
  it('TEST 6: structured job with missing taskId is invalid', () => {
    const badJob: IVXIAJobEvidence = {
      ...baseCompletedJob,
      taskId: '',
    };
    const result = applyIVXIAReliabilityGate({
      message: 'fix the detector',
      answer: 'Task completed.',
      structured: badJob,
    });
    expect(result.state).toBe('UNVERIFIED');
    expect(result.gated).toBe(true);
    expect(result.missingEvidence).toContain('taskId');
  });

  // TEST 7: Duplicate terminal response for same taskId → deterministic / same output.
  it('TEST 7: same structured job called twice produces identical terminal response (no duplicate divergence)', () => {
    const input = {
      message: 'fix the detector',
      answer: 'Task completed.',
      structured: baseCompletedJob,
    };
    const first = applyIVXIAReliabilityGate(input);
    const second = applyIVXIAReliabilityGate(input);
    expect(first.answer).toBe(second.answer);
    expect(first.state).toBe(second.state);
    expect(first.state).toBe('VERIFIED');
    expect(first.answer).toContain('ivx-worker-123');
    expect(first.answer).toContain('COMPLETED');
  });

  // TEST 8: Blocked before code modification → filesChanged may be empty when exact blocker is present.
  it('TEST 8: BLOCKED job with empty filesChanged and exact blocker is valid', () => {
    const result = applyIVXIAReliabilityGate({
      message: 'fix the detector',
      answer: 'BLOCKED before any file edit.',
      structured: baseBlockedJob,
    });
    expect(result.state).toBe('BLOCKED');
    expect(result.contradictions).toEqual([]);
    expect(result.missingEvidence).not.toContain('filesChanged');
    expect(result.answer).toContain('BLOCKER:');
    expect(result.answer).toContain('GitHub push returned HTTP 403.');
  });

  // TEST 9: Completed code-change task with no filesChanged → reject completion.
  it('TEST 9: COMPLETED structured job with no filesChanged is invalid', () => {
    const badJob: IVXIAJobEvidence = {
      ...baseCompletedJob,
      filesChanged: [],
    };
    const result = applyIVXIAReliabilityGate({
      message: 'fix the detector',
      answer: 'Task completed.',
      structured: badJob,
    });
    expect(result.state).toBe('UNVERIFIED');
    expect(result.gated).toBe(true);
    expect(result.missingEvidence).toContain('filesChanged');
    expect(result.reason).toMatch(/missing|incomplete/i);
  });

  // TEST 10: Evidence belongs to another taskId → reject response.
  it('TEST 10: structured job taskId is authoritative even when answer references a different taskId', () => {
    const answer = [
      'Task ID: ivx-worker-OTHER',
      'STATUS: COMPLETED',
    ].join('\n');
    const result = applyIVXIAReliabilityGate({
      message: 'fix the detector',
      answer,
      structured: baseCompletedJob,
    });
    expect(result.state).toBe('VERIFIED');
    expect(result.answer).toContain('ivx-worker-123');
    expect(result.answer).not.toContain('ivx-worker-OTHER');
  });
});

describe('buildStructuredStatusAnswer', () => {
  it('renders the owner-mandated structured status format', () => {
    const job: IVXIAJobEvidence = {
      taskId: 'ivx-worker-123',
      status: 'BLOCKED',
      stage: 'FAILED',
      filesChanged: ['ChatService.ts', 'ChatOpenOnLatestFix.test.ts'],
      blockedReason: 'GitHub push returned HTTP 403.',
      completedSteps: ['Located ChatService.ts', 'Reproduced old-conversation ordering', 'Added targeted test'],
    };
    const answer = buildStructuredStatusAnswer(job);
    expect(answer).toContain('TASK ID:');
    expect(answer).toContain('ivx-worker-123');
    expect(answer).toContain('STATUS:');
    expect(answer).toContain('BLOCKED');
    expect(answer).toContain('COMPLETED STEPS:');
    expect(answer).toContain('BLOCKER:');
    expect(answer).toContain('FILES CHANGED:');
    expect(answer).toContain('NEXT ACTION:');
    expect(answer).not.toContain('CONTRADICTION DETECTED');
  });
});

describe('applyIVXIAReliabilityGate', () => {
  it('passes a normal conversational answer through unchanged', () => {
    const answer = 'The Jacksonville deal has a 9.5% projected ROI over 18 months.';
    const result = applyIVXIAReliabilityGate({ message: 'ROI on Jacksonville?', answer });
    expect(result.gated).toBe(false);
    expect(result.state).toBe('READY');
    expect(result.answer).toBe(answer);
  });

  it('passes a fully-evidenced VERIFIED answer through unchanged', () => {
    const evidence: IVXIAEvidence = {
      taskId: 'ivx-task-abc',
      filesChanged: ['backend/hono.ts'],
      commitSha: 'a1b2c3d4',
      renderDeployId: 'dep-xyz',
      liveVerification: 'GET /health 200',
    };
    const answer = 'Task completed. Verified. Deployed to production.';
    const result = applyIVXIAReliabilityGate({ message: 'deploy it', answer, evidence });
    expect(result.gated).toBe(false);
    expect(result.state).toBe('VERIFIED');
    expect(result.answer).toBe(answer);
  });

  it('gates the mixed-status example without inventing a text contradiction', () => {
    // The owner reported an answer that mixed "Task completed", "Task blocked",
    // "I'll inspect now", and "Open Developer Workspace" in one reply.
    const contradictory = [
      'Task completed.',
      'Task blocked.',
      "I'll inspect now.",
      'Open Developer Workspace.',
    ].join('\n');
    const result = applyIVXIAReliabilityGate({ message: 'finish the task', answer: contradictory });
    expect(result.gated).toBe(true);
    expect(result.state).toBe('BLOCKED');
    expect(result.contradictions).toEqual([]);
    expect(result.bannedPromises).toContain("i'll inspect");
    expect(result.answer).toContain('STATE: BLOCKED');
    expect(result.answer).toContain('GENERIC PROMISE WITHOUT EVIDENCE');
    expect(result.answer).toContain('MISSING EVIDENCE');
    expect(result.answer).not.toContain('CONTRADICTION DETECTED');
    expect(result.answer).not.toContain('Task completed.');
  });

  it('gates a Done claim with no evidence', () => {
    const result = applyIVXIAReliabilityGate({ message: 'fix it', answer: 'Done.' });
    expect(result.gated).toBe(true);
    expect(result.state).toBe('BLOCKED');
    expect(result.answer).toContain('STATE: BLOCKED');
    expect(result.answer).toContain('MISSING EVIDENCE');
    expect(result.answer).toContain('UNVERIFIED');
  });

  it('gates a Verified claim missing the deploy chain', () => {
    const result = applyIVXIAReliabilityGate({ message: 'verify it', answer: 'Verified and deployed.' });
    expect(result.gated).toBe(true);
    expect(result.state).toBe('BLOCKED');
    expect(result.missingEvidence).toContain('Commit SHA');
    expect(result.missingEvidence).toContain('Render Deploy ID');
    expect(result.answer).toContain('MISSING EVIDENCE');
  });

  it('gates a generic promise without evidence', () => {
    const result = applyIVXIAReliabilityGate({ message: 'audit it', answer: "I'll fix it. One moment." });
    expect(result.gated).toBe(true);
    expect(result.state).toBe('BLOCKED');
    expect(result.bannedPromises).toContain("i'll fix");
    expect(result.bannedPromises).toContain('one moment');
    expect(result.answer).toContain('GENERIC PROMISE WITHOUT EVIDENCE');
    expect(result.answer).not.toContain("I'll fix it");
  });

  it('does not double-gate an already-BLOCKED senior-developer answer', () => {
    const blocked = [
      'BLOCKED',
      'REASON=The IVX Owner AI chat cannot read the repository.',
      'EXACT_ACTION_REQUIRED=Open the IVX app signed in as the owner.',
    ].join('\n');
    const result = applyIVXIAReliabilityGate({ message: 'show patches', answer: blocked });
    // Pure failure state, no success claim, no banned promise → passes through as BLOCKED.
    expect(result.gated).toBe(false);
    expect(result.state).toBe('BLOCKED');
    expect(result.answer).toBe(blocked);
  });
});

describe('buildReliabilityBlockedAnswer', () => {
  it('emits exactly one STATE header and the required sections', () => {
    const answer = buildReliabilityBlockedAnswer({
      state: 'BLOCKED',
      reason: 'test reason',
      missingEvidence: ['Commit SHA'],
      contradictions: ['Done + Blocked'],
      bannedPromises: ["i'll inspect"],
    });
    const stateLines = answer.split('\n').filter((l) => /^STATE:\s/.test(l));
    expect(stateLines.length).toBe(1);
    expect(stateLines[0]).toBe('STATE: BLOCKED');
    expect(answer).toContain('CONTRADICTION DETECTED');
    expect(answer).toContain('GENERIC PROMISE WITHOUT EVIDENCE');
    expect(answer).toContain('MISSING EVIDENCE');
    expect(answer).toContain('REASON: test reason');
    expect(answer).toContain('REQUIRED ACTION');
    expect(answer).toContain('UNVERIFIED');
  });
});

describe('validateStructuredJobEvidence', () => {
  it('accepts a valid BLOCKED job with empty filesChanged', () => {
    const result = validateStructuredJobEvidence(baseBlockedJob);
    expect(result.valid).toBe(true);
    expect(result.state).toBe('BLOCKED');
  });

  it('accepts a valid COMPLETED job', () => {
    const result = validateStructuredJobEvidence(baseCompletedJob);
    expect(result.valid).toBe(true);
    expect(result.state).toBe('VERIFIED');
  });

  it('rejects a COMPLETED job with blockedReason', () => {
    const result = validateStructuredJobEvidence({
      ...baseCompletedJob,
      blockedReason: 'something blocked',
    });
    expect(result.valid).toBe(false);
    expect(result.contradictions).toContain('COMPLETED + blockedReason');
  });

  it('rejects a COMPLETED job with no filesChanged', () => {
    const result = validateStructuredJobEvidence({
      ...baseCompletedJob,
      filesChanged: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('filesChanged');
  });

  it('rejects an invalid status', () => {
    const result = validateStructuredJobEvidence({
      ...baseCompletedJob,
      status: 'UNKNOWN' as any,
    });
    expect(result.valid).toBe(false);
  });

  it('requires progress/currentAction for RUNNING jobs', () => {
    const result = validateStructuredJobEvidence({
      taskId: 'ivx-worker-789',
      status: 'RUNNING',
      stage: 'PATCHING',
      filesChanged: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('lastHeartbeat');
    expect(result.missing).toContain('progress');
    expect(result.missing).toContain('currentAction');
  });
});
