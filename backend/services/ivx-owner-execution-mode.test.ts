import { describe, expect, test } from 'bun:test';
import {
  classifyOwnerExecutionCommand,
  listOwnerApprovalGates,
  type OwnerApprovalCategory,
} from './ivx-owner-execution-mode';

describe('classifyOwnerExecutionCommand — low-risk owner commands auto-execute', () => {
  const autoCommands = [
    'fix now',
    'deploy now',
    'complete this',
    'proceed',
    'finish',
    'prove it',
    'code it',
    'ship it',
    'just make it work',
    'run the tests',
    'fix this bug and deploy',
    'remove the chat loading spinner now',
    'get rid of the splash delay',
  ];

  for (const command of autoCommands) {
    test(`"${command}" stays in autonomous safe lane`, () => {
      const decision = classifyOwnerExecutionCommand(command);
      expect(decision.isOwnerExecutionCommand).toBe(true);
      expect(decision.autoExecute).toBe(true);
      expect(decision.requiresApproval).toBe(false);
      expect(decision.systemMode).toBe(true);
      expect(decision.approvalCategories).toEqual([]);
    });
  }
});

describe('classifyOwnerExecutionCommand — dangerous operations require Owner Gate', () => {
  const guarded: Array<{ command: string; category: OwnerApprovalCategory }> = [
    { command: 'delete all user data now', category: 'delete_data' },
    { command: 'drop table jv_deals now', category: 'delete_data' },
    { command: 'alter table jv_deals add column foo and deploy', category: 'modify_production_schema' },
    { command: 'run a destructive migration now', category: 'modify_production_schema' },
    { command: 'print the service-role key now', category: 'expose_secrets' },
    { command: 'rotate the GitHub token now', category: 'modify_secrets_credentials' },
    { command: 'replace the Render API key and proceed', category: 'modify_secrets_credentials' },
    { command: 'change the billing plan now', category: 'change_billing' },
    { command: 'transfer funds and proceed', category: 'change_billing' },
    { command: 'change authentication permissions now', category: 'modify_auth_permissions' },
    { command: 'grant a new role and proceed', category: 'modify_auth_permissions' },
    { command: 'disable authentication now', category: 'disable_security' },
    { command: 'turn off RLS and deploy', category: 'disable_security' },
    { command: 'change the firewall configuration now', category: 'change_security_controls' },
    { command: 'grant admin access to a new user now', category: 'grant_external_access' },
    { command: 'change the production Render service now', category: 'change_infrastructure' },
    { command: 'switch DNS and deploy now', category: 'change_infrastructure' },
    { command: 'rollback production to the previous release now', category: 'critical_rollback' },
    { command: 'execute this high-risk change now', category: 'explicit_high_risk' },
    { command: 'proceed even though risk is unknown', category: 'explicit_high_risk' },
  ];

  for (const { command, category } of guarded) {
    test(`"${command}" → Owner Gate (${category})`, () => {
      const decision = classifyOwnerExecutionCommand(command);
      expect(decision.isOwnerExecutionCommand).toBe(true);
      expect(decision.requiresApproval).toBe(true);
      expect(decision.autoExecute).toBe(false);
      expect(decision.systemMode).toBe(false);
      expect(decision.approvalCategories).toContain(category);
      expect(decision.reason).toContain('OWNER_GATE_REQUIRED');
    });
  }

  test('dangerous category wins even when a safe UI category is also present', () => {
    const decision = classifyOwnerExecutionCommand('fix the UI and change authentication permissions now');
    expect(decision.safeCategories).toContain('ui_fix');
    expect(decision.requiresApproval).toBe(true);
    expect(decision.autoExecute).toBe(false);
    expect(decision.approvalCategories).toContain('modify_auth_permissions');
  });

  test('removing UI is safe, removing production data is not', () => {
    expect(classifyOwnerExecutionCommand('remove the loading spinner').requiresApproval).toBe(false);
    const dangerous = classifyOwnerExecutionCommand('remove all the data from the users table now');
    expect(dangerous.requiresApproval).toBe(true);
    expect(dangerous.approvalCategories).toContain('delete_data');
  });
});

describe('classifyOwnerExecutionCommand — conversation stays non-mutating', () => {
  test('a plain question is not an execution command', () => {
    const decision = classifyOwnerExecutionCommand('what projects do I have?');
    expect(decision.isOwnerExecutionCommand).toBe(false);
    expect(decision.autoExecute).toBe(false);
    expect(decision.systemMode).toBe(false);
  });

  test('empty prompt is safe', () => {
    const decision = classifyOwnerExecutionCommand('   ');
    expect(decision.isOwnerExecutionCommand).toBe(false);
    expect(decision.autoExecute).toBe(false);
  });
});

describe('listOwnerApprovalGates', () => {
  test('exposes the complete dangerous-operation policy', () => {
    const categories = listOwnerApprovalGates().map((gate) => gate.category);
    expect(categories).toEqual(expect.arrayContaining([
      'delete_data',
      'modify_production_schema',
      'expose_secrets',
      'modify_secrets_credentials',
      'change_billing',
      'modify_auth_permissions',
      'disable_security',
      'change_security_controls',
      'grant_external_access',
      'change_infrastructure',
      'critical_rollback',
      'explicit_high_risk',
    ]));
    expect(new Set(categories).size).toBe(categories.length);
  });
});
