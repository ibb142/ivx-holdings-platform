import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { findReturnGuaranteeClaims } from '../../qa/landing-copy-assertions.mjs';

const source = readFileSync(new URL('../../expo/deploy-s3-direct.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../expo/ivxholding-landing/index.html', import.meta.url), 'utf8');
const e2eWorkflow = readFileSync(new URL('../../.github/workflows/ivx-e2e.yml', import.meta.url), 'utf8');
const qaWorkflow = readFileSync(new URL('../../.github/workflows/ivx-qa-suite.yml', import.meta.url), 'utf8');
// Execute the actual deployment functions with mocked AWS commands. Never run
// the deployment entrypoint or load credentials in this regression suite.
const helperStart = source.indexOf('async function ensureWwwRedirectFunction()');
const helperEnd = source.indexOf('const LANDING_DIR =');
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const helpers = source.slice(helperStart, helperEnd);
const commandNames = ['DescribeFunctionCommand', 'UpdateFunctionCommand', 'CreateFunctionCommand', 'PublishFunctionCommand', 'GetInvalidationCommand'];

function runtime(send, options = {}) {
  const commands = Object.fromEntries(commandNames.map((kind) => [kind, class {
    constructor(input) { this.kind = kind; this.input = input; }
  }]));
  return vm.runInNewContext(`${helpers}\n({ensureWwwRedirectFunction, waitForCompletedInvalidation})`, {
    ...commands, cf: { send }, Buffer, DIST_ID: 'test-distribution',
    setTimeout: (resolve) => resolve(), ...options,
  });
}

