import { describe, expect, test } from 'bun:test';
import { branchLabel, routeIVXChatIntent, resolveOwnerAuthActionIntent, } from './ivx-chat-intent-router';
describe('routeIVXChatIntent — 5-branch dispatch', () => {
    describe('branch: general_ai', () => {
        test('normal question → general_ai / normal_question', () => {
            const d = routeIVXChatIntent('How does compound interest work?');
            expect(d.branch).toBe('general_ai');
            expect(d.intent).toBe('normal_question');
            expect(d.requiresOwnerSession).toBe(false);
        });
        test('Casa Rosario question → business_modules / landing_inspection (named project)', () => {
            const d = routeIVXChatIntent('What is Casa Rosario?');
            expect(d.branch).toBe('business_modules');
            expect(d.intent).toBe('landing_inspection');
        });
        test('long structured response request → general_ai / long_structured_response', () => {
            const d = routeIVXChatIntent('Give me a full audit of the system, list all 50 checks');
            expect(d.branch).toBe('general_ai');
            expect(d.intent).toBe('long_structured_response');
        });
        test('app build planning (external app) → general_ai / app_build_planning', () => {
            const d = routeIVXChatIntent('build an app like TikTok');
            expect(d.branch).toBe('general_ai');
            expect(d.intent).toBe('app_build_planning');
        });
        test('time query → general_ai / time_query', () => {
            const d = routeIVXChatIntent('what time is it now?');
            expect(d.branch).toBe('general_ai');
            expect(d.intent).toBe('time_query');
        });
        test('location clarification → general_ai / location_clarification', () => {
            const d = routeIVXChatIntent('where are we right now?');
            expect(d.branch).toBe('general_ai');
            expect(d.intent).toBe('location_clarification');
        });
    });
    describe('branch: developer_executor', () => {
        test('fix this bug → developer_executor', () => {
            const d = routeIVXChatIntent('fix this bug in the chat screen');
            expect(d.branch).toBe('developer_executor');
            expect(d.intent).toBe('self_developer_execution');
            expect(d.requiresOwnerSession).toBe(true);
            expect(d.mayExecuteSideEffects).toBe(true);
        });
        test('deploy now → developer_executor', () => {
            const d = routeIVXChatIntent('deploy this to production now');
            expect(d.branch).toBe('developer_executor');
            expect(d.intent).toBe('self_developer_execution');
        });
        test('audit end to end and fix → developer_executor (not narrative)', () => {
            const d = routeIVXChatIntent('audit end to end and fix and deploy and prove verified');
            expect(d.branch).toBe('developer_executor');
            expect(d.intent).toBe('self_developer_execution');
        });
        test('remove end to end chat loading → developer_executor / removal', () => {
            const d = routeIVXChatIntent('remove end to end chat loading');
            expect(d.branch).toBe('developer_executor');
            expect(d.intent).toBe('self_developer_execution');
        });
        test('show me the analytics code → developer_executor / code_retrieval', () => {
            const d = routeIVXChatIntent('show me the analytics implementation code');
            expect(d.branch).toBe('developer_executor');
            expect(d.intent).toBe('code_retrieval');
            expect(d.mayExecuteSideEffects).toBe(false);
        });
        test('what bugs do you see → developer_executor / bug_review', () => {
            const d = routeIVXChatIntent('what bugs do you see in the chat behavior?');
            expect(d.branch).toBe('developer_executor');
            expect(d.intent).toBe('bug_review');
        });
        test('generate a 3d model of a villa → developer_executor / media_generation_3d', () => {
            const d = routeIVXChatIntent('generate a 3d model of a villa');
            expect(d.branch).toBe('developer_executor');
            expect(d.intent).toBe('media_generation_3d');
        });
        test('build the IVX engine → developer_executor (own-system build, not app planning)', () => {
            const d = routeIVXChatIntent('Build the IVX Global Autonomous Investment Engine');
            expect(d.branch).toBe('developer_executor');
            expect(d.intent).toBe('self_developer_execution');
        });
    });
    describe('branch: owner_actions', () => {
        test('sign in → owner_actions / owner_sign_in', () => {
            const d = routeIVXChatIntent('I need to sign in as owner');
            expect(d.branch).toBe('owner_actions');
            expect(d.intent).toBe('owner_sign_in');
            expect(d.requiresOwnerSession).toBe(false);
        });
        test('owner login → owner_actions / owner_sign_in', () => {
            const d = routeIVXChatIntent('open owner login');
            expect(d.branch).toBe('owner_actions');
            expect(d.intent).toBe('owner_sign_in');
        });
        test('sign out → owner_actions / owner_sign_out', () => {
            const d = routeIVXChatIntent('sign out now');
            expect(d.branch).toBe('owner_actions');
            expect(d.intent).toBe('owner_sign_out');
        });
        test('/supabase-tables → owner_actions / owner_backend_command', () => {
            const d = routeIVXChatIntent('/supabase-tables');
            expect(d.branch).toBe('owner_actions');
            expect(d.intent).toBe('owner_backend_command');
            expect(d.requiresOwnerSession).toBe(true);
        });
        test('manual answer directive → owner_actions / manual_answer', () => {
            const d = routeIVXChatIntent('answer manually, no tools');
            expect(d.branch).toBe('owner_actions');
            expect(d.intent).toBe('manual_answer');
            expect(d.mayExecuteSideEffects).toBe(false);
        });
    });
    describe('branch: autonomous_jobs', () => {
        test('improve IVX today → autonomous_jobs / daily_self_improvement', () => {
            const d = routeIVXChatIntent('improve IVX today');
            expect(d.branch).toBe('autonomous_jobs');
            expect(d.intent).toBe('daily_self_improvement');
            expect(d.requiresOwnerSession).toBe(true);
        });
        test('find best opportunity → autonomous_jobs / opportunity_scan', () => {
            const d = routeIVXChatIntent('find today best opportunity');
            expect(d.branch).toBe('autonomous_jobs');
            expect(d.intent).toBe('opportunity_scan');
        });
        test('find best investor for deal → autonomous_jobs / best_investor_workflow', () => {
            const d = routeIVXChatIntent('find the best investor for Casa Rosario');
            expect(d.branch).toBe('autonomous_jobs');
            expect(d.intent).toBe('best_investor_workflow');
        });
    });
    describe('branch: business_modules', () => {
        test('deal review → business_modules / deal_review', () => {
            const d = routeIVXChatIntent('review this deal for me — cap rate and NOI');
            expect(d.branch).toBe('business_modules');
            expect(d.intent).toBe('deal_review');
        });
        test('landing inspection → business_modules / landing_inspection', () => {
            const d = routeIVXChatIntent('can you see the Casa Rosario card on the landing page?');
            expect(d.branch).toBe('business_modules');
            expect(d.intent).toBe('landing_inspection');
        });
        test('current IVX app status → business_modules / live_project_state', () => {
            const d = routeIVXChatIntent('explain current IVX app status');
            expect(d.branch).toBe('business_modules');
            expect(d.intent).toBe('live_project_state');
        });
    });
    describe('multimodal routing', () => {
        test('image attached with implementation verb → developer_executor with image_then_developer', () => {
            const d = routeIVXChatIntent('fix this error', true);
            expect(d.branch).toBe('developer_executor');
            expect(d.multimodal).toBe('image_then_developer');
        });
        test('image attached with no implementation verb → general_ai with image_analysis', () => {
            const d = routeIVXChatIntent('what is in this image?', true);
            expect(d.multimodal).toBe('image_analysis');
        });
    });
    describe('branchLabel', () => {
        test('returns human-readable labels for every branch', () => {
            const branches = [
                'general_ai',
                'developer_executor',
                'owner_actions',
                'autonomous_jobs',
                'business_modules',
            ];
            for (const b of branches) {
                expect(branchLabel(b).length).toBeGreaterThan(0);
            }
        });
    });
    describe('resolveOwnerAuthActionIntent', () => {
        test('sign in variants', () => {
            expect(resolveOwnerAuthActionIntent('sign in')).toBe('owner_sign_in');
            expect(resolveOwnerAuthActionIntent('log in')).toBe('owner_sign_in');
            expect(resolveOwnerAuthActionIntent('owner login')).toBe('owner_sign_in');
        });
        test('sign out variants', () => {
            expect(resolveOwnerAuthActionIntent('sign out')).toBe('owner_sign_out');
            expect(resolveOwnerAuthActionIntent('log out')).toBe('owner_sign_out');
        });
        test('null for unrelated text', () => {
            expect(resolveOwnerAuthActionIntent('what is the weather')).toBe(null);
        });
    });
});
