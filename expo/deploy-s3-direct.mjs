/**
 * IVX Holdings — S3/CloudFront Landing Page Deploy
 *
 * Uses environment variables for AWS credentials (no hardcoded secrets).
 * Handles all files: HTML, CSS, JS, images, APK, config, sitemap, robots.
 * Creates redirect files for retired routes.
 * Sets proper MIME types, cache headers, and Content-Disposition.
 * Invalidates CloudFront cache after deploy.
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx bun run deploy-s3-direct.mjs
 *
 * If env vars are not set, falls back to legacy credentials with a warning.
 */
import { S3Client, PutObjectCommand, HeadBucketCommand, PutBucketWebsiteCommand } from '@aws-sdk/client-s3';
import {
  CloudFrontClient,
  CreateFunctionCommand,
  CreateInvalidationCommand,
  GetInvalidationCommand,
  GetDistributionConfigCommand,
  DescribeFunctionCommand,
  PublishFunctionCommand,
  UpdateDistributionCommand,
  UpdateFunctionCommand,
  ListResponseHeadersPoliciesCommand,
  CreateResponseHeadersPolicyCommand,
  GetResponseHeadersPolicyCommand,
} from '@aws-sdk/client-cloudfront';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';

// ── AWS Configuration ─────────────────────────────────
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || process.env.IVX_AWS_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || process.env.IVX_AWS_SECRET_ACCESS_KEY || '';
const REGION = process.env.AWS_REGION || 'us-east-1';
const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || '';
const BUCKET = process.env.S3_BUCKET_NAME || 'ivxholding.com';
const IVX_PUBLIC_SUPABASE_KEY = 'sb_publishable_HD3Xvq5bCQNJLFk1ROH9mQ_Wdb9xdDZ';

if (!ACCESS_KEY || !SECRET_KEY) {
  console.error('❌ AWS credentials not set. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars.');
  console.error('   NEVER hardcode credentials in source files.');
  process.exit(1);
}
if (!DIST_ID) {
  console.error('❌ CLOUDFRONT_DISTRIBUTION_ID not set.');
  process.exit(1);
}
const s3 = new S3Client({ region: REGION, credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } });
const cf = new CloudFrontClient({ region: 'us-east-1', credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } });

async function ensureWwwRedirectFunction() {
  const name = 'ivx-www-to-apex';
  const code = `function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;
  if (host && host.toLowerCase() === 'www.ivxholding.com') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: 'https://ivxholding.com' + request.uri },
        'cache-control': { value: 'public, max-age=3600' }
      }
    };
  }
  return request;
}`;
  let etag = '';
  let functionArn = '';
  try {
    const current = await cf.send(new DescribeFunctionCommand({ Name: name, Stage: 'DEVELOPMENT' }));
    etag = current.ETag || '';
    functionArn = current.FunctionSummary?.FunctionMetadata?.FunctionARN || '';
    const updated = await cf.send(new UpdateFunctionCommand({
      Name: name,
      IfMatch: etag,
      FunctionConfig: { Comment: 'Redirect www.ivxholding.com to apex', Runtime: 'cloudfront-js-2.0' },
      FunctionCode: Buffer.from(code, 'utf-8'),
    }));
    etag = updated.ETag || '';
    functionArn = updated.FunctionSummary?.FunctionMetadata?.FunctionARN || functionArn;
  } catch (error) {
    if (error?.name !== 'NoSuchFunction') throw error;
    const created = await cf.send(new CreateFunctionCommand({
      Name: name,
      FunctionConfig: { Comment: 'Redirect www.ivxholding.com to apex', Runtime: 'cloudfront-js-2.0' },
      FunctionCode: Buffer.from(code, 'utf-8'),
    }));
    etag = created.ETag || '';
    functionArn = created.FunctionSummary?.FunctionMetadata?.FunctionARN || '';
  }
  const published = await cf.send(new PublishFunctionCommand({ Name: name, IfMatch: etag }));
  return published.FunctionSummary?.FunctionMetadata?.FunctionARN || functionArn;
}

