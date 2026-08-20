/**
 * IVX Autonomous Quality Controller
 *
 * Independent release authority for Autonomous. The builder may propose or
 * execute work, but it cannot certify itself. This controller evaluates only
 * structured evidence and fails closed when required evidence is missing.
 */
import type { IVXOwnerExecutionDecision } from './ivx-owner-execution-mode';
import type { SelfHealCycleReport } from './ivx-self-heal-cycle';

export const IVX_AUTONOMOUS_QUALITY_CONTROLLER_MARKER = 'ivx-autonomous-quality-controller-2026-08-20-v1';

export type AutonomousQualityLevel = 'CERTIFIED' | 'BLOCKED' | 'OWNER_APPROVAL';

export type AutonomousQualityCheck = {
  name: string;
  required: boolean;
  passed: boolean;
  proof: string;
};

export type AutonomousQualityDecision = {
  marker: typeof IVX_AUTONOMOUS_QUALITY_CONTROLLER_MARKER;
  level: AutonomousQualityLevel;
  score: number;
  releaseAllowed: boolean;
  ownerApprovalRequired: boolean;
  reasons: string[];
  checks: AutonomousQualityCheck[];
};

export type AutonomousQualityInput = {
  ownerStopVerifiedInactive: boolean;
  decision: Pick<IVXOwnerExecutionDecision, 'requiresApproval' | 'approvalCategories'>;
  selfHeal: SelfHealCycleReport | null;
};

function testEvidence(report: SelfHealCycleReport, suite: 'typecheck' | 'lint' | 'smoke'): AutonomousQualityCheck {
  const matches = report.tests.filter((test) => test.suite === suite);
  const present = matches.length > 0;
  const passed = present && matches.every((test) => test.ok === true && test.exitCode === 0);
  return {
    name: suite,
    required: suite !== 'smoke',
    passed,
    proof: present
      ? `${matches.length} ${suite} report(s); allPassed=${passed}.`
      : `No ${suite} evidence was produced.`,
  };
}

export function certifyAutonomousQuality(input: AutonomousQualityInput): AutonomousQualityDecision {
  const checks: AutonomousQualityCheck[] = [];
  const reasons: string[] = [];

  const ownerControl = {
    name: 'owner_control',
    required: true,
    passed: input.ownerStopVerifiedInactive,
    proof: input.ownerStopVerifiedInactive
      ? 'Owner stop state was verified inactive before mutation.'
      : 'Owner stop state is active or unverified.',
  } satisfies AutonomousQualityCheck;
  checks.push(ownerControl);

  const risk = {
    name: 'risk_gate',
    required: true,
    passed: !input.decision.requiresApproval,
    proof: input.decision.requiresApproval
      ? `Owner approval required for: ${input.decision.approvalCategories.join(', ') || 'guarded operation'}.`
      : 'Operation is inside the autonomous low-risk lane.',
  } satisfies AutonomousQualityCheck;
  checks.push(risk);

  if (!input.selfHeal) {
    checks.push({
      name: 'execution_evidence',
      required: true,
      passed: false,
      proof: 'No self-heal/execution report exists.',
    });
  } else {
    const report = input.selfHeal;
    const stageIntegrity = report.stages.every((stage) => stage.status !== 'failed' && stage.status !== 'unverified');
    checks.push({
      name: 'stage_integrity',
      required: true,
      passed: report.allVerified === true && stageIntegrity,
      proof: `allVerified=${report.allVerified}; failedOrUnverifiedStages=${report.stages.filter((stage) => stage.status === 'failed' || stage.status === 'unverified').length}.`,
    });

    checks.push(testEvidence(report, 'typecheck'));
    checks.push(testEvidence(report, 'lint'));
    checks.push(testEvidence(report, 'smoke'));

    const production = report.production;
    checks.push({
      name: 'production_health',
      required: true,
      passed: Boolean(
        production
        && production.failures === 0
        && production.thresholdExceeded === false
        && production.rollbackInFlight === false
      ),
      proof: production
        ? `failures=${production.failures}; thresholdExceeded=${production.thresholdExceeded}; rollbackInFlight=${production.rollbackInFlight}.`
        : 'No production health evidence exists.',
    });

    const rollback = report.rollback;
    checks.push({
      name: 'rollback_integrity',
      required: true,
      passed: rollback ? (!rollback.triggered || rollback.ok === true) : true,
      proof: rollback
        ? `triggered=${rollback.triggered}; ok=${rollback.ok}; reason=${rollback.reason}`
        : 'No rollback was required.',
    });
  }

  for (const check of checks) {
    if (check.required && !check.passed) reasons.push(`${check.name}: ${check.proof}`);
  }

  if (input.decision.requiresApproval) {
    return {
      marker: IVX_AUTONOMOUS_QUALITY_CONTROLLER_MARKER,
      level: 'OWNER_APPROVAL',
      score: 0,
      releaseAllowed: false,
      ownerApprovalRequired: true,
      reasons,
      checks,
    };
  }

  const requiredPassed = checks.filter((check) => check.required).every((check) => check.passed);
  if (!requiredPassed) {
    return {
      marker: IVX_AUTONOMOUS_QUALITY_CONTROLLER_MARKER,
      level: 'BLOCKED',
      score: 0,
      releaseAllowed: false,
      ownerApprovalRequired: false,
      reasons,
      checks,
    };
  }

  const smoke = checks.find((check) => check.name === 'smoke');
  const score = smoke?.passed ? 100 : 95;
  return {
    marker: IVX_AUTONOMOUS_QUALITY_CONTROLLER_MARKER,
    level: 'CERTIFIED',
    score,
    releaseAllowed: true,
    ownerApprovalRequired: false,
    reasons: smoke?.passed ? [] : ['smoke: optional smoke evidence was not produced; confidence capped at 95.'],
    checks,
  };
}
