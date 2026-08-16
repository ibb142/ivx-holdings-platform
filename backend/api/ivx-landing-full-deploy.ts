/**
 * IVX Landing Full Deploy — pushes ALL landing static files to S3 + invalidates CloudFront.
 *
 * Unlike the SEO autodeployer (which intentionally skips index.html), this endpoint
 * deploys every file in expo/ivxholding-landing/ including the main index.html,
 * ivx-reels.js, and all JS/CSS assets. This is needed when the landing page on S3
 * is stale and the committed code has fixes that must reach production immediately.
 *
 * Public endpoint (no owner auth) so the autonomous system can trigger it after
 * a backend deploy. Uses a confirmation token to prevent accidental triggers.
 */

import { PutObjectCommand, S3Client, PutBucketWebsiteCommand, PutBucketPolicyCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCloudFrontInvalidation } from '../services/ivx-cloudfront-invalidation';
import { getIVXOwnerVariableRuntimeValue, getRawOwnerVariableValue } from './ivx-owner-variables';

const BUCKET_DEFAULT = 'ivxholding.com';
const WWW_BUCKET_DEFAULT = 'www.ivxholding.com';
const CONFIRM_TOKEN = 'DEPLOY_IVX_LANDING_FULL';

interface UploadResult {
  key: string;
  contentType: string;
  bytes: number;
  ok: boolean;
  error?: string;
}

interface WwwRedirectResult {
  attempted: boolean;
  ok: boolean;
  bucket: string;
  error?: string;
}

interface FullDeployResult {
  ok: boolean;
  bucket: string;
  region: string;
  uploads: UploadResult[];
  cloudFront: {
    attempted: boolean;
    ok: boolean;
    invalidationId?: string;
    error?: string;
  };
  wwwRedirect: WwwRedirectResult;
  missingEnv: string[];
  credentialSources?: Record<string, string>;
  timestamp: string;
  durationMs: number;
}

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  bucket?: string;
  cloudFrontDistributionId?: string;
}

