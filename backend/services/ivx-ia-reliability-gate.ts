/**
 * IVX IA Reliability Gate — Single Decision Engine.
 *
 * Problem (owner spec): IVX IA sometimes returns contradictory messages in the
 * same conversation — "Task completed" + "Task blocked" + "I'll inspect now" +
 * "Open Developer Workspace" — which destroys trust.
 *
 * FINAL SMALL FIX — IVX TASK STATUS CONTRADICTION (2026-07-19):
 * The previous text-based contradiction detector scanned the natural-language
 * answer for words like "done", "completed", "blocked", "failed", etc. That
 * produced false positives on honest execution answers such as
 * "NO CODE CHANGED — no development was completed." when the structured job
 * status was BLOCKED. The fix makes the gate read ONE authoritative structured
 * status from the persistent worker job whenever it is available, and only
 * falls back to text scanning when no structured job is provided.
 *
 * This gate now enforces five owner-required rules, deterministically and with
 * no I/O:
 *
 *  1. SINGLE DECISION ENGINE — every reply carries exactly ONE status, picked
 *     from a fixed state machine: READY | RUNNING | WAITING_OWNER | BLOCKED |
 *     FAILED | VERIFIED. Never mixed.
 *  2. AUTHORITATIVE STRUCTURED STATUS — when a worker job is provided, the
 *     final status is read ONLY from job.status. Natural-language words inside
 *     the answer, previous messages, quoted text, logs, or error descriptions
 *     do NOT determine the status.
 *  3. NO GENERIC PROMISES — "I'll inspect now", "I'll fix it", "One moment",
 *     "hold on", "let me check" are blocked unless the answer also carries real
 *     evidence (a task id, files changed, commit SHA, deploy id, or live
 *     verification). A promise without evidence is rewritten to UNVERIFIED.
 *  4. EVIDENCE-FIRST — any claim of Done / Fixed / Verified / Deployed must be
 *     backed by evidence fields (Task ID, Files changed, Commit SHA, Render
 *     Deploy ID, Live verification). Missing evidence → answer becomes
 *     "UNVERIFIED" with the exact missing artifact named.
 *  5. STRUCTURED VALIDATION — a completed job must not carry a blockedReason.
 *     A blocked job may list completedSteps. A completed code-change task must
 *     have filesChanged. Evidence must belong to the same taskId.
 *
 * Pure + deterministic (no network, filesystem, or AI) so it is fully
 * unit-testable. It runs AFTER the senior-developer / access-status / execution
 * gates so it never re-implements their work — it only polishes the final answer
 * into a single-state, evidence-first reply.
 */
export const IVX_IA_RELIABILITY_GATE_MARKER =
  'ivx-ia-reliability-gate-2026-07-19-v2';

/** The single allowed decision state for any IVX IA reply. */
export type IVXIAState =
  | 'READY'
  | 'RUNNING'
  | 'WAITING_OWNER'
  | 'BLOCKED'
  | 'FAILED'
  | 'VERIFIED'
  | 'UNVERIFIED';

/** Evidence fields that turn a promise into a verifiable claim. */
export type IVXIAEvidence = {
  taskId?: string | null;
  filesChanged?: string[] | null;
  commitSha?: string | null;
  renderDeployId?: string | null;
  liveVerification?: string | null;
};

/** Authoritative structured status values from the persistent worker job. */
export type IVXIAJobStatusValue =
  | 'QUEUED'
  | 'CLAIMED'
  | 'RUNNING'
  | 'TESTING'
  | 'WAITING_OWNER'
  | 'BLOCKED'
  | 'FAILED'
  | 'COMPLETED'
  | 'CANCELLED';

