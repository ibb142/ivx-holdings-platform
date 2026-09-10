import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
await Promise.all([a.connect(), b.connect()]);
try {
  // The preceding HA proof installs the original queue migrations in this
  // disposable local PostgreSQL service. No production data is involved.
  const patch = (client, changes) => client.query('select public.ivx_senior_queue_patch($1::jsonb)', [JSON.stringify(changes)]);
  const claim = async (client, jobId, worker) => (await client.query('select public.ivx_senior_queue_claim($1,$2,true) as value', [jobId, worker])).rows[0].value;
  const fixture = suffix => ({ jobId: `commit-recovery-${suffix}`, ownerId: `commit-recovery-owner-${suffix}`,
    status: 'committing', attempts: 1, leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    result: { commitSha: 'a'.repeat(40), branch: 'synthetic-repair', prNumber: null } });
  const original = fixture('original');
  await patch(a, [{ expected: null, next: original }]);
  assert.equal(await claim(a, original.jobId, 'before-fix'), null, 'Baseline must reproduce the lost-PR recovery deadlock');
  const privileges = async () => (await a.query("select has_function_privilege('anon','public.ivx_senior_queue_claim(text,text,boolean)','execute') as anon, has_function_privilege('authenticated','public.ivx_senior_queue_claim(text,text,boolean)','execute') as authenticated, has_function_privilege('service_role','public.ivx_senior_queue_claim(text,text,boolean)','execute') as service")).rows[0];
  const accessBefore = await privileges();
  assert.deepEqual(accessBefore, { anon: false, authenticated: false, service: true });

  await a.query(await readFile(new URL('../supabase/repair-functions/ivx-senior-commit-identity-recovery.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await privileges(), accessBefore, 'Repair must preserve the existing access boundary');
  const claims = await Promise.all([claim(a, original.jobId, 'recovery-a'), claim(b, original.jobId, 'recovery-b')]);
  assert.equal(claims.filter(Boolean).length, 1, 'Exactly one physical worker may recover the same missing PR');
  const winner = claims.find(Boolean);
  assert.equal(winner.jobId, original.jobId);
  assert.equal(winner.result.commitSha, original.result.commitSha);
  assert.equal(winner.result.prNumber, null, 'A claim does not invent PR evidence');
  assert.equal(winner.status, 'committing', 'A claim is not completion');
  assert.equal(winner.attempts, original.attempts, 'Resume retains the same attempt');
  assert.equal(await claim(b, original.jobId, 'late-worker'), null, 'A live lease cannot be stolen');
  await assert.rejects(patch(b, [{ expected: winner, next: { ...winner, result: { ...winner.result, prNumber: 17 } }, workerInstanceId: 'stale-worker' }]), /Worker lease lost/);
  await patch(a, [{ expected: winner, next: { ...winner, result: { ...winner.result, prNumber: 17 } }, workerInstanceId: winner.leaseWorkerInstanceId }]);

  for (const [suffix, change] of [
    ['missing-branch', { result: { ...original.result, branch: null } }],
    ['invalid-sha', { result: { ...original.result, commitSha: 'short-sha' } }],
    ['missing-commit', { result: { ...original.result, commitSha: null } }],
    ['terminal', { status: 'blocked' }],
    ['same-owner', { ownerId: original.ownerId }],
  ]) {
    const job = { ...fixture(suffix), ...change };
    await patch(a, [{ expected: null, next: job }]);
    assert.equal(await claim(b, job.jobId, 'forbidden-worker'), null, suffix);
  }
  const knownPr = { ...fixture('known-pr'), result: { commitSha: 'b'.repeat(40), prNumber: 18 } };
  await patch(a, [{ expected: null, next: knownPr }]);
  assert.ok(await claim(b, knownPr.jobId, 'known-pr-worker'), 'Existing persisted-PR recovery remains supported');
  const proof = { ok: true, sourceSha: process.env.GITHUB_SHA ?? null, database: 'isolated PostgreSQL',
    baselineLostPrRecoveryRejected: true, missingPrRecoveryWinners: 1, sameJobPreserved: true,
    liveLeaseProtected: true, staleProcessWriteRejected: true, malformedIdentityRejected: true,
    terminalResurrectionRejected: true, ownerSingleFlightPreserved: true, existingPrResumePreserved: true,
    privateAccessUnchanged: true, productionRowsTouched: 0 };
  const output = new URL('../qa/evidence/fleet-ha/senior-commit-recovery.json', import.meta.url);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally { await Promise.allSettled([a.end(), b.end()]); }
