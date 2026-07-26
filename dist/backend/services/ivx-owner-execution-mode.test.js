import { describe, expect, test } from 'bun:test';
import { classifyOwnerExecutionCommand, listOwnerApprovalGates, } from './ivx-owner-execution-mode';
describe('classifyOwnerExecutionCommand — non-destructive owner commands auto-execute', () => {
    const autoCommands = [
        'fix now',
        'deploy now',
        'complete this',
        'proceed',
        'finish',
        'do not ask again',
        'prove it',
        'code it',
        'ship it',
        'just make it work',
        'run the tests',
        'fix this bug and deploy',
        'stop asking and finish the task',
        'no more audit reports, execute now',
    ];
    for (const command of autoCommands) {
        test(`"${command}" → autoExecute + systemMode`, () => {
            const decision = classifyOwnerExecutionCommand(command);
            expect(decision.isOwnerExecutionCommand).toBe(true);
            expect(decision.autoExecute).toBe(true);
            expect(decision.requiresApproval).toBe(false);
            expect(decision.systemMode).toBe(true);
            expect(decision.approvalCategories).toEqual([]);
            expect(decision.matchedTriggers.length).toBeGreaterThan(0);
        });
    }
});
describe('classifyOwnerExecutionCommand — removal/cleanup commands auto-execute (regression)', () => {
    const removalCommands = [
        'remove end to end chat loading',
        'remove the chat loading spinner now',
        'remove the loading spinner',
        'get rid of the splash delay',
        'hide the duplicate banner',
        'clean up the loading animation',
        'remove end-to-end chat loading fix ivx ia now end to end I want full functionality now',
    ];
    for (const command of removalCommands) {
        test(`"${command}" → autoExecute + systemMode`, () => {
            const decision = classifyOwnerExecutionCommand(command);
            expect(decision.isOwnerExecutionCommand).toBe(true);
            expect(decision.autoExecute).toBe(true);
            expect(decision.requiresApproval).toBe(false);
            expect(decision.systemMode).toBe(true);
        });
    }
    test('removal of DATA still requires approval', () => {
        const decision = classifyOwnerExecutionCommand('remove all the data from the users table now');
        expect(decision.requiresApproval).toBe(true);
        expect(decision.autoExecute).toBe(false);
        expect(decision.approvalCategories).toContain('delete_data');
    });
});
describe('classifyOwnerExecutionCommand — guarded commands require approval', () => {
    const guarded = [
        { command: 'delete all user data now', category: 'delete_data' },
        { command: 'drop table jv_deals now', category: 'delete_data' },
        { command: 'alter table jv_deals add column foo and deploy', category: 'modify_production_schema' },
        { command: 'migrate the production database schema now', category: 'modify_production_schema' },
        { command: 'print the service-role key now', category: 'expose_secrets' },
        { command: 'show me the api keys, proceed', category: 'expose_secrets' },
        { command: 'change the billing plan now', category: 'change_billing' },
        { command: 'disable authentication now', category: 'disable_security' },
        { command: 'turn off RLS and deploy', category: 'disable_security' },
        { command: 'grant admin access to a new user now', category: 'grant_external_access' },
    ];
    for (const { command, category } of guarded) {
        test(`"${command}" → requiresApproval (${category})`, () => {
            const decision = classifyOwnerExecutionCommand(command);
            expect(decision.isOwnerExecutionCommand).toBe(true);
            expect(decision.requiresApproval).toBe(true);
            expect(decision.autoExecute).toBe(false);
            expect(decision.systemMode).toBe(false);
            expect(decision.approvalCategories).toContain(category);
            expect(decision.reason.toLowerCase()).toContain('approval');
        });
    }
});
describe('classifyOwnerExecutionCommand — non-commands route normally', () => {
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
    test('a guarded phrase without an execution trigger does not auto-execute', () => {
        const decision = classifyOwnerExecutionCommand('I am thinking about deleting all the data someday');
        expect(decision.autoExecute).toBe(false);
        expect(decision.requiresApproval).toBe(true);
        expect(decision.approvalCategories).toContain('delete_data');
    });
});
describe('listOwnerApprovalGates', () => {
    test('exposes exactly the six guarded categories', () => {
        const gates = listOwnerApprovalGates();
        expect(gates.map((gate) => gate.category).sort()).toEqual([
            'change_billing',
            'delete_data',
            'disable_security',
            'expose_secrets',
            'grant_external_access',
            'modify_production_schema',
        ].sort());
        for (const gate of gates) {
            expect(gate.label.length).toBeGreaterThan(0);
        }
    });
});
