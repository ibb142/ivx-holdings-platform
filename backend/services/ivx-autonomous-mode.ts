/**
 * IVX Autonomous Mode — single end-to-end lifecycle for unattended operation.
 *
 * LOW-RISK work may flow through execution, testing, deploy and verification.
 * Dangerous work is held at the Owner Gate. Before any mutating lifecycle begins,
 * the owner emergency-stop state must be verifiably inactive; uncertainty fails
 * closed for mutation while read/monitoring surfaces can remain available.
 */
import { classifyOwnerExecutionCommand, type IVXOwnerExecutionDecision } from './ivx-owner-execution-mode';
import { checkToolAvailability, type ToolAvailabilityReport } from './ivx-tool-availability';
import { splitTaskIntoBlocks, type IVXPlannedBlock } from './ivx-task-block-splitter';
import type { SelfHealCycleReport } from './ivx-self-heal-cycle';
import { type ProductionHealth } from './ivx-production-guard';
import { recordExecutionTrace } from './ivx-execution-trace-store';
import { EVIDENCE_CLASSIFICATION, type EvidenceClassification } from './ivx-evidence-gate';
import { assertAutonomousMutationAllowed } from './ivx-emergency-stop-gate';

export const IVX_AUTONOMOUS_MODE_MARKER = 'ivx-autonomous-mode-2026-08-20-owner-controlled';

export type AutonomousStepStatus = 'verified' | 'failed' | 'skipped' | 'blocked' | 'unverified';

export type AutonomousLifecycleStep = {
  step: number;
  name: string;
  status: AutonomousStepStatus;
  proof: string;
};

export type AutonomousFinalStatus = 'VERIFIED' | 'FAILED' | 'BLOCKED_FOR_APPROVAL' | 'STOPPED_BY_OWNER';

export type AutonomousModeReport = {
  marker: string;
  taskId: string;
  requestId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  task: string;
  intent: {
    isOwnerExecutionCommand: boolean;
    autoExecute: boolean;
    requiresApproval: boolean;
    approvalCategories: string[];
    safeCategories: string[];
    reason: string;
  };
  toolAvailability: ToolAvailabilityReport;
  plan: { blockCount: number; blocks: { title: string }[] };
  selfHeal: SelfHealCycleReport | null;
  production: ProductionHealth | null;
  humanApprovalRequired: boolean;
  approvalReason: string | null;
  ownerStopChecked: boolean;
  ownerStopVerifiedInactive: boolean;
  steps: AutonomousLifecycleStep[];
  classification: EvidenceClassification;
  finalStatus: AutonomousFinalStatus;
  executionTraceId: string | null;
};

export type RunAutonomousModeOptions = {
  conversationId?: string | null;
  approverEmail?: string;
  suites?: SelfHealCycleReport['tests'][number]['suite'][];
  selfHealRunner?: (options: { approverEmail?: string }) => Promise<SelfHealCycleReport>;
  /** Injectable mutation gate for deterministic tests. Defaults to the real owner emergency-stop gate. */
  mutationGate?: (context: string) => Promise<unknown>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function genTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `autotask_${crypto.randomUUID()}`;
  }
  return `autotask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function genRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `autoreq_${crypto.randomUUID()}`;
  }
  return `autoreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function step(n: number, name: string, status: AutonomousStepStatus, proof: string): AutonomousLifecycleStep {
  return { step: n, name, status, proof };
}

