import { describe, expect, it } from 'bun:test';
import { IVX_DAILY_IMPROVEMENT_MARKER, IVX_DAILY_IMPROVEMENT_SAFE_SCOPE, buildDailyImprovementCommand, } from './ivx-daily-improvement';
import { asksToImproveIVXToday, buildIVXOwnerAIPlannerDecision } from './ivx-owner-ai-intent-router';
import { classifyOwnerExecutionCommand } from './ivx-owner-execution-mode';
describe('daily improvement command', () => {
    it('synthesizes a single-pass autonomous loop command', () => {
        const command = buildDailyImprovementCommand();
        expect(command).toContain('find ONE real');
        expect(command).toContain('Patch the code');
        expect(command).toContain('Run the validation checks');
        expect(command).toContain('Commit the change');
        expect(command).toContain('Deploy');
        expect(command).toContain('Verify production');
    });
    it('constrains the loop to safe, non-destructive categories', () => {
        const command = buildDailyImprovementCommand();
        for (const scope of IVX_DAILY_IMPROVEMENT_SAFE_SCOPE) {
            expect(command).toContain(scope);
        }
        // The safety guidance must NOT use destructive trigger words, or each split block
        // would wrongly trip an approval gate when classified by the orchestrator.
        expect(command.toLowerCase()).not.toContain('delete data');
        expect(command.toLowerCase()).not.toContain('expose secrets');
        expect(command).toContain('Stay strictly inside the safe categories');
    });
    it('the synthesized command is itself non-destructive and auto-executes', () => {
        const decision = classifyOwnerExecutionCommand(buildDailyImprovementCommand());
        expect(decision.requiresApproval).toBe(false);
        expect(decision.autoExecute).toBe(true);
    });
    it('exports a stable marker', () => {
        expect(IVX_DAILY_IMPROVEMENT_MARKER).toBe('ivx-daily-improvement-2026-05-30');
    });
});
describe('improve-IVX-today intent detection', () => {
    const positives = [
        'Improve IVX today',
        'improve ivx today.',
        'Fix one bug today',
        'fix one real issue now',
        'self improve',
        'self-improvement',
        'Run daily improvement',
        'start the daily self improvement',
        'improve the platform today',
    ];
    for (const prompt of positives) {
        it(`routes "${prompt}" to self_improvement`, () => {
            expect(asksToImproveIVXToday(prompt)).toBe(true);
            expect(buildIVXOwnerAIPlannerDecision(prompt).route).toBe('self_improvement');
        });
    }
    const negatives = [
        'What projects do I have?',
        'Rank all projects',
        'Compare Casa Rosario and Perez Residence',
        'what time is it',
    ];
    for (const prompt of negatives) {
        it(`does not misroute "${prompt}"`, () => {
            expect(asksToImproveIVXToday(prompt)).toBe(false);
            expect(buildIVXOwnerAIPlannerDecision(prompt).route).not.toBe('self_improvement');
        });
    }
});
