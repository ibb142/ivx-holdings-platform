/**
 * IVX Deployment State Protocol
 *
 * Owner spec (2026-07-05):
 *   Never answer deployment questions with conversational text.
 *   Every deployment request must return exactly one of:
 *     STATE: READY
 *     STATE: RUNNING
 *     STATE: BLOCKED
 *     STATE: VERIFIED
 *
 *   If BLOCKED:  return only the exact blocker.
 *   If VERIFIED: return GitHub SHA, Render Deploy ID, Health endpoint,
 *                Version endpoint, Timestamp, Evidence ledger.
 *
 *   Never fabricate production evidence.
 *   Never claim deployment without verification.
 *
 * This module is the single source of truth for the strict deployment state
 * envelope. It is pure (no I/O) so it is fully unit-testable. All deployment
 * handlers (chat brain slash-commands, natural-language deploy intents, the
 * public_deploy canned answer, the developer-deploy-control route) MUST format
 * their final answer through this module so the owner always receives the same
 * state-protocol shape — never conversational prose, never a fake VERIFIED.
 */

export const IVX_DEPLOYMENT_STATE_PROTOCOL_MARKER =
  'ivx-deployment-state-protocol-2026-07-05-v1';

export type IVXDeploymentState = 'READY' | 'RUNNING' | 'BLOCKED' | 'VERIFIED';

/** Evidence required to claim VERIFIED. Every field must be present and
 *  non-null — no partial proof is allowed to claim VERIFIED. */
export type IVXDeploymentVerifiedEvidence = {
  /** GitHub commit SHA the deploy was built from. */
  githubSha: string | null;
  /** Render deploy ID returned by the Render API. */
  renderDeployId: string | null;
  /** Production /health endpoint HTTP status (must be 2xx). */
  healthHttpStatus: number | null;
  /** Production /health response body SHA (or null if unavailable). */
  healthSha: string | null;
  /** Production /version endpoint HTTP status. */
  versionHttpStatus: number | null;
  /** Production /version response body SHA. */
  versionSha: string | null;
  /** ISO timestamp the verification was performed. */
  verifiedAt: string;
  /** Senior Developer Proof Ledger entry id (or null if no ledger entry). */
  proofLedgerEntryId: string | null;
};

export type IVXDeploymentProtocolInput = {
  state: IVXDeploymentState;
  /** Stable task id for this deployment request. */
  taskId: string;
  /** Exact blocker text when state is BLOCKED. Must be null/empty otherwise. */
  blocker: string | null;
  /** When state is RUNNING, the in-progress deploy id (if known). */
  runningDeployId: string | null;
  /** Evidence when state is VERIFIED. Required when state === 'VERIFIED'. */
  evidence: IVXDeploymentVerifiedEvidence | null;
  /** Optional blocker code (e.g. OWNER_SESSION_MISSING, RENDER_API_KEY_MISSING). */
  blockerCode: string | null;
};

/**
 * Returns true only when every evidence field required to claim VERIFIED is
 * present, the production /health and /version endpoints both returned HTTP
 * 2xx, and at least one of healthSha/versionSha is non-null. This is the
 * single gate — no caller may print "STATE: VERIFIED" without passing it.
 */
export function isEvidenceSufficientForVerified(
  evidence: IVXDeploymentVerifiedEvidence | null,
): boolean {
  if (!evidence) {
    return false;
  }
  const hasGithubSha = Boolean(evidence.githubSha && evidence.githubSha.length >= 6);
  const hasRenderDeployId = Boolean(evidence.renderDeployId && evidence.renderDeployId.length > 0);
  const healthOk = typeof evidence.healthHttpStatus === 'number'
    && evidence.healthHttpStatus >= 200
    && evidence.healthHttpStatus < 300;
  const versionOk = typeof evidence.versionHttpStatus === 'number'
    && evidence.versionHttpStatus >= 200
    && evidence.versionHttpStatus < 300;
  const hasCommitProof = Boolean(evidence.healthSha || evidence.versionSha);
  return hasGithubSha && hasRenderDeployId && healthOk && versionOk && hasCommitProof;
}

/**
 * Format the strict deployment state-protocol envelope. This is the ONLY
 * sanctioned format for a deployment answer. If the caller passes VERIFIED
 * with insufficient evidence, the formatter downgrades to BLOCKED with the
 * exact reason — it never lets a fake VERIFIED through.
 */
