import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBudgetReconciliationOptions, runBudgetReconciliationCli } from './reconcile-uncertain-budget-cli.mjs';

const IDS = ['48dddee7-1602-403a-8520-9e5170eae70f', 'a8ea75f1-40fa-4ddf-99cc-acb422a47086'];
const ARGS = [`--reservation-ids=${IDS.join(',')}`];
const ENV = {
  IVX_BUDGET_RECONCILIATION_DATABASE_URL: 'postgres://postgres:TEST_ONLY@db.kvclcdjmjghndxsngfzb.supabase.co/postgres',
  AI_GATEWAY_API_KEY: 'vck_TEST_ONLY_PROVIDER_KEY',
};

function harness(overrides = {}) {
  const seen = { created: 0, connected: 0, ended: 0, verifierCalls: [], stdout: [], stderr: [] };
  const client = {
    async connect() { seen.connected++; },
    async end() { seen.ended++; },
  };
  const options = {
    argv: ARGS,
    env: ENV,
    createClient(config) { seen.created++; seen.config = config; return client; },
    async reconcile(input) {
      seen.verifierCalls.push(input);
      return { state: 'DRY_RUN', blocked: [] };
    },
    log(value) { seen.stdout.push(value); },
    error(value) { seen.stderr.push(value); },
    ...overrides,
  };
  return { seen, client, run: () => runBudgetReconciliationCli(options) };
}

test('only --apply selects live execution; DRY_RUN=false cannot turn a preview into a write', async () => {
  const h = harness({ env: { ...ENV, DRY_RUN: 'false' } });
  assert.equal(await h.run(), 0);
  assert.equal(h.seen.verifierCalls[0].apply, false);
  assert.deepEqual(h.seen.verifierCalls[0].reservationIds, IDS);
  assert.equal(h.seen.verifierCalls[0].gatewayKey, ENV.AI_GATEWAY_API_KEY);
  assert.equal(h.seen.config.connectionTimeoutMillis, 5000);
  assert.equal(h.seen.config.statement_timeout, 4000);
  assert.equal(h.seen.ended, 1);
});

test('ambiguous or unknown arguments are rejected before client construction', async () => {
  const cases = [[], [...ARGS, '--commit=true'], [...ARGS, '--apply=false'], [...ARGS, '--dry-run'],
    [...ARGS, 'unexpected'], [...ARGS, '--apply', '--apply'], [...ARGS, ...ARGS]];
  for (const argv of cases) {
    const h = harness({ argv });
    assert.equal(await h.run(), 1);
    assert.equal(h.seen.created, 0);
    assert.equal(h.seen.verifierCalls.length, 0);
    assert.match(h.seen.stderr[0], /^INVALID_ARGUMENTS:/);
  }
});

