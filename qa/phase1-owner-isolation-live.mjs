// Hosted acceptance only. Never prints credentials or existing customer records.
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const API = 'https://api.ivxholding.com';
export const SUPABASE = 'https://kvclcdjmjghndxsngfzb.supabase.co';
export const OWNER_READ = '/api/ivx/development-control';
const ROLE_DENIAL = 'IVX role guard failed: privileged IVX access is required.';
const TABLES = ['public_chat_sessions', 'public_chat_messages', 'ivx_ai_conversations'];
const fail = code => { throw new ProofError(code); };
class ProofError extends Error {}
const requireProof = (condition, code) => { if (!condition) fail(code); };
const same = isDeepStrictEqual;
const now = () => new Date().toISOString();
const userPayload = data => data?.user ?? data;

export async function runProof(config, { fetchImpl = fetch, checkpoint = () => {} } = {}) {
  const receipt = {
    item: '7.2', scope: 'hosted Auth, deployed owner guard, profile isolation and private chat persistence',
    result: 'FAIL', startedAt: now(), targetSha: config.targetSha, qaSourceSha: config.qaSourceSha,
    productionProject: 'kvclcdjmjghndxsngfzb', run: config.run, checks: [],
    temporaryIdentities: [], temporaryRows: [], cleanup: [], errors: [],
    runtimeControlMutations: 0, directSchemaStatements: 0, existingCustomerRowsRequested: 0,
    credentialValuesLogged: false,
  };
  const identities = [];
  const fixtures = [];
  let ownerToken;
  let ownerId;
  let cleaning = false;
  const deadline = Date.now() + 9 * 60_000;
  const save = () => checkpoint(structuredClone(receipt));
  const pass = (name, detail = {}) => { receipt.checks.push({ name, result: 'PASS', at: now(), ...detail }); save(); };
  const request = async (origin, path, { method = 'GET', token, admin = false, body, prefer } = {}) => {
    requireProof(origin === API || origin === SUPABASE, 'unapproved_origin');
    requireProof(path.startsWith('/') && !path.startsWith('//'), 'invalid_path');
    requireProof(!admin || origin === SUPABASE, 'admin_credential_origin');
    if (!cleaning) requireProof(Date.now() < deadline, 'proof_deadline');
    const headers = { Accept: 'application/json', 'Cache-Control': 'no-store' };
    if (origin === SUPABASE) headers.apikey = admin ? config.serviceKey : config.anonKey;
    if (admin || token) headers.Authorization = `Bearer ${admin ? config.serviceKey : token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    let response;
    try {
      response = await fetchImpl(origin + path, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(20_000),
      });
    } catch { fail(`transport_${origin === API ? 'api' : 'supabase'}_${method}`); }
    let data = null;
    try { const text = await response.text(); if (text) data = JSON.parse(text); }
    catch { fail(`invalid_json_http_${response.status}`); }
    return { status: response.status, data };
  };
  const success = (response, code) => {
    requireProof(response.status >= 200 && response.status < 300, `${code}_http_${response.status}`);
    return response.data;
  };
  const rest = (table, filter, options = {}) => request(SUPABASE, `/rest/v1/${table}?${filter}`, options);
  const adminRead = async (table, filter) => {
    const rows = success(await rest(table, filter, { admin: true }), `${table}_read`);
    requireProof(Array.isArray(rows), `${table}_rows_invalid`);
    return rows;
  };
  const checkDeployment = async label => {
    for (const path of ['/health', '/version']) {
      const data = success(await request(API, path), 'deployment');
      requireProof(data?.ok === true && data.commit === config.targetSha, 'deployed_sha_mismatch');
    }
    pass(label, { sha: config.targetSha });
  };
  const login = async (email, password, expectedId) => {
    const data = success(await request(SUPABASE, '/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email, password },
    }), 'password_login');
    requireProof(typeof data?.access_token === 'string' && data.access_token.split('.').length === 3, 'password_session_missing');
    // Save the token for logout before subsequent verification can fail.
    if (expectedId) identities.find(identity => identity.id === expectedId).token = data.access_token;
    else ownerToken = data.access_token;
    const user = userPayload(success(await request(SUPABASE, '/auth/v1/user', { token: data.access_token }), 'session_validation'));
    requireProof(user?.email?.toLowerCase() === email.toLowerCase() && user.id === data.user?.id, 'password_identity_mismatch');
    if (expectedId) requireProof(user.id === expectedId && user.app_metadata?.role === 'member', 'member_identity_mismatch');
    return { user, token: data.access_token };
  };
  const ownerAllowed = async label => {
    const data = success(await request(API, OWNER_READ, { token: ownerToken }), 'owner_api');
    requireProof(data?.ok === true && data.ownerOnly === true && data.authenticatedUserId === ownerId, 'owner_not_verified');
    pass(label, { http: 200 });
  };
  const memberDenied = async (identity, label) => {
    const response = await request(API, OWNER_READ, { token: identity.token });
    // This exact deployed guard message proves role rejection, not an Auth outage mapped to 403.
    requireProof(response.status === 403 && response.data?.ok === false && response.data?.error === ROLE_DENIAL, 'member_denial_not_proven');
    pass(label, { http: 403, reason: 'verified_session_without_privileged_role' });
  };
  const fixtureFilter = fixture => `id=eq.${fixture.row.id}&${fixture.markerKey}=eq.${encodeURIComponent(fixture.row[fixture.markerKey])}`;
  const cleanupStep = async (name, fn) => {
    try { await fn(); receipt.cleanup.push({ name, result: 'PASS' }); }
    catch (error) { receipt.cleanup.push({ name, result: 'FAIL', code: error instanceof ProofError ? error.message : 'unexpected_cleanup_error' }); }
    save();
  };

  try {
    requireProof(config.consent === 'temporary-members-and-chat-fixtures', 'hosted_qa_opt_in_required');
    requireProof(config.apiBase === API && config.supabaseUrl === SUPABASE, 'production_origin_mismatch');
    requireProof(/^[a-f0-9]{40}$/.test(config.targetSha ?? ''), 'target_sha_invalid');
    requireProof(/^[a-f0-9]{40}$/.test(config.qaSourceSha ?? ''), 'qa_source_sha_invalid');
    requireProof(/^[a-zA-Z0-9_-]{1,100}$/.test(config.run ?? ''), 'run_invalid');
    requireProof([config.ownerEmail, config.ownerPassword, config.anonKey, config.serviceKey].every(value => typeof value === 'string' && value.trim()), 'protected_credentials_missing');
    await checkDeployment('deployed_commit_before');
    const owner = await login(config.ownerEmail, config.ownerPassword);
    ownerId = owner.user.id;
    await ownerAllowed('real_owner_allowed_before');
    const anonymous = await request(API, OWNER_READ);
    requireProof(anonymous.status === 401 && /missing bearer/i.test(anonymous.data?.error ?? ''), 'anonymous_denial_not_proven');
    pass('anonymous_owner_api_denied', { http: 401 });

    for (const label of ['a', 'b']) {
      const identity = { id: randomUUID(), email: `phase1-72-${randomUUID()}@qa.invalid`, label, token: null };
      const password = randomBytes(36).toString('base64url') + '!aA9';
      const absent = await request(SUPABASE, `/auth/v1/admin/users/${identity.id}`, { admin: true });
      requireProof(absent.status === 404, 'temporary_identity_already_exists_or_unavailable');
      // The reviewed Auth trigger creates members, without a foreign key to Auth.
      const members = await adminRead('members', `email=eq.${encodeURIComponent(identity.email)}&select=member_id&limit=2`);
      requireProof(members.length === 0, 'temporary_member_email_already_exists');
      identities.push(identity);
      receipt.temporaryIdentities.push({ id: identity.id, email: identity.email, createConfirmed: false });
      save();
      const created = userPayload(success(await request(SUPABASE, '/auth/v1/admin/users', {
        method: 'POST', admin: true, body: {
          id: identity.id, email: identity.email, password, email_confirm: true,
          app_metadata: { role: 'member', phase1_qa_run: config.run }, user_metadata: { phase1_qa_run: config.run },
        },
      }), 'temporary_identity_create'));
      requireProof(created?.id === identity.id && created.email === identity.email && created.app_metadata?.phase1_qa_run === config.run, 'created_identity_mismatch');
      receipt.temporaryIdentities.at(-1).createConfirmed = true;
      save();
      success(await rest('profiles', '', { admin: true, method: 'POST', body: { id: identity.id, email: identity.email, role: 'member' } }), 'temporary_profile_create');
      await login(identity.email, password, identity.id);
      await memberDenied(identity, `real_member_${label}_denied`);
    }

    for (const identity of identities) {
      const other = identities.find(value => value.id !== identity.id);
      const own = success(await rest('profiles', `id=eq.${identity.id}&select=id,role&limit=1`, { token: identity.token }), 'own_profile');
      requireProof(same(own, [{ id: identity.id, role: 'member' }]), 'own_profile_not_persisted');
      const foreign = success(await rest('profiles', `id=eq.${other.id}&select=id&limit=1`, { token: identity.token }), 'foreign_profile');
      requireProof(same(foreign, []), 'cross_profile_access');
      pass(`profile_${identity.label}_self_read_and_cross_read_denied`);
      const change = await rest('profiles', `id=eq.${identity.id}`, {
        method: 'PATCH', token: identity.token, body: { role: 'owner' }, prefer: 'return=representation',
      });
      requireProof(([401, 403].includes(change.status) && change.data?.code === '42501') || (change.status === 200 && same(change.data, [])), 'profile_role_write_not_denied');
      const unchanged = await adminRead('profiles', `id=eq.${identity.id}&select=id,role&limit=1`);
      requireProof(same(unchanged, [{ id: identity.id, role: 'member' }]), 'profile_role_escalation');
      pass(`profile_${identity.label}_role_update_denied`);
    }

    const first = identities[0];
    const mutations = [{ role: 'owner' }, { role: 'admin' }, { role: 'developer' },
      { user_role: 'owner' }, { app_role: 'superadmin' }, { profile: { role: 'owner' } }, { app_metadata: { role: 'owner' } }];
    for (const [index, metadata] of mutations.entries()) {
      success(await request(SUPABASE, '/auth/v1/user', { method: 'PUT', token: first.token, body: { data: metadata } }), 'editable_metadata_update');
      const user = userPayload(success(await request(SUPABASE, '/auth/v1/user', { token: first.token }), 'editable_metadata_readback'));
      requireProof(user?.id === first.id && user.app_metadata?.role === 'member', 'server_role_changed');
      for (const key of Object.keys(metadata)) requireProof(same(user.user_metadata?.[key], metadata[key]), 'metadata_update_not_observed');
      await memberDenied(first, `editable_metadata_case_${index + 1}_denied`);
    }

    for (const identity of identities) {
      const sessionId = randomUUID();
      const marker = `phase1-72:${config.run}:${randomUUID()}`;
      const rows = [
        { table: TABLES[0], row: { id: sessionId, client_id_hash: createHash('sha256').update(marker).digest('hex'), metadata: { phase1_qa_run: config.run } }, markerKey: 'client_id_hash' },
        { table: TABLES[1], row: { id: randomUUID(), session_id: sessionId, role: 'user', content: marker, source: 'phase1-72-qa' }, markerKey: 'session_id' },
        { table: TABLES[2], row: { id: randomUUID(), visitor_id: marker, messages: [{ role: 'user', content: marker }] }, markerKey: 'visitor_id' },
      ];
      identity.sessionId = sessionId;
      identity.message = rows[1].row;
      for (const fixture of rows) {
        const before = await adminRead(fixture.table, `id=eq.${fixture.row.id}&select=id&limit=1`);
        requireProof(before.length === 0, 'fixture_already_exists');
        fixtures.push(fixture);
        receipt.temporaryRows.push({ table: fixture.table, id: fixture.row.id, createConfirmed: false });
        save();
        success(await rest(fixture.table, '', { method: 'POST', admin: true, body: fixture.row }), 'fixture_insert');
        receipt.temporaryRows.at(-1).createConfirmed = true;
        save();
      }
    }

    for (const table of TABLES) {
      const ownFixtures = fixtures.filter(fixture => fixture.table === table);
      const filter = `id=in.(${ownFixtures.map(fixture => fixture.row.id).join(',')})&select=id&limit=2`;
      for (const subject of [{ label: 'anonymous' }, { label: 'owner_direct_rest', token: ownerToken }, ...identities]) {
        const denial = await rest(table, filter, { token: subject.token });
        requireProof([401, 403].includes(denial.status) && denial.data?.code === '42501', 'private_read_denial_not_proven');
        pass(`${table}_${subject.label}_direct_read_denied`, { http: denial.status, code: '42501' });
      }
      for (const fixture of ownFixtures) {
        const select = Object.keys(fixture.row).join(',');
        const rows = await adminRead(table, `id=eq.${fixture.row.id}&select=${select}&limit=1`);
        requireProof(rows.length === 1, 'private_row_missing');
        for (const [key, value] of Object.entries(fixture.row)) requireProof(same(rows[0][key], value), 'private_persistence_mismatch');
      }
      pass(`${table}_backend_persistence_preserved`, { temporaryRows: 2 });
    }

    for (const identity of identities) {
      for (const read of ['initial', 'reload']) {
        const history = success(await request(API, `/api/public/chat/history?sessionId=${identity.sessionId}&limit=2`), 'deployed_chat_history');
        requireProof(history?.ok === true && history.persistence === 'supabase' && history.sessionId === identity.sessionId, 'shared_chat_history_not_proven');
        requireProof(history.messages?.length === 1 && history.messages[0].id === identity.message.id && history.messages[0].content === identity.message.content, 'history_mixed_or_missing');
        pass(`visitor_${identity.label}_history_${read}`, { http: 200, persistence: 'supabase', messages: 1 });
      }
    }
    await ownerAllowed('real_owner_allowed_after');
    await checkDeployment('deployed_commit_after');
    receipt.acceptancePassed = true;
  } catch (error) {
    receipt.errors.push(error instanceof ProofError ? error.message : 'unexpected_proof_error');
  } finally {
    cleaning = true;
    // Each deletion is restricted to this run's predeclared IDs plus its ownership marker.
    for (const fixture of [...fixtures].reverse()) {
      await cleanupStep(`${fixture.table}:${fixture.row.id}`, async () => {
        success(await rest(fixture.table, fixtureFilter(fixture), { method: 'DELETE', admin: true }), 'fixture_delete');
        const rows = await adminRead(fixture.table, `id=eq.${fixture.row.id}&select=id&limit=1`);
        requireProof(rows.length === 0, 'fixture_cleanup_incomplete');
        const entry = receipt.temporaryRows.find(value => value.id === fixture.row.id && value.table === fixture.table);
        requireProof(entry.createConfirmed, 'fixture_create_outcome_uncertain');
      });
    }
    for (const identity of [...identities].reverse()) {
      if (identity.token) await cleanupStep(`member_${identity.label}_session_logout`, async () => {
        success(await request(SUPABASE, '/auth/v1/logout?scope=global', { method: 'POST', token: identity.token }), 'member_logout');
      });
      await cleanupStep(`member_${identity.label}_identity_and_rows`, async () => {
        const response = await request(SUPABASE, `/auth/v1/admin/users/${identity.id}`, { admin: true });
        const entry = receipt.temporaryIdentities.find(value => value.id === identity.id);
        if (response.status !== 404) {
          const user = userPayload(success(response, 'cleanup_identity_read'));
          requireProof(user?.id === identity.id && user.email === identity.email && user.app_metadata?.phase1_qa_run === config.run, 'cleanup_identity_marker_mismatch');
          success(await request(SUPABASE, `/auth/v1/admin/users/${identity.id}`, { method: 'DELETE', admin: true }), 'cleanup_identity_delete');
        }
        const memberFilter = `auth_user_id=eq.${identity.id}&email=eq.${encodeURIComponent(identity.email)}`;
        success(await rest('members', memberFilter, { method: 'DELETE', admin: true }), 'cleanup_member_delete');
        requireProof((await adminRead('members', `${memberFilter}&select=member_id&limit=1`)).length === 0, 'member_cleanup_incomplete');
        requireProof((await adminRead('profiles', `id=eq.${identity.id}&select=id&limit=1`)).length === 0, 'profile_cleanup_incomplete');
        const absent = await request(SUPABASE, `/auth/v1/admin/users/${identity.id}`, { admin: true });
        requireProof(absent.status === 404 && entry.createConfirmed, 'identity_cleanup_unconfirmed');
      });
    }
    if (ownerToken) await cleanupStep('owner_qa_session_logout_only', async () => {
      // Local scope revokes only the session opened by this run, not the owner's other sessions.
      success(await request(SUPABASE, '/auth/v1/logout?scope=local', { method: 'POST', token: ownerToken }), 'owner_qa_logout');
    });
    receipt.result = receipt.acceptancePassed && receipt.errors.length === 0 && receipt.cleanup.every(step => step.result === 'PASS') ? 'PASS' : 'FAIL';
    receipt.finishedAt = now();
    save();
  }
  return receipt;
}

async function main() {
  const dir = resolve('qa-results/phase1-owner-isolation');
  mkdirSync(dir, { recursive: true });
  const receiptPath = resolve(dir, 'receipt.json');
  const receipt = await runProof({
    consent: process.env.IVX_PHASE1_HOSTED_QA,
    targetSha: process.env.IVX_TARGET_SHA, qaSourceSha: process.env.IVX_QA_SOURCE_SHA,
    run: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
    apiBase: API, supabaseUrl: process.env.SUPABASE_URL,
    ownerEmail: process.env.IVX_QA_OWNER_EMAIL, ownerPassword: process.env.IVX_QA_OWNER_PASSWORD,
    anonKey: process.env.SUPABASE_ANON_KEY, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }, { checkpoint: value => writeFileSync(receiptPath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }) });
  console.log(JSON.stringify(receipt));
  if (receipt.result !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('PHASE1_OWNER_ISOLATION_UNEXPECTED_ERROR'); process.exitCode = 1; });
}
