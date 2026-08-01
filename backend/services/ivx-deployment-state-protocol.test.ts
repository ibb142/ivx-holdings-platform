import { describe, expect, test } from 'bun:test';
import {
  IVX_DEPLOYMENT_STATE_PROTOCOL_MARKER,
  buildBlockedDeploymentProtocol,
  buildRunningDeploymentProtocol,
  buildVerifiedDeploymentProtocol,
  formatDeploymentStateProtocol,
  isDeploymentStateProtocolAnswer,
  isEvidenceSufficientForVerified,
  type IVXDeploymentVerifiedEvidence,
} from './ivx-deployment-state-protocol';

describe('ivx-deployment-state-protocol — formatDeploymentStateProtocol', () => {
  test('BLOCKED returns only STATE header + exact blocker', () => {
    const out = formatDeploymentStateProtocol({
      state: 'BLOCKED',
      taskId: 'deploy-123',
      blocker: 'RENDER_API_KEY not configured in this environment.',
      blockerCode: 'RENDER_API_KEY_MISSING',
      runningDeployId: null,
      evidence: null,
    });
    expect(out.startsWith('STATE: BLOCKED')).toBe(true);
    expect(out).toContain('TASK_ID: deploy-123');
    expect(out).toContain('BLOCKER_CODE: RENDER_API_KEY_MISSING');
    expect(out).toContain('EXACT_BLOCKER: RENDER_API_KEY not configured in this environment.');
    expect(out).toContain(IVX_DEPLOYMENT_STATE_PROTOCOL_MARKER);
    // No conversational prose, no fake VERIFIED.
    expect(out).not.toContain('STATE: VERIFIED');
    expect(out).not.toContain('I deployed');
  });

  test('READY returns STATE: READY with executor + proof ledger', () => {
    const out = formatDeploymentStateProtocol({
      state: 'READY',
      taskId: 'deploy-123',
      blocker: null,
      blockerCode: null,
      runningDeployId: null,
      evidence: null,
    });
    expect(out.startsWith('STATE: READY')).toBe(true);
    expect(out).toContain('EXECUTOR: senior_developer_24_7');
    expect(out).toContain('PROOF_LEDGER: active');
  });

  test('RUNNING returns STATE: RUNNING with deploy id', () => {
    const out = formatDeploymentStateProtocol({
      state: 'RUNNING',
      taskId: 'deploy-123',
      blocker: null,
      blockerCode: null,
      runningDeployId: 'dep-abc',
      evidence: null,
    });
    expect(out.startsWith('STATE: RUNNING')).toBe(true);
    expect(out).toContain('RENDER_DEPLOY_ID: dep-abc');
  });

  test('VERIFIED with sufficient evidence returns full evidence chain', () => {
    const evidence: IVXDeploymentVerifiedEvidence = {
      githubSha: 'abc123def456',
      renderDeployId: 'dep-abc',
      healthHttpStatus: 200,
      healthSha: 'abc123def456',
      versionHttpStatus: 200,
      versionSha: 'abc123def456',
      verifiedAt: '2026-07-05T12:00:00.000Z',
      proofLedgerEntryId: 'ledger-1',
    };
    const out = formatDeploymentStateProtocol({
      state: 'VERIFIED',
      taskId: 'deploy-123',
      blocker: null,
      blockerCode: null,
      runningDeployId: null,
      evidence,
    });
    expect(out.startsWith('STATE: VERIFIED')).toBe(true);
    expect(out).toContain('GITHUB_SHA: abc123def456');
    expect(out).toContain('RENDER_DEPLOY_ID: dep-abc');
    expect(out).toContain('HEALTH_ENDPOINT: /health → HTTP 200');
    expect(out).toContain('VERSION_ENDPOINT: /version → HTTP 200');
    expect(out).toContain('TIMESTAMP: 2026-07-05T12:00:00.000Z');
    expect(out).toContain('EVIDENCE_LEDGER: ledger-1');
  });

  test('VERIFIED with insufficient evidence downgrades to BLOCKED', () => {
    const incomplete: IVXDeploymentVerifiedEvidence = {
      githubSha: 'abc123def456',
      renderDeployId: null, // missing
      healthHttpStatus: 200,
      healthSha: 'abc123def456',
      versionHttpStatus: 200,
      versionSha: 'abc123def456',
      verifiedAt: '2026-07-05T12:00:00.000Z',
      proofLedgerEntryId: null,
    };
    const out = formatDeploymentStateProtocol({
      state: 'VERIFIED',
      taskId: 'deploy-123',
      blocker: null,
      blockerCode: null,
      runningDeployId: null,
      evidence: incomplete,
    });
    // Must NOT claim VERIFIED — downgrade to BLOCKED.
    expect(out.startsWith('STATE: BLOCKED')).toBe(true);
    expect(out).toContain('EVIDENCE_INSUFFICIENT');
    expect(out).toContain('Render Deploy ID missing');
    expect(out).not.toContain('STATE: VERIFIED');
  });

  test('VERIFIED with no evidence at all downgrades to BLOCKED', () => {
    const out = formatDeploymentStateProtocol({
      state: 'VERIFIED',
      taskId: 'deploy-123',
      blocker: null,
      blockerCode: null,
      runningDeployId: null,
      evidence: null,
    });
    expect(out.startsWith('STATE: BLOCKED')).toBe(true);
    expect(out).toContain('no evidence attached');
    expect(out).not.toContain('STATE: VERIFIED');
  });

  test('VERIFIED with non-2xx /health downgrades to BLOCKED', () => {
    const evidence: IVXDeploymentVerifiedEvidence = {
      githubSha: 'abc123def456',
      renderDeployId: 'dep-abc',
      healthHttpStatus: 503, // degraded
      healthSha: 'abc123def456',
      versionHttpStatus: 200,
      versionSha: 'abc123def456',
      verifiedAt: '2026-07-05T12:00:00.000Z',
      proofLedgerEntryId: null,
    };
    const out = formatDeploymentStateProtocol({
      state: 'VERIFIED',
      taskId: 'deploy-123',
      blocker: null,
      blockerCode: null,
      runningDeployId: null,
      evidence,
    });
    expect(out.startsWith('STATE: BLOCKED')).toBe(true);
    expect(out).toContain('production /health not verified');
    expect(out).not.toContain('STATE: VERIFIED');
  });
});

