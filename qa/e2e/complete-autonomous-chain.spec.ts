import { test, expect, type Request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { IVX_OWNER_AI_ROOM_ID as ROOM } from '../../expo/constants/ivx-owner-ai';
import { ChainEvidenceError, requireProof, digest, parseOwnerResponse, verifyChainEvidence,
  ORDER_SEEN_SQL, CHAIN_SNAPSHOT_SQL, SERVICE_IDS } from '../autonomous-chain-evidence.mjs';

const API = 'https://api.ivxholding.com';
const AUTH = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const REPO = 'https://api.github.com/repos/ibb142/ivx-holdings-platform';
const STORAGE_KEY = 'sb-kvclcdjmjghndxsngfzb-auth-token';

test('16.2–16.8: one owner order has a durable IA, commit, PR and live deployment', async ({ page }, info) => {
  const proof: Record<string, any> = { startedAt: new Date().toISOString(), chainPassed: false,
    phase4Certified: false, continuous24HoursCertified: false, requests: 0, observations: [] };
  let stage = 'PREFLIGHT';
  const save = async () => {
    await mkdir('qa/evidence/autonomous-chain', { recursive: true });
    await writeFile('qa/evidence/autonomous-chain/proof.json', JSON.stringify(proof, null, 2) + '\n');
  };
  try {
    requireProof(process.env.PHASE4_LIVE_CHAIN === '1', 'LIVE_CHAIN_NOT_SELECTED');
    requireProof(info.retry === 0 && info.repeatEachIndex === 0 && info.project.retries === 0
      && info.project.repeatEach === 1 && info.config.workers === 1
      && Number(process.env.GITHUB_RUN_ATTEMPT || '1') === 1, 'ORDER_RETRY_FORBIDDEN');
    const orderToken = process.env.PHASE4_ORDER_TOKEN || '';
    const order = process.env.PHASE4_ORDER || '';
    requireProof(/^[a-zA-Z0-9_-]{12,100}$/.test(orderToken) && order.trim().length >= 15, 'ORDER_INPUT_MISSING');
    const message = `${order.trim()}\nAudit tracking token: ${orderToken}`;
    const password = ['OWNER_NEW_PASSWORD', 'OWNER_PASSWORD', 'IVX_OWNER_PASSWORD',
      'IVX_OWNER_NEW_PASSWORD', 'OWNER_LOGIN_PASSWORD', 'IVX_OWNER_LOGIN_PASSWORD']
      .map(name => process.env[name]).find(value => value?.trim());
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const dbUrl = process.env.SUPABASE_DB_URL || process.env.SUPABASE_POOLER_URL;
    const githubToken = process.env.GH_TOKEN;
    const renderToken = process.env.RENDER_API_KEY;
    requireProof(password && anonKey && dbUrl && githubToken && renderToken, 'LIVE_CHAIN_CREDENTIAL_UNAVAILABLE');
    const connection = new URL(dbUrl!);
    const project = 'kvclcdjmjghndxsngfzb';
    requireProof(connection.hostname === `db.${project}.supabase.co`
      || (connection.hostname.endsWith('.pooler.supabase.com')
        && decodeURIComponent(connection.username).endsWith(`.${project}`)), 'DATABASE_PROJECT_MISMATCH');
    // Certificate validation stays enabled, regardless of URL sslmode options.
    for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) connection.searchParams.delete(key);
    const readDatabase = async (sql: string, values: string[]) => {
      const client = new pg.Client({ host: connection.hostname, port: Number(connection.port || '5432'),
        user: decodeURIComponent(connection.username), password: decodeURIComponent(connection.password),
        database: decodeURIComponent(connection.pathname.slice(1) || 'postgres'), ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: 5_000, query_timeout: 6_000,
        application_name: 'phase4-chain-readonly' });
      let disconnected = false;
      client.on('error', () => { disconnected = true; });
      try {
        await client.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '4s'");
        const result = await client.query<Record<string, any>>(sql, values);
        requireProof(!disconnected, 'DATABASE_CONNECTION_LOST');
        await client.query('ROLLBACK');
        return result.rows[0];
      } catch { throw new ChainEvidenceError('DATABASE_EVIDENCE_UNAVAILABLE'); }
      finally { await client.end(); }
    };
    let ownerToken = '';
    const get = async (url: string, headers: Record<string, string> = {}) => {
      const response = await fetch(url, { method: 'GET', redirect: 'error', headers,
        signal: AbortSignal.timeout(12_000) });
      const body = await response.json();
      requireProof(response.status === 200, 'EVIDENCE_HTTP_FAILED');
      return body;
    };
    const ownerGet = (path: string) => get(`${API}${path}`, { authorization: `Bearer ${ownerToken}` });
    const githubGet = (path: string) => get(`${REPO}${path}`, { authorization: `Bearer ${githubToken}`,
      accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' });
    const renderGet = (serviceId: string) => get(`https://api.render.com/v1/services/${serviceId}/deploys?limit=20`,
      { authorization: `Bearer ${renderToken}` });
    const probe = async (path: string) => {
      const body = await get(API + path);
      return { httpStatus: 200, commitSha: body.commit || body.commitSha || body.sha || null,
        degraded: body.degraded === true || body.ok === false || ['degraded', 'error', 'unhealthy'].includes(body.status) };
    };
    proof.orderToken = orderToken;
    proof.sourceSha = process.env.GITHUB_SHA || null;
    const baseline = await probe('/health');
    const initialVersion = await probe('/version');
    requireProof(/^[a-f0-9]{40}$/.test(baseline.commitSha || '') && !baseline.degraded
      && !initialVersion.degraded && initialVersion.commitSha === baseline.commitSha, 'BASE_RELEASE_UNHEALTHY');
    proof.baseSha = baseline.commitSha;
    // Prove evidence access before sending the mutating order.
    await githubGet(`/commits/${baseline.commitSha}`);
    for (const serviceId of SERVICE_IDS) await renderGet(serviceId);
    requireProof((await readDatabase(ORDER_SEEN_SQL, [orderToken, ROOM])).seen === false, 'ORDER_ALREADY_EXISTS');

    stage = 'OWNER_LOGIN';
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('login-email').fill(process.env.OWNER_EMAIL || 'iperez4242@gmail.com');
    await page.getByTestId('login-password').fill(password!);
    const signedIn = page.waitForResponse(response => response.url().startsWith(`${AUTH}/auth/v1/token?`)
      && response.request().method() === 'POST').then(async response => {
      requireProof(response.status() === 200, 'OWNER_LOGIN_REJECTED');
      return response.json();
    });
    const [, session] = await Promise.all([page.getByTestId('login-submit').click(), signedIn]);
    ownerToken = session.access_token;
    requireProof(typeof ownerToken === 'string' && !!ownerToken, 'OWNER_TOKEN_MISSING');
    const identity = await get(`${AUTH}/auth/v1/user`, { authorization: `Bearer ${ownerToken}`, apikey: anonKey! });
    requireProof(identity.id === session.user?.id, 'OWNER_IDENTITY_MISMATCH');
    requireProof((await ownerGet('/api/ivx/verify/env-status')).ok === true, 'OWNER_GATE_REJECTED');
    await page.getByTestId('home-runtime-ready').waitFor({ state: 'visible' });
    // Observe settled auth state, rather than treating network silence as auth.
    await page.waitForFunction(({ key, id }) => {
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      return stored?.user?.id === id && !!stored.access_token && !!stored.refresh_token;
    }, { key: STORAGE_KEY, id: identity.id });
    await page.goto('/ivx/chat', { waitUntil: 'domcontentloaded' });
    const input = page.getByTestId('ivx-owner-chat-input');
    const send = page.getByTestId('ivx-owner-chat-send');
    await expect(input).toBeVisible();
    await expect(send).toBeVisible();
    proof.ownerAuthenticated = true;
    await save();

    stage = 'CHAT_SUBMISSION';
    const sent: Request[] = [];
    const matchesOrder = (request: Request) => {
      if (request.method() !== 'POST' || request.url() !== `${API}/api/ivx/owner-ai`) return false;
      try { return request.postDataJSON()?.message?.includes(orderToken) === true; }
      catch { return false; }
    };
    page.on('request', request => { if (matchesOrder(request)) sent.push(request); });
    await input.fill(message);
    const reply = page.waitForResponse(response => matchesOrder(response.request()), { timeout: 120_000 });
    proof.submittedAt = new Date().toISOString();
    // Exactly two physical clicks, not a first send followed by two more.
    const [, response] = await Promise.all([send.dblclick({ delay: 50 }), reply]);
    requireProof([200, 202].includes(response.status()), 'CHAT_HTTP_FAILED');
    const payload = parseOwnerResponse(response.headers()['content-type'] || '', await response.text());
    requireProof(sent.length === 1, 'DUPLICATE_BROWSER_SUBMISSION');
    const requestBody = sent[0].postDataJSON();
    requireProof(typeof requestBody.requestId === 'string' && requestBody.requestId.length > 0
      && payload.requestId === requestBody.requestId && payload.conversationId === ROOM, 'CHAT_IDENTITY_MISMATCH');
    const jobId = payload.executionStatus?.taskId;
    requireProof(typeof jobId === 'string' && /^ivx-worker-[a-f0-9-]{36}$/.test(jobId), 'WORKER_HANDOFF_MISSING');
    requireProof(payload.executionStatus.statusUrl === `/api/ivx/senior-developer/worker/jobs/${jobId}`, 'WORKER_STATUS_ROUTE_MISMATCH');
    proof.requestId = requestBody.requestId;
    proof.jobId = jobId;
    proof.requests = sent.length;
    await save();
    await expect(page.getByTestId('ivx-execution-console-bubble').filter({ hasText: jobId })).toBeVisible();

    stage = 'WORKER_COMPLETION';
    let job: any;
    const deadline = Date.now() + 35 * 60_000;
    do {
      const current = await ownerGet(`/api/ivx/senior-developer/worker/jobs/${jobId}`);
      requireProof(current.ok === true && current.job?.jobId === jobId, 'WORKER_STATUS_INVALID');
      job = current.job;
      if (proof.observations.at(-1)?.status !== job.status) {
        proof.observations.push({ at: new Date().toISOString(), status: job.status });
        await save();
      }
      requireProof(!['failed', 'blocked', 'cancelled'].includes(job.status), 'WORKER_TERMINAL_FAILURE');
      if (job.status === 'completed') break;
      await delay(15_000);
    } while (Date.now() < deadline);
    requireProof(job?.status === 'completed', 'WORKER_COMPLETION_TIMEOUT');

    stage = 'DURABLE_AND_EXTERNAL_EVIDENCE';
    const requestKey = `owner-chat-requests/${digest(JSON.stringify([identity.id, ROOM, proof.requestId]))}`;
    const database = await readDatabase(CHAIN_SNAPSHOT_SQL, [proof.requestId, identity.id, ROOM, message, requestKey]);
    requireProof(Number.isInteger(job.result?.prNumber) && job.result.prNumber > 0
      && /^[a-f0-9]{40}$/.test(job.result?.commitSha || ''), 'COMMIT_OR_PR_MISSING');
    const commit = await githubGet(`/commits/${job.result.commitSha}`);
    const pullRequest = await githubGet(`/pulls/${job.result.prNumber}`);
    const checkRuns: any[] = [];
    for (let number = 1; number <= 10; number++) {
      const checks = await githubGet(`/commits/${job.result.commitSha}/check-runs?per_page=100&page=${number}`);
      requireProof(Array.isArray(checks.check_runs), 'GITHUB_CI_RESPONSE_INVALID');
      checkRuns.push(...checks.check_runs);
      if (checkRuns.length >= checks.total_count) break;
    }
    const deployments: any[] = [];
    for (const serviceId of SERVICE_IDS) {
      const listed = await renderGet(serviceId);
      const matching = listed.map((entry: any) => entry.deploy).find((deploy: any) =>
        deploy?.status === 'live' && deploy.commit?.id === pullRequest.merge_commit_sha);
      requireProof(matching, 'RENDER_DEPLOYMENT_MISSING');
      deployments.push({ ...matching, serviceId });
    }
    const health = await probe('/health');
    const version = await probe('/version');
    Object.assign(proof, verifyChainEvidence({ requestId: proof.requestId, conversationId: ROOM,
      ownerId: identity.id, baseSha: proof.baseSha, sentCount: sent.length, job, database,
      pullRequest, commit, checkRuns, deployments, health, version, submittedAt: proof.submittedAt }));
  } catch (error) {
    // Playwright/HTTP/SQL errors can contain credential-bearing arguments.
    // Keep only our fixed error codes and the failing stage in saved evidence.
    proof.error = error instanceof ChainEvidenceError ? error.code : `${stage}_FAILED`;
    throw new Error(proof.error);
  } finally {
    proof.stage = stage;
    proof.completedAt = new Date().toISOString();
    await save();
  }
});
