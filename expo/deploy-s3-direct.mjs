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
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';

// ── AWS Configuration ─────────────────────────────────
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || process.env.IVX_AWS_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || process.env.IVX_AWS_SECRET_ACCESS_KEY || '';
const REGION = process.env.AWS_REGION || 'us-east-1';
const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || '';
const BUCKET = process.env.S3_BUCKET_NAME || 'ivxholding.com';

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

const LANDING_DIR = '/home/user/rork-app/expo/ivxholding-landing';
const ASSETS_DIR = '/home/user/rork-app/expo/assets/images';
const APK_PATH = '/tmp/ivx-holdings-1.10.13.apk';

// Build version for cache-busting
const BUILD_VER = 'v' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

// ── Config injection ──────────────────────────────────
function injectConfig(html) {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
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
  console.log('═══════════════════════════════════════════════════');
  console.log('  IVX Holdings — S3/CloudFront Landing Page Deploy');
  console.log('═══════════════════════════════════════════════════');
  console.log('Bucket:', BUCKET, '| Region:', REGION, '| CloudFront:', DIST_ID);
  console.log('Build version:', BUILD_VER);
  console.log('');

  // ── Test bucket access ──────────────────────────────
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log('✅ Bucket accessible: YES');
  } catch (e) {
    console.error('❌ Bucket access FAILED:', e.name, e.message);
    if (e.message && e.message.includes('CompromisedKeyQuarantine')) {
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
      console.error('4. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars');
      console.error('5. NEVER hardcode credentials in source files');
      console.error('═══════════════════════════');
    }
    process.exit(1);
  }

  let ok = 0, fail = 0;
  const results = [];

  // ── HTML files (no-cache) ───────────────────────────
  const htmlFiles = [
    { path: LANDING_DIR + '/index.html', key: 'index.html', inject: true },
    { path: LANDING_DIR + '/capture.html', key: 'capture.html' },
    { path: LANDING_DIR + '/capture.html', key: 'capture' },
    { path: LANDING_DIR + '/enterprise-register.html', key: 'enterprise-register.html', injectBackend: true },
    { path: LANDING_DIR + '/enterprise-register.html', key: 'enterprise-register', injectBackend: true },
    { path: LANDING_DIR + '/reset-password.html', key: 'reset-password.html', injectBackend: true },
    { path: LANDING_DIR + '/reset-password.html', key: 'reset-password', injectBackend: true },
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
      }));
      console.log('✅ UPLOADED', f.key, '(' + body.length + ' bytes)');
      results.push({ key: f.key, status: 'ok', size: body.length });
      ok++;
    } catch (e) {
      console.error('❌ FAILED', f.key + ':', e.message);
      results.push({ key: f.key, status: 'fail', error: e.message });
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

  // ── CSS/JS files (immutable, long cache) ───────────
  const assetFiles = [
    { path: LANDING_DIR + '/ivx-styles.css', key: 'ivx-styles.css', type: 'text/css; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-app.js', key: 'ivx-app.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-home-feed.js', key: 'ivx-home-feed.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-invest.js', key: 'ivx-invest.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-portal.js', key: 'ivx-portal.js', type: 'application/javascript; charset=utf-8' },
    { path: LANDING_DIR + '/ivx-reels.js', key: 'ivx-reels.js', type: 'application/javascript; charset=utf-8' },
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

  // ── Extracted base64 images (immutable) ────────────
  const imageFiles = [
    { path: LANDING_DIR + '/ivx-inline-img-1.png', key: 'ivx-inline-img-1.png', type: 'image/png' },
    { path: LANDING_DIR + '/ivx-inline-img-2.png', key: 'ivx-inline-img-2.png', type: 'image/png' },
    { path: ASSETS_DIR + '/ivx-logo.png', key: 'ivx-logo.png', type: 'image/png' },
    { path: ASSETS_DIR + '/ivx-symbol.png', key: 'ivx-symbol.png', type: 'image/png' },
    { path: ASSETS_DIR + '/ivx-og-image.png', key: 'ivx-og-image.png', type: 'image/png' },
    { path: ASSETS_DIR + '/favicon.png', key: 'favicon.png', type: 'image/png' },
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
      console.error('❌ FAILED', f.key + ':', e.message);
      results.push({ key: f.key, status: 'fail', error: e.message });
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
      console.error('❌ FAILED', f.key + ':', e.message);
      results.push({ key: f.key, status: 'fail', error: e.message });
      fail++;
    }
  }

  // ── ivx-config.json (no-cache, injected) ───────────
  const config = JSON.stringify({
    version: BUILD_VER,
    gitSha: process.env.GIT_SHA || 'local-build',
    builtAt: new Date().toISOString(),
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
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
    console.error('❌ FAILED ivx-config.json:', e.message);
    results.push({ key: 'ivx-config.json', status: 'fail', error: e.message });
    fail++;
  }

  // ── APK file (if exists) ────────────────────────────
  if (existsSync(APK_PATH)) {
    const apkBody = readFileSync(APK_PATH);
    const apkKeys = [
      { key: 'apk/download', disposition: 'attachment; filename="ivx-holdings-v1.10.13.apk"' },
      { key: 'apk/ivx-holdings-v1.10.13.apk', disposition: 'attachment; filename="ivx-holdings-v1.10.13.apk"' },
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
        console.error('❌ FAILED', a.key + ':', e.message);
        results.push({ key: a.key, status: 'fail', error: e.message });
        fail++;
      }
    }
  } else {
    console.log('⚠️  APK not found at', APK_PATH, '— skipping APK upload');
    results.push({ key: 'apk/download', status: 'skipped', reason: 'APK not built' });
  }

  // ── CloudFront invalidation ────────────────────────
  console.log('');
  console.log('CloudFront invalidation...');
  try {
    const inv = await cf.send(new CreateInvalidationCommand({
      DistributionId: DIST_ID,
      InvalidationBatch: {
        CallerReference: 'ivx-deploy-' + Date.now(),
        Paths: { Quantity: 1, Items: ['/*'] },
      },
    }));
    console.log('✅ CloudFront invalidated:', inv.Invalidation?.Id || 'unknown');
  } catch (e) {
    console.error('❌ CloudFront invalidation FAILED:', e.message);
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

  // Write results for verification
  writeFileSync(LANDING_DIR + '/deploy-results.json', JSON.stringify({ ok, fail, results, buildVer: BUILD_VER, timestamp: new Date().toISOString() }, null, 2));

  return { ok, fail };
}

deploy().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