/** Structured evidence from the persistent worker job — the single source of truth. */
export type IVXIAJobEvidence = {
  taskId: string;
  status: IVXIAJobStatusValue;
  stage?: string;
  filesChanged?: string[];
  tests?: { run: boolean; passed: boolean; command: string | null };
  commitSha?: string | null;
  deploymentId?: string | null;
  blockedReason?: string | null;
  completedSteps?: string[];
  error?: string | null;
  currentAction?: string | null;
  lastHeartbeat?: string | null;
  progress?: number;
};

export type IVXIAReliabilityGateInput = {
  message: string;
  answer: string;
  evidence?: IVXIAEvidence | null;
  /** When provided, status is derived from the structured job record only. */
  structured?: IVXIAJobEvidence | null;
};

export type IVXIAReliabilityGateResult = {
  answer: string;
  gated: boolean;
  state: IVXIAState;
  contradictions: string[];
  bannedPromises: string[];
  missingEvidence: string[];
  reason: string | null;
};

/**
 * Generic promise / filler phrases the owner explicitly banned. They are only
 * allowed when the answer also carries real evidence (task id / files / commit /
 * deploy / live verification); otherwise the promise is fabricated intent.
 */
export const BANNED_GENERIC_PROMISES: readonly string[] = [
  "i'll inspect",
  'i will inspect',
  "i'll fix",
  'i will fix',
  "i'll patch",
  'i will patch',
  "i'll validate",
  'i will validate',
  "i'll implement",
  'i will implement',
  "i'll return proof",
  'i will return proof',
  "i'll check",
  'i will check',
  "i'll look",
  'i will look',
  "i'll review",
  'i will review',
  'let me check',
  'let me look',
  'let me inspect',
  'let me review',
  'let me see',
  'one moment',
  'one sec',
  'just a moment',
  'just a second',
  'give me a moment',
  'give me a second',
  'hold on',
  'please wait',
  'stand by',
  'standby',
  "i'll get back to you",
  'i will get back to you',
  'i will update you shortly',
  "i'll update you shortly",
  'checking now',
  'executing that now',
  'starting now',
  'i am starting',
  'i am inspecting',
  'i am checking',
  'i am executing',
];

/**
 * Success-state assertions. When any of these appear, the answer is claiming a
 * positive outcome and must carry evidence — otherwise it is a fabricated
 * completion claim.
 *
 * NOTE: These are only used when NO structured job record is provided. When a
 * structured job is present, status is determined exclusively from job.status.
 */
const SUCCESS_STATE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\btask\s+completed\b/i, label: 'Task completed' },
  { pattern: /\btask\s+done\b/i, label: 'Task done' },
  { pattern: /\bdone\b/i, label: 'Done' },
  { pattern: /\bcompleted\b/i, label: 'Completed' },
  { pattern: /\bfinished\b/i, label: 'Finished' },
  { pattern: /\bshipped\b/i, label: 'Shipped' },
  { pattern: /\bfixed\b/i, label: 'Fixed' },
  { pattern: /\bverified\b/i, label: 'Verified' },
  { pattern: /\bdeployed\b/i, label: 'Deployed' },
  { pattern: /\bdeploy\s+(?:is\s+)?live\b/i, label: 'Deploy live' },
  { pattern: /\blive\s+in\s+production\b/i, label: 'Live in production' },
  { pattern: /\ball\s+checks\s+pass(?:ed|ing)?\b/i, label: 'All checks passed' },
  { pattern: /\btests?\s+passed\b/i, label: 'Tests passed' },
  { pattern: /\bbuild\s+succeeded\b/i, label: 'Build succeeded' },
];

/**
 * Failure / waiting-state assertions. When one of these coexists with a success
 * assertion in the same answer, the reply is contradictory.
 *
 * NOTE: These are only used when NO structured job record is provided.
 */
