/**
 * IVX IA — Unified AI Gate Pipeline (Stabilization Sprint).
 *
 * Single source of truth for the deterministic gate sequence every IVX IA
 * chat reply must pass through before it reaches the owner/user. Both the
 * Owner AI path (`/api/ivx/owner-ai`) and the public chat path
 * (`/public/chat`) call this pipeline so there is exactly ONE IVX IA brain,
 * one personality, and one final status per task.
 *
 * Goals enforced (owner spec — IVX IA Stabilization Sprint):
 *  1. Single AI brain — both paths run the identical gate sequence.
 *  2. Deterministic request router — the caller classifies the branch; this
 *     pipeline only polishes the answer into a single-state, evidence-first
 *     reply. Routing happens upstream in `ivx-chat-intent-router`.
 *  3. One final status per task — the reliability gate resolves to exactly
 *     one of READY | RUNNING | WAITING_OWNER | BLOCKED | FAILED | VERIFIED.
 *  4. Executor is the only component allowed to modify code — the
 *     fake-execution gate blocks any first-person execution claim from the
 *     chat model unless a real Developer Proof Ledger entry is attached.
 *  5. Chat is read-only for execution — the chat model cannot deploy, commit,
 *     run tests, or modify files. Any such claim is rewritten to BLOCKED.
 *  6. Evidence generated only from executor — a VERIFIED claim requires
 *     task_id, files_changed, commit_sha, render_deploy_id, live_http_status.
 *  7. Remove contradictory personalities — identical pipeline = identical
 *     personality. No path produces a different "voice".
 *  8. Remove fake execution narratives — the fake-execution gate + the
 *     senior-developer narrative gate catch every class of fabrication.
 *
 * Gate order (deterministic, first match wins, each gate sees the previous
 * gate's output):
 *   1. FAKE EXECUTION GATE  — developer request without proof → BLOCKED.
 *                             Confession/apology/secretary narrative → BLOCKED.
 *   2. SENIOR DEVELOPER NARRATIVE GATE — fabricated patch/dev/deploy/QA
 *                             narrative → BLOCKED or real proof.
 *   3. ACCESS-STATUS NARRATIVE GATE — fabricated Yes/No access checklist →
 *                             BLOCKED + route to live executor.
 *   4. RELIABILITY GATE (single decision engine) — runs LAST so it never
 *                             re-implements the others. Resolves
 *                             contradictions, banned promises, and success
 *                             claims without evidence into a single state.
 *
 * Pure — no I/O, no AI, fully unit-testable. The caller owns all side effects.
 */
import { applyIVXFakeExecutionGate, isDeveloperRequest, isVerificationRequest, type IVXFakeExecutionState } from './ivx-fake-execution-gate';
import { applySeniorDeveloperNarrativeGate } from './ivx-senior-developer-narrative-gate';
import { applyAccessStatusNarrativeGate } from './ivx-access-status-narrative-gate';
import { applyIVXIAReliabilityGate, type IVXIAJobEvidence, type IVXIAState } from './ivx-ia-reliability-gate';
import {
  classifyTaskIntent,
  requiredCapabilitiesFor,
  type FeasibilityGateResult,
} from './ivx-pre-execution-feasibility-gate';

export const IVX_UNIFIED_GATE_PIPELINE_MARKER =
  'ivx-unified-ai-gate-pipeline-2026-07-04-v1';

/** Developer Proof attached to this turn, when one exists. Same shape as the
 *  fake-execution gate proof so it flows through unchanged. */
export type IVXGatePipelineProof = {
  taskId: string;
  filesChanged: string[];
  commitSha: string | null;
  renderDeployId: string | null;
  liveHttpStatus: number | null;
};

/** Real proof = all five evidence fields present and HTTP 2xx. Mirrors the
 *  fake-execution gate's hasRealProof check so the short-circuit decision is
 *  identical to that gate's VERIFIED passthrough. */
function hasRealProof(proof: IVXGatePipelineProof | null | undefined): boolean {
  return Boolean(
    proof
    && proof.taskId.length > 0
    && proof.filesChanged.length > 0
    && proof.commitSha
    && proof.renderDeployId
    && typeof proof.liveHttpStatus === 'number'
    && proof.liveHttpStatus >= 200
    && proof.liveHttpStatus < 300,
  );
}

