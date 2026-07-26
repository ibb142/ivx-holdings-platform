import { describe, expect, test } from 'bun:test';
import { resolveMultimodalRouting } from './ivx-owner-ai-intent-router';
/**
 * Multimodal routing regression tests.
 *
 * Guards the bug fix: an attached image must be INSPECTED FIRST. IVX only enters
 * Developer Action Mode / the deployment workflow when the prompt explicitly asks
 * for implementation work or deployment — and even then, image analysis runs first.
 */
describe('resolveMultimodalRouting', () => {
    test('no image attached → not a multimodal route (unchanged behavior)', () => {
        expect(resolveMultimodalRouting('What is this?', false)).toBeNull();
        expect(resolveMultimodalRouting('Fix this error', false)).toBeNull();
        expect(resolveMultimodalRouting('Deploy this', false)).toBeNull();
    });
    test('Image + "What is this?" → image analysis', () => {
        expect(resolveMultimodalRouting('What is this?', true)).toBe('image_analysis');
    });
    test('Image + "Explain this error" → image analysis (explain is not implementation)', () => {
        expect(resolveMultimodalRouting('Explain this error', true)).toBe('image_analysis');
    });
    test('Image + describe/read prompts → image analysis', () => {
        expect(resolveMultimodalRouting('Describe this screenshot', true)).toBe('image_analysis');
        expect(resolveMultimodalRouting('Read the text in this image', true)).toBe('image_analysis');
        expect(resolveMultimodalRouting('What does this screen show?', true)).toBe('image_analysis');
    });
    test('Image + "Fix this error" → image analysis first, then Developer Action Mode', () => {
        expect(resolveMultimodalRouting('Fix this error', true)).toBe('image_then_developer');
    });
    test('Image + implementation verbs → image analysis first, then Developer Action Mode', () => {
        expect(resolveMultimodalRouting('Debug the crash in this screenshot', true)).toBe('image_then_developer');
        expect(resolveMultimodalRouting('Implement the screen shown here', true)).toBe('image_then_developer');
        expect(resolveMultimodalRouting('Build this UI', true)).toBe('image_then_developer');
        expect(resolveMultimodalRouting('Change the color shown in this image', true)).toBe('image_then_developer');
    });
    test('Image + "Deploy this" → image analysis first, then deployment workflow', () => {
        expect(resolveMultimodalRouting('Deploy this', true)).toBe('image_then_deployment');
    });
    test('Image + deployment verbs → image analysis first, then deployment workflow', () => {
        expect(resolveMultimodalRouting('Ship this to production', true)).toBe('image_then_deployment');
        expect(resolveMultimodalRouting('Release this build', true)).toBe('image_then_deployment');
        expect(resolveMultimodalRouting('Push to production', true)).toBe('image_then_deployment');
    });
    test('deployment takes precedence over generic implementation verbs', () => {
        // "fix and deploy" must reach deployment workflow, not stop at developer mode.
        expect(resolveMultimodalRouting('Fix and deploy this', true)).toBe('image_then_deployment');
    });
});
