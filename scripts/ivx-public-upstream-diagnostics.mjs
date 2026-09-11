// Read-only observations for Phase 1 database/Auth/feed failures. No success certificate.
import { lookup } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const project = 'kvclcdjmjghndxsngfzb';
const publicKey = 'sb_publishable_HD3Xvq5bCQNJLFk1ROH9mQ_Wdb9xdDZ';
const supabase = `https://${project}.supabase.co`;
const observations = [];
function errorCodes(error) {
  return [error, error?.cause, ...(error?.cause?.errors ?? [])]
    .filter(Boolean).map(e => ({ name: e.name, code: e.code ?? null }));
}
for (const hostname of [`${project}.supabase.co`, 'api.ivxholding.com']) {
  try {
    const addresses = await lookup(hostname, { all: true });
    observations.push({ kind: 'dns', hostname, addressFamilies: addresses.map(x => x.family) });
  } catch (error) { observations.push({ kind: 'dns', hostname, errorCodes: errorCodes(error) }); }
}
const targets = [
  ['runtime_health', 'https://api.ivxholding.com/health'],
  ['auth_health', supabase + '/auth/v1/health'],
  ['published_video_read', supabase + '/rest/v1/project_videos?select=id&is_approved=eq.true&limit=1'],
  ['public_feed', 'https://api.ivxholding.com/api/reels?limit=1'],
];
for (const [check, url] of targets) {
  const started = Date.now();
  const observation = { kind: 'http', check, observedAt: new Date().toISOString(), status: 0 };
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12_000),
      headers: url.startsWith(supabase) ? { apikey: publicKey } : {} });
    observation.status = response.status;
    observation.contentType = response.headers.get('content-type');
    const reader = response.body?.getReader();
    let text = '', bytes = 0;
    if (reader) {
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 16_384) { observation.bodyLimitExceeded = true; break; }
          text += new TextDecoder().decode(part.value);
        }
      } finally { await reader.cancel(); }
    }
    if (!observation.bodyLimitExceeded) {
      try {
        const data = JSON.parse(text);
        observation.rowCount = Array.isArray(data) ? data.length : undefined;
        observation.errorCode = typeof data?.code === 'string' ? data.code.slice(0, 80) : undefined;
        if (check === 'runtime_health') observation.deployedSha = data.commit;
        if (check === 'public_feed') observation.videoCount = Array.isArray(data.videos) ? data.videos.length : null;
      } catch { observation.jsonBody = false; }
    }
  } catch (error) { observation.errorCodes = errorCodes(error); }
  observation.durationMs = Date.now() - started;
  observations.push(observation);
  // Compare an independent IPv4 HTTP client only when the direct data read had no response.
  if (check === 'published_video_read' && observation.status === 0) {
    try {
      const { stdout } = await promisify(execFile)('curl', ['-4', '--silent', '--show-error',
        '--connect-timeout', '5', '--max-time', '12', '--output', '/dev/null',
        '--header', 'apikey: ' + publicKey, '--write-out', '%{http_code} %{time_connect} %{time_appconnect} %{time_starttransfer}', url], { timeout: 13_000 });
      observations.push({ kind: 'ipv4_curl', timings: stdout.trim() });
    } catch (error) {
      observations.push({ kind: 'ipv4_curl', exitCode: error.code, timings: String(error.stdout ?? '').trim() });
    }
  }
}
console.log(JSON.stringify({ result: 'OBSERVATIONS_ONLY', sourceSha: process.env.GITHUB_SHA ?? null,
  completedAt: new Date().toISOString(), mutations: 0, observations }));