function readEnv(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

/** Resolve AWS credentials from process.env, Owner Variables table, or request body. */
async function resolveAwsCredentials(credsFromRequest?: AwsCredentials): Promise<{
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
  cloudFrontDistributionId: string;
  sources: Record<string, string>;
}> {
  const sources: Record<string, string> = {};

  // 1. Request body (highest priority for one-time injection)
  let accessKey = credsFromRequest?.accessKeyId || '';
  let secretKey = credsFromRequest?.secretAccessKey || '';
  let region = credsFromRequest?.region || '';
  let bucket = credsFromRequest?.bucket || '';
  let cloudFrontDistributionId = credsFromRequest?.cloudFrontDistributionId || '';

  if (accessKey) sources.accessKey = 'request_body';
  if (secretKey) sources.secretKey = 'request_body';

  // 2. process.env
  if (!accessKey) { accessKey = readEnv('AWS_ACCESS_KEY_ID') || readEnv('IVX_AWS_ACCESS_KEY_ID'); if (accessKey) sources.accessKey = 'process_env'; }
  if (!secretKey) { secretKey = readEnv('AWS_SECRET_ACCESS_KEY') || readEnv('IVX_AWS_SECRET_ACCESS_KEY'); if (secretKey) sources.secretKey = 'process_env'; }
  if (!region) { region = readEnv('AWS_REGION') || 'us-east-1'; }
  if (!bucket) { bucket = readEnv('S3_BUCKET_NAME') || 'ivxholding.com'; }
  if (!cloudFrontDistributionId) { cloudFrontDistributionId = readEnv('CLOUDFRONT_DISTRIBUTION_ID'); }

  // 3. Owner Variables table (encrypted)
  if (!accessKey) {
    accessKey = await getRawOwnerVariableValue('AWS_ACCESS_KEY_ID');
    if (!accessKey) accessKey = await getIVXOwnerVariableRuntimeValue('IVX_AWS_READONLY_ACCESS_KEY_ID');
    if (accessKey) sources.accessKey = 'owner_variables';
  }
  if (!secretKey) {
    secretKey = await getRawOwnerVariableValue('AWS_SECRET_ACCESS_KEY');
    if (!secretKey) secretKey = await getIVXOwnerVariableRuntimeValue('IVX_AWS_READONLY_SECRET_ACCESS_KEY');
    if (secretKey) sources.secretKey = 'owner_variables';
  }
  if (!cloudFrontDistributionId) {
    cloudFrontDistributionId = await getRawOwnerVariableValue('CLOUDFRONT_DISTRIBUTION_ID');
  }

  return { accessKey, secretKey, region, bucket, cloudFrontDistributionId, sources };
}

/** Store AWS credentials in the ivx_owner_variables table for future use. */
async function storeAwsCredentialsInDb(creds: AwsCredentials): Promise<boolean> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
    const key = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
    if (!url || !key) return false;
    const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const entries = [
      { name: 'AWS_ACCESS_KEY_ID', value: creds.accessKeyId },
      { name: 'AWS_SECRET_ACCESS_KEY', value: creds.secretAccessKey },
      { name: 'AWS_REGION', value: creds.region || 'us-east-1' },
      { name: 'S3_BUCKET_NAME', value: creds.bucket || 'ivxholding.com' },
      { name: 'CLOUDFRONT_DISTRIBUTION_ID', value: creds.cloudFrontDistributionId || '' },
    ];
    for (const entry of entries) {
      if (!entry.value) continue;
      const { error } = await sb.from('ivx_owner_variables').upsert({
        name: entry.name,
        encrypted_value: entry.value,
        masked_preview: entry.value.substring(0, 4) + '****',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'name' });
      if (error) console.log(`[LandingFullDeploy] Failed to store ${entry.name}: ${error.message}`);
    }
    return true;
  } catch (err) {
    console.log(`[LandingFullDeploy] storeAwsCredentialsInDb error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    'html': 'text/html; charset=utf-8',
    'js': 'application/javascript; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'json': 'application/json; charset=utf-8',
    'xml': 'application/xml; charset=utf-8',
    'txt': 'text/plain; charset=utf-8',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
  };
  return types[ext] ?? 'application/octet-stream';
}

function getCacheControl(filename: string): string {
  if (filename === 'index.html') return 'no-cache, no-store, must-revalidate';
  if (filename === 'ivx-config.json') return 'no-cache, no-store, must-revalidate';
  if (filename === 'robots.txt' || filename === 'sitemap.xml') return 'public, max-age=3600';
  // JS/CSS assets — short cache since they change with deploys
  if (filename.endsWith('.js') || filename.endsWith('.css')) return 'public, max-age=300, s-maxage=600, stale-while-revalidate=1200';
  return 'public, max-age=3600';
}

function substituteLandingPlaceholders(html: string): string {
  const apiBaseUrl = (readEnv('EXPO_PUBLIC_API_BASE_URL') || readEnv('EXPO_PUBLIC_IVX_API_BASE_URL') || 'https://ivxholding.com').replace(/\/$/, '');
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL') || '';
  const supabaseAnonKey = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') || readEnv('SUPABASE_ANON_KEY') || '';
  const appUrl = (readEnv('EXPO_PUBLIC_APP_URL') || readEnv('EXPO_PUBLIC_IVX_API_BASE_URL') || apiBaseUrl).replace(/\/$/, '');
  const backendUrl = (readEnv('EXPO_PUBLIC_IVX_API_BASE_URL') || readEnv('RENDER_EXTERNAL_URL') || apiBaseUrl).replace(/\/$/, '');
  const googleAdsKey = readEnv('EXPO_PUBLIC_GOOGLE_ADS_API_KEY') || '';
  const metaPixelId = readEnv('META_PIXEL_ID') || '';
  const tiktokPixelId = readEnv('TIKTOK_PIXEL_ID') || '';
  const linkedinPartnerId = readEnv('LINKEDIN_PARTNER_ID') || '';

  return html
    .replace(/__IVX_API_BASE_URL__/g, apiBaseUrl)
    .replace(/__IVX_SUPABASE_URL__/g, supabaseUrl)
    .replace(/__IVX_SUPABASE_ANON_KEY__/g, supabaseAnonKey)
    .replace(/__IVX_APP_URL__/g, appUrl)
    .replace(/__IVX_BACKEND_URL__/g, backendUrl)
    .replace(/__IVX_GOOGLE_ADS_KEY__/g, googleAdsKey)
    .replace(/__IVX_META_PIXEL_ID__/g, metaPixelId)
    .replace(/__IVX_TIKTOK_PIXEL_ID__/g, tiktokPixelId)
    .replace(/__IVX_LINKEDIN_PARTNER_ID__/g, linkedinPartnerId);
}

function tryReadLandingFile(relativePath: string): string | null {
  const candidates = [
    join(process.cwd(), 'expo', 'ivxholding-landing', relativePath),
    join(process.cwd(), 'ivxholding-landing', relativePath),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      // try next candidate
    }
  }
  return null;
}

function tryReadBrandAsset(filename: string): Buffer | null {
  const candidates = [
    join(process.cwd(), 'expo', 'assets', 'images', filename),
    join(process.cwd(), 'assets', 'images', filename),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path);
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function fetchBrandAssetFromGitHub(filename: string): Promise<Buffer | null> {
  const repoUrl = readEnv('GITHUB_REPO_URL') || 'https://github.com/ibb142/ivx-holdings-platform';
  const token = readEnv('GITHUB_TOKEN') || '';
  const repoPath = repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const apiUrl = `https://api.github.com/repos/${repoPath}/contents/expo/assets/images/${encodeURIComponent(filename)}?ref=main`;
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'ivx-landing-deploy',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(apiUrl, { headers });
    if (!response.ok) {
      console.log(`[LandingFullDeploy] GitHub fetch ${filename} failed: HTTP ${response.status}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'github fetch failed';
    console.log(`[LandingFullDeploy] GitHub fetch ${filename} error: ${message}`);
    return null;
  }
}

/** List all files in the landing directory */
function listLandingFiles(): string[] {
  const dirCandidates = [
    join(process.cwd(), 'expo', 'ivxholding-landing'),
    join(process.cwd(), 'ivxholding-landing'),
  ];
  for (const dir of dirCandidates) {
    try {
      const files = readdirSync(dir);
      return files.filter((f) => {
        try {
          return statSync(join(dir, f)).isFile();
        } catch {
          return false;
        }
      });
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * Deploy all landing files to S3 + invalidate CloudFront.
 * Public endpoint with confirmation token.
 */
export async function handleLandingFullDeploy(request: Request): Promise<Response> {
  const timestamp = new Date().toISOString();
  const startMs = Date.now();

  let body: { confirm?: string; awsCredentials?: AwsCredentials; storeCredentials?: boolean } = {};
  try {
    body = await request.json() as { confirm?: string; awsCredentials?: AwsCredentials; storeCredentials?: boolean };
  } catch {
    // Allow empty body
  }

  if (body.confirm !== CONFIRM_TOKEN) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Invalid confirmation token. Use {"confirm":"DEPLOY_IVX_LANDING_FULL"}',
      timestamp,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // If credentials are provided in the request body, store them for future use
  if (body.awsCredentials?.accessKeyId && body.awsCredentials?.secretAccessKey && body.storeCredentials !== false) {
    const stored = await storeAwsCredentialsInDb(body.awsCredentials);
    console.log(`[LandingFullDeploy] Credential storage: ${stored ? 'success' : 'failed/skipped'}`);
  }

  // Resolve credentials from request body → process.env → Owner Variables table
  const { accessKey, secretKey, region, bucket, cloudFrontDistributionId, sources } =
    await resolveAwsCredentials(body.awsCredentials);
  const awsRegion = region;

  const missingEnv: string[] = [];
  if (!accessKey) missingEnv.push('AWS_ACCESS_KEY_ID');
  if (!secretKey) missingEnv.push('AWS_SECRET_ACCESS_KEY');

  if (missingEnv.length > 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: `Missing AWS credentials: ${missingEnv.join(', ')}. Checked request body, process.env, and Owner Variables table.`,
      bucket,
      region: awsRegion,
      missingEnv,
      credentialSources: sources,
      hint: 'Provide awsCredentials in the request body: {"confirm":"DEPLOY_IVX_LANDING_FULL","awsCredentials":{"accessKeyId":"AKIA...","secretAccessKey":"...","region":"us-east-1","bucket":"ivxholding.com","cloudFrontDistributionId":"E..."}}',
      timestamp,
      durationMs: Date.now() - startMs,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const s3 = new S3Client({
    region: awsRegion,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const files = listLandingFiles();
  if (files.length === 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'No landing files found in container. Expected expo/ivxholding-landing/ in the Docker image.',
      timestamp,
      durationMs: Date.now() - startMs,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const uploads: UploadResult[] = [];
  const invalidationPaths: string[] = [];

  for (const filename of files) {
    const rawContent = tryReadLandingFile(filename);
    if (rawContent === null) {
      uploads.push({ key: filename, contentType: getContentType(filename), bytes: 0, ok: false, error: 'File not readable' });
      continue;
    }

    // Substitute env placeholders for HTML and JSON files
    const isHtmlOrJson = filename.endsWith('.html') || filename.endsWith('.json');
    const body = isHtmlOrJson ? substituteLandingPlaceholders(rawContent) : rawContent;
    const bytes = Buffer.byteLength(body, 'utf-8');
    const contentType = getContentType(filename);
    const cacheControl = getCacheControl(filename);

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: filename,
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
        }),
      );
      uploads.push({ key: filename, contentType, bytes, ok: true });
      invalidationPaths.push(`/${filename}`);
      console.log(`[LandingFullDeploy] Uploaded ${filename} (${contentType}, ${bytes} bytes)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upload failed';
      uploads.push({ key: filename, contentType, bytes, ok: false, error: message });
      console.log(`[LandingFullDeploy] FAILED ${filename}: ${message}`);
    }
  }

  // Upload official brand assets from expo/assets/images/ to the S3 bucket root
  console.log('[LandingFullDeploy] Uploading brand assets from expo/assets/images/');
  const brandAssets = [
    { filename: 'ivx-logo.png', key: 'ivx-logo.png' },
    { filename: 'ivx-logo-master.png', key: 'ivx-logo-master.png' },
    { filename: 'ivx-symbol.png', key: 'ivx-symbol.png' },
    { filename: 'ivx-og-image.png', key: 'ivx-og-image.png' },
    { filename: 'favicon.png', key: 'favicon.png' },
    { filename: 'favicon-16.png', key: 'favicon-16.png' },
    { filename: 'favicon-32.png', key: 'favicon-32.png' },
    { filename: 'favicon-180.png', key: 'favicon-180.png' },
    { filename: 'favicon-192.png', key: 'favicon-192.png' },
  ];
  for (const asset of brandAssets) {
    let buffer = tryReadBrandAsset(asset.filename);
    if (!buffer) {
      console.log(`[LandingFullDeploy] Brand asset not found locally, fetching ${asset.filename} from GitHub...`);
      buffer = await fetchBrandAssetFromGitHub(asset.filename);
    }
    if (!buffer) {
      uploads.push({ key: asset.key, contentType: getContentType(asset.key), bytes: 0, ok: false, error: 'Brand asset not readable and GitHub fetch failed' });
      continue;
    }
    const contentType = getContentType(asset.key);
    const cacheControl = asset.key === 'ivx-logo.png' || asset.key === 'ivx-symbol.png'
      ? 'public, max-age=31536000'
      : 'public, max-age=86400';
    try {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: asset.key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: cacheControl,
      }));
      uploads.push({ key: asset.key, contentType, bytes: buffer.length, ok: true });
      invalidationPaths.push(`/${asset.key}`);
      console.log(`[LandingFullDeploy] Uploaded brand asset ${asset.key} (${contentType}, ${buffer.length} bytes)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upload failed';
      uploads.push({ key: asset.key, contentType, bytes: 0, ok: false, error: message });
      console.log(`[LandingFullDeploy] FAILED brand asset ${asset.key}: ${message}`);
    }
  }

  // Also invalidate the root path
  invalidationPaths.push('/');

  const allUploadsOk = uploads.length > 0 && uploads.every((u) => u.ok);

  // ============================================================================
  // Configure www.ivxholding.com S3 bucket to redirect to ivxholding.com
  // ============================================================================
  const wwwBucket = WWW_BUCKET_DEFAULT;
  let wwwRedirect: WwwRedirectResult = { attempted: false, ok: false, bucket: wwwBucket };
  try {
    // Check if www bucket exists
    try {
      await s3.send(new HeadBucketCommand({ Bucket: wwwBucket }));
    } catch {
      // Bucket doesn't exist — skip www redirect setup
      wwwRedirect = { attempted: false, ok: false, bucket: wwwBucket, error: 'www bucket does not exist' };
      console.log('[LandingFullDeploy] www bucket does not exist — skipping redirect setup');
    }

    // Set up website redirect on www bucket
    wwwRedirect.attempted = true;
    await s3.send(new PutBucketWebsiteCommand({
      Bucket: wwwBucket,
      WebsiteConfiguration: {
        RedirectAllRequestsTo: {
          HostName: 'ivxholding.com',
          Protocol: 'https',
        },
      },
    }));
    wwwRedirect.ok = true;
    console.log('[LandingFullDeploy] www redirect configured: https://www.ivxholding.com → https://ivxholding.com');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'www redirect setup failed';
    if (!wwwRedirect.attempted) wwwRedirect.attempted = true;
    wwwRedirect.error = message;
    console.log(`[LandingFullDeploy] www redirect FAILED: ${message}`);
  }

  // Invalidate CloudFront
  let cloudFront: FullDeployResult['cloudFront'] = { attempted: false, ok: false };
  // Also check Owner Variables table for CloudFront ID
  let cloudFrontId = cloudFrontDistributionId;
  if (!cloudFrontId) {
    cloudFrontId = await getRawOwnerVariableValue('CLOUDFRONT_DISTRIBUTION_ID');
  }
  if (allUploadsOk && cloudFrontId) {
    const invalidation = await createCloudFrontInvalidation({
      paths: invalidationPaths,
      callerReference: `landing-full-deploy-${Date.now()}`,
      distributionId: cloudFrontId,
    });
    cloudFront = {
      attempted: true,
      ok: invalidation.ok,
      invalidationId: invalidation.invalidationId,
      error: invalidation.error,
    };
    console.log(
      `[LandingFullDeploy] CloudFront invalidation: ${invalidation.status}` +
        (invalidation.invalidationId ? ` (${invalidation.invalidationId})` : ''),
    );
  } else if (allUploadsOk && !cloudFrontId) {
    cloudFront = {
      attempted: false,
      ok: false,
      error: 'CLOUDFRONT_DISTRIBUTION_ID not set — S3 updated but CDN cache may be stale',
    };
  }

  const result: FullDeployResult = {
    ok: allUploadsOk,
    bucket,
    region: awsRegion,
    uploads,
    cloudFront,
    wwwRedirect,
    missingEnv: [],
    credentialSources: sources,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startMs,
  };

  return new Response(JSON.stringify(result), {
    status: allUploadsOk ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** GET status — returns what would be deployed without actually deploying */
export async function handleLandingFullDeployStatus(): Promise<Response> {
  const files = listLandingFiles();
  const { accessKey, secretKey, region, bucket, cloudFrontDistributionId, sources } =
    await resolveAwsCredentials(undefined);
  const hasAws = !!accessKey && !!secretKey;
  const hasCloudFront = !!cloudFrontDistributionId;

  return new Response(JSON.stringify({
    ok: true,
    filesAvailable: files,
    fileCount: files.length,
    awsCredentialsConfigured: hasAws,
    cloudFrontConfigured: hasCloudFront,
    bucket,
    region,
    credentialSources: sources,
    timestamp: new Date().toISOString(),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
