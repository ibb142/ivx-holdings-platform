import {
  S3Client,
  CreateBucketCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import {
  CloudFrontClient,
  ListDistributionsCommand,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import { readFileSync } from 'fs';
import { fetchStaticLandingApiPayloads } from './scripts/landing-static-api.mjs';
import { injectLandingCardRenderer } from './scripts/landing-card-renderer-injector.mjs';
import { sanitizeLandingHtml } from './scripts/landing-html-sanitizer.mjs';

const BUCKET_NAME = 'ivxholding.com';
const WWW_BUCKET = 'www.ivxholding.com';
const PUBLIC_BASE_URL = 'https://ivxholding.com';
const VERIFY_RETRY_DELAY_MS = 4000;
const VERIFY_MAX_ATTEMPTS = 6;
const rawRegion = (process.env.AWS_REGION || '').trim();
const REGION = /^[a-z]{2}-[a-z]+-[0-9]$/.test(rawRegion) ? rawRegion : 'us-east-1';
const ACCESS_KEY = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const SECRET_KEY = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const PRODUCTION_BACKEND_URL = 'https://api.ivxholding.com';
const LANDING_HTML_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';
const LANDING_CONFIG_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';
const LANDING_API_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
const LANDING_HEALTH_CACHE_CONTROL = 'public, max-age=30, s-maxage=60, stale-while-revalidate=120';

function isLocalDevCredential(value) {
  const v = String(value || '').toLowerCase();
  return v.includes('127.0.0.1') || v.includes('localhost') || v.includes('::1') ||
    v.includes('supabase local development') || v.includes('super-secret-jwt') ||
    v.includes('54321') || v.includes('54322') || v.includes('54323');
}

function isValidSupabaseUrl(url) {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(url || '').trim());
}

function isValidSupabaseAnonKey(key) {
  const k = String(key || '').trim();
  return k.startsWith('eyJ') && k.length > 30 && !isLocalDevCredential(k);
}

function sanitizeBackendUrl(url) {
  const u = String(url || '').trim().replace(/\/$/, '');
  if (!u) return PRODUCTION_BACKEND_URL;
  if (isLocalDevCredential(u)) return PRODUCTION_BACKEND_URL;
  if (u.includes('ivxholding.com')) return u;
  // Prefer production API over legacy Render URLs
  if (u.includes('onrender.com')) return PRODUCTION_BACKEND_URL;
  return u;
}

function sanitizeSupabaseUrl(url) {
  const u = String(url || '').trim();
  if (isLocalDevCredential(u) || !isValidSupabaseUrl(u)) return '';
  return u;
}

function sanitizeSupabaseAnonKey(key) {
  const k = String(key || '').trim();
  if (isLocalDevCredential(k) || !isValidSupabaseAnonKey(k)) return '';
  return k;
}

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

async function bucketExists(name) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
    return true;
  } catch {
    return false;
  }
}

