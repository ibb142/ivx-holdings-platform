import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MANIFEST_PATH = 'private authenticated audit item set';
const API = 'https://api.ivxholding.com';
const TERMINAL = new Set(['completed', 'failed', 'blocked', 'cancelled']);
const now = () => new Date().toISOString();

export function validateManifest(m) {
  if (m.items?.length !== 144 || m.itemsTotal !== 144) throw new Error('Expected exactly 144 audited items');
  if (new Set(m.items.map(i => i.itemId)).size !== 144) throw new Error('Duplicate item ID');
  if (m.items.some((i, n) => i.number !== n + 1 || !i.action || !i.acceptance || i.assignedAgentNumber < 1 || i.assignedAgentNumber > 112)) throw new Error('Incomplete item mapping');
  if (new Set(m.items.map(i => i.assignedAgentNumber)).size !== 112) throw new Error('Incomplete 112-agent assignment');
  if (m.items.filter(i => i.unitId).length !== 119) throw new Error('Catalog mapping changed');
  if (m.certificatePolicy.completedJobIsPass !== false || m.certificatePolicy.historicalPassIsCurrentCertificate !== false) throw new Error('Unsafe certification policy');
  return m;
}

export function marker(m, item) { return `[OWNER_AUDIT:${m.missionId}:${item.itemId}]`; }
export function matchesItem(job, m, item) { return typeof job?.input?.goal === 'string' && job.input.goal.includes(marker(m, item)); }
export function selectNext(m, state) {
  if (Object.values(state.items).some(r => ['SUBMITTING', 'UNKNOWN'].includes(r.submission))) return null;
  if (Object.values(state.items).some(r => r.jobId && !TERMINAL.has(r.workerStatus))) return null;
  return [...m.items].sort((a, b) => a.order - b.order).find(i =>
    ['code_change', 'qa_only'].includes(i.executionMode) && !state.items[i.itemId]?.submission && !state.items[i.itemId]?.jobId && state.items[i.itemId]?.certificate?.status !== 'CERTIFIED'
  ) ?? null;
}

export function validateCertificate(item, report, context) {
  const fail = reason => ({ status: 'NOT_CERTIFIED', reason });
  if (!context.artifactVerified) return fail('Artifact bytes and GitHub run have not been verified');
  if (report?.itemId !== item.itemId || report.productionSha !== context.productionSha) return fail('Item or current production SHA mismatch');
  if (report.result !== 'PASS' || report.exitCode !== 0 || !report.command) return fail('Missing passing command');
  if (!Array.isArray(report.assertions) || !report.assertions.length || report.assertions.some(a => a.status !== 'PASS' || !a.name || a.expected === undefined || a.observed === undefined)) return fail('Missing, failed, or skipped assertions');
  const finished = Date.parse(report.finishedAt), started = Date.parse(report.startedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started || started < Date.parse(context.missionStartedAt) || finished > Date.now() + 60_000) return fail('Invalid or historical evidence timestamps');
  if (item.requiresBrowser && (!report.frontendVersion || report.frontendVersion !== context.frontendVersion)) return fail('Published frontend version is not proven');
  if (report.repaired === true && (!report.commitSha || !report.prUrl || !report.deployId || report.postDeployPass !== true)) return fail('Repair lacks commit, PR, deployment, and post-deploy proof');
  return { status: 'CERTIFIED', certifiedAt: now(), productionSha: report.productionSha, test: report.command, artifactUrl: context.artifactUrl, artifactSha256: context.artifactSha256, assertions: report.assertions.length, scope: item.acceptance };
}

export function workerGoal(m, item) {
  return [marker(m, item), `${item.priority} item ${item.number}: ${item.title}.`, `QA lane owner IA ${item.assignedAgentNumber}; this is a scoped Senior Developer job, not proof that 112 independent coders are running.`,
    `Action: ${item.action}`, `Acceptance: ${item.acceptance}`, `Repository instructions: ${MANIFEST_PATH}; qa/landing-owner-audit-sync.md.`,
    item.executionMode === 'qa_only' ? 'QA ONLY. Inspect and test with existing approved QA identities/fixtures. Do not change production records, send messages, alter infrastructure, permissions or authentication boundaries. If access or verified business data is missing, return BLOCKED with the exact dependency.' : 'Make the smallest low-risk application or QA code correction, run focused tests, and follow the existing PR, required CI and deployment policy. Do not change credentials, IAM, payments, destructive migrations, infrastructure or security boundaries. If the required change crosses those gates, return BLOCKED with the exact dependency.',
    'Do not infer a pass from task completion or overall workflow success. Preserve real failures and critical skips. Attach item-specific test output, expected/observed values and artifacts. Do not publish private audit data, credentials or user records in repository files, logs or artifacts. For production certification follow the approved artifact reference contract in qa/landing-owner-audit-sync.md. Report code fixed separately from production certified.',
    `Target completion requested by owner: ${m.targetCompleteBy}; never manufacture evidence to meet the deadline.`].join('\n');
}

