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
const FINANCIAL_MUTATION = /(^|_)(move|credit|debit|settle|settlement|transfer|trade|purchase|sell|withdraw|payout|disburse)(_|$)/i;
const BANK_DESTINATION_MUTATION = /(^|_)(change|replace|update|set)(_|.*_)(bank|beneficiary|routing|account|swift|bic)(_|$)/i;
const HIGH_RISK_MUTATION = /(^|_)(deploy|merge|rotate|revoke|delete|drop|truncate|production|privileged|grant|secret|credential)(_|$)/i;
const MEDIUM_ENGINEERING = /(^|_)(write|edit|modify|implement|develop|code|commit|push|migration|refactor|repair|fix)(_|$)/i;
const GIT_SHA_40 = /^[0-9a-f]{40}$/i;

function normalizeActions(actions) {
  return Array.isArray(actions)
    ? [...new Set(actions.map((a) => String(a || '').trim()).filter(Boolean))]
    : [];
}

function hasOwnerOnlyAction(actions) {
  return actions.some((a) => OWNER_ONLY_ACTIONS.has(a) || BANK_DESTINATION_MUTATION.test(a) || HIGH_RISK_MUTATION.test(a));
}

export function classifyAutonomousRisk(task = {}) {
  const actions = normalizeActions(task.actions);
  if (actions.some((a) => NEVER_AUTONOMOUS_ACTIONS.has(a) || FINANCIAL_MUTATION.test(a))) {
    return AUTONOMOUS_RISK.FINANCIAL;
  }
  if (hasOwnerOnlyAction(actions)) return AUTONOMOUS_RISK.HIGH;
  if (actions.some((a) => MEDIUM_ENGINEERING.test(a))) return AUTONOMOUS_RISK.MEDIUM;
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
  const approvalType = String(task.approvalType || 'none');
  const ownerBearerApproved = ownerApprovalVerified && approvalType === 'owner_bearer';
  const targetBranch = String(task.targetBranch || '');
  const production = task.production === true || targetBranch === 'main';
  const realFundsAllowed = task.realFundsAllowed === true;
  const taskId = String(task.taskId || '').trim();
  const sourceSha = String(task.sourceSha || '').trim();

  if (actions.length === 0) blockers.push('actions_missing');
  if (!taskId) blockers.push('taskId_missing');
  if (task.realExecutionOnly !== true) blockers.push('realExecutionOnly_not_true');
  if (task.simulatedSuccessAllowed !== false) blockers.push('simulatedSuccessAllowed_not_false');
  if (task.evidenceRequired !== true) blockers.push('evidenceRequired_not_true');
  if (task.exactSourceShaRequired !== true) blockers.push('exactSourceShaRequired_not_true');
  if (!GIT_SHA_40.test(sourceSha)) blockers.push('sourceSha_invalid_or_missing');

  for (const action of actions) {
    if (NEVER_AUTONOMOUS_ACTIONS.has(action)) blockers.push(`never_autonomous:${action}`);
  }

  if (realFundsAllowed) blockers.push('real_funds_forbidden');

  if (ownerApprovalRequired && !ownerBearerApproved) {
    blockers.push(`human_owner_bearer_required:${riskClass}`);
  }

  if (production && !ownerBearerApproved) {
    blockers.push('production_requires_human_owner_bearer');
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
    approvalType,
    ownerBearerApproved,
    production,
    actions,
    taskId,
    sourceSha,
    blockers,
    policy: {
      failClosed: true,
      realFundsAllowed: false,
      simulatedSuccessAllowed: false,
      evidenceRequired: true,
      exactSourceShaRequired: true,
      highRiskRequiresHumanOwnerBearer: true,
      productionRequiresHumanOwnerBearer: true,
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
