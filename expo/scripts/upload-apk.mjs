#!/usr/bin/env node
/**
 * Upload a built APK to S3 for public download — CREDENTIAL-FREE.
 *
 * This script does NOT require AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY
 * in the local environment. Instead it:
 *   1. Obtains an owner JWT via the backend passwordless login endpoint.
 *   2. Calls POST /api/ivx/apk/presign-upload to mint a short-lived presigned
 *      S3 PUT URL (AWS creds stay server-side on Render).
 *   3. Uploads the APK binary to the presigned URL.
 *   4. Verifies the public download URL returns HTTP 200.
 *
 * Usage:
 *   bun run scripts/upload-apk.mjs [apkPath] [s3Key]
 *
 * Defaults:
 *   apkPath = android/app/build/outputs/apk/qa/app-qa.apk
 *   s3Key   = apk/ivx-holdings-<version>-owner.apk (auto-derived from app.config.ts)
 *
 * Environment (all optional — sensible defaults are baked in):
 *   IVX_API_BASE_URL       — Backend URL (default: https://api.ivxholding.com)
 *   IVX_OWNER_EMAIL        — Owner login email (default: iperez4242@gmail.com)
 *   IVX_EMERGENCY_CODE     — Emergency recovery code (default: ivx_emergency_recovery)
 *   IVX_S3_BUCKET          — S3 bucket for public URL (default: ivxholding.com)
 */

import { readFileSync, statSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_BASE_URL = (process.env.IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/$/, '');
const OWNER_EMAIL = (process.env.IVX_OWNER_EMAIL || 'iperez4242@gmail.com').trim();
const EMERGENCY_CODE = (process.env.IVX_EMERGENCY_CODE || 'ivx_emergency_recovery').trim();
const S3_BUCKET = (process.env.IVX_S3_BUCKET || 'ivxholding.com').trim();
const CONFIRM_PHRASE = 'CONFIRM_IVX_APK_UPLOAD';

const APK_PATH = process.argv[2] || resolve(__dirname, '../android/app/build/outputs/apk/qa/app-qa.apk');

// ─── Helpers ──────────────────────────────────────────────────────────────

function log(msg) { console.log(`[Upload APK] ${msg}`); }
function err(msg) { console.error(`[Upload APK] ERROR: ${msg}`); }

/** Read the app version from app.config.ts to derive a default S3 key. */
function deriveS3Key() {
  try {
    const configPath = resolve(__dirname, '../app.config.ts');
    const configContent = readFileSync(configPath, 'utf8');
    const versionMatch = configContent.match(/version['"]s*:\s*['"]([^'"]+)['"]/);
    const version = versionMatch ? versionMatch[1] : 'latest';
    return `apk/ivx-holdings-${version}-owner.apk`;
  } catch {
    return 'apk/ivx-holdings-latest-owner.apk';
  }
}

const S3_KEY = process.argv[3] || deriveS3Key();

/** Obtain an owner JWT via the backend passwordless login endpoint. */
async function obtainOwnerJWT() {
  log(`Authenticating as ${OWNER_EMAIL}...`);
  const resp = await fetch(`${API_BASE_URL}/api/ivx/owner-passwordless-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, emergency: EMERGENCY_CODE }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!data.accessToken) {
    throw new Error(`Login failed (${resp.status}): ${data.message || data.error || 'No accessToken in response'}`);
  }
  log(`JWT obtained (${data.accessToken.length} chars).`);
  return data.accessToken;
}

/** Call the backend presign endpoint to get a short-lived S3 PUT URL. */
async function getPresignedUploadUrl(jwt, s3Key) {
  log(`Requesting presigned upload URL for key: ${s3Key}`);
  const resp = await fetch(`${API_BASE_URL}/api/ivx/apk/presign-upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      key: s3Key,
      confirm: true,
      confirmText: CONFIRM_PHRASE,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!data.uploadUrl) {
    throw new Error(`Presign failed (${resp.status}): ${data.error || data.detail || JSON.stringify(data).slice(0, 200)}`);
  }
  log(`Presigned URL minted (expires in ${data.expiresInSeconds}s).`);
  return { uploadUrl: data.uploadUrl, publicUrl: data.publicUrl, bucket: data.bucket };
}

/** Upload the APK binary to the presigned S3 URL. */
async function uploadToPresignedUrl(uploadUrl, apkPath) {
  const fileData = readFileSync(apkPath);
  const fileSize = statSync(apkPath).size;
  log(`Uploading ${(fileSize / (1024 * 1024)).toFixed(1)} MB to S3...`);

  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
    },
    body: fileData,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`S3 PUT failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  log(`Upload complete (${fileSize} bytes, HTTP ${resp.status}).`);
  return true;
}

/** Verify the public download URL returns HTTP 200 with correct content type. */
async function verifyPublicUrl(publicUrl) {
  log(`Verifying public URL: ${publicUrl}`);
  const resp = await fetch(publicUrl, { method: 'HEAD' });
  if (resp.status !== 200) {
    throw new Error(`Verification failed: HTTP ${resp.status} (expected 200)`);
  }
  const contentType = resp.headers.get('content-type') || '';
  const contentLength = resp.headers.get('content-length') || '0';
  log(`Verified: HTTP ${resp.status}, ${contentType}, ${contentLength} bytes.`);
  return { status: resp.status, contentType, contentLength };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  log('Starting credential-free APK upload...');

  // 1. Validate APK file exists
  if (!existsSync(APK_PATH)) {
    err(`APK file not found: ${APK_PATH}`);
    err('Build the APK first with: cd android && ./gradlew assembleQa --no-daemon');
    process.exit(1);
  }
  const fileSize = statSync(APK_PATH).size;
  log(`APK: ${APK_PATH} (${(fileSize / (1024 * 1024)).toFixed(1)} MB)`);
  log(`S3 key: ${S3_KEY}`);
  log(`Backend: ${API_BASE_URL}`);

  // 2. Obtain owner JWT (no local credentials needed)
  const jwt = await obtainOwnerJWT();

  // 3. Get presigned upload URL from backend (AWS creds stay server-side)
  const { uploadUrl, publicUrl } = await getPresignedUploadUrl(jwt, S3_KEY);

  // 4. Upload APK to presigned URL
  await uploadToPresignedUrl(uploadUrl, APK_PATH);

  // 5. Verify public download URL
  await verifyPublicUrl(publicUrl);

  // 6. Done
  log('─'.repeat(60));
  log('SUCCESS — APK is live.');
  log(`Download URL: ${publicUrl}`);
  log('─'.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    err(e.message || e);
    process.exit(1);
  });
