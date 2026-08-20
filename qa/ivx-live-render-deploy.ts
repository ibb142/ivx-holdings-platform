/**
 * Live Render deployment executed through the real mutation-tool pipeline.
 *
 * This is NOT a simulation. It:
 *   1. Proves an unapproved deploy is refused.
 *   2. Proves a wrongly-approved deploy is refused.
 *   3. Runs `deploy` in `verify` mode (real read-only GET against Render).
 *   4. Runs `deploy` in `trigger` mode (real POST /deploys) — unless a rollout
 *      is already in flight, in which case it ADOPTS that deploy rather than
 *      starting a duplicate production rollout.
 *   5. Polls the real deploy until it reaches a terminal state.
 *   6. Probes the live public URL.
 *
 * Every step records the real HTTP status. Failures are reported as failures.
 */
import { executeMutationTool, redactSecrets } from '../backend/services/ivx-agent-mutation-tools';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type StepResult = {
  step: number;
  name: string;
  passed: boolean;
  detail: string;
  data?: unknown;
};

const steps: StepResult[] = [];

function record(step: number, name: string, passed: boolean, detail: string, data?: unknown): void {
  steps.push({ step, name, passed, detail, data });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] step ${step} — ${name}: ${detail}`);
}

const SERVICE_ID = (process.env.RENDER_SERVICE_ID ?? '').trim();
const API_KEY = (process.env.RENDER_API_KEY ?? '').trim();
const PUBLIC_URL = 'https://ivx-holdings-platform.onrender.com';

const TERMINAL = new Set([
  'live',
  'build_failed',
  'update_failed',
  'canceled',
  'deactivated',
  'pre_deploy_failed',
]);
const IN_FLIGHT = new Set(['created', 'queued', 'build_in_progress', 'update_in_progress', 'pre_deploy_in_progress']);

type Deploy = { id?: string; status?: string; commit?: { id?: string; message?: string } };

async function renderGet<T>(path: string): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: (await res.json()) as T };
}

/** Returns an already-running deploy, if any, so we never double-trigger prod. */
async function findInFlightDeploy(): Promise<Deploy | null> {
  const { body } = await renderGet<{ deploy: Deploy }[]>(`/services/${SERVICE_ID}/deploys?limit=5`);
  if (!body) return null;
  for (const item of body) {
    const status = item.deploy?.status ?? '';
    if (IN_FLIGHT.has(status)) return item.deploy;
  }
  return null;
}

async function pollDeploy(deployId: string): Promise<Deploy> {
  const deadline = Date.now() + 14 * 60_000;
  let last: Deploy = {};
  while (Date.now() < deadline) {
    const { status, body } = await renderGet<Deploy>(`/services/${SERVICE_ID}/deploys/${deployId}`);
    if (!body) {
      console.log(`  poll HTTP ${status}`);
      await Bun.sleep(10_000);
      continue;
    }
    last = body;
    const state = last.status ?? 'unknown';
    console.log(`  deploy ${deployId} status=${state}`);
    if (TERMINAL.has(state)) return last;
    await Bun.sleep(15_000);
  }
  return last;
}

async function main(): Promise<void> {
  const approvalToken = (process.env.IVX_OWNER_TOKEN ?? '').trim();

  console.log('=== IVX LIVE RENDER DEPLOY ===');
  console.log(`service: ${SERVICE_ID}`);
  console.log(`approval token present: ${approvalToken.length > 0}`);
  console.log(`render key present: ${API_KEY.length > 0}\n`);

  const unapproved = await executeMutationTool('deploy', { mode: 'verify' }, { ownerApprovalToken: null });
  record(
    1,
    'deploy refused without owner approval',
    !unapproved.ok && /owner approval required/.test(unapproved.error ?? ''),
    unapproved.error ?? 'unexpectedly succeeded',
  );

  const wrong = await executeMutationTool('deploy', { mode: 'verify' }, { ownerApprovalToken: 'not-the-owner-token' });
  record(
    2,
    'deploy refused with wrong approval token',
    !wrong.ok && /owner approval required/.test(wrong.error ?? ''),
    wrong.error ?? 'unexpectedly succeeded',
  );

  const verify = await executeMutationTool(
    'deploy',
    { mode: 'verify', serviceId: SERVICE_ID },
    { ownerApprovalToken: approvalToken },
  );
  record(
    3,
    'deploy target verified against live Render API',
    verify.ok === true,
    verify.ok ? verify.summary : (verify.error ?? 'failed'),
    verify.extract,
  );
  if (!verify.ok) return finish();

  // Adopt an in-flight rollout rather than stacking a second production deploy.
  const existing = await findInFlightDeploy();
  let deployId: string | null = null;

  if (existing?.id) {
    deployId = existing.id;
    record(
      4,
      'production rollout in flight (adopted, no duplicate triggered)',
      true,
      `adopted deploy ${deployId} status=${existing.status ?? 'unknown'} commit=${existing.commit?.id ?? 'n/a'}`,
      { deployId, adopted: true, status: existing.status ?? null, commitSha: existing.commit?.id ?? null },
    );
  } else {
    const trigger = await executeMutationTool(
      'deploy',
      { mode: 'trigger', serviceId: SERVICE_ID },
      { ownerApprovalToken: approvalToken },
    );
    const extract = (trigger.extract ?? {}) as { deployId?: string | null; status?: string | null };
    deployId = typeof extract.deployId === 'string' ? extract.deployId : null;
    record(
      4,
      'production rollout triggered',
      trigger.ok === true && deployId !== null,
      trigger.ok ? trigger.summary : (trigger.error ?? 'failed'),
      { ...extract, adopted: false },
    );
    if (!trigger.ok || !deployId) return finish();
  }

  const final = await pollDeploy(deployId);
  const finalStatus = final.status ?? 'unknown';
  record(
    5,
    'deploy reached terminal state "live"',
    finalStatus === 'live',
    `final status=${finalStatus}, commit=${final.commit?.id ?? 'unknown'}`,
    { deployId, finalStatus, commitSha: final.commit?.id ?? null },
  );

  try {
    const res = await fetch(PUBLIC_URL, { headers: { Accept: 'text/html' } });
    record(
      6,
      'live public URL responds',
      res.status > 0 && res.status < 500,
      `GET ${PUBLIC_URL} -> HTTP ${res.status}`,
      { httpStatus: res.status },
    );
  } catch (err) {
    record(6, 'live public URL responds', false, redactSecrets(err instanceof Error ? err.message : String(err)));
  }

  finish();
}

function finish(): void {
  const passed = steps.filter((s) => s.passed).length;
  const total = steps.length;
  const allPassed = passed === total;

  console.log(`\n=== RESULT: ${passed}/${total} steps passed ===`);
  console.log(allPassed ? 'LIVE DEPLOY VERIFIED' : 'DEPLOY NOT FULLY VERIFIED');

  const dir = join(process.cwd(), 'qa', 'evidence', 'autonomous');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ivx-live-render-deploy-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        kind: 'ivx-live-render-deploy',
        generatedAt: new Date().toISOString(),
        serviceId: SERVICE_ID,
        publicUrl: PUBLIC_URL,
        passedSteps: passed,
        totalSteps: total,
        allPassed,
        steps,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`evidence: ${file}`);
  if (!allPassed) process.exitCode = 1;
}

void main();
