/**
 * IVX Fresh Evidence Generator
 * Generates evidence artifacts from CURRENT production state — not historical claims.
 * Every artifact includes: generatedAt, commitSha, environment, runnerVersion, result, sourceCommand, evidenceHash.
 */
import type { EvidenceArtifact, TestStatus } from './ivx-qa-types';
import { RUNNER_VERSION, PRODUCTION_API, LANDING_URL } from './ivx-qa-types';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const ENVIRONMENT = process.env.NODE_ENV || 'production-evidence';
const EVIDENCE_DIR = join(process.cwd(), 'qa', 'evidence');

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function makeArtifact(
  name: string,
  result: TestStatus,
  sourceCommand: string,
  data: Record<string, unknown>,
  commitSha: string,
): EvidenceArtifact {
  const generatedAt = new Date().toISOString();
  const dataStr = JSON.stringify(data);
  return {
    name,
    generatedAt,
    commitSha,
    environment: ENVIRONMENT,
    runnerVersion: RUNNER_VERSION,
    result,
    sourceCommand,
    evidenceHash: sha256(generatedAt + dataStr),
    data,
  };
}

async function fetchJson(url: string, opts?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

async function getProductionSha(): Promise<string> {
  try {
    const h = await fetchJson(`${PRODUCTION_API}/health`);
    return String(h.commit || 'unknown');
  } catch {
    return 'unknown';
  }
}

/**
 * Generate a complete fresh evidence package from current production.
 */
export async function generateEvidencePackage(): Promise<{
  artifacts: EvidenceArtifact[];
  packageHash: string;
  generatedAt: string;
}> {
  const commitSha = await getProductionSha();
  const artifacts: EvidenceArtifact[] = [];

  // 1. GitHub HEAD
  try {
    const gh = await fetchJson('https://api.github.com/repos/ibb142/ivx-holdings-platform/commits/main');
    artifacts.push(makeArtifact(
      'github-head',
      'PASS',
      'GET https://api.github.com/repos/ibb142/ivx-holdings-platform/commits/main',
      { headSha: gh.sha, message: String(gh.commit?.message || '').slice(0, 200), date: gh.commit?.author?.date },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('github-head', 'ERROR', 'github-api', { error: String(e) }, commitSha));
  }

  // 2. Production health
  try {
    const h = await fetchJson(`${PRODUCTION_API}/health`);
    artifacts.push(makeArtifact(
      'production-health',
      h.status === 'healthy' ? 'PASS' : 'FAIL',
      `GET ${PRODUCTION_API}/health`,
      h,
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('production-health', 'ERROR', `GET ${PRODUCTION_API}/health`, { error: String(e) }, commitSha));
  }

  // 3. SHA parity
  try {
    const h = await fetchJson(`${PRODUCTION_API}/health`);
    const gh = await fetchJson('https://api.github.com/repos/ibb142/ivx-holdings-platform/commits/main');
    const prodSha = String(h.commit || '').slice(0, 12);
    const ghSha = String(gh.sha || '').slice(0, 12);
    artifacts.push(makeArtifact(
      'sha-parity',
      prodSha === ghSha ? 'PASS' : 'FAIL',
      'Compare production /health commit vs GitHub HEAD',
      { productionSha: prodSha, githubSha: ghSha, match: prodSha === ghSha },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('sha-parity', 'ERROR', 'sha-parity-check', { error: String(e) }, commitSha));
  }

  // 4. Landing page
  try {
    const res = await fetch(LANDING_URL, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
    artifacts.push(makeArtifact(
      'landing-page',
      res.status === 200 ? 'PASS' : 'FAIL',
      `GET ${LANDING_URL}`,
      { httpStatus: res.status, contentType: res.headers.get('content-type') },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('landing-page', 'ERROR', `GET ${LANDING_URL}`, { error: String(e) }, commitSha));
  }

  // 5. Owner auth
  try {
    const d = await fetchJson(`${PRODUCTION_API}/api/ivx/owner-passwordless-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'iperez4242@gmail.com', emergency: 'ivx_emergency_recovery' }),
    });
    const token = String(d.accessToken || '');
    artifacts.push(makeArtifact(
      'owner-auth',
      token.length > 100 ? 'PASS' : 'FAIL',
      `POST ${PRODUCTION_API}/api/ivx/owner-passwordless-login`,
      { tokenLength: token.length, success: d.success },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('owner-auth', 'ERROR', 'owner-login', { error: String(e) }, commitSha));
  }

  // 6. Public chat
  try {
    const d = await fetchJson(`${PRODUCTION_API}/api/public/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is 2 plus 3?' }),
    });
    artifacts.push(makeArtifact(
      'public-chat',
      d.ok && String(d.answer || '').length > 0 ? 'PASS' : 'FAIL',
      `POST ${PRODUCTION_API}/api/public/chat`,
      { ok: d.ok, answerLength: String(d.answer || '').length, answerPreview: String(d.answer || '').slice(0, 100) },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('public-chat', 'ERROR', 'public-chat', { error: String(e) }, commitSha));
  }

  // 7. Security gate
  try {
    const res = await fetch(`${PRODUCTION_API}/api/ivx/owner-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
      signal: AbortSignal.timeout(10000),
    });
    artifacts.push(makeArtifact(
      'security-gate',
      res.status === 401 || res.status === 403 ? 'PASS' : 'FAIL',
      `POST ${PRODUCTION_API}/api/ivx/owner-ai (no auth)`,
      { httpStatus: res.status, expectedStatus: '401 or 403' },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('security-gate', 'ERROR', 'security-gate', { error: String(e) }, commitSha));
  }

  // 8. Render response time
  try {
    const start = Date.now();
    await fetch(`${PRODUCTION_API}/health`, { signal: AbortSignal.timeout(10000) });
    const elapsed = Date.now() - start;
    artifacts.push(makeArtifact(
      'render-response-time',
      elapsed < 5000 ? 'PASS' : 'FAIL',
      `GET ${PRODUCTION_API}/health (timed)`,
      { responseMs: elapsed, threshold: 5000 },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('render-response-time', 'ERROR', 'render-timed', { error: String(e) }, commitSha));
  }

  // 9. Supabase config
  try {
    const h = await fetchJson(`${PRODUCTION_API}/health`);
    artifacts.push(makeArtifact(
      'supabase-config',
      h.databaseConfigured ? 'PASS' : 'FAIL',
      `GET ${PRODUCTION_API}/health (databaseConfigured field)`,
      { databaseConfigured: h.databaseConfigured },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('supabase-config', 'ERROR', 'supabase-config', { error: String(e) }, commitSha));
  }

  // 10. Worker endpoint
  try {
    const res = await fetch(`${PRODUCTION_API}/api/ivx/senior-developer/worker/jobs`, {
      signal: AbortSignal.timeout(10000),
    });
    artifacts.push(makeArtifact(
      'worker-endpoint',
      res.status === 200 || res.status === 401 || res.status === 403 ? 'PASS' : 'FAIL',
      `GET ${PRODUCTION_API}/api/ivx/senior-developer/worker/jobs`,
      { httpStatus: res.status },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('worker-endpoint', 'ERROR', 'worker-endpoint', { error: String(e) }, commitSha));
  }

  // 11. Member registration endpoint
  try {
    const res = await fetch(`${PRODUCTION_API}/api/members/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
    artifacts.push(makeArtifact(
      'member-registration',
      res.status === 200 || res.status === 400 || res.status === 422 ? 'PASS' : 'FAIL',
      `POST ${PRODUCTION_API}/api/members/register`,
      { httpStatus: res.status },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('member-registration', 'ERROR', 'member-registration', { error: String(e) }, commitSha));
  }

  // 12. Reels endpoint
  try {
    const res = await fetch(`${PRODUCTION_API}/api/video/capabilities`, {
      signal: AbortSignal.timeout(10000),
    });
    artifacts.push(makeArtifact(
      'reels-endpoint',
      res.status === 200 || res.status === 401 ? 'PASS' : 'FAIL',
      `GET ${PRODUCTION_API}/api/video/capabilities`,
      { httpStatus: res.status },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('reels-endpoint', 'ERROR', 'reels-endpoint', { error: String(e) }, commitSha));
  }

  // 13. Critical files check
  const { CRITICAL_FILES } = await import('./ivx-critical-files');
  const missingP0 = CRITICAL_FILES.filter(f => f.protectionLevel === 'P0' && !existsSync(join(process.cwd(), f.path)));
  artifacts.push(makeArtifact(
    'critical-files-p0',
    missingP0.length === 0 ? 'PASS' : 'FAIL',
    'Check P0 critical files exist on disk',
    { totalP0: CRITICAL_FILES.filter(f => f.protectionLevel === 'P0').length, missing: missingP0.map(f => f.path) },
    commitSha,
  ));

  // 14. Test totals (local)
  try {
    const { execSync } = await import('child_process');
    const testOutput = execSync('cd /home/user/rork-app && bun test backend/ --reporter=default 2>&1 | tail -5', { timeout: 60000, encoding: 'utf8' });
    const passMatch = testOutput.match(/(\d+) pass/);
    const failMatch = testOutput.match(/(\d+) fail/);
    const skipMatch = testOutput.match(/(\d+) skip/);
    artifacts.push(makeArtifact(
      'backend-tests',
      (!failMatch || parseInt(failMatch[1]) === 0) ? 'PASS' : 'FAIL',
      'bun test backend/ --reporter=default',
      { pass: passMatch ? parseInt(passMatch[1]) : 0, fail: failMatch ? parseInt(failMatch[1]) : 0, skip: skipMatch ? parseInt(skipMatch[1]) : 0, raw: testOutput.slice(0, 300) },
      commitSha,
    ));
  } catch (e) {
    artifacts.push(makeArtifact('backend-tests', 'ERROR', 'bun test backend/', { error: String(e).slice(0, 300) }, commitSha));
  }

  // Write evidence package
  if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
  const packageData = {
    generatedAt: new Date().toISOString(),
    commitSha,
    runnerVersion: RUNNER_VERSION,
    artifacts,
  };
  const packageHash = sha256(JSON.stringify(packageData));
  const outPath = join(EVIDENCE_DIR, `evidence-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(packageData, null, 2));
  writeFileSync(join(EVIDENCE_DIR, 'latest.json'), JSON.stringify(packageData, null, 2));

  return { artifacts, packageHash, generatedAt: packageData.generatedAt };
}

if (import.meta.main) {
  generateEvidencePackage()
    .then((pkg) => {
      console.log('=== IVX FRESH EVIDENCE PACKAGE ===');
      console.log(`Generated: ${pkg.generatedAt}`);
      console.log(`Package Hash: ${pkg.packageHash}`);
      console.log(`Artifacts: ${pkg.artifacts.length}`);
      console.log('');
      for (const a of pkg.artifacts) {
        console.log(`[${a.result}] ${a.name} — ${a.sourceCommand.slice(0, 80)}`);
        console.log(`  hash: ${a.evidenceHash}`);
      }
      console.log('\nEvidence written to qa/evidence/latest.json');
    })
    .catch(console.error);
}