test('cohorts require distinct full UUIDs and reject abbreviations, tasks, empty IDs and oversized batches', async () => {
  const oversized = Array.from({ length: 113 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
  for (const ids of ['48dddee7-...,a8ea75f1-...', 'task_example', '', `${IDS[0]},`,
    `${IDS[0]},${IDS[0].toUpperCase()}`, oversized.join(',')]) {
    const h = harness({ argv: [`--reservation-ids=${ids}`] });
    assert.equal(await h.run(), 1);
    assert.equal(h.seen.created, 0);
    assert.match(h.seen.stderr[0], /^INVALID_RESERVATION_IDS:/);
  }
  assert.deepEqual(parseBudgetReconciliationOptions([`--reservation-ids=${IDS[0].toUpperCase()}`], ENV)
    .reservationIds, [IDS[0]]);
});

test('project binding and provider credentials are checked without disclosing secrets or opening connections', async () => {
  const cases = [
    { ...ENV, IVX_BUDGET_RECONCILIATION_DATABASE_URL: '' },
    { ...ENV, AI_GATEWAY_API_KEY: ' ' },
    { ...ENV, AI_GATEWAY_API_KEY: 'PRIVATE_INVALID_PROVIDER_KEY' },
    { ...ENV, IVX_BUDGET_RECONCILIATION_DATABASE_URL: 'postgres://postgres:PRIVATE@db.other.supabase.co/postgres' },
    { ...ENV, IVX_BUDGET_RECONCILIATION_DATABASE_URL: 'not-a-url-PRIVATE' },
    { ...ENV, IVX_BUDGET_RECONCILIATION_DATABASE_URL: ENV.IVX_BUDGET_RECONCILIATION_DATABASE_URL.replace('postgres:', 'https:') },
    { ...ENV, IVX_BUDGET_RECONCILIATION_DATABASE_URL: 'postgres://postgres.other:PRIVATE@aws-0-us-east-1.pooler.supabase.com/postgres' },
  ];
  for (const env of cases) {
    const h = harness({ env });
    assert.equal(await h.run(), 1);
    assert.equal(h.seen.created, 0);
    assert.doesNotMatch(h.seen.stderr.join(''), /PRIVATE|TEST_ONLY/);
    assert.deepEqual(h.seen.stdout, []);
  }
  const pooler = { ...ENV, IVX_BUDGET_RECONCILIATION_DATABASE_URL:
    'postgres://postgres.kvclcdjmjghndxsngfzb:TEST_ONLY@aws-0-us-east-1.pooler.supabase.com:5432/postgres' };
  assert.equal(parseBudgetReconciliationOptions(ARGS, pooler).connectionString,
    pooler.IVX_BUDGET_RECONCILIATION_DATABASE_URL);
});

test('blocked previews, incomplete cohorts and lost acknowledgements return nonzero with evidence retained', async () => {
  const reports = [
    { state: 'DRY_RUN', blocked: [{ reservationId: IDS[0], reason: 'MISSING_PROVIDER_ID' }] },
    { state: 'INCOMPLETE', reconciledCount: 1 },
    { state: 'WRITE_UNCONFIRMED', reconciledCount: 0 },
  ];
  for (const report of reports) {
    const h = harness({ reconcile: async () => report });
    assert.equal(await h.run(), 1);
    assert.deepEqual(JSON.parse(h.seen.stdout[0]), report);
    assert.equal(h.seen.ended, 1);
  }
});

test('explicit --apply delegates settlement to the existing verifier and reports confirmed success', async () => {
  let input;
  const h = harness({ argv: [...ARGS, '--apply'], reconcile: async value => {
    input = value;
    return { state: 'COHORT_RECONCILED', reconciledCount: 2 };
  } });
  assert.equal(await h.run(), 0);
  assert.equal(input.apply, true);
  assert.deepEqual(input.reservationIds, IDS);
  assert.equal(h.seen.ended, 1);
  assert.equal(JSON.parse(h.seen.stdout[0]).reconciledCount, 2);
});

test('connection and verifier failures close the client once and do not disclose error secrets', async () => {
  const connectFailure = harness();
  connectFailure.client.connect = async () => { throw new Error('PRIVATE_DATABASE_CREDENTIAL'); };
  const verificationFailure = harness({ reconcile: async () => { throw new Error('PRIVATE_PROVIDER_KEY'); } });
  for (const h of [connectFailure, verificationFailure]) {
    assert.equal(await h.run(), 1);
    assert.equal(h.seen.ended, 1);
    assert.doesNotMatch(h.seen.stderr.join(''), /PRIVATE/);
    assert.deepEqual(h.seen.stdout, []);
  }
});

test('the executable rejects the submitted live alias and abbreviated cohort without credentials', () => {
  const entry = fileURLToPath(new URL('./reconcile-uncertain-budget.mjs', import.meta.url));
  for (const [argv, expected] of [
    [[...ARGS, '--commit=true'], /INVALID_ARGUMENTS:/],
    [['--reservation-ids=48dddee7-...,a8ea75f1-...'], /INVALID_RESERVATION_IDS:/],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...argv], { encoding: 'utf8', timeout: 5000,
      env: { ...process.env, IVX_BUDGET_RECONCILIATION_DATABASE_URL: '', AI_GATEWAY_API_KEY: '' } });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.equal(result.stdout, '');
  }
});
