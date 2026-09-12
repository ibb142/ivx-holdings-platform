// Publishes the explicitly requested, visibly labelled QA clip to one missing key.
// This is not a recovered property tour and does not certify production acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { CloudFrontClient, GetDistributionCommand, CreateInvalidationCommand, GetInvalidationCommand } from '@aws-sdk/client-cloudfront';

const ACCOUNT = '206818124217';
const BUCKET = 'ivxholding.com';
const KEY = 'videos/original/b8788d0c-0558-43fb-a3dd-4ccdc6f441c8/casa-rosario.mp4';
const DISTRIBUTION = 'E1C0DEI0VKCUYN';
const EXPECTED_HASH = 'a52d9d83ace9c8c2d83ea3e7edda99ad591dd34c025e533093b5e7da88bf2c9c';
const asset = new URL('../../qa/fixtures/casa-rosario-temporary-20260912.mp4', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const send = (client, command) => client.send(command, { abortSignal: AbortSignal.timeout(10_000) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const receipt = { temporary: true, originalTourRestored: false, phase4Certified: false,
  key: KEY, sourceSha: process.env.GITHUB_SHA ?? null, sha256: EXPECTED_HASH,
  uploaded: false, existingExactClip: false, signedBytesVerified: false, publicBytesVerified: false };
let stage = 'local-binary';

try {
  const mode = process.argv[2];
  assert.ok(['--verify-local', '--publish-authorized-temporary'].includes(mode), 'Explicit operation required');
  const bytes = await readFile(asset);
  assert.equal(bytes.length, 72238, 'Unexpected clip size');
  assert.equal(hash(bytes), EXPECTED_HASH, 'Unexpected clip digest');
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp', 'MP4 signature missing');
  if (mode === '--verify-local') {
    console.log(JSON.stringify({ localBinaryVerified: true, bytes: bytes.length, sha256: EXPECTED_HASH,
      temporary: true, originalTourRestored: false }));
  } else {
    assert.ok(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY, 'Existing AWS secret binding required');
    const settings = { region: 'us-east-1', maxAttempts: 1 };
    const sts = new STSClient(settings);
    const s3 = new S3Client({ ...settings, forcePathStyle: true });
    const cf = new CloudFrontClient(settings);
    const object = { Bucket: BUCKET, Key: KEY, ExpectedBucketOwner: ACCOUNT };
    stage = 'aws-identity';
    assert.equal((await send(sts, new GetCallerIdentityCommand({}))).Account, ACCOUNT, 'AWS account mismatch');
    stage = 'distribution-preflight';
    const distribution = await send(cf, new GetDistributionCommand({ Id: DISTRIBUTION }));
    assert.ok(distribution.Distribution?.DistributionConfig?.Aliases?.Items?.includes('ivxholding.com'), 'Distribution alias mismatch');
    assert.ok(distribution.Distribution?.DistributionConfig?.Origins?.Items?.some(origin =>
      origin.DomainName?.startsWith(BUCKET + '.s3') && origin.DomainName.endsWith('.amazonaws.com')), 'Distribution origin mismatch');

    stage = 'object-preflight';
    let existing = null;
    try { existing = await send(s3, new HeadObjectCommand(object)); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
    if (existing) {
      // Never replace a recovered original, a competing upload, or unrelated bytes.
      assert.equal(existing.ContentLength, bytes.length, 'Existing object differs; replacement refused');
      assert.equal(existing.Metadata?.['qa-temporary'], 'true', 'Existing object is not this temporary clip');
      assert.equal(existing.Metadata?.['sha256'], EXPECTED_HASH, 'Existing object digest differs');
      receipt.existingExactClip = true;
    } else {
      stage = 'conditional-upload';
      const uploaded = await send(s3, new PutObjectCommand({ ...object, Body: bytes,
        IfNoneMatch: '*', ContentType: 'video/mp4', ContentLength: bytes.length,
        CacheControl: 'public, max-age=60, must-revalidate',
        ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
        Metadata: { 'qa-temporary': 'true', 'original-tour-restored': 'false', sha256: EXPECTED_HASH } }));
      receipt.uploaded = true;
      receipt.versionId = uploaded.VersionId ?? null;
    }
    stage = 'signed-readback';
    const stored = await send(s3, new GetObjectCommand(object));
    assert.equal(stored.ContentType, 'video/mp4', 'Stored MIME mismatch');
    assert.equal(stored.ContentLength, bytes.length, 'Stored size mismatch');
    assert.equal(hash(Buffer.from(await stored.Body.transformToByteArray())), EXPECTED_HASH, 'Stored bytes mismatch');
    receipt.signedBytesVerified = true;

    stage = 'single-path-invalidation';
    const invalidation = await send(cf, new CreateInvalidationCommand({ DistributionId: DISTRIBUTION,
      InvalidationBatch: { CallerReference: 'phase4-casa-temporary-' + EXPECTED_HASH,
        Paths: { Quantity: 1, Items: ['/' + KEY] } } }));
    receipt.invalidationId = invalidation.Invalidation?.Id;
    assert.ok(receipt.invalidationId, 'Invalidation receipt missing');
    let edgeStatus = invalidation.Invalidation.Status;
    for (let attempt = 0; edgeStatus !== 'Completed' && attempt < 12; attempt++) {
      await pause(15_000);
      edgeStatus = (await send(cf, new GetInvalidationCommand({ DistributionId: DISTRIBUTION,
        Id: receipt.invalidationId }))).Invalidation?.Status;
    }
    assert.equal(edgeStatus, 'Completed', 'Invalidation still pending');
    stage = 'public-readback';
    const response = await fetch('https://ivxholding.com/' + KEY, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, 'Public media unavailable');
    assert.equal(response.headers.get('content-type')?.split(';')[0], 'video/mp4', 'Public media MIME mismatch');
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), EXPECTED_HASH, 'Public bytes mismatch');
    receipt.publicBytesVerified = true;
  }
} catch (error) {
  process.exitCode = 1;
  receipt.error = { stage, code: error.name ?? 'Error', httpStatus: error.$metadata?.httpStatusCode ?? null,
    reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Operation did not complete; inspect this stage before retrying' };
} finally {
  receipt.completedAt = new Date().toISOString();
  await mkdir('qa/evidence/casa-temporary-video', { recursive: true });
  await writeFile('qa/evidence/casa-temporary-video/receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
