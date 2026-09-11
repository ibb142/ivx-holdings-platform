import { createHash } from 'node:crypto';

export function autonomousBranchSuffix(taskId: string): string {
  const prefix = taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'task';
  return `${prefix}-${createHash('sha256').update(taskId).digest('hex')}`;
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;
async function branchHead(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`GitHub branch ref lookup failed: ${response.status}`);
  const data = await response.json() as { object?: { sha?: string } };
  if (!data.object?.sha || !/^[a-f0-9]{40}$/i.test(data.object.sha)) throw new Error('GitHub branch ref did not include a full commit SHA.');
  return data.object.sha;
}

/** Existing work is the parent of the next commit. Never reset a published
 * branch to main: its head is durable evidence used by PR/CI recovery.
 */
export async function ensureAutonomousBranch(input: { branch: string; defaultBranch: string; request: Request }): Promise<string> {
  const refPath = `/git/ref/heads/${encodeURIComponent(input.branch)}`;
  const existing = await input.request(refPath);
  if (existing.ok) return branchHead(existing);
  if (existing.status !== 404) throw new Error(`GitHub branch ref lookup failed: ${existing.status}`);
  const baseSha = await branchHead(await input.request(`/git/ref/heads/${encodeURIComponent(input.defaultBranch)}`));
  const created = await input.request('/git/refs', {
    method: 'POST', body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: baseSha }),
  });
  if (!created.ok && created.status !== 422) throw new Error(`GitHub branch creation failed: ${created.status}`);
  // A 422 can be a concurrent creator or a validation failure. Read the real
  // head before using it; the requested base alone proves neither outcome.
  return branchHead(await input.request(refPath));
}