describe('ivx-deployment-state-protocol — isEvidenceSufficientForVerified', () => {
  test('returns true when all evidence present and 2xx', () => {
    const evidence: IVXDeploymentVerifiedEvidence = {
      githubSha: 'abc123def456',
      renderDeployId: 'dep-abc',
      healthHttpStatus: 200,
      healthSha: 'abc123def456',
      versionHttpStatus: 200,
      versionSha: 'abc123def456',
      verifiedAt: '2026-07-05T12:00:00.000Z',
      proofLedgerEntryId: null,
    };
    expect(isEvidenceSufficientForVerified(evidence)).toBe(true);
  });

  test('returns false when evidence is null', () => {
    expect(isEvidenceSufficientForVerified(null)).toBe(false);
  });

  test('returns false when githubSha missing', () => {
    const evidence: IVXDeploymentVerifiedEvidence = {
      githubSha: null,
      renderDeployId: 'dep-abc',
      healthHttpStatus: 200,
      healthSha: 'abc123def456',
      versionHttpStatus: 200,
      versionSha: 'abc123def456',
      verifiedAt: '2026-07-05T12:00:00.000Z',
      proofLedgerEntryId: null,
    };
    expect(isEvidenceSufficientForVerified(evidence)).toBe(false);
  });

  test('returns false when both healthSha and versionSha are null', () => {
    const evidence: IVXDeploymentVerifiedEvidence = {
      githubSha: 'abc123def456',
      renderDeployId: 'dep-abc',
      healthHttpStatus: 200,
      healthSha: null,
      versionHttpStatus: 200,
      versionSha: null,
      verifiedAt: '2026-07-05T12:00:00.000Z',
      proofLedgerEntryId: null,
    };
    expect(isEvidenceSufficientForVerified(evidence)).toBe(false);
  });
});

describe('ivx-deployment-state-protocol — isDeploymentStateProtocolAnswer', () => {
  test('detects compliant BLOCKED answer', () => {
    const answer = buildBlockedDeploymentProtocol('task-1', 'RENDER_API_KEY_MISSING', 'no key');
    expect(isDeploymentStateProtocolAnswer(answer)).toBe(true);
  });

  test('detects compliant VERIFIED answer', () => {
    const answer = buildVerifiedDeploymentProtocol('task-1', {
      githubSha: 'abc123def456',
      renderDeployId: 'dep-abc',
      healthHttpStatus: 200,
      healthSha: 'abc123def456',
      versionHttpStatus: 200,
      versionSha: 'abc123def456',
      verifiedAt: '2026-07-05T12:00:00.000Z',
      proofLedgerEntryId: null,
    });
    expect(isDeploymentStateProtocolAnswer(answer)).toBe(true);
  });

  test('detects compliant RUNNING answer', () => {
    const answer = buildRunningDeploymentProtocol('task-1', 'dep-abc');
    expect(isDeploymentStateProtocolAnswer(answer)).toBe(true);
  });

  test('rejects conversational prose', () => {
    expect(isDeploymentStateProtocolAnswer('I deployed the app to production. Deployment is live.')).toBe(false);
    expect(isDeploymentStateProtocolAnswer('## Deploy Now — TRIGGERED')).toBe(false);
    expect(isDeploymentStateProtocolAnswer('')).toBe(false);
  });

  test('rejects STATE header without the protocol marker', () => {
    expect(isDeploymentStateProtocolAnswer('STATE: VERIFIED\nGITHUB_SHA: abc')).toBe(false);
  });
});

describe('ivx-deployment-state-protocol — buildBlockedDeploymentProtocol', () => {
  test('produces exact blocker only', () => {
    const out = buildBlockedDeploymentProtocol('task-1', 'OWNER_SESSION_MISSING', 'No verified owner session is present.');
    expect(out.startsWith('STATE: BLOCKED')).toBe(true);
    expect(out).toContain('BLOCKER_CODE: OWNER_SESSION_MISSING');
    expect(out).toContain('EXACT_BLOCKER: No verified owner session is present.');
    // No conversational filler.
    expect(out.split('\n').filter((l) => l.trim().length > 0).length).toBeLessThanOrEqual(5);
  });
});
