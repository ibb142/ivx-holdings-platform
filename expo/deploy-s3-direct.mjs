import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { readFileSync, existsSync } from 'fs';

const ACCESS_KEY = 'AKIASAJBIV7CECCECRRV';
const SECRET_KEY = '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';
const REGION = 'us-east-1';
const DIST_ID = 'E1C0DEI0VKCUYN';
const BUCKET = 'ivxholding.com';

const s3 = new S3Client({ region: REGION, credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } });
const cf = new CloudFrontClient({ region: 'us-east-1', credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } });

const LANDING_DIR = '/home/user/rork-app/expo/ivxholding-landing';
const ASSETS_DIR = '/home/user/rork-app/expo/assets/images';

function injectConfig(html) {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const apiUrl = 'https://api.ivxholding.com';
  html = html.replace(/__IVX_API_BASE_URL__/g, apiUrl);
  html = html.replace(/__IVX_SUPABASE_URL__/g, supabaseUrl);
  html = html.replace(/__IVX_SUPABASE_ANON_KEY__/g, supabaseKey);
  html = html.replace(/__IVX_BACKEND_URL__/g, apiUrl);
  html = html.replace(/__IVX_APP_URL__/g, '');
  html = html.replace(/__IVX_GOOGLE_ADS_KEY__/g, '');
  html = html.replace(/__IVX_META_PIXEL_ID__/g, '');
  html = html.replace(/__IVX_TIKTOK_PIXEL_ID__/g, '');
  html = html.replace(/__IVX_LINKEDIN_PARTNER_ID__/g, '');
  return html;
}

async function deploy() {
  console.log('S3 Landing Deploy — starting');
  console.log('Bucket: ' + BUCKET + ' | Region: ' + REGION);

  // Test bucket access
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log('Bucket accessible: YES');
  } catch (e) {
    console.error('Bucket access FAILED: ' + e.message);
    process.exit(1);
  }

  let ok = 0, fail = 0;

  const files = [
    { path: LANDING_DIR + '/index.html', key: 'index.html', type: 'text/html; charset=utf-8', cache: 'no-cache, no-store, must-revalidate', inject: true },
    { path: LANDING_DIR + '/capture.html', key: 'capture.html', type: 'text/html; charset=utf-8', cache: 'no-cache, no-store, must-revalidate' },
    { path: LANDING_DIR + '/capture.html', key: 'capture', type: 'text/html; charset=utf-8', cache: 'no-cache, no-store, must-revalidate' },
    { path: LANDING_DIR + '/enterprise-register.html', key: 'enterprise-register.html', type: 'text/html; charset=utf-8', cache: 'no-cache, no-store, must-revalidate', injectBackend: true },
    { path: LANDING_DIR + '/enterprise-register.html', key: 'enterprise-register', type: 'text/html; charset=utf-8', cache: 'no-cache, no-store, must-revalidate', injectBackend: true },
    { path: LANDING_DIR + '/reset-password.html', key: 'reset-password.html', type: 'text/html; charset=utf-8', cache: 'no-cache, no-store, must-revalidate', injectBackend: true },
    { path: LANDING_DIR + '/reset-password.html', key: 'reset-password', type: 'text/html; charset=utf-8', cache: 'no-cache, no-store, must-revalidate', injectBackend: true },
    { path: LANDING_DIR + '/robots.txt', key: 'robots.txt', type: 'text/plain; charset=utf-8', cache: 'public, max-age=3600' },
    { path: LANDING_DIR + '/sitemap.xml', key: 'sitemap.xml', type: 'application/xml; charset=utf-8', cache: 'public, max-age=3600' },
    { path: LANDING_DIR + '/ivx-reels.js', key: 'ivx-reels.js', type: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
    { path: LANDING_DIR + '/ivx-home-feed.js', key: 'ivx-home-feed.js', type: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
    { path: LANDING_DIR + '/ivx-invest.js', key: 'ivx-invest.js', type: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
    { path: LANDING_DIR + '/ivx-portal.js', key: 'ivx-portal.js', type: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
    { path: LANDING_DIR + '/landing-support-chat.js', key: 'landing-support-chat.js', type: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
    { path: LANDING_DIR + '/landing-support-chat.css', key: 'landing-support-chat.css', type: 'text/css; charset=utf-8', cache: 'public, max-age=300' },
  ];

  for (const f of files) {
    if (!existsSync(f.path)) { console.log('SKIP ' + f.key + ' — not found'); fail++; continue; }
    let body = readFileSync(f.path, 'utf-8');
    if (f.inject) {
      body = injectConfig(body);
      const spinners = (body.match(/spinner/gi) || []).length;
      const pulses = (body.match(/ivx-pulse/gi) || []).length;
      console.log('index.html: ' + spinners + ' spinner refs, ' + pulses + ' ivx-pulse refs');
    }
    if (f.injectBackend) {
      body = body.replace(/__IVX_API_BASE_URL__/g, 'https://api.ivxholding.com');
      body = body.replace(/__IVX_BACKEND_URL__/g, 'https://api.ivxholding.com');
    }
    try {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: f.key, Body: body, ContentType: f.type, CacheControl: f.cache }));
      console.log('UPLOADED ' + f.key + ' (' + body.length + ' bytes)');
      ok++;
    } catch (e) {
      console.error('FAILED ' + f.key + ': ' + e.message);
      fail++;
    }
  }

  // Brand assets
  const assets = [
    { src: ASSETS_DIR + '/ivx-logo.png', key: 'ivx-logo.png', type: 'image/png' },
    { src: ASSETS_DIR + '/ivx-symbol.png', key: 'ivx-symbol.png', type: 'image/png' },
    { src: ASSETS_DIR + '/ivx-og-image.png', key: 'ivx-og-image.png', type: 'image/png' },
    { src: ASSETS_DIR + '/favicon.png', key: 'favicon.png', type: 'image/png' },
  ];
  for (const a of assets) {
    if (!existsSync(a.src)) { console.log('SKIP ' + a.key + ' — not found'); fail++; continue; }
    const buf = readFileSync(a.src);
    try {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: a.key, Body: buf, ContentType: a.type, CacheControl: 'public, max-age=86400' }));
      console.log('UPLOADED ' + a.key + ' (' + buf.length + ' bytes)');
      ok++;
    } catch (e) {
      console.error('FAILED ' + a.key + ': ' + e.message);
      fail++;
    }
  }

  // ivx-config.json
  const config = JSON.stringify({
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
    apiBaseUrl: 'https://api.ivxholding.com',
    backendUrl: 'https://api.ivxholding.com',
    deployedAt: new Date().toISOString(),
  });
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'ivx-config.json', Body: config, ContentType: 'application/json', CacheControl: 'no-cache, no-store, must-revalidate' }));
    console.log('UPLOADED ivx-config.json');
    ok++;
  } catch (e) {
    console.error('FAILED ivx-config.json: ' + e.message);
    fail++;
  }

  // CloudFront invalidation
  console.log('CloudFront invalidation...');
  try {
    const inv = await cf.send(new CreateInvalidationCommand({
      DistributionId: DIST_ID,
      InvalidationBatch: { CallerReference: 'deploy-' + Date.now(), Paths: { Quantity: 1, Items: ['/*'] } },
    }));
    console.log('CloudFront invalidated: ' + inv.Invalidation?.Id);
  } catch (e) {
    console.error('CloudFront invalidation FAILED: ' + e.message);
  }

  console.log('DEPLOY COMPLETE: ' + ok + ' ok, ' + fail + ' failed');
}

deploy().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