export function formatDeploymentStateProtocol(
  input: IVXDeploymentProtocolInput,
): string {
  const taskId = (input.taskId ?? '').trim() || 'ivx-deploy-no-task-id';
  const blockerCode = (input.blockerCode ?? '').trim() || null;

  // VERIFIED without sufficient evidence is downgraded to BLOCKED. The owner
  // spec is explicit: never fabricate production evidence, never claim
  // deployment without verification.
  if (input.state === 'VERIFIED' && !isEvidenceSufficientForVerified(input.evidence)) {
    const missing: string[] = [];
    if (!input.evidence) {
      missing.push('no evidence attached');
    } else {
      if (!input.evidence.githubSha) missing.push('GitHub SHA missing');
      if (!input.evidence.renderDeployId) missing.push('Render Deploy ID missing');
      if (typeof input.evidence.healthHttpStatus !== 'number' || input.evidence.healthHttpStatus < 200 || input.evidence.healthHttpStatus >= 300) {
        missing.push(`production /health not verified (HTTP ${input.evidence.healthHttpStatus ?? 'n/a'})`);
      }
      if (typeof input.evidence.versionHttpStatus !== 'number' || input.evidence.versionHttpStatus < 200 || input.evidence.versionHttpStatus >= 300) {
        missing.push(`production /version not verified (HTTP ${input.evidence.versionHttpStatus ?? 'n/a'})`);
      }
      if (!input.evidence.healthSha && !input.evidence.versionSha) {
        missing.push('no commit SHA returned from /health or /version');
      }
    }
    const exactBlocker = `Cannot claim VERIFIED — evidence insufficient: ${missing.join('; ')}.`;
    return formatDeploymentStateProtocol({
      state: 'BLOCKED',
      taskId,
      blocker: exactBlocker,
      blockerCode: blockerCode ?? 'EVIDENCE_INSUFFICIENT',
      runningDeployId: null,
      evidence: null,
    });
  }

  if (input.state === 'BLOCKED') {
    const exactBlocker = (input.blocker ?? '').trim() || 'Deployment blocked — no exact blocker supplied.';
    const lines = [
      'STATE: BLOCKED',
      `TASK_ID: ${taskId}`,
      `BLOCKER_CODE: ${blockerCode ?? 'UNKNOWN_BLOCKER'}`,
      `EXACT_BLOCKER: ${exactBlocker}`,
      `_Protocol: ${IVX_DEPLOYMENT_STATE_PROTOCOL_MARKER}_`,
    ];
    return lines.join('\n');
  }

  if (input.state === 'READY') {
    const lines = [
      'STATE: READY',
      `TASK_ID: ${taskId}`,
      `EXECUTOR: senior_developer_24_7`,
      `PROOF_LEDGER: active`,
      `_Protocol: ${IVX_DEPLOYMENT_STATE_PROTOCOL_MARKER}_`,
    ];
    return lines.join('\n');
  }

  if (input.state === 'RUNNING') {
    const lines = [
      'STATE: RUNNING',
      `TASK_ID: ${taskId}`,
      `EXECUTOR: senior_developer_24_7`,
      input.runningDeployId ? `RENDER_DEPLOY_ID: ${input.runningDeployId}` : 'RENDER_DEPLOY_ID: pending',
      'Live progress: poll /deploy-status or /deploy-verify for the final commit-match check.',
      `_Protocol: ${IVX_DEPLOYMENT_STATE_PROTOCOL_MARKER}_`,
    ];
    return lines.join('\n');
  }

  // state === 'VERIFIED' with sufficient evidence.
  const ev = input.evidence as IVXDeploymentVerifiedEvidence;
  const lines = [
    'STATE: VERIFIED',
    `TASK_ID: ${taskId}`,
    `GITHUB_SHA: ${ev.githubSha ?? 'UNVERIFIED'}`,
    `RENDER_DEPLOY_ID: ${ev.renderDeployId ?? 'UNVERIFIED'}`,
    `HEALTH_ENDPOINT: /health → HTTP ${ev.healthHttpStatus ?? 'n/a'} (SHA ${ev.healthSha ?? 'n/a'})`,
    `VERSION_ENDPOINT: /version → HTTP ${ev.versionHttpStatus ?? 'n/a'} (SHA ${ev.versionSha ?? 'n/a'})`,
    `TIMESTAMP: ${ev.verifiedAt}`,
    `EVIDENCE_LEDGER: ${ev.proofLedgerEntryId ?? 'no ledger entry attached'}`,
    `_Protocol: ${IVX_DEPLOYMENT_STATE_PROTOCOL_MARKER}_`,
  ];
  return lines.join('\n');
}

/**
 * Build a BLOCKED state-protocol envelope from a missing-credential error.
 * Used by the chat brain and the public_deploy path when a deploy cannot
 * even be triggered because the required credentials are absent.
 */
export function buildBlockedDeploymentProtocol(
  taskId: string,
  blockerCode: string,
  exactBlocker: string,
): string {
  return formatDeploymentStateProtocol({
    state: 'BLOCKED',
    taskId,
    blocker: exactBlocker,
    blockerCode,
    runningDeployId: null,
    evidence: null,
  });
}

/**
 * Build a RUNNING state-protocol envelope from a triggered-but-not-yet-live
 * Render deploy. Used by handleDeployNow when the deploy was accepted but the
 * poll budget expired before it reached a terminal state.
 */
export function buildRunningDeploymentProtocol(
  taskId: string,
  runningDeployId: string | null,
): string {
  return formatDeploymentStateProtocol({
    state: 'RUNNING',
    taskId,
    blocker: null,
    blockerCode: null,
    runningDeployId,
    evidence: null,
  });
}

/**
 * Build a VERIFIED state-protocol envelope from live production evidence.
 * If the evidence is insufficient, this downgrades to BLOCKED — it never
 * lets a fake VERIFIED through.
 */
export function buildVerifiedDeploymentProtocol(
  taskId: string,
  evidence: IVXDeploymentVerifiedEvidence,
): string {
  return formatDeploymentStateProtocol({
    state: 'VERIFIED',
    taskId,
    blocker: null,
    blockerCode: null,
    runningDeployId: null,
    evidence,
  });
}

/**
 * True when a string already conforms to the deployment state-protocol
 * envelope (i.e. starts with one of the four sanctioned STATE: headers).
 * Used by the unified gate pipeline to detect and pass through compliant
 * deployment answers without re-interpreting them.
 */
export function isDeploymentStateProtocolAnswer(answer: string): boolean {
  const text = (answer ?? '').trim();
  if (!text) {
    return false;
  }
  return /^STATE:\s+(READY|RUNNING|BLOCKED|VERIFIED)\b/m.test(text)
    && text.includes(IVX_DEPLOYMENT_STATE_PROTOCOL_MARKER);
}
