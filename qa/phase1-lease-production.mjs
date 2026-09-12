import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.ivxholding.com';
const PROJECT = 'kvclcdjmjghndxsngfzb';
const AUTH = `https://${PROJECT}.supabase.co`;
export const TARGET_SHA = '2ec993814841fdab299c0026ba2e1bd04ce82f36';
const sql = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${sql(JSON.stringify(value))}::jsonb`;
const now = () => new Date().toISOString();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const requireProof = (condition, message) => { if (!condition) throw new Error(message); };

export function fixtureIdentity(uuid) {
  requireProof(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(uuid), 'Invalid QA UUID');
  return { id: `phase1-71-qa:${uuid}`, holder: `phase1-71-qa:${uuid}`, marker: `phase1-71:${uuid}` };
}

function transaction(body, declarations = '') {
  return `begin; set local statement_timeout='25000'; set local lock_timeout='2000';
    do $qa$ declare v jsonb; ${declarations} begin ${body} end $qa$;
    commit; select current_setting('ivx.phase1_71_receipt')::jsonb as receipt;`;
}

export function claimSql(f, contender = false) {
  fixtureIdentity(f.id.split(':')[1]);
  const requests = [{ workerId: f.holder, agentNumber: 112,
    options: { missionScope: { familyPrefixes: [''], activePrefixes: [f.id] } } }];
  const rpc = `public.ivx_autonomous_tasks_claim_batch(${json(requests)},v_process,1800)`;
  if (contender) return transaction(`
    v_process := ${sql(f.marker + ':postgres:')} || pg_backend_pid()::text;
    v_key := pg_catalog.hashtextextended(${sql('ivx-autonomous-worker:' + f.holder)},0);
    for attempt in 1..100 loop
      select pid into v_holder_pid from pg_locks where locktype='advisory' and granted
        and classid=((v_key>>32)&4294967295)::oid and objid=(v_key&4294967295)::oid limit 1;
      exit when v_holder_pid is not null;
      perform pg_sleep(0.1);
    end loop;
    if v_holder_pid is null then raise exception 'QA contention barrier was not observed'; end if;
    v := ${rpc};
    perform set_config('ivx.phase1_71_receipt',jsonb_build_object('at',clock_timestamp(),'pid',pg_backend_pid(),
      'process',v_process,'observedHolderPid',v_holder_pid,'result',v)::text,false);`,
  'v_process text; v_key bigint; v_holder_pid integer;');
  const payload = { taskId: f.id, idempotencyKey: f.id, state: 'QUEUED', assignedAgentNumber: 112,
    dependencies: [], priority: 'low', taskType: 'qa', title: 'Temporary Phase 1 lease boundary acceptance',
    qaMarker: f.marker, simulated: true, productionWorkClaimed: false };
  return transaction(`
    v_process := ${sql(f.marker + ':postgres:')} || pg_backend_pid()::text;
    insert into public.ivx_autonomous_tasks(task_id,idempotency_key,state,assigned_agent_number,priority,payload)
      values(${sql(f.id)},${sql(f.id)},'QUEUED',112,'low',${json(payload)});
    v := ${rpc};
    if v->0->'task'->>'taskId' is distinct from ${sql(f.id)} then raise exception 'QA did not acquire its exact fixture'; end if;
    perform set_config('ivx.phase1_71_receipt',jsonb_build_object('at',clock_timestamp(),'pid',pg_backend_pid(),
      'process',v_process,'result',v)::text,false);
    perform pg_sleep(8);`, 'v_process text;');
}

export function assertConcurrentClaims(a, b, fixtureId) {
  requireProof(Number.isInteger(a?.pid) && Number.isInteger(b?.pid) && a.pid !== b.pid, 'Distinct database processes not proven');
  requireProof(b.observedHolderPid === a.pid, 'Contender did not observe the claiming process');
  requireProof(a.result?.[0]?.ok === true && a.result[0].task?.taskId === fixtureId, 'Exact fixture winner missing');
  requireProof(b.result?.[0]?.ok === true && b.result[0].task === null && b.result[0].claimContended === true, 'Concurrent exclusion not proven');
}

export async function runProof(env = process.env) {
  const f = fixtureIdentity(randomUUID());
  const receipt = { item: '7.1', result: 'FAIL', startedAt: now(), targetSha: TARGET_SHA,
    qaSourceSha: env.GITHUB_SHA, workflowRun: env.GITHUB_RUN_ID, project: PROJECT, fixture: f,
    checks: [], cleanup: [], errors: [], sqlReceipts: {}, apiAttempts: [],
    scope: 'Live PostgreSQL RPC contention plus physical Render API process renewal and rejection',
    fixtureOnly: true, applicationTasksCompleted: 0, providerCalls: 0, restarts: 0, schemaChanges: 0 };
  const dir = resolve('qa-results/phase1-lease-production'); mkdirSync(dir, { recursive: true });
  const save = () => writeFileSync(resolve(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  const pass = (name, detail = {}) => { receipt.checks.push({ name, result: 'PASS', at: now(), ...detail }); save(); };
  const fail = e => { receipt.errors.push(e instanceof Error ? e.message : 'Unknown failure'); save(); };
  let token, fixtureAttempted = false;
  const request = async (origin, path, { method = 'GET', body, headers = {}, timeout = 30000 } = {}) => {
    requireProof([API, AUTH, 'https://api.supabase.com'].includes(origin), 'Unapproved origin');
    const started = Date.now();
    let response;
    try { response = await fetch(origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store', Connection: 'close',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new Error(`Transport failure ${origin === API ? 'api' : origin === AUTH ? 'auth' : 'management'} ${method}`); }
    let data;
    try { data = await response.json(); } catch { throw new Error(`Invalid JSON HTTP ${response.status}`); }
    return { http: response.status, data, elapsedMs: Date.now() - started, at: now() };
  };
  const db = async (query, label) => {
    const r = await request('https://api.supabase.com', `/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
      body: { query, read_only: false }, timeout: 45000 });
    requireProof(r.http === 201 || r.http === 200, `SQL ${label} HTTP ${r.http}`);
    requireProof(Array.isArray(r.data), `SQL ${label} response is not an array`);
    return r.data;
  };
  const snapshot = async () => (await db(`select task_id,state,lease_holder,worker_instance_id,
    last_heartbeat_at,lease_expires_at,version,payload->>'qaMarker' as qa_marker
    from public.ivx_autonomous_tasks where task_id=${sql(f.id)} and payload->>'qaMarker'=${sql(f.marker)};`, 'fixture_read'))[0];
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const postApi = (path, body) => request(API, path, { method: 'POST', body, headers: authHeaders() });
  const health = async () => {
    const r = await request(API, `/health?phase1_71=${f.marker}&nonce=${randomUUID()}`);
    requireProof(r.http === 200 && r.data?.ok === true && r.data.commit === TARGET_SHA, 'Production health/SHA mismatch');
    requireProof(typeof r.data.instanceId === 'string' && r.data.instanceId.startsWith('srv-d7t9ivreo5us73ftose0:'), 'Physical API process identity missing');
    return { instanceId: r.data.instanceId, commit: r.data.commit, at: r.at };
  };
  try {
    requireProof(env.IVX_PHASE1_71_QA === 'one-temporary-lease-fixture', 'Hosted QA gate required');
    requireProof(env.SUPABASE_ACCESS_TOKEN && env.SUPABASE_ANON_KEY && env.IVX_QA_OWNER_PASSWORD, 'Required protected credential missing');
    const instances = new Map();
    for (let i = 0; i < 12 && instances.size < 2; i++) { const h = await health(); instances.set(h.instanceId, h); }
    requireProof(instances.size === 2, 'Two real API processes not observed');
    receipt.apiProcesses = [...instances.values()]; pass('Two physical API process identities at target SHA', { instances: receipt.apiProcesses });
    const [apiOwner, apiOther] = [...instances.keys()];
    const login = await request(AUTH, '/auth/v1/token?grant_type=password', { method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY }, body: { email: 'iperez4242@gmail.com', password: env.IVX_QA_OWNER_PASSWORD } });
    requireProof(login.http === 200 && typeof login.data?.access_token === 'string', 'Owner password session failed');
    token = login.data.access_token;
    const states = await request(API, '/api/ivx/autonomous-task-engine/states', { headers: authHeaders() });
    requireProof(states.http === 200 && states.data?.ok === true, 'Owner task-engine access failed');
    pass('Real owner session accepted by deployed task engine', { http: states.http });
    const denied = await request(API, `/api/ivx/autonomous-task-engine/lease/${encodeURIComponent(f.id)}/heartbeat`, { method: 'POST', body: { workerId: f.holder } });
    requireProof(denied.http === 401, 'Anonymous renewal was not denied'); pass('Anonymous renewal denied', { http: denied.http });
    receipt.databaseFunctions = await db(`select proname,md5(pg_get_functiondef(oid)) as definition_md5
      from pg_proc where oid in ('public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)'::regprocedure,
      'public.ivx_autonomous_tasks_heartbeat_batch(jsonb,text,integer)'::regprocedure,
      'public.ivx_autonomous_tasks_start_batch(jsonb,text,integer)'::regprocedure);`, 'function_identity');
    const hashes = Object.fromEntries(receipt.databaseFunctions.map(r => [r.proname, r.definition_md5]));
    requireProof(hashes.ivx_autonomous_tasks_claim_batch === '42d3bf7de77a2c79adc1e679ab9fc381' &&
      hashes.ivx_autonomous_tasks_heartbeat_batch === 'ab7f2bf5876f919719b5b86e7ead0e0e' &&
      hashes.ivx_autonomous_tasks_start_batch === 'cb2fef855d3fedbaf409515808bbe6be', 'Reviewed production RPC changed');
    pass('Reviewed live claim/start/heartbeat functions verified');
    const indexes = await db(`select i.indisunique,i.indisvalid from pg_index i
      where i.indexrelid='public.ivx_autonomous_tasks_active_holder_idx'::regclass;`, 'unique_index');
    requireProof(indexes[0]?.indisunique === true && indexes[0]?.indisvalid === true, 'Active lease holder unique index invalid');
    pass('Active lease holder unique index valid');
    fixtureAttempted = true; save();
    // The fixture is invisible while QUEUED and committed only after claiming.
    // The contender waits for the real holder's advisory lock before competing.
    const claims = await Promise.allSettled([
      db(claimSql(f), 'claim_winner'),
      (async () => { await delay(500); return db(claimSql(f, true), 'claim_contender'); })(),
    ]);
    receipt.sqlReceipts.claims = claims.map(r => r.status === 'fulfilled' ? { status: r.status, rows: r.value } : { status: r.status, error: r.reason.message }); save();
    requireProof(claims.every(r => r.status === 'fulfilled'), 'Concurrent production claim query failed');
    const a = claims[0].value[0]?.receipt, b = claims[1].value[0]?.receipt;
    assertConcurrentClaims(a, b, f.id);
    pass('One winner across concurrent PostgreSQL processes', { winnerPid: a.pid, loserPid: b.pid, winners: 1, claimContended: true });
    const before = await snapshot();
    requireProof(before?.state === 'LEASED' && before.worker_instance_id === a.process && before.lease_holder === f.holder, 'Winning lease was not persisted');
    pass('Winning lease durable after transaction commit', { state: before.state, holder: before.lease_holder, process: before.worker_instance_id });

    // Explicit fixture setup for HTTP boundary verification. This assignment is
    // not reported as an application claim or as real fleet work. The deployed
    // API supplies its own process identity for every heartbeat tested below.
    const bound = await db(`update public.ivx_autonomous_tasks set worker_instance_id=${sql(apiOwner)}
      where task_id=${sql(f.id)} and payload->>'qaMarker'=${sql(f.marker)} and worker_instance_id=${sql(a.process)}
      and state='LEASED' returning task_id,worker_instance_id;`, 'bind_http_fixture');
    requireProof(bound.length === 1, 'HTTP fixture identity binding failed');
    receipt.httpFixtureSetup = { source: 'explicit QA precondition', previousProcess: a.process, ownerProcess: apiOwner, otherObservedProcess: apiOther }; save();
    const duplicates = await Promise.allSettled([1,2].map(() => postApi('/api/ivx/autonomous-task-engine/lease', { workerId: f.holder })));
    receipt.apiAttempts.push(...duplicates.map(r => r.status === 'fulfilled' ? { operation: 'duplicate_claim', ...r.value } : { operation: 'duplicate_claim', error: r.reason.message })); save();
    requireProof(duplicates.every(r => r.status === 'fulfilled' && r.value.http === 200 && r.value.data?.ok === true && r.value.data.task === null), 'Deployed duplicate claim was not excluded');
    pass('Two concurrent deployed HTTP claims cannot take another task');
    let accepted = false, fenced = false;
    for (let i = 0; i < 16 && !(accepted && fenced); i++) {
      const initial = await snapshot();
      const r = await postApi(`/api/ivx/autonomous-task-engine/lease/${encodeURIComponent(f.id)}/heartbeat?qa=${f.marker}&n=${i}`, { workerId: f.holder });
      const after = await snapshot();
      receipt.apiAttempts.push({ operation: 'heartbeat', ...r, before: initial, after }); save();
      requireProof(r.http === 200 && after?.worker_instance_id === apiOwner && after?.lease_holder === f.holder, 'HTTP renewal lost fixture/owner identity');
      requireProof(Date.parse(initial.lease_expires_at) > Date.parse(r.at) + 60000, 'Fixture lease expired during replica test');
      if (r.data?.ok === true) {
        requireProof(Date.parse(after.last_heartbeat_at) > Date.parse(initial.last_heartbeat_at) && after.version > initial.version, 'Successful heartbeat not durable');
        requireProof(Date.parse(after.lease_expires_at) > Date.parse(r.at) + 20000, 'Lease was not renewed');
        accepted = true;
      } else {
        requireProof(r.data?.error === 'Worker lease lost or expired.', 'Unexpected renewal rejection');
        requireProof(after.version === initial.version && after.lease_expires_at === initial.lease_expires_at, 'Other process changed the lease');
        fenced = true;
      }
    }
    requireProof(accepted && fenced, 'Renewal by owner and rejection by other real API process not both observed');
    pass('Real API owner process renews a durable lease');
    pass('Other real API process is rejected with lease unchanged', { ownerProcess: apiOwner, otherObservedProcess: apiOther });
    const wrong = await postApi(`/api/ivx/autonomous-task-engine/lease/${encodeURIComponent(f.id)}/heartbeat`, { workerId: f.holder + ':wrong' });
    requireProof(wrong.http === 200 && wrong.data?.ok === false && wrong.data.error === 'Not the lease holder.', 'Wrong logical holder was not rejected');
    pass('Wrong logical lease holder rejected');
    const final = await health();
    requireProof(instances.has(final.instanceId), 'API processes changed during acceptance');
    const last = await snapshot(); requireProof(last?.state === 'LEASED' && last.worker_instance_id === apiOwner, 'Fixture ownership changed at end');
    pass('Deployment and durable fixture ownership stable at end', final);
    receipt.acceptancePassed = true;
  } catch (e) { fail(e); }
  finally {
    if (fixtureAttempted) {
      try {
        const removed = await db(`begin; set local statement_timeout='10000'; set local lock_timeout='2000';
          delete from public.ivx_autonomous_task_events where task_id=${sql(f.id)};
          delete from public.ivx_autonomous_tasks where task_id=${sql(f.id)} and idempotency_key=${sql(f.id)} and payload->>'qaMarker'=${sql(f.marker)};
          commit; select count(*)::int as remaining from public.ivx_autonomous_tasks where task_id=${sql(f.id)};`, 'fixture_cleanup');
        requireProof(removed[0]?.remaining === 0, 'Temporary task cleanup incomplete');
        receipt.cleanup.push({ name: 'Exact temporary task removed', result: 'PASS', at: now() });
      } catch (e) { receipt.cleanup.push({ name: 'Exact temporary task removed', result: 'FAIL', at: now() }); fail(e); }
    }
    if (token) {
      try {
        const r = await fetch(AUTH + '/auth/v1/logout?scope=local', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
        requireProof(r.status >= 200 && r.status < 300, 'QA owner session logout failed');
        receipt.cleanup.push({ name: 'Only this QA owner session signed out', result: 'PASS', at: now() });
      } catch (e) { receipt.cleanup.push({ name: 'Only this QA owner session signed out', result: 'FAIL', at: now() }); fail(e); }
    }
    receipt.finishedAt = now();
    receipt.result = receipt.acceptancePassed && receipt.errors.length === 0 && receipt.cleanup.length === 2 && receipt.cleanup.every(c => c.result === 'PASS') ? 'PASS' : 'FAIL';
    save(); console.log(JSON.stringify(receipt));
  }
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await runProof(); process.exitCode = receipt.result === 'PASS' ? 0 : 1;
}