export type IVXGatePipelineInput = {
  /** The owner/user prompt for this turn. */
  message: string;
  /** The drafted model answer to gate. */
  answer: string;
  /** Whether a verified owner session is present (owner AI path = true after
   *  auth; public chat = false). Gates that require owner session will block
   *  honestly when this is false. */
  ownerSessionPresent: boolean;
  /** Real Developer Proof Ledger entry attached to this turn, when one
   *  exists. Only the executor produces this — never the chat model. */
  proof?: IVXGatePipelineProof | null;
  /** Optional evidence for the reliability gate (task id, files, commit,
   *  deploy id, live verification). Falls back to `proof` when not provided. */
  evidence?: {
    taskId?: string | null;
    filesChanged?: string[] | null;
    commitSha?: string | null;
    renderDeployId?: string | null;
    liveVerification?: string | null;
  } | null;
  /** Optional authoritative structured worker job record. When provided, the
   *  reliability gate reads status ONLY from this record and never infers it
   *  from natural-language text in the answer. */
  structured?: IVXIAJobEvidence | null;
  /** Pre-execution feasibility gate result, when the caller already ran it.
   *  When provided, the pipeline uses it as Stage 0 and short-circuits to
   *  BLOCKED if the gate blocked. When omitted, the pipeline runs the
   *  feasibility decomposition synchronously (presence-only, no live probes)
   *  so the chat path still benefits from the truth-first gate. */
  feasibility?: FeasibilityGateResult | null;
};

export type IVXGatePipelineStageResult = {
  gate: 'pre_execution_feasibility' | 'fake_execution' | 'senior_developer_narrative' | 'access_status_narrative' | 'reliability';
  gated: boolean;
  state: IVXFakeExecutionState | IVXIAState;
  reason: string | null;
  markers: string[];
};

export type IVXGatePipelineResult = {
  /** The final gated answer to return to the caller. */
  answer: string;
  /** True when any gate intervened and rewrote the answer. */
  gated: boolean;
  /** The single resolved decision state for this reply. */
  state: IVXIAState;
  /** Per-stage audit trail (in execution order). Never empty. */
  stages: IVXGatePipelineStageResult[];
  /** The final reason from the last gate that intervened, or null when no
   *  gate intervened. */
  reason: string | null;
};

/**
 * Run the unified IVX IA gate pipeline. Deterministic, pure, no I/O.
 *
 * Each gate receives the previous gate's output answer so the pipeline
 * composes. The first gate that intervenes records its state; subsequent
 * gates still run so the final `state` reflects the most restrictive
 * resolution (the reliability gate runs last and has the final word on the
 * single-state header).
 */
/**
 * Inline (synchronous) feasibility check used when the caller did not pre-run
 * the gate. Presence-only — no live network probes — so it is safe to run in
 * the pure pipeline. The full async gate (with live probes) is run by the
 * execution loop and passed in via `input.feasibility`.
 */
function runInlineFeasibilityCheck(message: string, ownerSessionPresent: boolean): FeasibilityGateResult {
  const intent = classifyTaskIntent(message);
  const required = requiredCapabilitiesFor(intent);
  const generatedAt = new Date().toISOString();
  if (required.length === 0) {
    return {
      state: 'READY',
      taskId: 'inline-feasibility',
      capabilities: [],
      repeatedBlocker: false,
      generatedAt,
      marker: 'ivx-pre-execution-feasibility-gate-2026-07-05-v1' as const,
    };
  }
  // Inline check: only verify owner session (the only capability that does not
  // need a live probe). Credential checks defer to the async gate.
  if (required.includes('verify_owner_session') && !ownerSessionPresent) {
    return {
      state: 'BLOCKED',
      taskId: 'inline-feasibility',
      blockerCode: 'OWNER_SESSION_MISSING',
      exactBlocker: 'No verified owner session is present. Owner login is required before this task can execute.',
      failedCapability: 'verify_owner_session',
      requiredVariable: 'IVX_OWNER_TOKEN',
      runtimeSource: 'none',
      httpStatus: null,
      nextOwnerAction: 'Complete owner login. A verified owner session is required before this task can execute.',
      capabilities: [],
      repeatedBlocker: false,
      generatedAt,
      marker: 'ivx-pre-execution-feasibility-gate-2026-07-05-v1' as const,
    };
  }
  return {
    state: 'READY',
    taskId: 'inline-feasibility',
    capabilities: [],
    repeatedBlocker: false,
    generatedAt,
    marker: 'ivx-pre-execution-feasibility-gate-2026-07-05-v1' as const,
  };
}

/** Format the inline feasibility block for the chat answer. */
function formatInlineFeasibilityBlock(result: FeasibilityGateResult): string {
  if (result.state === 'READY') return '';
  return [
    'STATE: BLOCKED',
    `TASK_ID: ${result.taskId}`,
    `BLOCKER_CODE: ${result.blockerCode}`,
    `EXACT_BLOCKER: ${result.exactBlocker}`,
    `FAILED_CAPABILITY: ${result.failedCapability}`,
    `REQUIRED_VARIABLE: ${result.requiredVariable ?? 'n/a'}`,
    `RUNTIME_SOURCE: ${result.runtimeSource}`,
    `HTTP_STATUS: ${result.httpStatus ?? 'n/a'}`,
    `NEXT_OWNER_ACTION: ${result.nextOwnerAction}`,
    'Pre-execution feasibility gate blocked execution. The chat model cannot fabricate this task.',
  ].join('\n');
}