async function setupBucket(name) {
  const exists = await bucketExists(name);

  if (!exists) {
    console.log(`\n📦 Creating bucket: ${name}`);
    const createParams = { Bucket: name };
    if (REGION !== 'us-east-1') {
      createParams.CreateBucketConfiguration = { LocationConstraint: REGION };
    }
    await s3.send(new CreateBucketCommand(createParams));
    console.log('   ✅ Bucket created');
  } else {
    console.log(`\n📦 Bucket exists: ${name}`);
  }

  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: name,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: false,
      IgnorePublicAcls: false,
      BlockPublicPolicy: false,
      RestrictPublicBuckets: false,
    },
  }));

  await s3.send(new PutBucketPolicyCommand({
    Bucket: name,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Sid: 'PublicReadGetObject',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${name}/*`,
      }],
    }),
  }));
}

function isHtmlResponse(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized.startsWith('<!doctype html') || normalized.startsWith('<html') || normalized.includes('<body');
}

async function verifyPublicJsonEndpoint(url, expectedType) {
  let lastError = 'Unknown verification failure';

  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(`   🔎 Verifying ${url} (attempt ${attempt}/${VERIFY_MAX_ATTEMPTS})...`);
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      });
      const body = await response.text();
      const contentType = (response.headers.get('content-type') || '').toLowerCase();

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else if (!contentType.includes('application/json')) {
        lastError = `invalid content-type ${contentType || 'unknown'}`;
      } else if (isHtmlResponse(body)) {
        lastError = 'HTML fallback detected';
      } else {
        const parsed = JSON.parse(body);

        if (expectedType === 'health') {
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.status === 'string') {
            console.log(`   ✅ Verified ${url} as live JSON health payload`);
            return true;
          }
          lastError = 'health payload schema mismatch';
        } else {
          const deals = Array.isArray(parsed) ? parsed : parsed?.deals;
          if (Array.isArray(deals) && deals.length > 0) {
            console.log(`   ✅ Verified ${url} as live JSON deals payload with ${deals.length} deals`);
            return true;
          }
          lastError = 'deals payload schema mismatch or empty payload';
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < VERIFY_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_DELAY_MS));
    }
  }

  console.error(`   ❌ Verification failed for ${url}: ${lastError}`);
  return false;
}

async function verifyPublicJsonEndpoints() {
  console.log('\n🔍 Validating live public JSON endpoints...');
  const checks = await Promise.all([
    verifyPublicJsonEndpoint(`${PUBLIC_BASE_URL}/api/landing-deals`, 'deals'),
    verifyPublicJsonEndpoint(`${PUBLIC_BASE_URL}/api/published-jv-deals`, 'deals'),
    verifyPublicJsonEndpoint(`${PUBLIC_BASE_URL}/health`, 'health'),
  ]);

  return checks.every(Boolean);
}

async function deploy() {
  console.log('🚀 Deploying IVX Holdings landing page...');
  console.log(`   Region: ${REGION}`);

  await setupBucket(BUCKET_NAME);

  console.log('\n🌐 Configuring static website hosting for root domain...');
  await s3.send(new PutBucketWebsiteCommand({
    Bucket: BUCKET_NAME,
    WebsiteConfiguration: {
      IndexDocument: { Suffix: 'index.html' },
      ErrorDocument: { Key: 'index.html' },
    },
  }));
  console.log('   ✅ Root bucket website hosting configured');

  await setupBucket(WWW_BUCKET);

  console.log('\n🔀 Configuring www redirect to root domain...');
  await s3.send(new PutBucketWebsiteCommand({
    Bucket: WWW_BUCKET,
    WebsiteConfiguration: {
      RedirectAllRequestsTo: {
        HostName: 'ivxholding.com',
        Protocol: 'https',
      },
    },
  }));
  console.log('   ✅ www redirect configured');

  console.log('\n📤 Uploading index.html...');
  const rawApiBaseUrl = (
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL ||
    'https://ivxholding.com'
  ).trim().replace(/\/$/, '');
  const apiBaseUrl = sanitizeBackendUrl(rawApiBaseUrl);
  const supabaseUrl = sanitizeSupabaseUrl(
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  );
  const supabaseAnonKey = sanitizeSupabaseAnonKey(
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  );
  const appUrl = (
    process.env.EXPO_PUBLIC_APP_URL ||
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL ||
    ''
  ).trim().replace(/\/$/, '');

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('\n❌ CRITICAL: Supabase credentials are MISSING or invalid!');
    console.error('   EXPO_PUBLIC_SUPABASE_URL =', process.env.EXPO_PUBLIC_SUPABASE_URL ? '(provided)' : '(empty)');
    console.error('   EXPO_PUBLIC_SUPABASE_ANON_KEY =', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ? '(provided)' : '(empty)');
    console.error('\n   Without these, live deals will NOT load on the landing page.');
    console.error('   Set them before deploying:');
    console.error('     EXPO_PUBLIC_SUPABASE_URL="https://xxx.supabase.co" \\');
    console.error('     EXPO_PUBLIC_SUPABASE_ANON_KEY="eyJ..." \\');
    console.error('     node deploy-landing.mjs');
    console.error('');
    console.error('   Continuing deploy WITHOUT Supabase — deals section will try API fallback.');
    console.error('');
  }

  const backendUrl = sanitizeBackendUrl(
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL ||
    'https://api.ivxholding.com'
  );

  const googleAdsKey = (
    process.env.EXPO_PUBLIC_GOOGLE_ADS_API_KEY ||
    ''
  ).trim();
  const metaPixelId = (process.env.META_PIXEL_ID || '').trim();
  const tiktokPixelId = (process.env.TIKTOK_PIXEL_ID || '').trim();
  const linkedinPartnerId = (process.env.LINKEDIN_PARTNER_ID || '').trim();

  let html = readFileSync('./ivxholding-landing/index.html', 'utf-8');
  console.log('   [DEBUG] index.html read bytes:', Buffer.byteLength(html, 'utf-8'));
  console.log('   [DEBUG] index.html contains overscroll removal:', html.includes('overscroll-behavior-y: none; REMOVED'));
  const sanitizedLandingHtml = sanitizeLandingHtml(html);
  html = sanitizedLandingHtml.html;
  if (sanitizedLandingHtml.duplicateBlockCount > 0) {
    console.log('   🧹 Removed duplicate landing runtime blocks:', sanitizedLandingHtml.duplicateBlockCount, '(markers:', sanitizedLandingHtml.markerOccurrences + ')');
  }
  html = injectLandingCardRenderer(html);
  html = html.replace(/__IVX_API_BASE_URL__/g, apiBaseUrl);
  html = html.replace(/__IVX_SUPABASE_URL__/g, supabaseUrl);
  html = html.replace(/__IVX_SUPABASE_ANON_KEY__/g, supabaseAnonKey);
  html = html.replace(/__IVX_APP_URL__/g, appUrl);
  html = html.replace(/__IVX_BACKEND_URL__/g, backendUrl);
  html = html.replace(/__IVX_GOOGLE_ADS_KEY__/g, googleAdsKey);
  html = html.replace(/__IVX_META_PIXEL_ID__/g, metaPixelId);
  html = html.replace(/__IVX_TIKTOK_PIXEL_ID__/g, tiktokPixelId);
  html = html.replace(/__IVX_LINKEDIN_PARTNER_ID__/g, linkedinPartnerId);
  if (apiBaseUrl) {
    console.log(`   🔗 API URL injected: ${apiBaseUrl}`);
  } else {
    console.warn('   ⚠️  EXPO_PUBLIC_API_BASE_URL not set');
  }
  if (supabaseUrl && supabaseAnonKey) {
    console.log(`   🔗 Supabase URL injected: ${supabaseUrl}`);
  } else {
    console.warn('   ⚠️  EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY not set — live deals will not load');
  }
  if (appUrl) {
    console.log(`   🔗 App URL injected: ${appUrl}`);
  } else {
    console.warn('   ⚠️  App URL not set — invest buttons will open waitlist funnel instead of app');
  }

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'index.html',
    Body: html,
    ContentType: 'text/html; charset=utf-8',
    CacheControl: LANDING_HTML_CACHE_CONTROL,
  }));
  console.log('   ✅ index.html uploaded');

  console.log('\n📤 Uploading capture.html (multi-audience public lead capture)...');
  let captureHtml = readFileSync('./ivxholding-landing/capture.html', 'utf-8');
  captureHtml = captureHtml.replace(/__IVX_BACKEND_URL__/g, backendUrl || apiBaseUrl);
  // Serve the same page at /capture (no extension) and /capture.html so links work either way.
  for (const key of ['capture.html', 'capture']) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: captureHtml,
      ContentType: 'text/html; charset=utf-8',
      CacheControl: LANDING_HTML_CACHE_CONTROL,
    }));
  }
  console.log('   ✅ capture.html + /capture uploaded');

  console.log('\n📤 Uploading ivx-config.json (Supabase credentials for fallback)...');
  const configJson = JSON.stringify({
    supabaseUrl: supabaseUrl || '',
    supabaseAnonKey: supabaseAnonKey || '',
    apiBaseUrl: apiBaseUrl || '',
    appUrl: appUrl || '',
    backendUrl: backendUrl || '',
    deployedAt: new Date().toISOString(),
  });
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'ivx-config.json',
    Body: configJson,
    ContentType: 'application/json',
    CacheControl: LANDING_CONFIG_CACHE_CONTROL,
  }));
  console.log('   ✅ ivx-config.json uploaded');

  console.log('\n📤 Uploading static JSON API endpoints...');
  const { dealsPayload, healthPayload } = await fetchStaticLandingApiPayloads({
    supabaseUrl,
    supabaseAnonKey,
    directApiBaseUrl: backendUrl || apiBaseUrl,
  });
  const dealsJson = JSON.stringify(dealsPayload);
  const healthJson = JSON.stringify(healthPayload);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'api/landing-deals',
    Body: dealsJson,
    ContentType: 'application/json',
    CacheControl: LANDING_API_CACHE_CONTROL,
  }));
  console.log('   ✅ /api/landing-deals uploaded');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'api/published-jv-deals',
    Body: dealsJson,
    ContentType: 'application/json',
    CacheControl: LANDING_API_CACHE_CONTROL,
  }));
  console.log('   ✅ /api/published-jv-deals uploaded');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'health',
    Body: healthJson,
    ContentType: 'application/json',
    CacheControl: LANDING_HEALTH_CACHE_CONTROL,
  }));
  console.log('   ✅ /health uploaded');

  console.log('\n🖼️  Uploading brand assets...');
  const brandAssets = [
    { src: './assets/images/ivx-logo.png', key: 'ivx-logo.png', contentType: 'image/png' },
    { src: './assets/images/ivx-symbol.png', key: 'ivx-symbol.png', contentType: 'image/png' },
    { src: './assets/images/ivx-og-image.png', key: 'ivx-og-image.png', contentType: 'image/png' },
    { src: './assets/images/favicon.png', key: 'favicon.png', contentType: 'image/png' },
    { src: './assets/images/favicon-16.png', key: 'favicon-16.png', contentType: 'image/png' },
    { src: './assets/images/favicon-32.png', key: 'favicon-32.png', contentType: 'image/png' },
    { src: './assets/images/favicon-180.png', key: 'favicon-180.png', contentType: 'image/png' },
    { src: './assets/images/favicon-192.png', key: 'favicon-192.png', contentType: 'image/png' },
  ];
  for (const asset of brandAssets) {
    const buffer = readFileSync(asset.src);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: asset.key,
      Body: buffer,
      ContentType: asset.contentType,
      CacheControl: asset.key.startsWith('ivx-logo') || asset.key === 'ivx-symbol.png' ? 'public, max-age=31536000' : 'public, max-age=86400',
    }));
    console.log(`   ✅ ${asset.key} uploaded`);
  }

  console.log('\n🔎 Uploading robots.txt (real crawl directives — not the SPA fallback)...');
  const robotsTxt = readFileSync('./ivxholding-landing/robots.txt', 'utf-8');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'robots.txt',
    Body: robotsTxt,
    ContentType: 'text/plain; charset=utf-8',
    CacheControl: 'public, max-age=3600',
  }));
  console.log('   ✅ robots.txt uploaded');

  console.log('\n🎬 Uploading ivx-reels.js (enterprise vertical video experience)...');
  const reelsJs = readFileSync('./ivxholding-landing/ivx-reels.js', 'utf-8');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'ivx-reels.js',
    Body: reelsJs,
    ContentType: 'application/javascript; charset=utf-8',
    CacheControl: 'public, max-age=300',
  }));
  console.log('   ✅ ivx-reels.js uploaded');

  console.log('\n🗺️  Uploading sitemap.xml...');
  const sitemapXml = readFileSync('./ivxholding-landing/sitemap.xml', 'utf-8');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'sitemap.xml',
    Body: sitemapXml,
    ContentType: 'application/xml; charset=utf-8',
    CacheControl: 'public, max-age=3600',
  }));
  console.log('   ✅ sitemap.xml uploaded');

  const websiteEndpoint = REGION === 'us-east-1'
    ? `${BUCKET_NAME}.s3-website-us-east-1.amazonaws.com`
    : `${BUCKET_NAME}.s3-website-${REGION}.amazonaws.com`;

  console.log('\n🔄 Checking for CloudFront distribution...');
  let cloudfrontDistId = null;
  try {
    const cf = new CloudFrontClient({
      region: 'us-east-1',
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    });
    const distResp = await cf.send(new ListDistributionsCommand({}));
    const dists = distResp.DistributionList?.Items || [];
    for (const dist of dists) {
      const aliases = dist.Aliases?.Items || [];
      if (aliases.includes('ivxholding.com') || aliases.includes('www.ivxholding.com')) {
        cloudfrontDistId = dist.Id;
        console.log(`   ✅ Found CloudFront distribution: ${dist.Id} (${dist.DomainName})`);
        break;
      }
    }

    if (cloudfrontDistId) {
      console.log('   🗑️  Invalidating CloudFront cache...');
      await cf.send(new CreateInvalidationCommand({
        DistributionId: cloudfrontDistId,
        InvalidationBatch: {
          CallerReference: `deploy-landing-${Date.now()}`,
          Paths: { Quantity: 1, Items: ['/*'] },
        },
      }));
      console.log('   ✅ CloudFront cache invalidation triggered (takes 1–2 min)');
    } else {
      console.log('   ⚠️  No CloudFront distribution found for ivxholding.com');
      console.log('   Run: node deploy/scripts/setup-cloudfront-landing.mjs to create one');
    }
  } catch (cfErr) {
    console.warn(`   ⚠️  CloudFront invalidation skipped: ${cfErr.message}`);
  }

  const publicJsonVerified = await verifyPublicJsonEndpoints();
  if (!publicJsonVerified) {
    throw new Error('Public JSON endpoint verification failed after deploy');
  }

  console.log('\n🎉 DEPLOYMENT COMPLETE!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (cloudfrontDistId) {
    console.log('🔒 HTTPS URL: https://ivxholding.com');
    console.log('🔒 HTTPS www:  https://www.ivxholding.com');
    console.log(`🔗 CloudFront Distribution: ${cloudfrontDistId}`);
  } else {
    console.log(`🔗 Direct URL: http://${websiteEndpoint}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!cloudfrontDistId) {
    console.log('\n📌 To enable HTTPS:');
    console.log('   1. Run: node deploy/scripts/setup-cloudfront-landing.mjs');
    console.log('   2. This creates CloudFront + updates Route53 DNS');
    console.log('   3. Future deploys will auto-invalidate CloudFront cache');
  }
}

deploy().catch((err) => {
  console.error('\n❌ Deploy failed:', err.message);
  if (err.message.includes('credentials') || err.message.includes('InvalidAccessKeyId')) {
    console.error('   → Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
  }
  if (err.message.includes('BucketAlreadyOwnedByYou')) {
    console.error('   → Bucket already exists and is owned by you — that is fine, continuing...');
  }
  process.exit(1);
});