const LANDING_DIR = '/home/user/rork-app/expo/ivxholding-landing';
const ASSETS_DIR = '/home/user/rork-app/expo/assets/images';
const APK_PATH = '/tmp/ivx-holdings-1.10.14.apk';

// Build version for cache-busting
const BUILD_VER = 'v' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

// ── Config injection ──────────────────────────────────
function injectConfig(html) {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || IVX_PUBLIC_SUPABASE_KEY;
  const apiUrl = 'https://api.ivxholding.com';
  html = html.replace(/__IVX_API_BASE_URL__/g, apiUrl);
  html = html.replace(/__IVX_SUPABASE_URL__/g, supabaseUrl);
  html = html.replace(/__IVX_SUPABASE_ANON_KEY__/g, supabaseKey);
  html = html.replace(/__IVX_BACKEND_URL__/g, apiUrl);
  html = html.replace(/__IVX_APP_URL__/g, '');
  // Analytics IDs — only inject if real values exist
  const gadsKey = process.env.EXPO_PUBLIC_GOOGLE_ADS_KEY || process.env.IVX_GOOGLE_ADS_KEY || '';
  const metaPixel = process.env.EXPO_PUBLIC_META_PIXEL_ID || process.env.IVX_META_PIXEL_ID || '';
  const tiktokPixel = process.env.EXPO_PUBLIC_TIKTOK_PIXEL_ID || process.env.IVX_TIKTOK_PIXEL_ID || '';
  const linkedinPartner = process.env.EXPO_PUBLIC_LINKEDIN_PARTNER_ID || process.env.IVX_LINKEDIN_PARTNER_ID || '';
  html = html.replace(/__IVX_GOOGLE_ADS_KEY__/g, gadsKey);
  html = html.replace(/__IVX_META_PIXEL_ID__/g, metaPixel);
  html = html.replace(/__IVX_TIKTOK_PIXEL_ID__/g, tiktokPixel);
  html = html.replace(/__IVX_LINKEDIN_PARTNER_ID__/g, linkedinPartner);
  return html;
}

