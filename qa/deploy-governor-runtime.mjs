import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Preserve the existing live inference requirement, with a deadline and an
 * explicit failing stage. No POST retry can silently duplicate paid inference. */
export async function verifyGovernorRuntime({ apiBase, targetSha, runId, fetchImpl = fetch }) {
  const report = { targetSha, startedAt: new Date().toISOString(), completedAt: null,
    gate: 'FAIL', certified: false, scope: 'Deployment health and one live inference; not fleet certification', checks: [] };
  const check = async (name, path, validate, init = {}) => {
    const started = performance.now();
    const row = { name, httpStatus: null, elapsedMs: null, ok: false, errorType: null };
    report.checks.push(row);
    try {
      const response = await fetchImpl(`${apiBase}${path}`, { ...init, signal: AbortSignal.timeout(init.method === 'POST' ? 40_000 : 20_000) });
      row.httpStatus = response.status;
      if (!response.ok) { row.errorType = 'HTTP_ERROR'; return false; }
      const body = await response.json();
      row.ok = validate(body);
      if (!row.ok) row.errorType = 'ASSERTION_FAILED';
      return row.ok;
    } catch (error) {
      row.errorType = ['AbortError', 'TimeoutError'].includes(error?.name) ? 'TIMEOUT' : 'TRANSPORT_OR_JSON_ERROR';
      return false;
    } finally { row.elapsedMs = Math.round(performance.now() - started); }
  };
  try {
    if (!/^[a-f0-9]{40}$/.test(targetSha ?? '') || !/^https:\/\//.test(apiBase ?? '')) throw Error('INVALID_TARGET');
    if (!await check('health', '/health', b => b.ok === true && b.commit === targetSha)) return report;
    if (!await check('version', '/version', b => b.ok === true && b.commit === targetSha)) return report;
    if (!await check('ai_provider', '/health/ai/live', b => b.ok === true)) return report;
    const token = `IVX-LIVE-${runId}-1`;
    if (!await check('public_chat_inference', '/api/public/chat', b => b.source === 'chatgpt'
      && typeof b.endpoint === 'string' && b.endpoint.length > 0
      && String(b.answer ?? b.text ?? '').includes(token), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ivx-client-id': `github-live-cert-${runId}` },
      body: JSON.stringify({ message: `Return the exact token ${token} and no other text.`,
        sessionId: 'github-live-cert', requestId: `github-live-cert-${runId}`, history: [] }),
    })) return report;
    report.gate = 'PASS';
    return report;
  } finally { report.completedAt = new Date().toISOString(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifyGovernorRuntime({ apiBase: process.env.API_BASE, targetSha: process.env.TARGET_SHA,
      runId: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}` });
    await mkdir('qa/evidence', { recursive: true });
    await writeFile('qa/evidence/deploy-governor-runtime.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (report.gate !== 'PASS') process.exitCode = 1;
  } catch { console.error('DEPLOY_GOVERNOR_VALIDATION_UNAVAILABLE'); process.exitCode = 1; }
}
