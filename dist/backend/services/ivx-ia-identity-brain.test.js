import { describe, it, expect } from 'bun:test';
import { detectIVXIdentityQuestion, buildIVXIdentityAnswer, resolveIVXIdentityAnswer, IVX_IA_IDENTITY_NAME, IVX_IA_OWNER_NAME, IVX_IA_COMPANY, } from './ivx-ia-identity-brain';
describe('ivx-ia-identity-brain', () => {
    describe('detectIVXIdentityQuestion', () => {
        it('detects "what is your name"', () => {
            expect(detectIVXIdentityQuestion('What is your name?')).toBe('name');
            expect(detectIVXIdentityQuestion("what's your name")).toBe('name');
            expect(detectIVXIdentityQuestion('your name?')).toBe('name');
            expect(detectIVXIdentityQuestion('tell me your name')).toBe('name');
        });
        it('detects "who are you" as name', () => {
            expect(detectIVXIdentityQuestion('Who are you?')).toBe('name');
        });
        it('detects "who created you"', () => {
            expect(detectIVXIdentityQuestion('Who created you?')).toBe('creator');
            expect(detectIVXIdentityQuestion('who made you')).toBe('creator');
            expect(detectIVXIdentityQuestion('who built you')).toBe('creator');
        });
        it('detects "who is your owner"', () => {
            expect(detectIVXIdentityQuestion('Who is your owner?')).toBe('owner');
            expect(detectIVXIdentityQuestion('who owns you')).toBe('owner');
            expect(detectIVXIdentityQuestion('who is the owner of IVXHOLDINGS')).toBe('owner');
            expect(detectIVXIdentityQuestion('who is Ivan Perez')).toBe('owner');
        });
        it('detects "what is IVX"', () => {
            expect(detectIVXIdentityQuestion('What is IVX?')).toBe('what_is_ivx');
            expect(detectIVXIdentityQuestion('What is IVXHOLDINGS?')).toBe('what_is_ivx');
            expect(detectIVXIdentityQuestion('Tell me about IVXHOLDINGS')).toBe('what_is_ivx');
        });
        it('detects IVXHOLDINGS project questions', () => {
            expect(detectIVXIdentityQuestion('Tell me about the IVX project')).toBe('ivx_project');
            expect(detectIVXIdentityQuestion('What is Casa Rosario?')).toBe('ivx_project');
            expect(detectIVXIdentityQuestion('What projects are available?')).toBe('ivx_project');
            expect(detectIVXIdentityQuestion('Tell me about the deal')).toBe('ivx_project');
        });
        it('detects investment questions', () => {
            expect(detectIVXIdentityQuestion('How do I invest?')).toBe('ivx_investment');
            expect(detectIVXIdentityQuestion('How to invest with IVX?')).toBe('ivx_investment');
            expect(detectIVXIdentityQuestion('What is the ROI?')).toBe('ivx_investment');
            expect(detectIVXIdentityQuestion('What is the minimum investment?')).toBe('ivx_investment');
            expect(detectIVXIdentityQuestion('Is IVXHOLDINGS legit?')).toBe('ivx_investment');
        });
        it('returns none for unrelated questions', () => {
            expect(detectIVXIdentityQuestion('How is the weather?')).toBe('none');
            expect(detectIVXIdentityQuestion('Fix the login bug')).toBe('none');
            expect(detectIVXIdentityQuestion('Deploy now')).toBe('none');
            expect(detectIVXIdentityQuestion('')).toBe('none');
        });
    });
    describe('buildIVXIdentityAnswer', () => {
        it('name answer includes IVX IA', () => {
            const answer = buildIVXIdentityAnswer('name') ?? '';
            expect(answer).toContain(IVX_IA_IDENTITY_NAME);
            expect(answer).toContain(IVX_IA_COMPANY);
        });
        it('creator answer includes Ivan Perez and IVXHOLDINGS', () => {
            const answer = buildIVXIdentityAnswer('creator') ?? '';
            expect(answer).toContain(IVX_IA_OWNER_NAME);
            expect(answer).toContain(IVX_IA_COMPANY);
            expect(answer).toContain(IVX_IA_IDENTITY_NAME);
        });
        it('owner answer includes Ivan Perez', () => {
            const answer = buildIVXIdentityAnswer('owner') ?? '';
            expect(answer).toContain(IVX_IA_OWNER_NAME);
            expect(answer).toContain(IVX_IA_COMPANY);
        });
        it('what_is_ivx answer includes IVXHOLDINGS and Ivan Perez', () => {
            const answer = buildIVXIdentityAnswer('what_is_ivx') ?? '';
            expect(answer).toContain(IVX_IA_COMPANY);
            expect(answer).toContain(IVX_IA_OWNER_NAME);
        });
        it('project answer is not blocked or limited', () => {
            const answer = buildIVXIdentityAnswer('ivx_project') ?? '';
            expect(answer.toLowerCase()).not.toContain('blocked');
            expect(answer.toLowerCase()).not.toContain('not allowed');
            expect(answer.length).toBeGreaterThan(100);
        });
        it('investment answer is not blocked or limited', () => {
            const answer = buildIVXIdentityAnswer('ivx_investment') ?? '';
            expect(answer.toLowerCase()).not.toContain('blocked');
            expect(answer.toLowerCase()).not.toContain('not allowed');
            expect(answer.length).toBeGreaterThan(100);
        });
        it('none returns null', () => {
            expect(buildIVXIdentityAnswer('none')).toBeNull();
        });
    });
    describe('resolveIVXIdentityAnswer', () => {
        it('returns answer for identity questions', () => {
            const answer = resolveIVXIdentityAnswer('What is your name?');
            expect(answer).not.toBeNull();
            expect(answer).toContain(IVX_IA_IDENTITY_NAME);
        });
        it('returns null for unrelated questions', () => {
            expect(resolveIVXIdentityAnswer('Deploy now')).toBeNull();
            expect(detectIVXIdentityQuestion('What time is it?')).toBe('none');
        });
    });
});
