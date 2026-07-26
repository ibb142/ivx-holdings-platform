/**
 * REGRESSION — "IVX Owner AI must EXECUTE, never return developer narrative."
 *
 * Reproduces the exact owner-reported failure: asking IVX Owner AI to start
 * building returned a planner/chat narrative ("Architecture Proposal /
 * Execution Plan / Initial Actions / Next Steps Required / Once approved /
 * I will proceed") instead of real senior-developer execution.
 *
 * This test exercises the SAME two production units the live IVX Owner AI chat
 * path uses (`backend/api/ivx-owner-ai.ts` imports both):
 *   1. `buildIVXOwnerAIPlannerDecision` — the router that decides the route.
 *   2. `enforceDeveloperExecutionAnswer` — the output guard applied on the
 *      self_developer route before the answer reaches the owner.
 *
 * Passing here proves the exact failing prompt routes to the senior-developer
 * execution runtime, and that a narrative answer carrying any of the reported
 * phrases is BLOCKED before delivery.
 */
import { describe, expect, test } from 'bun:test';
import { buildIVXOwnerAIPlannerDecision } from './ivx-owner-ai-intent-router';
import { enforceDeveloperExecutionAnswer } from './ivx-developer-execution-guard';
/** The exact prompt the owner reported as still returning narrative. */
const FAILED_PROMPT = 'To build the IVX Global Autonomous Investment Engine, start developing now.';
/** The exact narrative phrases that must never reach the owner unproven. */
const BANNED_NARRATIVE_OUTPUT = [
    'Architecture Proposal',
    'Execution Plan',
    'Initial Actions',
    'Next Steps Required',
    'Once approved',
    'I will proceed',
];
describe('REGRESSION — IVX Owner AI build command executes, never narrates', () => {
    test('the exact failed prompt routes to the senior-developer execution runtime', () => {
        const decision = buildIVXOwnerAIPlannerDecision(FAILED_PROMPT);
        console.log('[regression] route decision for failed prompt:', {
            prompt: FAILED_PROMPT,
            semanticIntent: decision.semanticIntent,
            route: decision.route,
            toolHints: decision.toolHints,
        });
        // Must route to the executing runtime, NOT a planner/chat template.
        expect(decision.route).toBe('self_developer');
        expect(decision.semanticIntent).toBe('self_developer_execution');
        expect(decision.toolHints).toContain('run_ivx_senior_developer_task');
    });
    test('a planner-narrative answer with the reported phrases is BLOCKED before delivery', () => {
        const narrative = [
            'Architecture Proposal',
            'I will build the IVX Global Autonomous Investment Engine across four phases.',
            '',
            'Execution Plan',
            'Phase 1 — scaffolding. Phase 2 — data layer.',
            '',
            'Initial Actions',
            'I will set up the project structure.',
            '',
            'Next Steps Required',
            'Once approved I will proceed with implementation.',
        ].join('\n');
        const enforced = enforceDeveloperExecutionAnswer(narrative);
        console.log('[regression] guard result for narrative:', {
            enforced: enforced.enforced,
            violations: enforced.result.violations,
        });
        // The narrative must be blocked and replaced with the strict BLOCKED format.
        expect(enforced.enforced).toBe(true);
        expect(enforced.answer).toContain('STATUS:\nBLOCKED');
        // None of the reported narrative phrases may survive into the delivered answer.
        for (const phrase of BANNED_NARRATIVE_OUTPUT) {
            expect(enforced.answer).not.toContain(phrase);
        }
    });
    test('each reported phrase is individually caught by the guard', () => {
        for (const phrase of BANNED_NARRATIVE_OUTPUT) {
            const candidate = `${phrase}: here is what I think we should do next, with no real command output.`;
            const enforced = enforceDeveloperExecutionAnswer(candidate);
            expect(enforced.enforced).toBe(true);
            expect(enforced.answer).not.toContain(phrase);
        }
    });
});
