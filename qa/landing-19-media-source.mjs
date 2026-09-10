// Read-only diagnosis of the exact object referenced by the public Casa reel.
// This diagnostic never sets a QA unit to PASS or changes storage permissions.
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import assert from 'node:assert/strict';
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.log(JSON.stringify({ inspected: false, reason: 'Owner-managed S3 credentials unavailable' }));
  process.exit(0);
}
const identity = await new STSClient({ region: 'us-east-1' }).send(new GetCallerIdentityCommand({}));
assert.equal(identity.Account, '206818124217', 'Expected the existing IVX deployment account');
const s3 = new S3Client({ region: 'us-east-1', forcePathStyle: true });
const object = { Bucket: 'ivxholding.com', Key: 'videos/original/b8788d0c-0558-43fb-a3dd-4ccdc6f441c8/casa-rosario.mp4' };
try {
  const metadata = await s3.send(new HeadObjectCommand(object));
  const prefix = await s3.send(new GetObjectCommand({ ...object, Range: 'bytes=0-63' }));
  const bytes = Buffer.from(await prefix.Body.transformToByteArray());
  console.log(JSON.stringify({ inspected: true, exists: true, contentType: metadata.ContentType, bytes: metadata.ContentLength, mp4Signature: bytes.subarray(4, 8).toString() === 'ftyp' }));
} catch (error) {
  console.log(JSON.stringify({ inspected: true, exists: error.$metadata?.httpStatusCode === 404 ? false : null, httpStatus: error.$metadata?.httpStatusCode, error: error.name }));
}