export function runIVXUnifiedGatePipeline(input: IVXGatePipelineInput): IVXGatePipelineResult {
  const stages: IVXGatePipelineStageResult[] = [];
  let answer = input.answer;
  let anyGated = false;

  // ── Stage 0: Pre-Execution Feasibility Gate ─────────────────────────────
  // Runs FIRST. Decomposes the prompt into required capabilities and verifies
  // each one against the real runtime. If any capability cannot be exercised
  // right now, the pipeline short-circuits to BLOCKED with the exact blocker
  // code. This is the truth-first gate the owner spec requires — it prevents
  // the chat model from ever producing a fake execution report when the
  // runtime lacks the credentials to actually execute.
  const feasibility = input.feasibility ?? runInlineFeasibilityCheck(input.message, input.ownerSessionPresent);
  const feasibilityBlocked = feasibility.state === 'BLOCKED';
  stages.push({
    gate: 'pre_execution_feasibility',
    gated: feasibilityBlocked,
    state: feasibilityBlocked ? 'BLOCKED' : 'READY',
    reason: feasibilityBlocked
      ? `Pre-execution feasibility gate blocked: ${feasibility.blockerCode} on ${feasibility.failedCapability}.`
      : 'All required capabilities verified (or no capabilities required for this conversational prompt).',
    markers: feasibilityBlocked ? [feasibility.blockerCode] : [],
  });
  if (feasibilityBlocked) {
    const blockerBlock = formatInlineFeasibilityBlock(feasibility);
    stages.push(
      { gate: 'fake_execution', gated: false, state: 'BLOCKED', reason: 'Skipped — pre-execution feasibility gate already blocked execution.', markers: [] },
      { gate: 'senior_developer_narrative', gated: false, state: 'BLOCKED', reason: 'Skipped — pre-execution feasibility gate already blocked execution.', markers: [] },
      { gate: 'access_status_narrative', gated: false, state: 'BLOCKED', reason: 'Skipped — pre-execution feasibility gate already blocked execution.', markers: [] },
      { gate: 'reliability', gated: false, state: 'BLOCKED', reason: 'Skipped — pre-execution feasibility gate already blocked execution.', markers: [] },
    );
    return {
      answer: blockerBlock,
      gated: true,
      state: 'BLOCKED',
      stages,
      reason: `Pre-execution feasibility gate blocked: ${feasibility.blockerCode} on ${feasibility.failedCapability}.`,
    };
  }

  // ── Stage 1: Fake Execution Gate ────────────────────────────────────────
  // Runs after the feasibility gate so a developer request without proof is
  // blocked before any narrative gate can reinterpret the answer.
  const fakeExecution = applyIVXFakeExecutionGate({
    message: input.message,
    answer,
    ownerSessionPresent: input.ownerSessionPresent,
    proof: input.proof,
  });
  stages.push({
    gate: 'fake_execution',
    gated: fakeExecution.gated,
    state: fakeExecution.state,
    reason: fakeExecution.reason,
    markers: [...fakeExecution.fakeClaims, ...fakeExecution.confessionMarkers],
  });
  if (fakeExecution.gated) {
    anyGated = true;
    answer = fakeExecution.answer;
    // The fake-execution gate is the authoritative first gate. When it
    // intervenes it has already produced the final routing answer (BLOCKED for
    // developer requests without proof, UNVERIFIED for verification requests
    // without proof, VERIFIED when real proof is attached, or BLOCKED for any
    // other message whose drafted answer contained fake execution / confession
    // / unverified-confirmation markers). Running the later gates on its
    // output re-interprets the honest prose — the reliability gate
    // false-positives on the word "verified" inside the "No verified proof is
    // attached" line and rewrites UNVERIFIED → BLOCKED, and the senior-developer
    // narrative gate re-blocks a real VERIFIED proof block as "no real proof
    // attached". Both violate the single-state rule (#5) and the verification
    // rule (#6). Short-circuit on ANY fake-execution intervention so its state
    // is final. The audit trail still records all four stages (the later three
    // are marked as not-run below).
    stages.push(
      { gate: 'senior_developer_narrative', gated: false, state: fakeExecution.state, reason: 'Skipped — fake-execution gate already produced the final routing answer.', markers: [] },
      { gate: 'access_status_narrative', gated: false, state: fakeExecution.state, reason: 'Skipped — fake-execution gate already produced the final routing answer.', markers: [] },
      { gate: 'reliability', gated: false, state: fakeExecution.state, reason: 'Skipped — fake-execution gate already produced the final routing answer.', markers: [] },
    );
    return {
      answer,
      gated: true,
      state: fakeExecution.state,
      stages,
      reason: fakeExecution.reason,
    };
  }
  void isDeveloperRequest;
  void isVerificationRequest;

  // ── Stage 2: Senior Developer Narrative Gate ────────────────────────────
  // Blocks fabricated patch / dev / QA / deploy / commit / verify narratives.
  // When real proof is attached, it produces the strict proof block; otherwise
  // the strict BLOCKED block. Runs after the fake-execution gate so a
  // developer request that slipped past (e.g. a non-developer-keyword message
  // that still fabricated a patch narrative) is still caught. The proof shape
  // is adapted from the unified pipeline proof so a real Developer Proof
  // Ledger entry flows through unchanged and produces a VERIFIED proof block
  // instead of being blocked.
  const seniorDevProof = input.proof
    ? {
        ownerAuthAccepted: input.ownerSessionPresent,
        filesChanged: input.proof.filesChanged,
        rawTestOutput: null,
        rawTypecheckOutput: null,
        commitSha: input.proof.commitSha,
        renderDeployId: input.proof.renderDeployId,
        liveCommit: input.proof.commitSha,
        commitMatch: Boolean(input.proof.commitSha),
        finalStatus: 'VERIFIED',
      }
    : null;
  const seniorDev = applySeniorDeveloperNarrativeGate({ message: input.message, answer, proof: seniorDevProof });
  stages.push({
    gate: 'senior_developer_narrative',
    gated: seniorDev.gated,
    state: seniorDev.gated ? 'BLOCKED' : 'READY',
    reason: seniorDev.gated
      ? (seniorDev.forbiddenMarkers.length > 0
        ? 'Fabricated senior-developer/patch narrative detected.'
        : (input.proof && input.proof.taskId.length > 0
          ? 'Senior Developer proof block produced from attached Developer Proof Ledger entry.'
          : 'Prompt routed to senior-developer proof mode; no real proof attached.'))
      : null,
    markers: seniorDev.forbiddenMarkers,
  });
  if (seniorDev.gated) {
    anyGated = true;
    answer = seniorDev.answer;
  }

  // ── Stage 3: Access-Status Narrative Gate ───────────────────────────────
  // Blocks fabricated Yes/No access checklists for Supabase/AWS/GitHub/Render/
  // Vercel. Routes the owner to the live executor path that returns real HTTP
  // evidence.
  const accessStatus = applyAccessStatusNarrativeGate({ message: input.message, answer });
  stages.push({
    gate: 'access_status_narrative',
    gated: accessStatus.gated,
    state: accessStatus.gated ? 'BLOCKED' : 'READY',
    reason: accessStatus.gated
      ? (accessStatus.routed
        ? 'Prompt routed to access-status audit; chat cannot run live credential checks.'
        : 'Fabricated access-status checklist detected.')
      : null,
    markers: accessStatus.markers,
  });
  if (accessStatus.gated) {
    anyGated = true;
    answer = accessStatus.answer;
  }

  // ── Stage 4: Reliability Gate (Single Decision Engine) ──────────────────
  // Runs LAST. Resolves the final answer into exactly one state. Catches
  // contradictions (Done + Blocked), banned promises ("I'll inspect now"), and
  // success claims without evidence. The resolved state is the pipeline's
  // final state — it has the final word.
  const evidence = input.evidence ?? (input.proof
    ? {
        taskId: input.proof.taskId,
        filesChanged: input.proof.filesChanged,
        commitSha: input.proof.commitSha,
        renderDeployId: input.proof.renderDeployId,
        liveVerification: typeof input.proof.liveHttpStatus === 'number'
          ? `HTTP ${input.proof.liveHttpStatus}`
          : null,
      }
    : null);
  const reliability = applyIVXIAReliabilityGate({ message: input.message, answer, evidence, structured: input.structured ?? null });
  stages.push({
    gate: 'reliability',
    gated: reliability.gated,
    state: reliability.state,
    reason: reliability.reason,
    markers: [
      ...reliability.contradictions,
      ...reliability.bannedPromises,
      ...reliability.missingEvidence,
    ],
  });
  if (reliability.gated) {
    anyGated = true;
    answer = reliability.answer;
  }

  return {
    answer,
    gated: anyGated,
    state: reliability.state,
    stages,
    reason: stages.slice().reverse().find((s) => s.gated && s.reason)?.reason ?? null,
  };
}

/** Compact, secret-safe audit log line for the unified pipeline. */
export function describeIVXGatePipelineRun(result: IVXGatePipelineResult): Record<string, unknown> {
  return {
    marker: IVX_UNIFIED_GATE_PIPELINE_MARKER,
    gated: result.gated,
    state: result.state,
    reason: result.reason,
    stages: result.stages.map((s) => ({
      gate: s.gate,
      gated: s.gated,
      state: s.state,
      markers: s.markers,
      reason: s.reason,
    })),
  };
}
