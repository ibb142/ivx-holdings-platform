// Read-only diagnosis of the exact object referenced by the public Casa reel.
// This diagnostic never sets a QA unit to PASS or changes storage permissions.
import { S3Client, HeadObjectCommand, GetObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import assert from 'node:assert/strict';
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.log(JSON.stringify({ inspected: false, reason: 'Owner-managed S3 credentials unavailable' }));
  process.exit(0);
}
const identity = await new STSClient({ region: 'us-east-1' }).send(new GetCallerIdentityCommand({}));
assert.equal(identity.Account, '206818124217', 'Expected the existing IVX deployment account');
const s3 = new S3Client({ region: 'us-east-1', forcePathStyle: true });
// Both exact keys are registered to Casa Rosario in project_videos/project_media.
// Do not scan unrelated objects, recover a version automatically, or label a
// header signature as decoded playback. A bounded listing is not an inventory.
const keys = [
  'videos/original/b8788d0c-0558-43fb-a3dd-4ccdc6f441c8/casa-rosario.mp4',
  'media/casa-rosario/casa-rosario-tour-1080p.mp4',
];
const failure = error => ({ httpStatus: error.$metadata?.httpStatusCode, error: error.name });
for (const Key of keys) {
  const object = { Bucket: 'ivxholding.com', Key };
  try {
    const metadata = await s3.send(new HeadObjectCommand(object));
    const prefix = await s3.send(new GetObjectCommand({ ...object, Range: 'bytes=0-63' }));
    const bytes = Buffer.from(await prefix.Body.transformToByteArray());
    console.log(JSON.stringify({ key: Key, inspected: true, exists: true, contentType: metadata.ContentType, bytes: metadata.ContentLength, mp4Signature: bytes.subarray(4, 8).toString() === 'ftyp' }));
  } catch (error) {
    console.log(JSON.stringify({ key: Key, inspected: true, exists: error.$metadata?.httpStatusCode === 404 ? false : null, ...failure(error) }));
    if (error.$metadata?.httpStatusCode !== 404) continue;
    try {
      const history = await s3.send(new ListObjectVersionsCommand({ Bucket: object.Bucket, Prefix: Key, MaxKeys: 20 }));
      const versions = (history.Versions || []).filter(v => v.Key === Key);
      const candidates = [];
      for (const version of versions.slice(0, 3)) {
        const candidate = { versionId: version.VersionId, bytes: version.Size, lastModified: version.LastModified, isLatest: version.IsLatest };
        try {
          const prefix = await s3.send(new GetObjectCommand({ ...object, VersionId: version.VersionId, Range: 'bytes=0-63' }));
          const bytes = Buffer.from(await prefix.Body.transformToByteArray());
          Object.assign(candidate, { contentType: prefix.ContentType, mp4Signature: bytes.subarray(4, 8).toString() === 'ftyp' });
        } catch (error) { Object.assign(candidate, failure(error)); }
        candidates.push(candidate);
      }
      console.log(JSON.stringify({ key: Key, historicalLookup: true, listingTruncated: history.IsTruncated === true,
        exactVersionsListed: versions.length, versionsInspected: candidates,
        deleteMarkers: (history.DeleteMarkers || []).filter(v => v.Key === Key).map(v => ({ versionId: v.VersionId, lastModified: v.LastModified, isLatest: v.IsLatest })),
        modifiedObjects: 0 }));
    } catch (error) {
      console.log(JSON.stringify({ key: Key, historicalLookup: false, ...failure(error), modifiedObjects: 0 }));
    }
  }
}