export async function runAutonomousMode(
  task: string,
  options: RunAutonomousModeOptions = {},
): Promise<AutonomousModeReport> {
  const startedAt = nowIso();
  const startMs = Date.now();
  const taskId = genTaskId();
  const requestId = genRequestId();
  const steps: AutonomousLifecycleStep[] = [];
  const exactTask = typeof task === 'string' ? task : String(task ?? '');

  steps.push(step(
    1,
    'receive task',
    exactTask.trim().length > 0 ? 'verified' : 'failed',
    exactTask.trim().length > 0
      ? `Task received and copied exactly (${exactTask.length} chars).`
      : 'Empty task — nothing to execute.',
  ));

  const decision: IVXOwnerExecutionDecision = classifyOwnerExecutionCommand(exactTask);
  steps.push(step(
    2,
    'classify intent',
    'verified',
    decision.requiresApproval
      ? `Guarded intent: ${decision.approvalCategories.join(', ')} — explicit owner approval required.`
      : `Intent classified for autonomous safe lane. autoExecute=${decision.autoExecute}. ${decision.reason}`,
  ));

  const toolAvailability = checkToolAvailability();
  steps.push(step(
    3,
    'verify tools/access',
    toolAvailability.canExecuteEndToEnd ? 'verified' : 'unverified',
    `${toolAvailability.available}/${toolAvailability.total} tools available; end-to-end=${toolAvailability.canExecuteEndToEnd}${
      toolAvailability.blockedSteps.length > 0 ? `; blocked steps: ${toolAvailability.blockedSteps.join(', ')}` : ''
    }.`,
  ));

  const blocks: IVXPlannedBlock[] = splitTaskIntoBlocks(exactTask);
  steps.push(step(
    4,
    'create execution plan',
    blocks.length > 0 ? 'verified' : 'failed',
    `Plan: ${blocks.length} block(s) — ${blocks.slice(0, 5).map((b) => b.title).join(' · ')}${blocks.length > 5 ? ' …' : ''}.`,
  ));

  // Owner Gate always takes precedence over autonomous execution.
  if (decision.requiresApproval) {
    const approvalReason = `OWNER_GATE_REQUIRED: ${decision.approvalCategories.join(', ')}. ${decision.reason}`;
    for (const [n, name] of [
      [5, 'execute'],
      [6, 'run tests'],
      [7, 'deploy if allowed'],
      [8, 'verify production'],
      [9, 'detect failure'],
      [10, 'retry or self-heal'],
      [11, 'roll back if needed'],
    ] as const) {
      steps.push(step(n, name, 'blocked', `Held — ${approvalReason}`));
    }
    const traceId = await safeTrace({
      taskId,
      requestId,
      conversationId: options.conversationId ?? null,
      toolName: 'ivx-autonomous-mode',
      rawOutput: { decision, blocks: blocks.map((b) => b.title), ownerStopChecked: false },
      linkedClaim: `Autonomous task HELD for explicit owner approval (${decision.approvalCategories.join(', ')}).`,
    });
    steps.push(step(12, 'return proof', 'verified', `Held for owner approval; trace=${traceId ?? 'n/a'}.`));
    return finalize({
      taskId, requestId, startedAt, startMs, task: exactTask, decision, toolAvailability,
      blocks, selfHeal: null, production: null, steps,
      classification: EVIDENCE_CLASSIFICATION.NOT_EXECUTED,
      finalStatus: 'BLOCKED_FOR_APPROVAL',
      humanApprovalRequired: true, approvalReason, executionTraceId: traceId,
      ownerStopChecked: false, ownerStopVerifiedInactive: false,
    });
  }

  // Kill switch / control-plane gate. This is deliberately immediately before
  // the mutating lifecycle. The real gate fails closed when its control state
  // cannot be verified, so Autonomous cannot patch/deploy through uncertainty.
  const mutationGate = options.mutationGate ?? assertAutonomousMutationAllowed;
  try {
    await mutationGate(`autonomous lifecycle ${taskId}`);
  } catch (error) {
    const stopReason = error instanceof Error ? error.message : String(error);
    for (const [n, name] of [
      [5, 'execute'],
      [6, 'run tests'],
      [7, 'deploy if allowed'],
      [8, 'verify production'],
      [9, 'detect failure'],
      [10, 'retry or self-heal'],
      [11, 'roll back if needed'],
    ] as const) {
      steps.push(step(n, name, 'blocked', `Owner control stopped mutation — ${stopReason}`));
    }
    const traceId = await safeTrace({
      taskId,
      requestId,
      conversationId: options.conversationId ?? null,
      toolName: 'ivx-autonomous-mode',
      rawOutput: { decision, blocks: blocks.map((b) => b.title), ownerStopChecked: true, ownerStopVerifiedInactive: false, stopReason },
      linkedClaim: `Autonomous mutation STOPPED by owner control plane: ${stopReason}`,
    });
    steps.push(step(12, 'return proof', 'verified', `Stopped before mutation; trace=${traceId ?? 'n/a'}.`));
    return finalize({
      taskId, requestId, startedAt, startMs, task: exactTask, decision, toolAvailability,
      blocks, selfHeal: null, production: null, steps,
      classification: EVIDENCE_CLASSIFICATION.NOT_EXECUTED,
      finalStatus: 'STOPPED_BY_OWNER',
      humanApprovalRequired: false, approvalReason: stopReason, executionTraceId: traceId,
      ownerStopChecked: true, ownerStopVerifiedInactive: false,
    });
  }

  let selfHeal: SelfHealCycleReport | null = null;
  let production: ProductionHealth | null = null;
  try {
    const runner = options.selfHealRunner ?? (async (opts) => {
      const { runSelfHealCycle } = await import('./ivx-self-heal-cycle');
      return runSelfHealCycle({ approverEmail: opts.approverEmail, suites: options.suites });
    });
    selfHeal = await runner({ approverEmail: options.approverEmail });
    production = selfHeal.production;

    const fixStage = selfHeal.stages.find((s) => s.name === 'fix safely');
    const testStages = selfHeal.stages.filter((s) => s.name.startsWith('run tests'));
    const verifyStage = selfHeal.stages.find((s) => s.name === 'verify production');
    const rollbackStage = selfHeal.stages.find((s) => s.name === 'rollback if needed');
    const testsPassed = testStages.length > 0 && testStages.every((s) => s.status === 'verified');

    steps.push(step(5, 'execute', fixStage ? mapStatus(fixStage.status) : 'skipped', fixStage?.proof ?? 'No execution stage produced.'));
    steps.push(step(6, 'run tests', testStages.length > 0 ? (testsPassed ? 'verified' : 'failed') : 'skipped',
      testStages.map((s) => s.proof).join(' | ') || 'No test suites run.'));
    const directDeployAvailable = toolAvailability.tools.some((t) => (t.tool === 'render_deploy' || t.tool === 'github_write') && t.available);
    steps.push(step(7, 'deploy if allowed',
      directDeployAvailable ? 'verified' : 'skipped',
      directDeployAvailable
        ? 'Deploy path available under autonomous safe-lane controls.'
        : 'Direct deploy API not configured; no direct deploy proof available from this lifecycle.'));
    steps.push(step(8, 'verify production', verifyStage ? mapStatus(verifyStage.status) : 'skipped', verifyStage?.proof ?? 'No production verification stage.'));

    const anyFailure = selfHeal.stages.some((s) => s.status === 'failed') || !testsPassed || (production?.thresholdExceeded ?? false);
    steps.push(step(9, 'detect failure', 'verified',
      anyFailure ? 'Failure detected — see failed test/verify stages and production health.' : 'No failure detected across execute/test/verify.'));
    steps.push(step(10, 'retry or self-heal', fixStage ? 'verified' : 'skipped',
      fixStage ? `Self-heal repair evidence: ${fixStage.proof}` : 'No blocker required a fix proposal.'));
    steps.push(step(11, 'roll back if needed', rollbackStage ? mapStatus(rollbackStage.status) : 'skipped', rollbackStage?.proof ?? 'No rollback stage.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const [n, name] of [
      [5, 'execute'], [6, 'run tests'], [7, 'deploy if allowed'], [8, 'verify production'],
      [9, 'detect failure'], [10, 'retry or self-heal'], [11, 'roll back if needed'],
    ] as const) {
      steps.push(step(n, name, 'failed', `Self-heal cycle threw: ${message}`));
    }
  }

  const executed = selfHeal !== null;
  const allOk = executed
    && steps.filter((s) => s.step >= 5 && s.step <= 11).every((s) => s.status === 'verified' || s.status === 'skipped')
    && production !== null
    && production.failures === 0
    && !production.thresholdExceeded;
  const classification: EvidenceClassification = !executed
    ? EVIDENCE_CLASSIFICATION.NOT_EXECUTED
    : allOk
      ? EVIDENCE_CLASSIFICATION.VERIFIED
      : EVIDENCE_CLASSIFICATION.UNVERIFIED;
  const finalStatus: AutonomousFinalStatus = classification === EVIDENCE_CLASSIFICATION.VERIFIED ? 'VERIFIED' : 'FAILED';

  const traceId = await safeTrace({
    taskId,
    requestId,
    conversationId: options.conversationId ?? null,
    toolName: 'ivx-autonomous-mode',
    rawOutput: {
      decision,
      ownerStopChecked: true,
      ownerStopVerifiedInactive: true,
      toolAvailability: { available: toolAvailability.available, total: toolAvailability.total, canExecuteEndToEnd: toolAvailability.canExecuteEndToEnd },
      selfHealCycleId: selfHeal?.cycleId ?? null,
      steps,
    },
    rawOutputRef: selfHeal ? `logs/audit/self-heal/${selfHeal.cycleId}.json` : null,
    linkedClaim: `Autonomous task ${finalStatus} (${classification}).`,
  });
  steps.push(step(12, 'return proof', 'verified',
    `classification=${classification}; ownerStopVerifiedInactive=true; trace=${traceId ?? 'n/a'}; selfHealCycle=${selfHeal?.cycleId ?? 'n/a'}.`));

  return finalize({
    taskId, requestId, startedAt, startMs, task: exactTask, decision, toolAvailability,
    blocks, selfHeal, production, steps, classification, finalStatus,
    humanApprovalRequired: false, approvalReason: null, executionTraceId: traceId,
    ownerStopChecked: true, ownerStopVerifiedInactive: true,
  });
}

