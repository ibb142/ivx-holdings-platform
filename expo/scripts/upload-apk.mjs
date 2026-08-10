#!/usr/bin/env node
/**
 * Upload a built APK to S3 for public download.
 * Uses AWS Signature v4 with raw fetch (no external AWS SDK needed).
 */
import { readFileSync, statSync } from 'fs';
import { createHmac, createHash } from 'crypto';

const APK_PATH = process.argv[2] || '/home/user/rork-app/expo/android/app/build/outputs/apk/release/app-release.apk';
const S3_KEY = process.argv[3] || 'apk/ivx-holdings-v1.4.5.apk';
const BUCKET = 'ivxholding.com';
const REGION = process.env.AWS_REGION || 'us-east-1';
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

console.log('[Upload APK] Starting...');
console.log('[Upload APK] APK path:', APK_PATH);
console.log('[Upload APK] S3 key:', S3_KEY);
console.log('[Upload APK] AWS_ACCESS_KEY_ID:', ACCESS_KEY ? ACCESS_KEY.substring(0, 12) + '...' : 'MISSING');
console.log('[Upload APK] AWS_SECRET_ACCESS_KEY:', SECRET_KEY ? `set (${SECRET_KEY.length} chars)` : 'MISSING');
console.log('[Upload APK] AWS_REGION:', REGION);

if (!ACCESS_KEY || !SECRET_KEY) {
  console.error('[Upload APK] FATAL: AWS credentials not found in environment');
  process.exit(1);
}

// SHA256 hash of empty string (for unsigned payload)
const EMPTY_HASH = createHash('sha256').update('').digest('hex');

function getSignatureKey(key, dateStamp, region, service) {
  const kDate = createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  return kSigning;
}

async function uploadToS3() {
  const fileData = readFileSync(APK_PATH);
  const fileSize = statSync(APK_PATH).size;
  console.log(`[Upload APK] File size: ${(fileSize / (1024 * 1024)).toFixed(1)} MB`);

  const now = new Date();
  // ISO basic format: 20260725T165313Z (no milliseconds, single Z)
  const iso = now.toISOString();
  const amzDate = iso.replace(/[:.-]/g, '').replace(/\d{3}Z$/, 'Z');
  const dateStamp = amzDate.substring(0, 8);

  // Use path-style addressing — required when bucket name contains a dot
  // (virtual-hosted style fails TLS cert validation for dotted bucket names)
  const host = `s3.${REGION}.amazonaws.com`;
  const url = `https://${host}/${BUCKET}/${S3_KEY}`;

  // For PUT with body, we need to hash the payload
  const payloadHash = createHash('sha256').update(fileData).digest('hex');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    `/${S3_KEY}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalHash = createHash('sha256').update(canonicalRequest).digest('hex');
  const credentialScope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalHash,
  ].join('\n');

  const signingKey = getSignatureKey(SECRET_KEY, dateStamp, REGION, 's3');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  console.log('[Upload APK] Uploading to:', url);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorization,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${S3_KEY.split('/').pop()}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
    body: fileData,
  });

  if (response.ok) {
    console.log('[Upload APK] SUCCESS! Status:', response.status);
    console.log('[Upload APK] ETag:', response.headers.get('etag'));
    console.log('[Upload APK] Download URL: https://ivxholding.com/' + S3_KEY);
    return true;
  } else {
    const body = await response.text();
    console.error('[Upload APK] FAILED! Status:', response.status);
    console.error('[Upload APK] Response:', body);
    return false;
  }
}

uploadToS3().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('[Upload APK] Error:', err);
  process.exit(1);
});