const FAILURE_STATE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bblocked\b/i, label: 'Blocked' },
  { pattern: /\bfailed\b/i, label: 'Failed' },
  { pattern: /\bwaiting\s+for\s+owner\b/i, label: 'Waiting for owner' },
  { pattern: /\bawaiting\s+approval\b/i, label: 'Awaiting approval' },
  { pattern: /\brequires?\s+owner\s+(?:confirmation|approval)\b/i, label: 'Requires owner approval' },
  { pattern: /\bnot\s+verified\b/i, label: 'Not verified' },
  { pattern: /\bunverified\b/i, label: 'Unverified' },
  { pattern: /\bcould\s+not\s+complete\b/i, label: 'Could not complete' },
  { pattern: /\bunable\s+to\b/i, label: 'Unable to' },
];

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function lower(value: string): string {
  return value.toLowerCase();
}

/** Remove quoted / code-fenced text so status words inside logs or quoted user text do not trigger false positives. */
function stripQuotedText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/["'](?:[^"']|\\["'])*["']/g, ' ');
}

/** Detect banned generic promise phrases in an answer. */
export function findBannedGenericPromises(answer: string): string[] {
  const text = lower(answer);
  return BANNED_GENERIC_PROMISES.filter((phrase) => text.includes(phrase));
}

/** Detect success-state assertions in an answer. */
export function findSuccessStateAssertions(answer: string): string[] {
  return SUCCESS_STATE_PATTERNS.filter(({ pattern }) => pattern.test(answer)).map(
    ({ label }) => label,
  );
}

/** Detect failure / waiting-state assertions in an answer. */
export function findFailureStateAssertions(answer: string): string[] {
  return FAILURE_STATE_PATTERNS.filter(({ pattern }) => pattern.test(answer)).map(
    ({ label }) => label,
  );
}

/**
 * Evidence required to back a success claim. Returns the list of missing
 * evidence fields given the claimed success labels and the attached evidence.
 *
 * NOTE: This text-based evidence check is only used when NO structured job
 * record is provided, or when the structured job is COMPLETED and we need to
 * validate that the required evidence fields are present.
 */
export function findMissingEvidence(
  answer: string,
  evidence: IVXIAEvidence | null | undefined,
): string[] {
  const text = answer ?? '';
  const ev = evidence ?? {};
  const missing: string[] = [];

  const hasTaskId = trimmed(ev.taskId).length > 0 || /\btask\s*id[:\s]+[a-z0-9_-]{4,}/i.test(text);
  const hasFiles = (ev.filesChanged && ev.filesChanged.length > 0)
    || /\bfiles?\s+changed[:\s]+[^\n]+/i.test(text);
  const hasCommit = trimmed(ev.commitSha).length > 0 || /\bcommit(?:_?sha)?[:\s]+[0-9a-f]{6,}/i.test(text);
  const hasDeploy = trimmed(ev.renderDeployId).length > 0
    || /\brender\s+deploy(?:ment)?\s+id[:\s]+[^\s\n]+/i.test(text)
    || /\bdeploy_?id[:\s]+[^\s\n]+/i.test(text);
  const hasLive = trimmed(ev.liveVerification).length > 0
    || /live\s+verification[:\s]+/i.test(text)
    || /production\s+\/health:\s*200/i.test(text)
    || /HTTP\s+200/i.test(text);

  // A "Verified" / "Deployed" / "Live in production" claim requires the full chain.
  const claimsVerified = /\bverified\b/i.test(text);
  const claimsDeployed = /\bdeployed\b/i.test(text) || /\blive\s+in\s+production\b/i.test(text);
  const claimsDone = /\b(?:done|completed|finished|shipped|fixed)\b/i.test(text);

  if (claimsDone && !hasFiles) missing.push('Files changed');
  if (claimsDone && !hasTaskId) missing.push('Task ID');
  if ((claimsVerified || claimsDeployed) && !hasCommit) missing.push('Commit SHA');
  if ((claimsVerified || claimsDeployed) && !hasDeploy) missing.push('Render Deploy ID');
  if ((claimsVerified || claimsDeployed) && !hasLive) missing.push('Live verification');

  return missing;
}