function mapStatus(s: SelfHealCycleReport['stages'][number]['status']): AutonomousStepStatus {
  if (s === 'verified') return 'verified';
  if (s === 'failed') return 'failed';
  if (s === 'skipped') return 'skipped';
  return 'unverified';
}

async function safeTrace(input: Parameters<typeof recordExecutionTrace>[0]): Promise<string | null> {
  try {
    return await recordExecutionTrace(input);
  } catch {
    return null;
  }
}

function finalize(input: {
  taskId: string;
  requestId: string;
  startedAt: string;
  startMs: number;
  task: string;
  decision: IVXOwnerExecutionDecision;
  toolAvailability: ToolAvailabilityReport;
  blocks: IVXPlannedBlock[];
  selfHeal: SelfHealCycleReport | null;
  production: ProductionHealth | null;
  steps: AutonomousLifecycleStep[];
  classification: EvidenceClassification;
  finalStatus: AutonomousFinalStatus;
  humanApprovalRequired: boolean;
  approvalReason: string | null;
  executionTraceId: string | null;
  ownerStopChecked: boolean;
  ownerStopVerifiedInactive: boolean;
}): AutonomousModeReport {
  return {
    marker: IVX_AUTONOMOUS_MODE_MARKER,
    taskId: input.taskId,
    requestId: input.requestId,
    startedAt: input.startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - input.startMs,
    task: input.task,
    intent: {
      isOwnerExecutionCommand: input.decision.isOwnerExecutionCommand,
      autoExecute: input.decision.autoExecute,
      requiresApproval: input.decision.requiresApproval,
      approvalCategories: input.decision.approvalCategories,
      safeCategories: input.decision.safeCategories,
      reason: input.decision.reason,
    },
    toolAvailability: input.toolAvailability,
    plan: { blockCount: input.blocks.length, blocks: input.blocks.map((b) => ({ title: b.title })) },
    selfHeal: input.selfHeal,
    production: input.production,
    humanApprovalRequired: input.humanApprovalRequired,
    approvalReason: input.approvalReason,
    ownerStopChecked: input.ownerStopChecked,
    ownerStopVerifiedInactive: input.ownerStopVerifiedInactive,
    steps: input.steps,
    classification: input.classification,
    finalStatus: input.finalStatus,
    executionTraceId: input.executionTraceId,
  };
}