// ── Redirect HTML for retired routes ──────────────────
function redirectHTML(target, routeName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="robots" content="noindex, follow" />
<title>IVX Holdings — Redirecting</title>
<link rel="canonical" href="https://ivxholding.com${target}" />
<script>
// Preserve UTM parameters
var utm = window.location.search;
window.location.replace('https://ivxholding.com${target}' + (utm ? utm : ''));
</script>
<meta http-equiv="refresh" content="0; url=https://ivxholding.com${target}" />
</head>
<body>
<p>Redirecting to <a href="https://ivxholding.com${target}">IVX Holdings</a>…</p>
</body>
</html>`;
}

// ── Backend health proxy page ─────────────────────────
const backendHealthHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="robots" content="noindex" />
<title>IVX Backend Health</title>
</head>
<body>
<p>Redirecting to backend health…</p>
<script>window.location.replace('https://api.ivxholding.com/health');</script>
<meta http-equiv="refresh" content="0; url=https://api.ivxholding.com/health" />
</body>
</html>`;

async function deploy() {
  const edgeStatus = { redirectFunction: 'pending', error: null, updatedAt: null };
  console.log('═══════════════════════════════════════════════════');
  console.log('  IVX Holdings — S3/CloudFront Landing Page Deploy');
  console.log('═══════════════════════════════════════════════════');
  console.log('Bucket:', BUCKET, '| Region:', REGION, '| CloudFront:', DIST_ID);
  console.log('Build version:', BUILD_VER);
  console.log('');

  // ── Test bucket access (non-blocking — try uploads even if HeadBucket fails) ──
  let bucketAccessible = false;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    bucketAccessible = true;
    console.log('✅ Bucket accessible: YES');
  } catch (e) {
    console.warn('⚠️  HeadBucket check failed:', e?.name || 'Unknown', e?.message || 'Unknown error');
    if (e?.$metadata) console.warn('   HTTP status:', e.$metadata.httpStatusCode || 'N/A', '| Request ID:', e.$metadata.requestId || 'N/A');
    if (e?.message && e.message.includes('CompromisedKeyQuarantine')) {
      console.error('');
      console.error('═══ AWS KEY QUARANTINED ═══');
      console.error('The AWS access key has been quarantined by AWS');
      console.error('(AWSCompromisedKeyQuarantineV3 policy attached).');
      console.error('This means AWS detected the key as compromised');
      console.error('(likely because it was hardcoded in source code');
      console.error('pushed to GitHub).');
      console.error('');
      console.error('OWNER ACTION REQUIRED:');
      console.error('1. Go to AWS IAM console');
      console.error('2. Delete the quarantined key');
      console.error('3. Create a new access key for a user with S3 + CloudFront permissions');
      console.error('4. Update GitHub secrets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
      console.error('5. NEVER hardcode credentials in source files');
      console.error('═══════════════════════════');
      process.exit(1);
    }
    console.warn('   Continuing anyway — will try direct PutObject (IAM may allow PutObject without ListBucket)...');
  }

  let ok = 0, fail = 0;
  const results = [];

  // ── HTML files (no-cache, security headers) ─────────────────
  const htmlFiles = [
    { path: LANDING_DIR + '/index.html', key: 'index.html', inject: true },
    { path: LANDING_DIR + '/capture.html', key: 'capture.html' },
    { path: LANDING_DIR + '/capture.html', key: 'capture' },
    { path: LANDING_DIR + '/enterprise-register.html', key: 'enterprise-register.html', injectBackend: true },
    { path: LANDING_DIR + '/enterprise-register.html', key: 'enterprise-register', injectBackend: true },
    { path: LANDING_DIR + '/reset-password.html', key: 'reset-password.html', injectBackend: true },
    { path: LANDING_DIR + '/reset-password.html', key: 'reset-password', injectBackend: true },
    // ── Standalone legal pages ──
    { path: LANDING_DIR + '/privacy.html', key: 'privacy.html' },
    { path: LANDING_DIR + '/terms.html', key: 'terms.html' },
    { path: LANDING_DIR + '/disclosures.html', key: 'disclosures.html' },
    { path: LANDING_DIR + '/cookie.html', key: 'cookie.html' },
    { path: LANDING_DIR + '/legal.html', key: 'legal.html' },
  ];

  for (const f of htmlFiles) {
    if (!existsSync(f.path)) { console.log('SKIP', f.key, '— not found'); fail++; continue; }
    let body = readFileSync(f.path, 'utf-8');
    if (f.inject) body = injectConfig(body);
    if (f.injectBackend) {
      body = body.replace(/__IVX_API_BASE_URL__/g, 'https://api.ivxholding.com');
      body = body.replace(/__IVX_BACKEND_URL__/g, 'https://api.ivxholding.com');
    }
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: f.key, Body: body,
        ContentType: 'text/html; charset=utf-8',
        CacheControl: 'no-cache, no-store, must-revalidate',
        // Security headers via S3 metadata (CloudFront can forward these)
        Metadata: {
          'x-ivx-hsts': 'max-age=31536000; includeSubDomains; preload',
          'x-ivx-xfo': 'DENY',
          'x-ivx-xcto': 'nosniff',
          'x-ivx-referrer': 'strict-origin-when-cross-origin',
          'x-ivx-permissions': 'geolocation=(), microphone=(), camera=(), payment=()',
        },
      }));
      console.log('✅ UPLOADED', f.key, '(' + body.length + ' bytes)');
      results.push({ key: f.key, status: 'ok', size: body.length });
      ok++;
    } catch (e) {
      console.error('❌ FAILED', f.key + ':', e?.name || 'Unknown', e?.message || 'Unknown error');
      if (e?.$metadata) console.error('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
      if (e?.message && e.message.includes('CompromisedKeyQuarantine')) {
        console.error('═══ AWS KEY QUARANTINED — aborting deploy ═══');
        process.exit(1);
      }
      results.push({ key: f.key, status: 'fail', error: e?.message || 'Unknown' });
      fail++;
    }
  }

  // ── Redirect files for retired routes ──────────────
  const redirects = [
    { key: 'register', target: '/#join', route: 'Smart Funnel → Member Registration' },
    { key: 'invest-now', target: '/#join', route: 'Smart Funnel → Member Registration' },
    { key: 'deal', target: '/#properties', route: 'Properties' },
    { key: 'register.html', target: '/#join', route: 'Smart Funnel → Member Registration' },
    { key: 'invest-now.html', target: '/#join', route: 'Smart Funnel → Member Registration' },
    { key: 'backend/health', target: 'https://api.ivxholding.com/health', route: 'Backend Health (external)' },
  ];

  for (const r of redirects) {
    const body = r.key === 'backend/health' ? backendHealthHTML : redirectHTML(r.target, r.key);
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: r.key, Body: body,
        ContentType: 'text/html; charset=utf-8',
        CacheControl: 'no-cache, no-store, must-revalidate',
      }));
      console.log('✅ REDIRECT', r.key, '→', r.target, '(' + r.route + ')');
      results.push({ key: r.key, status: 'redirect', target: r.target });
      ok++;
    } catch (e) {
      console.error('❌ FAILED redirect', r.key + ':', e.message);
      results.push({ key: r.key, status: 'fail', error: e.message });
      fail++;
    }
  }

  // ── CSS/JS files (immutable, long cache, security headers) ───
  const assetFiles = [
    { path: LANDING_DIR + '/ivx-styles.css', key: 'ivx-styles.css', type: 'text/css; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-app.js', key: 'ivx-app.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-app.js', key: 'ivx-app-landing-e2e-20260818.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-analytics.js', key: 'ivx-analytics.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-home-feed.js', key: 'ivx-home-feed.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-invest.js', key: 'ivx-invest.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-portal.js', key: 'ivx-portal.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-portal-20260822.js', key: 'ivx-portal-20260822.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-reels.js', key: 'ivx-reels.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-reels.js', key: 'ivx-reels-landing-e2e-20260818.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-reels.js', key: 'ivx-reels-landing-e2e-20260818-2.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-reels.js', key: 'ivx-reels-landing-e2e-20260818-3.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-reels.js', key: 'ivx-reels-landing-e2e-20260818-4.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-lazy-bridge.js', key: 'ivx-lazy-bridge.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-lazy-bridge-20260822.js', key: 'ivx-lazy-bridge-20260822.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-lazy-bridge.js', key: 'ivx-lazy-bridge-owner-portal-2.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-csp-actions.js', key: 'ivx-csp-actions-20260818.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-csp-actions.js', key: 'ivx-csp-actions-20260818-2.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-csp-actions.js', key: 'ivx-csp-actions-20260818-3.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-csp-actions.js', key: 'ivx-csp-actions-20260818-4.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-ui-utils.js', key: 'ivx-ui-utils.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-web-vitals.js', key: 'ivx-web-vitals.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-wire.js', key: 'ivx-wire.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-wire.js', key: 'ivx-wire-landing-e2e-20260818.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/landing-support-chat.js', key: 'landing-support-chat.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/landing-support-chat.css', key: 'landing-support-chat.css', type: 'text/css; charset=utf-8' },
  ];

  for (const f of assetFiles) {
    if (!existsSync(f.path)) { console.log('SKIP', f.key, '— not found'); fail++; continue; }
    const body = readFileSync(f.path);
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: f.key, Body: body,
        ContentType: f.type,
        CacheControl: 'public, max-age=31536000, immutable',
        Metadata: {
          'x-ivx-xcto': 'nosniff',
        },
      }));
      console.log('✅ UPLOADED', f.key, '(' + body.length + ' bytes, immutable cache)');
      results.push({ key: f.key, status: 'ok', size: body.length });
      ok++;
    } catch (e) {
      console.error('❌ FAILED', f.key + ':', e.message);
      results.push({ key: f.key, status: 'fail', error: e.message });
      fail++;
    }
  }

  // ── Image files (immutable) ────────────────────────
  const imageFiles = [
    { path: LANDING_DIR + '/ivx-inline-img-1.png', key: 'ivx-inline-img-1.png', type: 'image/png' },
    { path: LANDING_DIR + '/ivx-inline-img-2.png', key: 'ivx-inline-img-2.png', type: 'image/png' },
    { path: ASSETS_DIR + '/ivx-logo.png', key: 'ivx-logo.png', type: 'image/png' },
    { path: ASSETS_DIR + '/ivx-symbol.png', key: 'ivx-symbol.png', type: 'image/png' },
    { path: ASSETS_DIR + '/ivx-og-image.png', key: 'ivx-og-image.png', type: 'image/png' },
    { path: ASSETS_DIR + '/favicon.png', key: 'favicon.png', type: 'image/png' },
    // Favicon .ico — served from LANDING_DIR, must be image/x-icon not SPA fallback HTML
    { path: LANDING_DIR + '/favicon.ico', key: 'favicon.ico', type: 'image/x-icon' },
    // Favicon variants referenced in index.html
    { path: ASSETS_DIR + '/favicon-16.png', key: 'favicon-16.png', type: 'image/png' },
    { path: ASSETS_DIR + '/favicon-32.png', key: 'favicon-32.png', type: 'image/png' },
    { path: ASSETS_DIR + '/favicon-180.png', key: 'favicon-180.png', type: 'image/png' },
    { path: ASSETS_DIR + '/favicon-192.png', key: 'favicon-192.png', type: 'image/png' },
  ];

  for (const f of imageFiles) {
    if (!existsSync(f.path)) { console.log('SKIP', f.key, '— not found'); continue; }
    const body = readFileSync(f.path);
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: f.key, Body: body,
        ContentType: f.type,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      console.log('✅ UPLOADED', f.key, '(' + body.length + ' bytes)');
      results.push({ key: f.key, status: 'ok', size: body.length });
      ok++;
    } catch (e) {
      console.error('❌ FAILED', f.key + ':', e?.name || 'Unknown', e?.message || 'Unknown error');
      if (e?.$metadata) console.error('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
      results.push({ key: f.key, status: 'fail', error: e?.message || 'Unknown' });
      fail++;
    }
  }

  // ── Config files (no-cache) ────────────────────────
  const configFiles = [
    { path: LANDING_DIR + '/robots.txt', key: 'robots.txt', type: 'text/plain; charset=utf-8', cache: 'public, max-age=3600' },
    { path: LANDING_DIR + '/sitemap.xml', key: 'sitemap.xml', type: 'application/xml; charset=utf-8', cache: 'public, max-age=3600' },
  ];

  for (const f of configFiles) {
    if (!existsSync(f.path)) { console.log('SKIP', f.key, '— not found'); continue; }
    const body = readFileSync(f.path, 'utf-8');
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: f.key, Body: body,
        ContentType: f.type, CacheControl: f.cache,
      }));
      console.log('✅ UPLOADED', f.key, '(' + body.length + ' bytes)');
      results.push({ key: f.key, status: 'ok', size: body.length });
      ok++;
    } catch (e) {
      console.error('❌ FAILED', f.key + ':', e?.name || 'Unknown', e?.message || 'Unknown error');
      if (e?.$metadata) console.error('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
      results.push({ key: f.key, status: 'fail', error: e?.message || 'Unknown' });
      fail++;
    }
  }

  // ── ivx-config.json (no-cache, injected) ───────────
  const config = JSON.stringify({
    version: BUILD_VER,
    gitSha: process.env.GIT_SHA || 'local-build',
    builtAt: new Date().toISOString(),
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_PUBLISHABLE_KEY || IVX_PUBLIC_SUPABASE_KEY,
    apiBaseUrl: 'https://api.ivxholding.com',
    backendUrl: 'https://api.ivxholding.com',
    analytics: {
      googleAdsKey: process.env.EXPO_PUBLIC_GOOGLE_ADS_KEY || '',
      metaPixelId: process.env.EXPO_PUBLIC_META_PIXEL_ID || '',
      tiktokPixelId: process.env.EXPO_PUBLIC_TIKTOK_PIXEL_ID || '',
      linkedinPartnerId: process.env.EXPO_PUBLIC_LINKEDIN_PARTNER_ID || '',
    },
  }, null, 2);
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: 'ivx-config.json', Body: config,
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log('✅ UPLOADED ivx-config.json (version:', BUILD_VER + ')');
    results.push({ key: 'ivx-config.json', status: 'ok' });
    ok++;
  } catch (e) {
    console.error('❌ FAILED ivx-config.json:', e?.name || 'Unknown', e?.message || 'Unknown error');
    if (e?.$metadata) console.error('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
    results.push({ key: 'ivx-config.json', status: 'fail', error: e?.message || 'Unknown' });
    fail++;
  }

  // ── APK file (if exists) ────────────────────────────
  if (existsSync(APK_PATH)) {
    const apkBody = readFileSync(APK_PATH);
    const apkKeys = [
      { key: 'apk/download', disposition: 'attachment; filename="ivx-holdings-v1.10.14.apk"' },
      { key: 'apk/ivx-holdings-v1.10.14.apk', disposition: 'attachment; filename="ivx-holdings-v1.10.14.apk"' },
    ];
    for (const a of apkKeys) {
      try {
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET, Key: a.key, Body: apkBody,
          ContentType: 'application/vnd.android.package-archive',
          ContentDisposition: a.disposition,
          CacheControl: 'public, max-age=86400',
        }));
        console.log('✅ UPLOADED', a.key, '(' + apkBody.length + ' bytes, APK)');
        results.push({ key: a.key, status: 'ok', size: apkBody.length, type: 'apk' });
        ok++;
      } catch (e) {
        console.error('❌ FAILED', a.key + ':', e?.name || 'Unknown', e?.message || 'Unknown error');
        results.push({ key: a.key, status: 'fail', error: e?.message || 'Unknown' });
        fail++;
      }
    }
  } else {
    console.log('⚠️  APK not found at', APK_PATH, '— skipping APK upload');
    results.push({ key: 'apk/download', status: 'skipped', reason: 'APK not built' });
  }

  // ── CloudFront Response Headers Policy (security headers) ───────
  console.log('');
  console.log('CloudFront Response Headers Policy...');
  const POLICY_NAME = 'IVXSecurityHeaders';
  let policyETag = '';
  let policyId = '';

  try {
    // List existing policies to find ours
    const listRes = await cf.send(new ListResponseHeadersPoliciesCommand({}));
    const existing = listRes.ResponseHeadersPolicyList?.Items?.find(
      (p) => p.ResponseHeadersPolicy?.ResponseHeadersPolicyConfig?.Name === POLICY_NAME
    );

    if (existing?.ResponseHeadersPolicy?.Id) {
      policyId = existing.ResponseHeadersPolicy.Id;
      console.log('  Found existing policy:', policyId);
      const getRes = await cf.send(new GetResponseHeadersPolicyCommand({ Id: policyId }));
      policyETag = getRes.ETag || '';
    }
  } catch (e) {
    console.warn('  Could not list existing policies:', e?.message || 'Unknown');
  }

  const policyConfig = {
    Name: POLICY_NAME,
    Comment: 'Security headers for IVX Holdings landing page',
    CorsConfig: {
      AccessControlAllowOrigins: { Quantity: 1, Items: ['https://ivxholding.com'] },
      AccessControlAllowHeaders: { Quantity: 3, Items: ['Content-Type', 'Authorization', 'X-Requested-With'] },
      AccessControlAllowMethods: { Quantity: 2, Items: ['GET', 'OPTIONS'] },
      AccessControlAllowCredentials: false,
      OriginOverride: false,
    },
    SecurityHeadersConfig: {
      StrictTransportSecurity: {
        AccessControlMaxAgeSec: 31536000,
        IncludeSubdomains: true,
        Preload: true,
        Override: true,
      },
      FrameOptions: { FrameOption: 'DENY', Override: true },
      ContentTypeOptions: { Override: true },
      ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
      XSSProtection: { Protection: true, ModeBlock: true, Override: true },
    },
  };

  try {
    if (policyId) {
      console.log('  Policy already exists:', policyId);
    } else {
      const createRes = await cf.send(new CreateResponseHeadersPolicyCommand({
        ResponseHeadersPolicyConfig: policyConfig,
      }));
      policyId = createRes.ResponseHeadersPolicy?.Id || '';
      console.log('  Created policy:', policyId);
    }
  } catch (e) {
    console.warn('  Could not create/find policy:', e?.message || 'Unknown');
  }

  // Attach security policy and host redirect to the distribution. The redirect
  // is independent of the optional response-headers policy.
  let redirectFunctionArn = '';
  try {
    redirectFunctionArn = await ensureWwwRedirectFunction();
  } catch (e) {
    edgeStatus.redirectFunction = 'failed';
    edgeStatus.error = `${e?.name || 'Unknown'}: ${e?.message || 'Unknown error'}`;
    console.warn('  Could not publish www redirect function:', e?.message || 'Unknown');
  }
  if (policyId || redirectFunctionArn) {
    try {
      const distRes = await cf.send(new GetDistributionConfigCommand({ Id: DIST_ID }));
      const distConfig = distRes.DistributionConfig;
      const currentETag = distRes.ETag || '';

      if (distConfig) {
        if (!distConfig.DefaultCacheBehavior) {
          distConfig.DefaultCacheBehavior = {
            TargetOriginId: distConfig.Origins?.Items?.[0]?.Id || 'ivxholding-origin',
            ViewerProtocolPolicy: 'redirect-to-https',
            TrustedSigners: { Enabled: false, Quantity: 0 },
            ForwardedValues: { QueryString: false, Cookies: { Forward: 'none' } },
            MinTTL: 0,
          };
        }

        const currentPolicyId = distConfig.DefaultCacheBehavior.ResponseHeadersPolicyId;
        const policyChanged = Boolean(policyId && currentPolicyId !== policyId);
        const currentAssociations = distConfig.DefaultCacheBehavior.FunctionAssociations?.Items || [];
        const otherAssociations = currentAssociations.filter((item) => item.EventType !== 'viewer-request');
        const hasRedirectFunction = Boolean(redirectFunctionArn && currentAssociations.some((item) => item.EventType === 'viewer-request' && item.FunctionARN === redirectFunctionArn));
        if (redirectFunctionArn && !hasRedirectFunction) {
          distConfig.DefaultCacheBehavior.FunctionAssociations = {
            Quantity: otherAssociations.length + 1,
            Items: [...otherAssociations, { EventType: 'viewer-request', FunctionARN: redirectFunctionArn }],
          };
        }
        if (policyChanged || (redirectFunctionArn && !hasRedirectFunction)) {
          if (policyId) distConfig.DefaultCacheBehavior.ResponseHeadersPolicyId = policyId;

          await cf.send(new UpdateDistributionCommand({
            Id: DIST_ID,
            DistributionConfig: distConfig,
            IfMatch: currentETag,
          }));
          console.log('  ✅ Attached security headers and www redirect function to distribution');
          edgeStatus.redirectFunction = 'attached';
        } else {
          console.log('  Security policy and www redirect function already attached');
          edgeStatus.redirectFunction = 'attached';
        }
      }
    } catch (e) {
      console.warn('  Could not attach policy to distribution:', e?.message || 'Unknown');
      edgeStatus.redirectFunction = 'failed';
      edgeStatus.error = `${e?.name || 'Unknown'}: ${e?.message || 'Unknown error'}`;
      if (e?.$metadata) console.warn('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
    }
  }

  // ── www.ivxholding.com S3 bucket redirect to apex ──
  console.log('');
  console.log('Configuring www bucket redirect...');
  try {
    const wwwBucket = 'www.ivxholding.com';
    try {
      await s3.send(new HeadBucketCommand({ Bucket: wwwBucket }));
      console.log('  www bucket is reachable');
    } catch (e) {
      // HeadBucket can return 403 when the deploy identity may configure the
      // website but cannot list/inspect the bucket. Do not misreport that as a
      // confirmed missing bucket; PutBucketWebsite below is the real check.
      console.warn('  www bucket preflight unavailable; attempting redirect configuration directly');
      if (e?.$metadata) console.warn('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
    }
    if (true) {
      await s3.send(new PutBucketWebsiteCommand({
        Bucket: wwwBucket,
        WebsiteConfiguration: {
          RedirectAllRequestsTo: {
            HostName: 'ivxholding.com',
            Protocol: 'https',
          },
        },
      }));
      console.log('✅ www.ivxholding.com → ivxholding.com redirect configured');
    }
  } catch (e) {
    console.error('❌ www redirect setup FAILED:', e?.name || 'Unknown', e?.message || 'Unknown error');
    if (e?.$metadata) console.error('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
  }

  edgeStatus.updatedAt = new Date().toISOString();
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'deployment-edge-status.json',
      Body: JSON.stringify(edgeStatus, null, 2),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
  } catch (e) {
    console.warn('  Could not publish edge status:', e?.message || 'Unknown');
  }

  // ── CloudFront invalidation (create + wait until Completed) ──
  console.log('');
  console.log('CloudFront invalidation...');
  let invalidationId = '';
  try {
    const inv = await cf.send(new CreateInvalidationCommand({
      DistributionId: DIST_ID,
      InvalidationBatch: {
        CallerReference: 'ivx-deploy-' + Date.now(),
        Paths: { Quantity: 1, Items: ['/*'] },
      },
    }));
    invalidationId = inv.Invalidation?.Id || '';
    console.log('✅ CloudFront invalidation created:', invalidationId);
  } catch (e) {
    console.error('❌ CloudFront invalidation FAILED:', e?.name || 'Unknown', e?.message || 'Unknown error');
    if (e?.$metadata) console.error('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
    process.exit(1);
  }

  let invalidationStatus = '';
  if (invalidationId) {
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      try {
        const gi = await cf.send(new GetInvalidationCommand({ DistributionId: DIST_ID, Id: invalidationId }));
        invalidationStatus = gi.Invalidation?.Status || '';
        console.log('  invalidation', invalidationId, 'status:', invalidationStatus, '| progress:', gi.Invalidation?.Progress || 'N/A');
        if (invalidationStatus === 'Completed') {
          console.log('✅ CloudFront invalidation COMPLETED:', invalidationId);
          break;
        }
      } catch (e) {
        console.warn('  GetInvalidation check failed:', e?.name || 'Unknown', e?.message || 'Unknown error');
      }
    }
    if (invalidationStatus !== 'Completed') {
      console.error('❌ CloudFront invalidation did not reach Completed. Final status:', invalidationStatus || 'unknown', '| ID:', invalidationId);
      process.exit(1);
    }
  }

  // ── Summary ────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  DEPLOY SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log('  ✅ Uploaded:', ok);
  console.log('  ❌ Failed:', fail);
  console.log('  Total files:', ok + fail);
  console.log('  Build version:', BUILD_VER);
  console.log('═══════════════════════════════════════════════════');

  // Abort early if ALL uploads fail and bucket wasn't accessible
  if (fail > 0 && ok === 0) {
    console.error('═══════════════════════════════════════════════════');
    console.error('  ALL UPLOADS FAILED. The AWS key likely lacks s3:PutObject');
    console.error('  permission or has been quarantined by AWS.');
    console.error('  OWNER: Verify IAM permissions or rotate the key.');
    console.error('═══════════════════════════════════════════════════');
    process.exit(1);
  }

  // Write results for verification
  writeFileSync(LANDING_DIR + '/deploy-results.json', JSON.stringify({ ok, fail, results, buildVer: BUILD_VER, invalidationId, invalidationStatus, timestamp: new Date().toISOString() }, null, 2));

  return { ok, fail };
}

deploy().catch(e => { console.error('FATAL:', e?.name || 'Unknown', e?.message || 'Unknown error'); process.exit(1); });