/**
 * Validate a structured worker job record. This is the single source of truth
 * for status contradiction detection. The answer text is NOT inspected.
 */
export function validateStructuredJobEvidence(
  job: IVXIAJobEvidence,
): {
  valid: boolean;
  state: IVXIAState;
  reason: string | null;
  contradictions: string[];
  missing: string[];
} {
  const allowedStatuses: IVXIAJobStatusValue[] = [
    'QUEUED', 'CLAIMED', 'RUNNING', 'TESTING', 'WAITING_OWNER',
    'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED',
  ];
  const contradictions: string[] = [];
  const missing: string[] = [];

  if (!job.taskId || trimmed(job.taskId).length < 4) {
    missing.push('taskId');
  }
  if (!job.status) {
    missing.push('status');
  }
  if (!job.stage) {
    missing.push('currentStage');
  }

  if (job.status && !allowedStatuses.includes(job.status)) {
    return {
      valid: false,
      state: 'UNVERIFIED',
      reason: `Invalid structured status: ${job.status}`,
      contradictions,
      missing,
    };
  }

  // Required evidence by status (owner spec section 4).
  if (job.status === 'RUNNING' || job.status === 'QUEUED' || job.status === 'CLAIMED' || job.status === 'TESTING') {
    if (!job.lastHeartbeat) missing.push('lastHeartbeat');
    if (job.progress === undefined || job.progress === null) missing.push('progress');
    if (!job.currentAction) missing.push('currentAction');
  }

  if (job.status === 'BLOCKED') {
    if (!job.blockedReason && !job.error) missing.push('exact blocker or error');
    if (!job.completedSteps || job.completedSteps.length === 0) missing.push('completed steps');
  }

  if (job.status === 'COMPLETED') {
    if (!job.tests || !job.tests.run) missing.push('tests');
    if (job.filesChanged === undefined || job.filesChanged.length === 0) missing.push('filesChanged');
  }

  // Structural contradiction: a completed job cannot have a blocking reason.
  if (job.status === 'COMPLETED' && job.blockedReason) {
    contradictions.push('COMPLETED + blockedReason');
    return {
      valid: false,
      state: 'UNVERIFIED',
      reason: 'COMPLETED job cannot carry a blockedReason',
      contradictions,
      missing,
    };
  }

  // Missing required fields makes the structured record invalid.
  if (missing.length > 0) {
    return {
      valid: false,
      state: 'UNVERIFIED',
      reason: `Structured job record incomplete: missing ${missing.join(', ')}`,
      contradictions,
      missing,
    };
  }

  const stateMap: Record<IVXIAJobStatusValue, IVXIAState> = {
    QUEUED: 'RUNNING',
    CLAIMED: 'RUNNING',
    RUNNING: 'RUNNING',
    TESTING: 'RUNNING',
    WAITING_OWNER: 'WAITING_OWNER',
    BLOCKED: 'BLOCKED',
    FAILED: 'FAILED',
    COMPLETED: 'VERIFIED',
    CANCELLED: 'BLOCKED',
  };

  return {
    valid: true,
    state: stateMap[job.status],
    reason: null,
    contradictions,
    missing,
  };
}

/**
 * Build a clean structured status answer from the job record. This replaces the
 * old narrative-style BLOCKED answer when the job is the single source of truth.
 */
