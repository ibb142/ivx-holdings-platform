import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AUTONOMOUS_RISK,
  classifyAutonomousRisk,
  evaluateAutonomousTask,
  assertAutonomousTask,
} from '../ivx-autonomous-governance.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const base = {
  taskId: 'task-qa-001',
  sourceSha: SHA,
  actions: ['audit_code'],
  realExecutionOnly: true,
  simulatedSuccessAllowed: false,
  evidenceRequired: true,
  exactSourceShaRequired: true,
  realFundsAllowed: false,
  targetBranch: 'fix/security',
};

test('LOW audit task is autonomous when all evidence controls are explicit', () => {
  const d = evaluateAutonomousTask(base);
  assert.equal(d.ok, true);
  assert.equal(d.riskClass, AUTONOMOUS_RISK.LOW);
  assert.equal(d.ownerApprovalRequired, false);
});

test('engineering write is at least MEDIUM', () => {
  assert.equal(classifyAutonomousRisk({ actions: ['write_code'] }), AUTONOMOUS_RISK.MEDIUM);
});

test('caller cannot downgrade an inferred MEDIUM task to LOW', () => {
  const d = evaluateAutonomousTask({ ...base, actions: ['write_code'], riskClass: 'LOW' });
  assert.equal(d.riskClass, AUTONOMOUS_RISK.MEDIUM);
  assert.equal(d.ok, true);
});

test('deploy production is HIGH and requires human owner bearer', () => {
  const d = evaluateAutonomousTask({ ...base, actions: ['deploy_production'], production: true });
  assert.equal(d.riskClass, AUTONOMOUS_RISK.HIGH);
  assert.equal(d.ok, false);
  assert.ok(d.blockers.includes('human_owner_bearer_required:HIGH'));
  assert.ok(d.blockers.includes('production_requires_human_owner_bearer'));
});

test('boolean ownerApprovalVerified alone cannot authorize HIGH risk', () => {
  const d = evaluateAutonomousTask({
    ...base,
    actions: ['deploy_production'],
    production: true,
    ownerApprovalVerified: true,
    approvalType: 'system_key',
  });
  assert.equal(d.ok, false);
  assert.equal(d.ownerBearerApproved, false);
});

test('verified human owner bearer may authorize HIGH but never FINANCIAL', () => {
  const high = evaluateAutonomousTask({
    ...base,
    actions: ['deploy_production'],
    production: true,
    targetBranch: 'main',
    ownerApprovalVerified: true,
    approvalType: 'owner_bearer',
  });
  assert.equal(high.ok, true);

  const financial = evaluateAutonomousTask({
    ...base,
    actions: ['settle_wire'],
    ownerApprovalVerified: true,
    approvalType: 'owner_bearer',
  });
  assert.equal(financial.riskClass, AUTONOMOUS_RISK.FINANCIAL);
  assert.equal(financial.ok, false);
  assert.ok(financial.blockers.includes('financial_actions_require_non_autonomous_owner_execution'));
});

test('wallet credit is never autonomous', () => {
  const d = evaluateAutonomousTask({ ...base, actions: ['credit_wallet'] });
  assert.equal(d.ok, false);
  assert.equal(d.riskClass, AUTONOMOUS_RISK.FINANCIAL);
  assert.ok(d.blockers.includes('never_autonomous:credit_wallet'));
});

test('unknown financial mutation naming still classifies FINANCIAL', () => {
  assert.equal(classifyAutonomousRisk({ actions: ['wallet_transfer_external'] }), AUTONOMOUS_RISK.FINANCIAL);
});

test('bank destination mutation cannot be hidden behind a novel action name', () => {
  assert.equal(classifyAutonomousRisk({ actions: ['update_primary_bank_account'] }), AUTONOMOUS_RISK.HIGH);
});

test('realFundsAllowed=true always blocks', () => {
  const d = evaluateAutonomousTask({ ...base, realFundsAllowed: true });
  assert.equal(d.ok, false);
  assert.ok(d.blockers.includes('real_funds_forbidden'));
});

test('missing evidence controls fail closed', () => {
  for (const field of ['realExecutionOnly', 'simulatedSuccessAllowed', 'evidenceRequired', 'exactSourceShaRequired']) {
    const input = { ...base };
    delete input[field];
    assert.equal(evaluateAutonomousTask(input).ok, false, field);
  }
});

test('task identity and exact 40-char source SHA are mandatory', () => {
  assert.equal(evaluateAutonomousTask({ ...base, taskId: '' }).ok, false);
  assert.equal(evaluateAutonomousTask({ ...base, sourceSha: 'not-a-sha' }).ok, false);
});

test('main is production and requires verified human owner bearer', () => {
  const d = evaluateAutonomousTask({ ...base, targetBranch: 'main' });
  assert.equal(d.production, true);
  assert.equal(d.ok, false);
});

test('fabricated certificate is explicitly forbidden', () => {
  const d = evaluateAutonomousTask({ ...base, actions: ['fabricate_certificate'] });
  assert.equal(d.ok, false);
  assert.ok(d.blockers.includes('never_autonomous:fabricate_certificate'));
});

test('assertAutonomousTask throws fail-closed decision on blocked tasks', () => {
  assert.throws(
    () => assertAutonomousTask({ ...base, actions: ['debit_wallet'] }),
    (error) => error?.code === 'AUTONOMOUS_TASK_BLOCKED' && error?.decision?.ok === false,
  );
});

test('agent API source enforces owner authorization on mutations', () => {
  const source = fs.readFileSync(new URL('../../backend/api/ivx-agent-api.ts', import.meta.url), 'utf8');
  assert.match(source, /return Boolean\(envSecret\) && provided === envSecret/);
  assert.doesNotMatch(source, /provided\.startsWith\(['"]owner-/);
  const ownerGuards = source.match(/const denied = requireOwner/g) ?? [];
  assert.ok(ownerGuards.length >= 9, `expected >=9 owner guards, found ${ownerGuards.length}`);
});

test('agent API source rejects autonomous financial and high-risk bypasses', () => {
  const source = fs.readFileSync(new URL('../../backend/api/ivx-agent-api.ts', import.meta.url), 'utf8');
  assert.match(source, /function validateAutonomousRunPayload/);
  assert.match(source, /financial_or_never_autonomous_action/);
  assert.match(source, /high_risk_requires_non_autonomous_owner_flow/);
  assert.match(source, /sourceSha_invalid_or_missing/);
  assert.match(source, /real_funds_forbidden/);
  assert.match(source, /const autonomousBlocker = validateAutonomousRunPayload/);
});

test('autonomous workflow cannot deploy or write directly to main', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/ivx-landing-10of10-autonomous-112.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /actions:\s*write/);
  assert.doesNotMatch(workflow, /api\.render\.com\/v1\/services\/.*\/deploys/);
  assert.doesNotMatch(workflow, /render_trigger_deploy/);
  assert.doesNotMatch(workflow, /git push origin HEAD:main/);
  assert.match(workflow, /realFundsAllowed:false/);
  assert.match(workflow, /simulatedSuccessAllowed:false/);
  assert.match(workflow, /exactSourceShaRequired:true/);
});
