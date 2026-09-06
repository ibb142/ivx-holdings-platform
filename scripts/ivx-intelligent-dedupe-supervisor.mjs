const repo = process.env.GITHUB_REPOSITORY || 'ibb142/ivx-holdings-platform';
const token = process.env.GITHUB_TOKEN || '';
const mode = (process.env.IVX_DEDUPE_MODE || 'audit').toLowerCase();
if (!token) throw new Error('GITHUB_TOKEN is required');

const [owner, name] = repo.split('/');
const api = 'https://api.github.com';
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'IVX-Intelligent-Dedupe-Supervisor/1.0',
};

async function gh(path, init = {}) {
  const res = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} -> ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

function norm(value = '') {
  return value.toLowerCase().replace(/[`*_#]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseGoal(body = '') {
  const m = body.match(/\*\*Goal:\*\*\s*([^\n]+)/i);
  return m?.[1]?.trim() || '';
}

function parseDuty(text = '') {
  return text.match(/\bduty\s+([a-z0-9][a-z0-9._:-]*)/i)?.[1]?.toLowerCase() || null;
}

function parseModule(text = '') {
  return text.match(/\bmodule\s+["']([^"']+)["']/i)?.[1]?.toLowerCase().trim() || null;
}

function normalizeGoal(goal = '') {
  return norm(goal)
    .replace(/\bagent\s+\d+\b/g, 'agent')
    .replace(/\((implement|qa|verify)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function changedFiles(prNumber) {
  const files = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await gh(`/repos/${owner}/${name}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...rows.map((x) => x.filename));
    if (rows.length < 100) break;
  }
  return [...new Set(files)].sort();
}

function sameFiles(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function repairSignal(pr) {
  const text = norm(`${pr.title} ${pr.body || ''}`);
  return /\b(regression|repair|retry|failed ci|follow[- ]?up|supersed|fix failed)\b/.test(text);
}

async function comment(prNumber, body) {
  await gh(`/repos/${owner}/${name}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function closePr(prNumber) {
  await gh(`/repos/${owner}/${name}/pulls/${prNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
    headers: { 'Content-Type': 'application/json' },
  });
}

const prs = [];
for (let page = 1; page <= 10; page++) {
  const rows = await gh(`/repos/${owner}/${name}/pulls?state=open&sort=created&direction=asc&per_page=100&page=${page}`);
  prs.push(...rows);
  if (rows.length < 100) break;
}

const candidates = prs.filter((pr) => /^IVX autonomous coder:/i.test(pr.title || ''));
const enriched = [];
for (const pr of candidates) {
  const text = `${pr.title}\n${pr.body || ''}`;
  const goal = parseGoal(pr.body || '');
  const dutyId = parseDuty(text);
  const module = parseModule(text);
  const files = await changedFiles(pr.number);
  enriched.push({
    pr,
    dutyId,
    module,
    normalizedGoal: normalizeGoal(goal),
    files,
    repair: repairSignal(pr),
  });
}

const groups = new Map();
for (const item of enriched) {
  if (!item.dutyId || !item.module || !item.normalizedGoal) continue;
  const fingerprint = `${item.dutyId}|${item.module}|${item.normalizedGoal}`;
  const arr = groups.get(fingerprint) || [];
  arr.push(item);
  groups.set(fingerprint, arr);
}

const report = {
  marker: 'ivx-intelligent-dedupe-supervisor-v1-2026-09-06',
  checkedAt: new Date().toISOString(),
  mode,
  openAutonomousPrs: candidates.length,
  exactDuplicatePrsClosed: [],
  reviewRequired: [],
  canonicalPrs: [],
};

for (const [fingerprint, group] of groups) {
  if (group.length < 2) continue;
  group.sort((a, b) => a.pr.number - b.pr.number);
  const canonical = group[0];
  report.canonicalPrs.push(canonical.pr.number);

  for (const duplicate of group.slice(1)) {
    const exactFiles = sameFiles(canonical.files, duplicate.files);
    const safeToAutoClose = exactFiles && !canonical.repair && !duplicate.repair;
    if (!safeToAutoClose) {
      report.reviewRequired.push({
        canonicalPr: canonical.pr.number,
        candidatePr: duplicate.pr.number,
        dutyId: duplicate.dutyId,
        module: duplicate.module,
        reason: exactFiles ? 'repair/regression signal present' : 'same canonical task but changed-file set differs',
      });
      continue;
    }

    if (mode === 'apply') {
      await comment(duplicate.pr.number, `IVX intelligent dedupe supervisor: closing this PR as an EXACT duplicate of #${canonical.pr.number}.\n\nEvidence: same dutyId, same module, same normalized goal, and identical changed-file set. If this is a real regression, create a new task with fresh failing evidence and a new canonical task identity.`);
      await closePr(duplicate.pr.number);
    }
    report.exactDuplicatePrsClosed.push({
      canonicalPr: canonical.pr.number,
      duplicatePr: duplicate.pr.number,
      dutyId: duplicate.dutyId,
      module: duplicate.module,
      fingerprint,
      applied: mode === 'apply',
    });
  }
}

console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import('node:fs/promises');
  const lines = [
    '# IVX Intelligent Dedupe Supervisor',
    '',
    `- Open autonomous PRs inspected: ${report.openAutonomousPrs}`,
    `- Exact duplicates ${mode === 'apply' ? 'closed' : 'detected'}: ${report.exactDuplicatePrsClosed.length}`,
    `- Ambiguous same-task candidates held for review: ${report.reviewRequired.length}`,
    '',
    '## Safety policy',
    '- Auto-close only when dutyId + module + normalized goal + changed-file set are all identical.',
    '- Any repair/regression signal is never auto-closed.',
    '- Same task with different changed files is REVIEW, not trash.',
  ];
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