export function buildStructuredStatusAnswer(job: IVXIAJobEvidence): string {
  const lines: string[] = [];
  lines.push(`TASK ID:`);
  lines.push(job.taskId);
  lines.push('');
  lines.push('STATUS:');
  lines.push(job.status);
  lines.push('');
  lines.push('STAGE:');
  lines.push(job.stage ?? 'UNKNOWN');
  lines.push('');

  if (job.completedSteps && job.completedSteps.length > 0) {
    lines.push('COMPLETED STEPS:');
    for (const step of job.completedSteps) {
      lines.push(`- ${step}`);
    }
    lines.push('');
  }

  if (job.blockedReason) {
    lines.push('BLOCKER:');
    lines.push(job.blockedReason);
    lines.push('');
  }

  if (job.error && job.status !== 'BLOCKED') {
    lines.push('ERROR:');
    lines.push(job.error);
    lines.push('');
  }

  if (job.filesChanged && job.filesChanged.length > 0) {
    lines.push('FILES CHANGED:');
    for (const f of job.filesChanged) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  if (job.commitSha) {
    lines.push('COMMIT SHA:');
    lines.push(job.commitSha);
    lines.push('');
  }

  if (job.deploymentId) {
    lines.push('DEPLOYMENT ID:');
    lines.push(job.deploymentId);
    lines.push('');
  }

  if (job.tests && job.tests.run) {
    lines.push('TESTS:');
    lines.push(job.tests.passed ? 'PASS' : 'FAIL');
    lines.push(job.tests.command ?? '');
    lines.push('');
  }

  lines.push('NEXT ACTION:');
  if (job.status === 'BLOCKED') {
    lines.push(job.blockedReason ? `Resolve the blocker and resume task ${job.taskId}.` : 'Resolve the blocker and resume the same task.');
  } else if (job.status === 'COMPLETED') {
    lines.push('Task is complete. Evidence is attached above.');
  } else if (job.status === 'FAILED') {
    lines.push('Retry or fix the failure and resume the same task.');
  } else if (job.status === 'WAITING_OWNER') {
    lines.push('Owner approval required to proceed.');
  } else {
    lines.push(`Task is ${job.status.toLowerCase()}. Poll statusUrl for updates.`);
  }

  return lines.join('\n').trim();
}

/**
 * Resolve a single decision state from the answer + evidence + optional
 * structured job record.
 *
 * Priority (lowest confidence wins so a contradiction never overclaims):
 *  1. If a structured job record is provided, trust it exclusively. Validate
 *     its fields and return the structured status. No text scanning.
 *  2. Text-based contradiction detection is REMOVED. The only valid contradiction
 *     is a structured record that is internally inconsistent (e.g. COMPLETED + blockedReason).
 *  3. If a success assertion is present but evidence is missing → BLOCKED (the
 *     missing evidence is the blocker). Status words inside quoted text, logs,
 *     previous messages, or error descriptions are ignored.
 *  4. If only success assertions + full evidence → VERIFIED.
 *  5. If only failure assertions → BLOCKED / FAILED / WAITING_OWNER depending on
 *     the exact label.
 *  6. If only banned promises + no evidence → BLOCKED (generic promise without
 *     evidence).
 *  7. Otherwise → READY (normal conversational reply, no claim made).
 */
export function resolveSingleState(
  answer: string,
  evidence: IVXIAEvidence | null | undefined,
  structured?: IVXIAJobEvidence | null,
): {
  state: IVXIAState;
  contradictions: string[];
  bannedPromises: string[];
  missingEvidence: string[];
  reason: string | null;
} {
  // ── Structured job record is the single source of truth. ─────────────────
  if (structured) {
    const validation = validateStructuredJobEvidence(structured);
    if (!validation.valid) {
      return {
        state: validation.state,
        contradictions: validation.contradictions,
        bannedPromises: [],
        missingEvidence: validation.missing,
        reason: validation.reason,
      };
    }
    return {
      state: validation.state,
      contradictions: [],
      bannedPromises: [],
      missingEvidence: validation.missing,
      reason: null,
    };
  }

  // ── Fallback: text-based scanning (only when no structured job provided). ──
  // Strip quoted / code-fenced text so words like "completed" or "blocked"
  // inside logs, quoted user messages, or error descriptions do not trigger
  // false positives. NOTE: text-based contradiction detection has been removed;
  // the only valid contradiction is an inconsistent structured job record.
  const answerForScanning = stripQuotedText(answer);
  const successAssertions = findSuccessStateAssertions(answerForScanning);
  const failureAssertions = findFailureStateAssertions(answerForScanning);
  const bannedPromises = findBannedGenericPromises(answerForScanning);
  const missingEvidence = successAssertions.length > 0
    ? findMissingEvidence(answerForScanning, evidence)
    : [];

  // No text-based contradiction detection. The only contradictions are from
  // structured validation (COMPLETED + blockedReason, etc.) handled above.
  const contradictions: string[] = [];

  if (successAssertions.length > 0 && missingEvidence.length > 0) {
    return {
      state: 'BLOCKED',
      contradictions,
      bannedPromises,
      missingEvidence,
      reason: `Success claim (${successAssertions.join(', ')}) without required evidence: ${missingEvidence.join(', ')}.`,
    };
  }

  if (successAssertions.length > 0 && missingEvidence.length === 0) {
    return { state: 'VERIFIED', contradictions, bannedPromises, missingEvidence, reason: null };
  }

  if (failureAssertions.length > 0) {
    const lowerFailure = failureAssertions.map((f) => lower(f));
    const isWaiting = lowerFailure.some((f) => f.includes('waiting') || f.includes('awaiting') || f.includes('approval'));
    const isFailed = lowerFailure.some((f) => f.includes('failed') || f.includes('could not') || f.includes('unable'));
    const isNotVerified = lowerFailure.some((f) => f.includes('not verified') || f.includes('unverified'));
    const state: IVXIAState = isWaiting ? 'WAITING_OWNER' : isFailed ? 'FAILED' : isNotVerified ? 'BLOCKED' : 'BLOCKED';
    return { state, contradictions, bannedPromises, missingEvidence, reason: null };
  }

  if (bannedPromises.length > 0) {
    return {
      state: 'BLOCKED',
      contradictions,
      bannedPromises,
      missingEvidence,
      reason: `Generic promise without evidence: ${bannedPromises.join(', ')}. Inspection / execution has not actually started (no task id or evidence attached).`,
    };
  }

  return { state: 'READY', contradictions, bannedPromises, missingEvidence, reason: null };
}

/**
 * Build the replacement answer for a gated reply. Always carries exactly one
 * state header and the exact blocker / missing evidence / required action.
 */
export function buildReliabilityBlockedAnswer(input: {
  state: IVXIAState;
  reason: string;
  missingEvidence: string[];
  contradictions: string[];
  bannedPromises: string[];
}): string {
  const lines: string[] = [];
  lines.push(`STATE: ${input.state}`);
  lines.push('');

  if (input.contradictions.length > 0) {
    lines.push('CONTRADICTION DETECTED:');
    for (const c of input.contradictions) {
      lines.push(` - ${c}`);
    }
    lines.push('A success claim was retracted because a failure/waiting state appeared in the same reply.');
    lines.push('');
  }

  if (input.bannedPromises.length > 0) {
    lines.push('GENERIC PROMISE WITHOUT EVIDENCE:');
    for (const p of input.bannedPromises) {
      lines.push(` - "${p}"`);
    }
    lines.push('Inspection / execution has not actually started — no task id or evidence is attached to this turn.');
    lines.push('');
  }

  if (input.missingEvidence.length > 0) {
    lines.push('MISSING EVIDENCE:');
    for (const m of input.missingEvidence) {
      lines.push(` - ${m}`);
    }
    lines.push('');
  }

  lines.push(`REASON: ${input.reason}`);

  if (input.state === 'BLOCKED' || input.state === 'FAILED') {
    lines.push('');
    lines.push('REQUIRED ACTION:');
    if (input.missingEvidence.length > 0) {
      lines.push(` - Provide the missing evidence: ${input.missingEvidence.join(', ')}.`);
    }
    if (input.bannedPromises.length > 0) {
      lines.push(' - Run the real inspection / execution first, then reply with the task id and evidence.');
    }
    if (input.contradictions.length > 0) {
      lines.push(' - Pick exactly one status for this task. Do not assert Done and Blocked in the same reply.');
    }
    if (input.missingEvidence.length === 0 && input.bannedPromises.length === 0 && input.contradictions.length === 0) {
      lines.push(' - See the reason above and resolve the exact blocker.');
    }
  }

  if (input.state === 'WAITING_OWNER') {
    lines.push('');
    lines.push('REQUIRED ACTION:');
    lines.push(' - Sign in as the owner and explicitly authorize the guarded action to proceed.');
  }

  lines.push('');
  lines.push('UNVERIFIED — no success claim is valid without the evidence fields above.');
  return lines.join('\n');
}

/**
 * Apply the IVX IA Reliability Gate to a chat answer.
 *
 * When a structured job record is provided, the gate derives status from the
 * job and returns a clean structured answer. When no structured job is
 * provided, the gate falls back to text scanning for contradictions, banned
 * promises, and missing evidence.
 */
export function applyIVXIAReliabilityGate(
  input: IVXIAReliabilityGateInput,
): IVXIAReliabilityGateResult {
  const answer = trimmed(input.answer);
  const resolution = resolveSingleState(answer, input.evidence, input.structured ?? null);

  // If structured evidence is provided and is valid, rewrite the answer to the
  // owner-mandated structured format. This ensures one terminal response per
  // task and removes narrative contradictions.
  if (input.structured && resolution.reason === null) {
    const structuredAnswer = buildStructuredStatusAnswer(input.structured);
    return {
      answer: structuredAnswer,
      gated: structuredAnswer !== answer,
      state: resolution.state,
      contradictions: [],
      bannedPromises: [],
      missingEvidence: [],
      reason: null,
    };
  }

  // If structured evidence is provided but invalid, build a blocked answer that
  // names the exact validation failure (missing taskId, COMPLETED + blockedReason, etc.).
  if (input.structured && resolution.reason !== null) {
    const blockedAnswer = buildReliabilityBlockedAnswer({
      state: resolution.state,
      reason: resolution.reason,
      missingEvidence: resolution.missingEvidence,
      contradictions: resolution.contradictions,
      bannedPromises: [],
    });
    return {
      answer: blockedAnswer,
      gated: true,
      state: resolution.state,
      contradictions: resolution.contradictions,
      bannedPromises: [],
      missingEvidence: resolution.missingEvidence,
      reason: resolution.reason,
    };
  }

  // Pass-through states: READY (no claim), VERIFIED (claim + full evidence),
  // and pure failure/waiting states that have NO contradictions, banned promises,
  // or missing evidence (e.g. an already-BLOCKED senior-developer answer).
  // We only intervene when there is an actual reliability violation to fix.
  const hasViolation =
    resolution.contradictions.length > 0
    || resolution.bannedPromises.length > 0
    || resolution.missingEvidence.length > 0;

  if (!hasViolation) {
    return {
      answer,
      gated: false,
      state: resolution.state,
      contradictions: resolution.contradictions,
      bannedPromises: resolution.bannedPromises,
      missingEvidence: resolution.missingEvidence,
      reason: resolution.reason,
    };
  }

  // Intervene: rewrite to a single-state, evidence-first blocked answer.
  const replacement = buildReliabilityBlockedAnswer({
    state: resolution.state,
    reason: resolution.reason ?? 'IVX IA reliability gate intervened.',
    missingEvidence: resolution.missingEvidence,
    contradictions: resolution.contradictions,
    bannedPromises: resolution.bannedPromises,
  });

  return {
    answer: replacement,
    gated: true,
    state: resolution.state,
    contradictions: resolution.contradictions,
    bannedPromises: resolution.bannedPromises,
    missingEvidence: resolution.missingEvidence,
    reason: resolution.reason,
  };
}
