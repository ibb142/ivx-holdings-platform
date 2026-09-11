import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
export const PROJECT = 'kvclcdjmjghndxsngfzb';
const PUBLIC_KEY = 'sb_publishable_HD3Xvq5bCQNJLFk1ROH9mQ_Wdb9xdDZ';
const API = `https://api.supabase.com/v1/projects/${PROJECT}`;
const DATA = `https://${PROJECT}.supabase.co/rest/v1/project_videos?select=id&is_approved=eq.true&limit=1`;

export async function recover({ fetchImpl = fetch, token = process.env.SUPABASE_ACCESS_TOKEN,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), emit = console.log } = {}) {
  const evidence = { project: PROJECT, incident: 'supabase-unresponsive-nano-2026-09-10',
    startedAt: new Date().toISOString(), probes: [], restartRequests: 0, restartAcknowledged: false };
  const probe = async () => {
    const started = Date.now();
    let status = 0, hasApprovedVideo = false;
    try {
      const response = await fetchImpl(DATA, { headers: { apikey: PUBLIC_KEY }, signal: AbortSignal.timeout(12000) });
      status = response.status;
      if (response.ok) { const rows = await response.json(); hasApprovedVideo = Array.isArray(rows) && rows.some(row => typeof row.id === 'string'); }
    } catch { /* An uncertain read cannot authorize a successful recovery receipt. */ }
    const result = { status, hasApprovedVideo, durationMs: Date.now() - started };
    evidence.probes.push(result);
    return status === 200 && hasApprovedVideo && result.durationMs < 6000;
  };
  try {
    const first = await probe(); await wait(2000); const second = await probe();
    if (first && second) { evidence.result = 'already_healthy'; return evidence; }
    if (first || second) throw new Error('Intermittent data-plane response; two consecutive unhealthy probes are required');
    if (evidence.probes.some(p => (p.status >= 400 && p.status < 500) || (p.status === 200 && !p.hasApprovedVideo))) {
      throw new Error('The response does not prove a database outage; restart refused');
    }
    if (!token?.trim()) throw new Error('SUPABASE_ACCESS_TOKEN is not bound');
    const projectResponse = await fetchImpl(API, { headers: { Authorization: `Bearer ${token.trim()}` }, signal: AbortSignal.timeout(20000) });
    if (!projectResponse.ok) throw new Error(`Management authorization failed: HTTP ${projectResponse.status}`);
    const project = await projectResponse.json();
    if (project.id !== PROJECT || !['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'ACTIVE', 'RESTARTING', 'COMING_UP'].includes(project.status)) throw new Error('Project identity or lifecycle does not match the audited recovery');
    evidence.previousStatus = project.status;
    if (!['RESTARTING', 'COMING_UP'].includes(project.status)) {
      evidence.restartRequests = 1;
      try {
        const response = await fetchImpl(`${API}/restart`, { method: 'POST', headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000) });
        evidence.restartHttpStatus = response.status;
        if (![200, 201, 202].includes(response.status)) throw new Error(`Restart rejected: HTTP ${response.status}`);
        evidence.restartAcknowledged = true;
      } catch (error) {
        if (String(error.message).startsWith('Restart rejected:')) throw error;
        evidence.restartUncertain = true;
      }
    }
    let consecutiveHealthy = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      await wait(10000);
      consecutiveHealthy = await probe() ? consecutiveHealthy + 1 : 0;
      if (consecutiveHealthy === 3) { evidence.result = 'recovered'; return evidence; }
    }
    throw new Error('Recovery is not verified after bounded polling; do not repeat an uncertain restart');
  } catch (error) {
    evidence.result = 'unverified'; evidence.error = error.message; throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await emit(JSON.stringify(evidence));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await recover({ emit: async value => { console.log(value); await mkdir('qa/evidence/supabase-recovery', { recursive: true }); await writeFile('qa/evidence/supabase-recovery/recovery.json', value + '\n'); } })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
