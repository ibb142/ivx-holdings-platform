import { describe, expect, test } from 'bun:test';
import { shouldBuildNewFeature } from './services/ivx-senior-developer-runtime';
describe('shouldBuildNewFeature', () => {
    test('does NOT build a feature for audit/removal tasks even when production proof is requested', () => {
        const goals = [
            'Can you remove chat loading audit and remove now show proof of deploy and evidence now',
            'audit the senior developer and remove fake reports',
            'remove the loading spinner from chat',
            'stop generating fake feature files',
            'verify deployment and show proof',
            'run diagnostics and report back',
            'fix the owner login bug',
        ];
        for (const goal of goals) {
            expect(shouldBuildNewFeature(goal, true)).toBe(false);
            expect(shouldBuildNewFeature(goal, false)).toBe(false);
        }
    });
    test('builds a feature when the goal explicitly asks for one AND deployment/production proof is requested', () => {
        const goals = [
            'Build a new feature for investor alerts',
            'Create a new API endpoint for deal tracking',
            'Generate a new screen for owner reports',
            'Implement a new service from scratch',
            'Make a new module and deploy it',
        ];
        for (const goal of goals) {
            expect(shouldBuildNewFeature(goal, true)).toBe(true);
        }
    });
    test('does NOT build a feature when the goal asks for one but no deploy/production proof is requested', () => {
        expect(shouldBuildNewFeature('Build a new feature for investor alerts', false)).toBe(false);
        expect(shouldBuildNewFeature('Create a new API endpoint', false)).toBe(false);
    });
});
