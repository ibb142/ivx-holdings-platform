export const AUTONOMOUS_RISK = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  FINANCIAL: 'FINANCIAL',
});

export const OWNER_ONLY_ACTIONS = new Set([
  'merge_main',
  'deploy_production',
  'rotate_secret',
  'revoke_credential',
  'modify_production_schema',
  'delete_production_data',
  'change_privileged_grant',
  'change_bank_beneficiary',
  'change_bank_account',
  'change_bank_routing',
  'change_swift_bic',
]);

export const NEVER_AUTONOMOUS_ACTIONS = new Set([
  'move_real_funds',
  'credit_wallet',
  'debit_wallet',
  'confirm_wire_received',
  'settle_wire',
  'execute_trade',
  'approve_kyc',
  'approve_aml',
  'disable_security_gate',
  'disable_rls',
  'weaken_secret_scanner',
  'fabricate_certificate',
]);

const RISK_ORDER = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3, FINANCIAL: 4 });

function normalizeActions(actions) {
  return Array.isArray(actions)
    ? [...new Set(actions.map((a) => String(a || '').trim()).filter(Boolean))]
    : [];
}

export function classifyAutonomousRisk(task = {}) {
  const actions = normalizeActions(task.actions);
  if (actions.some((a) => NEVER_AUTONOMOUS_ACTIONS.has(a))) return AUTONOMOUS_RISK.FINANCIAL;
  if (actions.some((a) => a.startsWith('wire_') || a.startsWith('wallet_') || a.startsWith('settlement_'))) {
    return AUTONOMOUS_RISK.FINANCIAL;
  }
  if (actions.some((a) => OWNER_ONLY_ACTIONS.has(a))) return AUTONOMOUS_RISK.HIGH;
  if (actions.some((a) => ['write_code', 'commit_feature_branch', 'push_feature_branch', 'apply_non_destructive_migration'].includes(a))) {
    return AUTONOMOUS_RISK.MEDIUM;
  }
  return AUTONOMOUS_RISK.LOW;
}

export function evaluateAutonomousTask(task = {}) {
  const actions = normalizeActions(task.actions);
  const inferredRisk = classifyAutonomousRisk({ ...task, actions });
  const requestedRisk = String(task.riskClass || '').toUpperCase();
  const riskClass = RISK_ORDER[requestedRisk] && RISK_ORDER[requestedRisk] >= RISK_ORDER[inferredRisk]
    ? requestedRisk
    : inferredRisk;

  const blockers = [];
  const ownerApprovalRequired = riskClass === AUTONOMOUS_RISK.HIGH || riskClass === AUTONOMOUS_RISK.FINANCIAL;
  const ownerApprovalVerified = task.ownerApprovalVerified === true;
  const targetBranch = String(task.targetBranch || '');
  const production = task.production === true || targetBranch === 'main';
  const realFundsAllowed = task.realFundsAllowed === true;

  if (actions.length === 0) blockers.push('actions_missing');
  if (task.realExecutionOnly !== true) blockers.push('realExecutionOnly_not_true');
  if (task.simulatedSuccessAllowed !== false) blockers.push('simulatedSuccessAllowed_not_false');
  if (task.evidenceRequired !== true) blockers.push('evidenceRequired_not_true');
  if (task.exactSourceShaRequired !== true) blockers.push('exactSourceShaRequired_not_true');

  for (const action of actions) {
    if (NEVER_AUTONOMOUS_ACTIONS.has(action)) blockers.push(`never_autonomous:${action}`);
  }

  if (realFundsAllowed) blockers.push('real_funds_forbidden');

  if (ownerApprovalRequired && !ownerApprovalVerified) {
    blockers.push(`owner_approval_required:${riskClass}`);
  }

  if (production && !ownerApprovalVerified) {
    blockers.push('production_requires_owner_approval');
  }

  if (riskClass === AUTONOMOUS_RISK.FINANCIAL) {
    blockers.push('financial_actions_require_non_autonomous_owner_execution');
  }

  const autonomousAllowed = blockers.length === 0 && riskClass !== AUTONOMOUS_RISK.FINANCIAL;

  return {
    ok: autonomousAllowed,
    autonomousAllowed,
    riskClass,
    inferredRisk,
    ownerApprovalRequired,
    ownerApprovalVerified,
    production,
    actions,
    blockers,
    policy: {
      failClosed: true,
      realFundsAllowed: false,
      simulatedSuccessAllowed: false,
      evidenceRequired: true,
      exactSourceShaRequired: true,
      timeoutMayAutoApproveHighRisk: false,
      timeoutMayAutoApproveFinancial: false,
    },
  };
}

export function assertAutonomousTask(task = {}) {
  const decision = evaluateAutonomousTask(task);
  if (!decision.ok) {
    const error = new Error(`AUTONOMOUS_TASK_BLOCKED: ${decision.blockers.join(', ')}`);
    error.code = 'AUTONOMOUS_TASK_BLOCKED';
    error.decision = decision;
    throw error;
  }
  return decision;
}