export async function runSync({ fetchImpl = fetch, maxMinutes = 11 } = {}) {
  const policy = JSON.parse(await readFile('qa/owner-priority-state.json', 'utf8'));
  if (policy.active !== true || policy.priority !== 'P0-OWNER' || policy.mission !== 'landing') throw new Error('Owner landing mission is not active');
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo !== 'ibb142/ivx-holdings-platform' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Sync is limited to the approved repository and main ref');
  const runUrl = `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  let oidc = null, oidcExpires = 0;
  async function identity() {
    if (oidc && Date.now() < oidcExpires) return oidc;
    const response = await fetchImpl(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=ivx-360-autonomous-recovery`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, signal: AbortSignal.timeout(20_000) });
    const body = await response.json();
    if (!response.ok || !body.value) throw new Error('GitHub OIDC issuance failed');
    oidc = body.value; oidcExpires = Date.now() + 120_000;
    console.log(`::add-mask::${oidc}`);
    return oidc;
  }
  async function request(url, { method = 'GET', body, github = false, allow = [] } = {}) {
    const headers = github ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } : { 'X-IVX-GitHub-OIDC': await identity() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const attempts = method === 'GET' ? 3 : 1; // Never blindly retry an enqueue mutation.
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
        const text = await res.text(); let value; try { value = JSON.parse(text); } catch { value = { error: `Non-JSON response (${text.length} bytes)` }; }
        if (!res.ok && !allow.includes(res.status)) throw new Error(`${method} ${new URL(url).pathname}: HTTP ${res.status}`);
        return { status: res.status, body: value };
      } catch (error) { if (attempt + 1 === attempts) throw error; }
    }
  }
  const gh = (p, opts = {}) => request(`https://api.github.com/repos/${repo}/${p}`, { ...opts, github: true });
  const api = (p, opts = {}) => request(`${API}${p}`, opts);
  const auditId = process.env.IVX_OWNER_AUDIT_ID || 'items-ivx-landing-owner-20260908';
  if (!/^[a-zA-Z0-9_-]+$/.test(auditId)) throw new Error('Invalid audit identifier');
  let initial = await api(`/api/ivx/autonomous-core/audit-items/${auditId}`, { allow: [404] });
  const readyUntil = Date.now() + 8 * 60_000;
  while (initial.status === 404 && Date.now() < readyUntil) {
    await new Promise(resolve => setTimeout(resolve, 15_000));
    initial = await api(`/api/ivx/autonomous-core/audit-items/${auditId}`, { allow: [404] });
  }
  if (!initial.body.ok || !initial.body.set) throw new Error('Private owner audit is not available');
  const unpack = set => set.items.map(i => ({ item: i, data: JSON.parse(i.verification || '{}') }));
  let current = unpack(initial.body.set);
  const meta = current.find(r => r.item.number === 1)?.data;
  const m = validateManifest({ ...meta?.ownerAuditManifest, items: current.map(r => r.data.definition).sort((a, b) => a.number - b.number) });
  if (Date.now() > Date.parse(m.monitorUntil)) { console.log('Owner audit monitoring window finished.'); return; }
  const state = { missionId: m.missionId, startedAt: meta.missionState?.startedAt || now(), ...meta.missionState, auditId, items: {} };
  if (state.missionId !== m.missionId) throw new Error('Stored mission identity mismatch');
  for (const item of m.items) {
    const stored = current.find(r => r.item.number === item.number)?.data.execution;
    state.items[item.itemId] = stored || { number: item.number, assignedAgentNumber: item.assignedAgentNumber, executionMode: item.executionMode, workerStatus: null, submission: null, jobId: null };
    state.items[item.itemId].certificate = { status: 'NOT_CERTIFIED', reason: 'Current production artifact verification is pending for this run.' };
  }
  function auditStatus(row) {
    if (row.certificate.status === 'CERTIFIED') return 'verified';
    if (row.submission === 'UNKNOWN' || ['failed', 'blocked', 'cancelled'].includes(row.workerStatus)) return 'blocked';
    if (row.jobId && !TERMINAL.has(row.workerStatus)) return 'in_progress';
    return 'unverified';
  }
  async function save() {
    state.updatedAt = now(); state.lastRunUrl = runUrl;
    const latest = await api(`/api/ivx/autonomous-core/audit-items/${auditId}`);
    current = unpack(latest.body.set);
    const { items: definitions, ...ownerAuditManifest } = m;
    const { items: executions, ...missionState } = state;
    const items = m.items.map(i => {
      const row = state.items[i.itemId];
      const prior = current.find(r => r.item.number === i.number)?.data || {};
      const verification = { ...prior, definition: i, execution: row, ...(i.number === 1 ? { ownerAuditManifest, missionState } : {}) };
      return { number: i.number, systemArea: `${i.lane} / IA ${i.assignedAgentNumber}`, issue: `${i.itemId}: ${i.title}`, status: auditStatus(row), severity: { P0: 'critical', P1: 'high', P2: 'medium' }[i.priority], rootCause: i.baseline.reviewNote, fix: i.action, file: i.scopeFiles.join(', '), verification: JSON.stringify(verification) };
    });
    const changed = items.filter(i => {
      const existing = current.find(r => r.item.number === i.number)?.item;
      return !existing || Object.entries(i).some(([key, value]) => existing[key] !== value);
    });
    if (changed.length) {
      const result = await api(`/api/ivx/autonomous-core/audit-items/${auditId}/items`, { method: 'POST', body: { items: changed } });
      if (result.body.ok !== true || result.body.upserted !== changed.length) throw new Error('Incomplete private audit synchronization');
    }
    const readback = await api(`/api/ivx/autonomous-core/audit-items/${auditId}`);
    if (readback.body.set?.items?.length !== 144 || readback.body.set.items.some(i => !items.some(e => e.number === i.number && e.issue === i.issue && e.verification === i.verification))) throw new Error('Private audit readback mismatch');
    state.sync = { status: 'PASS', items: 144, catalogMapped: 119, additionalMapped: 25, readbackAt: now(), auditId };
  }
  const syncItems = save;
  await save();
  // The version probe is part of evidence identity; its failure never certifies health.
  try { const v = await api('/version'); state.production = { observedAt: now(), commit: v.body.commit ?? v.body.version?.commit ?? null }; } catch (e) { state.production = { observedAt: now(), error: e.message, commit: null }; }
  await save();
  const stopAt = Date.now() + Math.min(maxMinutes, 15) * 60_000;
  while (Date.now() < stopAt) {
    let changed = false;
    for (const item of m.items) {
      const row = state.items[item.itemId];
      if (row.submission === 'SUBMITTING' || row.submission === 'UNKNOWN') {
        const recent = await api('/api/ivx/senior-developer/worker/jobs');
        const job = recent.body.jobs?.find(j => matchesItem(j, m, item));
        if (job) { row.jobId = job.jobId; row.submission = 'ACCEPTED'; row.workerStatus = job.status; changed = true; }
        else if (row.submission === 'SUBMITTING') { row.submission = 'UNKNOWN'; row.blocker = 'Enqueue outcome is unknown; no automatic duplicate retry.'; changed = true; }
      }
      if (!row.jobId || TERMINAL.has(row.workerStatus)) continue;
      const polled = await api(`/api/ivx/senior-developer/worker/jobs/${row.jobId}`, { allow: [404] });
      if (polled.status === 404) { row.blocker = 'Accepted job is not available in the worker ledger'; row.workerStatus = 'blocked'; changed = true; continue; }
      const job = polled.body.job;
      if (!matchesItem(job, m, item)) throw new Error(`Worker job mismatch for ${item.itemId}`);
      const proof = { status: job.status, stage: job.stage, startedAt: job.startedAt, finishedAt: job.finishedAt, commitSha: job.result?.commitSha ?? null, prNumber: job.result?.prNumber ?? null, prMerged: job.result?.prMerged ?? false, deployId: job.result?.deployId ?? null, testsPassed: job.result?.testsPassed ?? null, error: job.error ?? job.result?.error ?? null };
      if (JSON.stringify(proof) !== JSON.stringify(row.workerProof)) { row.workerProof = proof; row.workerStatus = job.status; row.observedAt = now(); changed = true; }
      // Completion is only a worker result. Certification requires an independent artifact below.
    }
    if (changed) { await save(); }
    const next = selectNext(m, state);
    if (next && Date.now() <= Date.parse(m.targetCompleteBy)) {
      const row = state.items[next.itemId]; row.submission = 'SUBMITTING'; row.submittedAt = now(); await save();
      try {
        const response = await api('/api/ivx/senior-developer/worker/jobs', { method: 'POST', allow: [409], body: { goal: workerGoal(m, next), templateMode: 'BUG_FIX', executionMode: next.executionMode, approvePatch: next.executionMode === 'code_change', approveGitDeploy: false, riskLevel: 'low', validationMode: 'focused', proposedPlan: next.action, filesAffected: next.scopeFiles, rollbackOption: 'Revert only the scoped repair commit through the existing PR policy.' } });
        if (![202, 409].includes(response.status) || !matchesItem(response.body.job, m, next)) throw new Error('Worker returned no matching receipt; another job is not evidence for this item');
        row.jobId = response.body.job.jobId; row.workerStatus = response.body.job.status; row.submission = 'ACCEPTED'; row.receivedAt = now(); row.receiptRunUrl = runUrl;
        console.log('Scoped worker receipt saved in the private audit.');
      } catch (e) { row.submission = 'UNKNOWN'; row.blocker = e.message; console.log('Worker receipt requires private audit review.'); }
      await save();
    }
    if (!next && !Object.values(state.items).some(r => r.jobId && !TERMINAL.has(r.workerStatus))) break;
    await new Promise(resolve => setTimeout(resolve, 20_000));
  }
  // Candidate references remain inside the authenticated audit. Never publish the audit in GitHub.
  const refreshed = await api(`/api/ivx/autonomous-core/audit-items/${auditId}`);
  const references = unpack(refreshed.body.set).map(r => r.data.proposedCertificate).filter(Boolean);
  for (const reference of references) {
    const item = m.items.find(i => i.itemId === reference.itemId); if (!item) continue;
    const row = state.items[item.itemId];
    try {
      if (!Number.isSafeInteger(reference.artifactId) || !Number.isSafeInteger(reference.runId) || !/^[a-f0-9]{64}$/.test(reference.artifactSha256 ?? '') || !/^[A-Za-z0-9_./-]+\.json$/.test(reference.reportPath ?? '') || reference.reportPath.includes('..')) throw new Error('Invalid certificate reference');
      const run = (await gh(`actions/runs/${reference.runId}`)).body;
      const artifact = (await gh(`actions/artifacts/${reference.artifactId}`)).body;
      if (run.conclusion !== 'success' || artifact.expired || artifact.workflow_run?.id !== reference.runId || artifact.size_in_bytes > 10_000_000) throw new Error('Artifact/run linkage is not acceptable');
      const archive = await fetchImpl(`https://api.github.com/repos/${repo}/actions/artifacts/${reference.artifactId}/zip`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(40_000) });
      if (!archive.ok) throw new Error('Artifact download failed');
      const bytes = Buffer.from(await archive.arrayBuffer()); const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== reference.artifactSha256 || bytes.length > 10_000_000) throw new Error('Artifact digest/size mismatch');
      const dir = await mkdtemp(join(tmpdir(), 'ivx-owner-cert-'));
      let report;
      try { const zip = join(dir, 'artifact.zip'); await writeFile(zip, bytes); report = JSON.parse(execFileSync('unzip', ['-p', zip, reference.reportPath], { maxBuffer: 1_000_000 }).toString('utf8')); } finally { await rm(dir, { recursive: true, force: true }); }
      const version = (await api('/version')).body;
      let frontendVersion = null;
      if (item.requiresBrowser) { const v = await fetchImpl('https://ivxholding.com/version.json', { signal: AbortSignal.timeout(20_000) }); if (v.ok) { const b = await v.json(); frontendVersion = b.commit ?? b.sourceSha ?? null; } }
      row.certificate = validateCertificate(item, report, { artifactVerified: true, productionSha: version.commit ?? version.version?.commit, frontendVersion, missionStartedAt: state.startedAt, artifactUrl: `https://github.com/${repo}/actions/runs/${reference.runId}/artifacts/${reference.artifactId}`, artifactSha256: digest });
    } catch (e) { row.certificate = { status: 'NOT_CERTIFIED', reason: e.message }; }
  }
  const finalCertificate = state.items['IVX-LANDING-119'];
  if (Object.entries(state.items).some(([id, row]) => id !== 'IVX-LANDING-119' && row.certificate.status !== 'CERTIFIED')) finalCertificate.certificate = { status: 'NOT_CERTIFIED', reason: 'One or more of the 143 dependency certificates is missing.' };
  await syncItems();
  const summary = { generatedAt: now(), sync: state.sync, acceptedJobs: Object.values(state.items).filter(r => r.jobId).length, certified: Object.values(state.items).filter(r => r.certificate.status === 'CERTIFIED').length, total: 144, allCertified: Object.values(state.items).every(r => r.certificate.status === 'CERTIFIED'), targetCompleteBy: m.targetCompleteBy };
  state.summary = summary;
  await save();
  console.log('Synchronization finished. Detailed receipts and certificates are available only in the authenticated IVX audit.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runSync().catch(e => { console.error(e.message); process.exitCode = 1; });
