import { describe, expect, it } from 'bun:test';
import { autonomousBranchSuffix, ensureAutonomousBranch } from './ivx-coder-branch';
import { createHash } from 'node:crypto';

const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const response = (status: number, commit?: string) => Response.json(commit ? { object: { sha: commit } } : {}, { status });
describe('autonomous branch identity', () => {
  it('retains the complete task identity fingerprint, including suffixes beyond a shared prefix', () => {
    const task = `scheduler-repair:${sha}:74e256c2792609f034099c30c8b233089d789d3c165a6f393ec35e8b6afb9573`;
    expect(autonomousBranchSuffix(task).endsWith(createHash('sha256').update(task).digest('hex'))).toBe(true);
  });
  it('separates 112 task identities sharing the production scheduler prefix', () => {
    const tasks = Array.from({ length: 112 }, (_, i) => `scheduler-repair:${sha}:finding-${i}`);
    expect(new Set(tasks.map(autonomousBranchSuffix)).size).toBe(112);
    expect(autonomousBranchSuffix(tasks[0])).toBe(autonomousBranchSuffix(tasks[0]));
    expect(autonomousBranchSuffix('A:B')).not.toBe(autonomousBranchSuffix('a/b'));
    expect(autonomousBranchSuffix(' ../Bad // Branch.. ')).toMatch(/^[a-z0-9-]+$/);
  });
  it('keeps a published branch head without any write or reset to main', async () => {
    const calls: string[] = [];
    const actual = await ensureAutonomousBranch({ branch: 'repair', defaultBranch: 'main', request: async (path, init) => {
      calls.push(path); expect(init?.method).toBeUndefined(); return response(200, other);
    } });
    expect(actual).toBe(other);
    expect(calls).toEqual(['/git/ref/heads/repair']);
  });
  for (const status of [201, 422]) {
    it(`verifies the actual head after branch creation returns ${status}`, async () => {
      const replies = [response(404), response(200, sha), response(status), response(200, other)];
      const writes: RequestInit[] = [];
      const actual = await ensureAutonomousBranch({ branch: 'repair', defaultBranch: 'main', request: async (_path, init) => {
        if (init) writes.push(init); return replies.shift()!;
      } });
      expect(actual).toBe(other);
      expect(writes).toHaveLength(1);
      expect(writes[0].method).toBe('POST');
      expect(JSON.parse(String(writes[0].body))).toEqual({ ref: 'refs/heads/repair', sha });
    });
  }
  it('rejects an unverified creation race and an invalid existing head', async () => {
    const replies = [response(404), response(200, sha), response(422), response(404)];
    await expect(ensureAutonomousBranch({ branch: 'repair', defaultBranch: 'main', request: async () => replies.shift()! })).rejects.toThrow('404');
    await expect(ensureAutonomousBranch({ branch: 'repair', defaultBranch: 'main', request: async () => response(200, 'short') })).rejects.toThrow('full commit SHA');
  });
});