test('creates and publishes a genuinely missing CloudFront function', async () => {
  const calls = [];
  const api = runtime(async (command) => {
    calls.push(command);
    if (command.kind === 'DescribeFunctionCommand') throw Object.assign(new Error('missing'), { name: 'NoSuchFunctionExists' });
    if (command.kind === 'CreateFunctionCommand') return { ETag: 'created-etag', FunctionSummary: { FunctionMetadata: { FunctionARN: 'test-arn' } } };
    assert.equal(command.kind, 'PublishFunctionCommand');
    assert.equal(command.input.IfMatch, 'created-etag');
    return { FunctionSummary: { FunctionMetadata: { FunctionARN: 'test-arn' } } };
  });
  assert.equal(await api.ensureWwwRedirectFunction(), 'test-arn');
  assert.deepEqual(calls.map((call) => call.kind), ['DescribeFunctionCommand', 'CreateFunctionCommand', 'PublishFunctionCommand']);
  const code = calls[1].input.FunctionCode.toString('utf8');
  const handler = vm.runInNewContext(`${code}\nhandler`);
  const response = handler({ request: {
    headers: { host: { value: 'WWW.IVXHOLDING.COM' } }, uri: '/deals',
    querystring: { utm_source: { value: 'email%20campaign' }, tag: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b' }] } },
  } });
  assert.equal(response.statusCode, 301);
  assert.equal(response.headers.location.value, 'https://ivxholding.com/deals?utm_source=email%20campaign&tag=a&tag=b');
  const apex = { headers: { host: { value: 'ivxholding.com' } }, uri: '/', querystring: {} };
  assert.equal(handler({ request: apex }), apex);
  assert.equal(handler({ request: { ...apex, headers: { host: { value: 'www.ivxholding.com' } } } }).headers.location.value, 'https://ivxholding.com/');
});

test('updates an existing redirect using the returned ETag before publishing', async () => {
  const calls = [];
  const api = runtime(async (command) => {
    calls.push(command);
    if (command.kind === 'DescribeFunctionCommand') return { ETag: 'old', FunctionSummary: { FunctionMetadata: { FunctionARN: 'test-arn' } } };
    if (command.kind === 'UpdateFunctionCommand') {
      assert.equal(command.input.IfMatch, 'old');
      return { ETag: 'new' };
    }
    assert.equal(command.input.IfMatch, 'new');
    return {};
  });
  assert.equal(await api.ensureWwwRedirectFunction(), 'test-arn');
  assert.deepEqual(calls.map((call) => call.kind), ['DescribeFunctionCommand', 'UpdateFunctionCommand', 'PublishFunctionCommand']);
});

test('an authorization failure never falls back to creating a function', async () => {
  let calls = 0;
  const denied = Object.assign(new Error('denied'), { name: 'AccessDenied' });
  const api = runtime(async () => { calls++; throw denied; });
  await assert.rejects(api.ensureWwwRedirectFunction(), (error) => error === denied);
  assert.equal(calls, 1);
});

test('invalidation waits for actual Completed status', async () => {
  let reads = 0;
  const api = runtime(async (command) => {
    assert.equal(command.kind, 'GetInvalidationCommand');
    assert.equal(command.input.Id, 'test-invalidation');
    return { Invalidation: { Status: ++reads === 2 ? 'Completed' : 'InProgress' } };
  });
  await api.waitForCompletedInvalidation('test-invalidation', 'InProgress');
  assert.equal(reads, 2);
  await api.waitForCompletedInvalidation('already-done', 'Completed');
  assert.equal(reads, 2);
});

test('missing invalidation ID, denied access and timeout cannot certify a deploy', async () => {
  const denied = new Error('GetInvalidation denied');
  const api = runtime(async () => { throw denied; });
  await assert.rejects(api.waitForCompletedInvalidation('', 'Completed'), /missing an ID/);
  await assert.rejects(api.waitForCompletedInvalidation('test', 'InProgress'), (error) => error === denied);
  let now = 0;
  const timed = runtime(async () => ({ Invalidation: { Status: 'InProgress' } }), {
    Date: { now: () => now }, setTimeout: (resolve) => { now += 300_000; resolve(); },
  });
  await assert.rejects(timed.waitForCompletedInvalidation('test', 'InProgress'), /did not complete/);
});

test('security headers use the AWS security schema and match the effective meta CSP', () => {
  const config = source.match(/const policyConfig = (\{[\s\S]*?\n  \});/);
  assert.ok(config);
  const policy = vm.runInNewContext(`(${config[1]})`, { POLICY_NAME: 'test-policy' });
  assert.equal(policy.CustomHeadersConfig.Items.some((header) => header.Header.toLowerCase() === 'content-security-policy'), false);
  assert.equal(policy.CustomHeadersConfig.Quantity, policy.CustomHeadersConfig.Items.length);
  const csp = policy.SecurityHeadersConfig.ContentSecurityPolicy;
  assert.equal(csp.Override, true);
  assert.match(csp.ContentSecurityPolicy, /frame-ancestors 'none'/);
  assert.equal(policy.SecurityHeadersConfig.FrameOptions.FrameOption, 'DENY');
  assert.equal(policy.SecurityHeadersConfig.ContentTypeOptions.Override, true);
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(meta, csp.ContentSecurityPolicy.replace(/ frame-ancestors 'none';/, ''));
  assert.doesNotMatch(html, /<meta http-equiv="X-Frame-Options"/);
  assert.doesNotMatch(meta, /frame-ancestors/);
  assert.match(meta, /https:\/\/ivx-holdings-platform\.onrender\.com/);
  assert.doesNotMatch(meta, /ipapi\.co/);
});

test('a standalone negative disclosure is not a positive return promise', () => {
  assert.deepEqual(findReturnGuaranteeClaims('Investor disclosures\nNo guaranteed returns\nLoss of principal is possible.'), []);
  assert.deepEqual(findReturnGuaranteeClaims('NO GUARANTEED ROI.\nNo guaranteed profits!'), []);
});

test('negative headings do not hide positive promises elsewhere or in the same line', () => {
  assert.equal(findReturnGuaranteeClaims('No guaranteed returns\nInvest for guaranteed profits today.').length, 1);
  assert.equal(findReturnGuaranteeClaims('No guaranteed returns, except guaranteed ROI.').length, 2);
  assert.equal(findReturnGuaranteeClaims('Guaranteed return\nGuaranteed returns\nGuaranteed profit\nGuaranteed ROI').length, 4);
});

test('APK certification remains fail-closed and blocked geolocation is not requested', () => {
  const ui = readFileSync(new URL('../../expo/ivxholding-landing/ivx-ui-utils.js', import.meta.url), 'utf8');
  assert.match(ui, /gateStaleApkLinks/);
  const app = readFileSync(new URL('../../expo/ivxholding-landing/ivx-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /fetch\(['"]https:\/\/ipapi\.co/);
  const qa = readFileSync(new URL('../../qa/landing-live-e2e-agent.mjs', import.meta.url), 'utf8');
  assert.match(qa, /record\('apk-link-present', Boolean\(href\)/);
});

test('the static landing deploy path does not trigger an unrelated mobile build', () => {
  assert.match(e2eWorkflow, /expo\/ivxholding-landing\/\*\|expo\/deploy-s3-direct\.mjs\|qa\/landing-\*\|scripts\/__tests__\/ivx-landing-\*/);
  assert.match(e2eWorkflow, /expo\/\*\|package\.json\|bun\.lock\|bun\.lockb\|tsconfig\.json\) mobile=true/);
  assert.match(qaWorkflow, /expo\/ivxholding-landing\/\*\|expo\/deploy-s3-direct\.mjs\|qa\/landing-\*\|scripts\/__tests__\/ivx-landing-\*/);
  assert.match(qaWorkflow, /expo\/\*\|package\.json\|bun\.lock\|bun\.lockb\|tsconfig\.json\) expo=true/);
  assert.match(qaWorkflow, /if: steps\.impact\.outputs\.expo == 'true'/);
  assert.match(qaWorkflow, /expo_tests=SKIPPED_NO_EXPO_APP_CHANGES/);
});
