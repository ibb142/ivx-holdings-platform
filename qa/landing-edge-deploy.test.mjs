import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../expo/deploy-s3-direct.mjs', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('async function ensureWwwRedirectFunction()'), source.indexOf('\nconst LANDING_DIR'));
const commands = ['DescribeFunction', 'UpdateFunction', 'CreateFunction', 'PublishFunction'];

function fixture(respond) {
  const calls = [];
  const context = { Buffer, cf: { send: async (command) => {
    calls.push(command);
    return respond(command);
  } } };
  for (const name of commands) context[`${name}Command`] = class {
    constructor(input) { this.kind = name; this.input = input; }
  };
  const ensure = vm.runInNewContext(`${functionSource}; ensureWwwRedirectFunction`, context);
  return { ensure, calls };
}

const version = (etag) => ({ ETag: etag, FunctionSummary: { FunctionMetadata: { FunctionARN: 'arn:aws:cloudfront::123:function/ivx-www-to-apex' } } });

test('creates and publishes after the documented NoSuchFunctionExists response', async () => {
  const f = fixture((c) => {
    if (c.kind === 'DescribeFunction') throw Object.assign(new Error('missing'), { name: 'NoSuchFunctionExists' });
    return version('created-version');
  });
  assert.match(await f.ensure(), /ivx-www-to-apex$/);
  assert.deepEqual(f.calls.map(c => c.kind), ['DescribeFunction', 'CreateFunction', 'PublishFunction']);
  assert.equal(f.calls[2].input.IfMatch, 'created-version');
});

test('updates the existing version and publishes its returned ETag', async () => {
  const f = fixture(c => version(c.kind === 'DescribeFunction' ? 'old-version' : 'new-version'));
  await f.ensure();
  assert.deepEqual(f.calls.map(c => c.kind), ['DescribeFunction', 'UpdateFunction', 'PublishFunction']);
  assert.equal(f.calls[1].input.IfMatch, 'old-version');
  assert.equal(f.calls[2].input.IfMatch, 'new-version');
});

test('does not treat permission failure as a missing function', async () => {
  const f = fixture(() => { throw Object.assign(new Error('denied'), { name: 'AccessDenied' }); });
  await assert.rejects(f.ensure, /denied/);
  assert.equal(f.calls.length, 1);
});

test('does not publish an incomplete function version', async () => {
  const f = fixture(() => ({}));
  await assert.rejects(f.ensure, /version or ARN missing/);
  assert.equal(f.calls.some(c => c.kind === 'PublishFunction'), false);
});

test('viewer redirect preserves the path and repeated campaign parameters', async () => {
  const f = fixture(() => version('etag'));
  await f.ensure();
  const code = f.calls.find(c => c.kind === 'UpdateFunction').input.FunctionCode.toString();
  const handler = vm.runInNewContext(`${code}; handler`);
  const request = { uri: '/deals/one', headers: { host: { value: 'www.ivxholding.com' } }, querystring: {
    utm_source: { value: 'paid%20search' }, tag: { multiValue: [{ value: 'a' }, { value: 'b' }] }
  } };
  const response = handler({ request });
  assert.equal(response.statusCode, 301);
  assert.equal(response.headers.location.value, 'https://ivxholding.com/deals/one?utm_source=paid%20search&tag=a&tag=b');
  request.headers.host.value = 'ivxholding.com';
  assert.equal(handler({ request }), request);
});

test('places CSP in the AWS security-header field, with custom header quantity matching', () => {
  const declaration = source.match(/const policyConfig = (\{[\s\S]+?\n  \});/)[1];
  const policy = vm.runInNewContext(`(${declaration})`, { POLICY_NAME: 'test-policy' });
  assert.equal(policy.CustomHeadersConfig.Quantity, policy.CustomHeadersConfig.Items.length);
  assert.equal(policy.CustomHeadersConfig.Items.some(h => h.Header.toLowerCase() === 'content-security-policy'), false);
  assert.match(policy.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy, /default-src 'self'/);
  assert.equal(policy.SecurityHeadersConfig.ContentSecurityPolicy.Override, true);
});
