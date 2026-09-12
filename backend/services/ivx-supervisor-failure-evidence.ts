import { createHash } from 'node:crypto';
import type { RepairMission } from './ivx-global-certification-supervisor';

const FAILED = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required']);
const MAX_LOG_BYTES = 512 * 1024;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export type SupervisorFailureEvidence = {
  observedAt: string;
  mainSha: string;
  runId: number;
  runAttempt: number;
  workflowPath: string;
  workflowSha256: string;
  implementationPaths: string[];
  jobs: Array<{
    jobId: number;
    conclusion: string;
    failedSteps: string[];
    logExcerpt: string;
    logPrefixSha256: string;
    logTruncated: boolean;
  }>;
};

/** Logs are diagnostic data, never executable instructions or credential output. */
function redact(text: string): string {
  let clean = text.replace(/\u001b\[[0-9;]*m/g, '');
  for (const [name, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|(?:^|_)KEY$/.test(name) && value && value.length >= 8) clean = clean.split(value).join('[redacted]');
  }
  return clean
    .replace(/(?:Bearer|Basic)\s+\S+/gi, '[redacted-auth]')
    .replace(/(?:gh[pousr]_|github_pat_|sbp_|rnd_|sk-)[A-Za-z0-9_-]{10,}/g, '[redacted-token]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[redacted]@')
    .replace(/((?:password|secret|access_token|refresh_token|api[_-]?key)\s*[=:]\s*)[^\s,}"]+/gi, '$1[redacted]');
}

async function boundedLog(response: Response): Promise<{ text: string; prefix: string; truncated: boolean }> {
  if (!response.body) throw new Error('Failed job log has no body.');
  const reader = response.body.getReader();
  let prefix = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        const head = prefix.toString('utf8');
        return { prefix: head, text: bytes > MAX_LOG_BYTES
          ? head.slice(0, Math.max(0, head.lastIndexOf('\n'))) + '\n[bounded log tail follows]\n'
            + tail.toString('utf8').slice(tail.toString('utf8').indexOf('\n') + 1) : head,
          truncated: bytes > MAX_LOG_BYTES };
      }
      bytes += chunk.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('Failed job log exceeds transfer budget; dispatch deferred.');
      if (prefix.length < MAX_LOG_BYTES) {
        prefix = Buffer.concat([prefix, chunk.value.subarray(0, MAX_LOG_BYTES - prefix.length)]);
      }
      // Copy the retained tail so a small view cannot retain a large input buffer.
      const recent = chunk.value.subarray(Math.max(0, chunk.value.byteLength - MAX_LOG_BYTES));
      tail = Buffer.concat([tail.subarray(Math.min(tail.length,
        Math.max(0, tail.length + recent.byteLength - MAX_LOG_BYTES))), recent]);
    }
  } finally {
    await reader.cancel();
  }
}

function failureExcerpt(log: string): string {
  const lines = redact(log).split('\n');
  const selected = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    if (!/error|fail|timeout|timed.out|exception|aborted/i.test(lines[index])) continue;
    for (let near = Math.max(0, index - 2); near <= Math.min(lines.length - 1, index + 3); near++) selected.add(near);
  }
  return [...selected].sort((a, b) => a - b).map(index => lines[index]).join('\n').slice(-6000);
}

/** Read the failed attempt and its real logs before asking the coder for a fix. */
export async function collectSupervisorFailureEvidence(mission: RepairMission): Promise<SupervisorFailureEvidence> {
  if (!/^[a-f0-9]{40}$/i.test(mission.mainSha) || !Number.isSafeInteger(mission.runId) || Number(mission.runId) <= 0) {
    throw new Error('Exact MAIN SHA and workflow run ID are required for failure evidence.');
  }
  const repo = process.env.IVX_GITHUB_REPO || 'ibb142/ivx-holdings-platform';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid supervisor repository.');
  const token = (process.env.GITHUB_TOKEN || '').trim();
  const signal = AbortSignal.timeout(25_000);
  const request = async (path: string): Promise<Response> => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal,
    });
    if (!response.ok) throw new Error(`Failure evidence unavailable: GitHub HTTP ${response.status}.`);
    return response;
  };
  const run = await (await request(`/actions/runs/${mission.runId}`)).json() as {
    id: number; name: string; head_sha: string; head_branch: string; status: string; conclusion: string; run_attempt: number; path: string;
  };
  if (run.id !== mission.runId || run.name !== mission.workflow || run.head_sha !== mission.mainSha || run.head_branch !== 'main'
    || run.status !== 'completed' || !FAILED.has(run.conclusion) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error('Failed run identity changed; recollect certification before dispatch.');
  }
  if (!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(run.path)) throw new Error('Invalid failed workflow path.');
  const workflow = await (await request(`/contents/${run.path}?ref=${mission.mainSha}`)).json() as { encoding: string; content: string };
  if (workflow.encoding !== 'base64' || typeof workflow.content !== 'string') throw new Error('Failed workflow source unavailable.');
  const source = Buffer.from(workflow.content, 'base64').toString('utf8');
  const implementationPaths = [...new Set(source.match(/\b(?:backend|expo|scripts)\/[A-Za-z0-9_.\/-]+\.(?:tsx?|jsx?|mjs)\b/g) ?? [])]
    .filter(path => !path.split('/').some(part => part === '..' || part === '.')).slice(0, 12);
  const jobs: SupervisorFailureEvidence['jobs'] = [];
  for (let page = 1; page <= 3 && jobs.length < 3; page++) {
    const data = await (await request(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`)).json() as {
      jobs: Array<{ id: number; run_id: number; conclusion: string; steps: Array<{ name: string; conclusion: string }> }>;
    };
    for (const job of data.jobs) {
      if (!FAILED.has(job.conclusion)) continue;
      if (!Number.isSafeInteger(job.id) || job.id <= 0 || job.run_id !== run.id) throw new Error('Failed job identity mismatch.');
      const log = await boundedLog(await request(`/actions/jobs/${job.id}/logs`));
      const logExcerpt = failureExcerpt(log.text);
      if (!logExcerpt) throw new Error('Failed job has no diagnostic error excerpt; dispatch deferred.');
      jobs.push({ jobId: job.id, conclusion: job.conclusion,
        failedSteps: (job.steps || []).filter(step => FAILED.has(step.conclusion)).map(step => redact(step.name).slice(0, 200)),
        logExcerpt, logPrefixSha256: sha256(log.prefix), logTruncated: log.truncated });
      if (jobs.length === 3) break;
    }
    if (data.jobs.length < 100) break;
  }
  if (!jobs.length) throw new Error('Failed workflow has no readable failed jobs; dispatch deferred.');
  const current = await (await request('/git/ref/heads/main')).json() as { object: { sha: string } };
  if (current.object?.sha !== mission.mainSha) throw new Error('MAIN changed during failure collection; recollect before dispatch.');
  return { observedAt: new Date().toISOString(), mainSha: mission.mainSha, runId: run.id, runAttempt: run.run_attempt,
    workflowPath: run.path, workflowSha256: sha256(source), implementationPaths, jobs };
}
