import { describe, expect, test, beforeEach } from 'bun:test';
import { IVX_DEVELOPER_PROOF_STANDARD_MARKER, computeDeveloperProofFinalStatus, findForbiddenClaimWords, generateDeveloperProofTaskId, getDeveloperProof, getDeveloperProofHistory, getLatestDeveloperProof, recordDeveloperProof, updateDeveloperProof, verifyDeveloperProof, _resetDeveloperProofLedgerForTests, } from './services/ivx-developer-proof-standard';
describe('IVX Developer Proof Standard', () => {
    beforeEach(() => {
        _resetDeveloperProofLedgerForTests();
    });
    test('marker is the permanent 2026-07-04 standard', () => {
        expect(IVX_DEVELOPER_PROOF_STANDARD_MARKER).toBe('ivx-developer-proof-standard-2026-07-04-permanent');
    });
    test('UNVERIFIED when any execution field is missing', () => {
        expect(computeDeveloperProofFinalStatus({
            commit_sha: null,
            render_deploy_id: 'dep-1',
            live_http_status: 200,
            deployed_commit: 'abc1234',
            commit_match: true,
        })).toBe('UNVERIFIED');
        expect(computeDeveloperProofFinalStatus({
            commit_sha: 'abc1234',
            render_deploy_id: null,
            live_http_status: 200,
            deployed_commit: 'abc1234',
            commit_match: true,
        })).toBe('UNVERIFIED');
        expect(computeDeveloperProofFinalStatus({
            commit_sha: 'abc1234',
            render_deploy_id: 'dep-1',
            live_http_status: 500,
            deployed_commit: 'abc1234',
            commit_match: true,
        })).toBe('UNVERIFIED');
        expect(computeDeveloperProofFinalStatus({
            commit_sha: 'abc1234',
            render_deploy_id: 'dep-1',
            live_http_status: 200,
            deployed_commit: 'abc1234',
            commit_match: false,
        })).toBe('UNVERIFIED');
    });
    test('VERIFIED only when commit, deploy, live 2xx, deployed commit, and match are all present', () => {
        expect(computeDeveloperProofFinalStatus({
            commit_sha: 'abc1234def',
            render_deploy_id: 'dep-1',
            live_http_status: 200,
            deployed_commit: 'abc1234def',
            commit_match: true,
        })).toBe('IVX IA DEVELOPER PROOF STANDARD VERIFIED');
    });
    test('forbidden claim words are detected', () => {
        expect(findForbiddenClaimWords('the task is done and deployed')).toEqual(expect.arrayContaining(['done', 'deployed']));
        expect(findForbiddenClaimWords('fixed and verified live')).toEqual(expect.arrayContaining(['fixed', 'verified', 'live']));
        expect(findForbiddenClaimWords('no proof attached')).toEqual([]);
    });
    test('task ids are unique even in the same millisecond', () => {
        const a = generateDeveloperProofTaskId(1700000000000);
        const b = generateDeveloperProofTaskId(1700000000000);
        expect(a).not.toBe(b);
        expect(a.startsWith('ivx-dp-')).toBe(true);
    });
    test('recordDeveloperProof stores an UNVERIFIED entry when fields are missing', () => {
        const entry = recordDeveloperProof({
            requested_by: 'ivx-ia',
            action_type: 'code_change',
            files_changed: ['backend/api/x.ts'],
        });
        expect(entry.final_status).toBe('UNVERIFIED');
        expect(entry.task_id.startsWith('ivx-dp-')).toBe(true);
        expect(getDeveloperProof(entry.task_id)?.task_id).toBe(entry.task_id);
        expect(getLatestDeveloperProof()?.task_id).toBe(entry.task_id);
        expect(getDeveloperProofHistory()).toHaveLength(1);
    });
    test('updateDeveloperProof upgrades an entry to VERIFIED once all fields are present', () => {
        const entry = recordDeveloperProof({
            requested_by: 'ivx-ia',
            action_type: 'code_change',
            files_changed: ['backend/api/x.ts'],
        });
        expect(entry.final_status).toBe('UNVERIFIED');
        const updated = updateDeveloperProof(entry.task_id, {
            commit_sha: 'abc1234def',
            render_deploy_id: 'dep-1',
            live_http_status: 200,
            deployed_commit: 'abc1234def',
            commit_match: true,
        });
        expect(updated?.final_status).toBe('IVX IA DEVELOPER PROOF STANDARD VERIFIED');
    });
    test('verifyDeveloperProof recomputes final_status', () => {
        const entry = recordDeveloperProof({
            requested_by: 'ivx-ia',
            action_type: 'code_change',
            files_changed: ['backend/api/x.ts'],
            commit_sha: 'abc1234def',
            render_deploy_id: 'dep-1',
            live_http_status: 200,
            deployed_commit: 'abc1234def',
            commit_match: true,
        });
        const verified = verifyDeveloperProof(entry.task_id);
        expect(verified?.final_status).toBe('IVX IA DEVELOPER PROOF STANDARD VERIFIED');
    });
    test('history preserves insertion order', () => {
        const a = recordDeveloperProof({ requested_by: 'ivx-ia', action_type: 'a' });
        const b = recordDeveloperProof({ requested_by: 'ivx-ia', action_type: 'b' });
        const c = recordDeveloperProof({ requested_by: 'ivx-ia', action_type: 'c' });
        const ids = getDeveloperProofHistory().map((e) => e.task_id);
        expect(ids).toEqual([a.task_id, b.task_id, c.task_id]);
    });
});
