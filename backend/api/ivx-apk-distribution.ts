/**
 * Owner-only distribution presign endpoint (APK/AAB releases + landing assets).
 *
 * Mints a short-lived (15 min) presigned S3 PUT URL restricted to either the
 * `apk/` prefix (release artifacts) or an explicit whitelist of top-level
 * landing-page files, so a build agent can upload WITHOUT AWS credentials
 * ever leaving the runtime.
 *
 * Guards:
 *  - Registered owner bearer required (assertIVXRegisteredOwnerBearer)
 *  - Explicit per-class confirmation phrase (409 without it):
 *      apk/<name>.(apk|aab)      -> CONFIRM_IVX_APK_UPLOAD
 *      landing whitelist file    -> CONFIRM_IVX_LANDING_UPLOAD
 *  - Secrets are never returned; only the signed URL is.
 */
import { createHash, createHmac } from 'node:crypto';

import { getRawOwnerVariableValue } from './ivx-owner-variables';
import { IVXOwnerApprovalError, assertIVXRegisteredOwnerBearer, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

const IVX_APK_UPLOAD_CONFIRM_PHRASE = 'CONFIRM_IVX_APK_UPLOAD';
const IVX_LANDING_UPLOAD_CONFIRM_PHRASE = 'CONFIRM_IVX_LANDING_UPLOAD';
const IVX_APK_KEY_PATTERN = /^apk\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(apk|aab)$/;
/** Top-level landing-page assets only — no prefixes, no traversal, tight extension set. */
const IVX_LANDING_KEY_PATTERN = /^(index\.html|reset-password\.html|robots\.txt|sitemap\.xml|ivx-[a-z0-9-]{1,60}\.(js|json)|landing-support-chat\.(js|css))$/;
const IVX_APK_PRESIGN_EXPIRES_SECONDS = 900;
const IVX_APK_BUCKET_DEFAULT = 'ivxholding.com';

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

type PresignInput = {
  bucket: string;
  region: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;
  now: Date;
};

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Build a SigV4 query-string presigned PUT URL (UNSIGNED-PAYLOAD, host-only
 * signed header). Pure and deterministic for a fixed `now` so it is unit-testable.
 *
 * Uses PATH-STYLE addressing (s3.<region>.amazonaws.com/<bucket>/<key>) because
 * bucket names containing dots (e.g. `ivxholding.com`) break TLS on the
 * virtual-hosted wildcard certificate (*.s3.<region>.amazonaws.com).
 */
export function buildIVXS3PresignedPutUrl(input: PresignInput): string {
  const amzDate = input.now.toISOString().replace(/[:.-]/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const host = `s3.${input.region}.amazonaws.com`;
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;

  const queryEntries: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const canonicalQuery = queryEntries
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&');

  const canonicalRequest = [
    'PUT',
    `/${input.bucket}/${input.key}`,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `https://${host}/${input.bucket}/${input.key}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function isValidIVXApkDistributionKey(key: string): boolean {
  return IVX_APK_KEY_PATTERN.test(key);
}

export function isValidIVXLandingDistributionKey(key: string): boolean {
  return IVX_LANDING_KEY_PATTERN.test(key);
}

type PresignRequestBody = {
  key?: string;
  confirm?: boolean;
  confirmText?: string;
};

export async function handleIVXApkPresignUploadRequest(request: Request): Promise<Response> {
  let approval;
  try {
    approval = await assertIVXRegisteredOwnerBearer(request, 'apk_presign_upload');
  } catch (error) {
    if (error instanceof IVXOwnerApprovalError) {
      return ownerOnlyJson({ status: 'error', error: error.message, approval: error.proof }, error.status);
    }
    return ownerOnlyJson({ status: 'error', error: error instanceof Error ? error.message : 'Owner verification failed.' }, 403);
  }

  let body: PresignRequestBody = {};
  try {
    body = await request.json() as PresignRequestBody;
  } catch {
    // handled below via validation
  }

  const key = (body.key ?? '').trim();
  const isApkKey = isValidIVXApkDistributionKey(key);
  const isLandingKey = !isApkKey && isValidIVXLandingDistributionKey(key);
  if (!isApkKey && !isLandingKey) {
    return ownerOnlyJson({
      status: 'error',
      error: 'INVALID_KEY',
      detail: 'Key must match apk/<name>.(apk|aab) or a whitelisted top-level landing file (index.html, reset-password.html, robots.txt, sitemap.xml, ivx-*.js/json, landing-support-chat.js/css).',
    }, 400);
  }

  const requiredPhrase = isApkKey ? IVX_APK_UPLOAD_CONFIRM_PHRASE : IVX_LANDING_UPLOAD_CONFIRM_PHRASE;
  if (body.confirm !== true || (body.confirmText ?? '').trim() !== requiredPhrase) {
    return ownerOnlyJson({
      status: 'error',
      error: 'confirmationRequired',
      detail: `Pass confirm:true and confirmText:"${requiredPhrase}" to mint an upload URL for this key.`,
    }, 409);
  }

  const region = readEnv('AWS_REGION') || 'us-east-1';
  const bucket = readEnv('S3_BUCKET_NAME') || IVX_APK_BUCKET_DEFAULT;
  let accessKeyId = readEnv('AWS_ACCESS_KEY_ID');
  let secretAccessKey = readEnv('AWS_SECRET_ACCESS_KEY');
  if (!accessKeyId) accessKeyId = await getRawOwnerVariableValue('AWS_ACCESS_KEY_ID');
  if (!secretAccessKey) secretAccessKey = await getRawOwnerVariableValue('AWS_SECRET_ACCESS_KEY');

  if (!accessKeyId || !secretAccessKey) {
    return ownerOnlyJson({
      status: 'error',
      error: 'AWS_CREDENTIALS_MISSING',
      detail: 'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not available on this runtime.',
    }, 500);
  }

  const uploadUrl = buildIVXS3PresignedPutUrl({
    bucket,
    region,
    key,
    accessKeyId,
    secretAccessKey,
    expiresSeconds: IVX_APK_PRESIGN_EXPIRES_SECONDS,
    now: new Date(),
  });

  return ownerOnlyJson({
    status: 'ok',
    key,
    bucket,
    uploadUrl,
    publicUrl: `https://${IVX_APK_BUCKET_DEFAULT}/${key}`,
    expiresInSeconds: IVX_APK_PRESIGN_EXPIRES_SECONDS,
    approvedBy: approval.approval.ownerEmailMasked,
  });
}
