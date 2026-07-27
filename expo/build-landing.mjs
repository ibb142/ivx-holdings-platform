import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { fetchStaticLandingApiPayloads } from './scripts/landing-static-api.mjs';
import { injectLandingCardRenderer } from './scripts/landing-card-renderer-injector.mjs';
import { sanitizeLandingHtml } from './scripts/landing-html-sanitizer.mjs';

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

const SUPABASE_URL = sanitizeSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '');
const SUPABASE_ANON_KEY = sanitizeSupabaseAnonKey(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '');
const API_BASE_URL = sanitizeBackendUrl((process.env.EXPO_PUBLIC_IVX_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://ivxholding.com').trim().replace(/\/$/, ''));
const APP_URL = (process.env.EXPO_PUBLIC_APP_URL || process.env.EXPO_PUBLIC_IVX_API_BASE_URL || '').trim().replace(/\/$/, '');
const BACKEND_URL = sanitizeBackendUrl((process.env.EXPO_PUBLIC_IVX_API_BASE_URL || '').trim().replace(/\/$/, ''));
const GOOGLE_ADS_KEY = (process.env.EXPO_PUBLIC_GOOGLE_ADS_API_KEY || '').trim();
const META_PIXEL_ID = (process.env.META_PIXEL_ID || '').trim();
const TIKTOK_PIXEL_ID = (process.env.TIKTOK_PIXEL_ID || '').trim();
const LINKEDIN_PARTNER_ID = (process.env.LINKEDIN_PARTNER_ID || '').trim();

console.log('🔨 Building IVX Holdings landing page with credentials...');
console.log('   Supabase URL:', SUPABASE_URL ? SUPABASE_URL.substring(0, 40) + '...' : '❌ NOT SET');
console.log('   Supabase Key:', SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.substring(0, 20) + '...' : '❌ NOT SET');
console.log('   API Base URL:', API_BASE_URL || '(default)');
console.log('   App URL:', APP_URL || '(not set)');
console.log('   Backend URL:', BACKEND_URL || '(not set)');
console.log('   Google Ads Key:', GOOGLE_ADS_KEY ? GOOGLE_ADS_KEY.substring(0, 15) + '...' : '(not set)');
console.log('   Meta Pixel ID:', META_PIXEL_ID || '(not set)');
console.log('   TikTok Pixel ID:', TIKTOK_PIXEL_ID || '(not set)');
console.log('   LinkedIn Partner ID:', LINKEDIN_PARTNER_ID || '(not set)');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('\n⚠️  Supabase credentials not found in env vars.');
  console.warn('   Landing page will discover credentials at runtime from backend.');
  console.warn('   For best performance, set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY before building.');
  console.warn('   Building anyway with runtime credential discovery enabled...\n');
}

let html = readFileSync('./ivxholding-landing/index.html', 'utf-8');
const sanitizedLandingHtml = sanitizeLandingHtml(html);
html = sanitizedLandingHtml.html;
if (sanitizedLandingHtml.duplicateBlockCount > 0) {
  console.log('   Removed duplicate landing runtime blocks:', sanitizedLandingHtml.duplicateBlockCount, '(markers:', sanitizedLandingHtml.markerOccurrences + ')');
}
html = injectLandingCardRenderer(html);

html = html.replace(/__IVX_SUPABASE_URL__/g, SUPABASE_URL);
html = html.replace(/__IVX_SUPABASE_ANON_KEY__/g, SUPABASE_ANON_KEY);
html = html.replace(/__IVX_API_BASE_URL__/g, API_BASE_URL);
html = html.replace(/__IVX_APP_URL__/g, APP_URL);
html = html.replace(/__IVX_BACKEND_URL__/g, BACKEND_URL);
html = html.replace(/__IVX_GOOGLE_ADS_KEY__/g, GOOGLE_ADS_KEY);
html = html.replace(/__IVX_META_PIXEL_ID__/g, META_PIXEL_ID);
html = html.replace(/__IVX_TIKTOK_PIXEL_ID__/g, TIKTOK_PIXEL_ID);
html = html.replace(/__IVX_LINKEDIN_PARTNER_ID__/g, LINKEDIN_PARTNER_ID);

// Also inject into JS variables and meta tags directly
html = html.replace(/var _FALLBACK_SUPABASE_URL = '[^']*';/, `var _FALLBACK_SUPABASE_URL = '${SUPABASE_URL}';`);
html = html.replace(/var _FALLBACK_SUPABASE_KEY = '[^']*';/, `var _FALLBACK_SUPABASE_KEY = '${SUPABASE_ANON_KEY}';`);
html = html.replace(/var _IVX_API_URL = '[^']*';/, `var _IVX_API_URL = '${API_BASE_URL}';`);
html = html.replace(/var _IVX_BACKEND_URL = '[^']*';/, `var _IVX_BACKEND_URL = '${BACKEND_URL}';`);

// Inject into meta tags content attributes
html = html.replace(/<meta\s+name="ivx-sb-url"\s+content="[^"]*"/, `<meta name="ivx-sb-url" content="${SUPABASE_URL}"`);
html = html.replace(/<meta\s+name="ivx-sb-key"\s+content="[^"]*"/, `<meta name="ivx-sb-key" content="${SUPABASE_ANON_KEY}"`);
html = html.replace(/<meta\s+name="ivx-sb-url-fallback"\s+content="[^"]*"/, `<meta name="ivx-sb-url-fallback" content="${SUPABASE_URL}"`);
html = html.replace(/<meta\s+name="ivx-sb-key-fallback"\s+content="[^"]*"/, `<meta name="ivx-sb-key-fallback" content="${SUPABASE_ANON_KEY}"`);
html = html.replace(/<meta\s+name="ivx-api-url"\s+content="[^"]*"/, `<meta name="ivx-api-url" content="${API_BASE_URL}"`);
html = html.replace(/<meta\s+name="ivx-backend-url"\s+content="[^"]*"/, `<meta name="ivx-backend-url" content="${BACKEND_URL}"`);
html = html.replace(/<meta\s+name="ivx-gads-key"\s+content="[^"]*"/, `<meta name="ivx-gads-key" content="${GOOGLE_ADS_KEY}"`);
html = html.replace(/<meta\s+name="ivx-meta-pixel-id"\s+content="[^"]*"/, `<meta name="ivx-meta-pixel-id" content="${META_PIXEL_ID}"`);
html = html.replace(/<meta\s+name="ivx-tiktok-pixel-id"\s+content="[^"]*"/, `<meta name="ivx-tiktok-pixel-id" content="${TIKTOK_PIXEL_ID}"`);
html = html.replace(/<meta\s+name="ivx-linkedin-partner-id"\s+content="[^"]*"/, `<meta name="ivx-linkedin-partner-id" content="${LINKEDIN_PARTNER_ID}"`);


console.log('   Injected credentials + ad pixel IDs into JS vars + meta tags');

const distDir = './ivxholding-landing/dist';
const distApiDir = distDir + '/api';
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}
if (!existsSync(distApiDir)) {
  mkdirSync(distApiDir, { recursive: true });
}

writeFileSync(distDir + '/index.html', html, 'utf-8');
console.log('   ✅ index.html built → ivxholding-landing/dist/index.html');

// Enterprise registration page (ITEM 2)
let enterpriseHtml = readFileSync('./ivxholding-landing/enterprise-register.html', 'utf-8');
enterpriseHtml = enterpriseHtml.replace(/__IVX_API_BASE_URL__/g, API_BASE_URL);
enterpriseHtml = enterpriseHtml.replace(/__IVX_BACKEND_URL__/g, BACKEND_URL);
writeFileSync(distDir + '/enterprise-register.html', enterpriseHtml, 'utf-8');
console.log('   ✅ enterprise-register.html built → ivxholding-landing/dist/enterprise-register.html');

copyFileSync('./ivxholding-landing/landing-support-chat.css', distDir + '/landing-support-chat.css');
copyFileSync('./ivxholding-landing/landing-support-chat.js', distDir + '/landing-support-chat.js');
console.log('   ✅ landing support chat assets copied → ivxholding-landing/dist/landing-support-chat.*');

const configJson = JSON.stringify({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  apiBaseUrl: API_BASE_URL,
  appUrl: APP_URL,
  backendUrl: BACKEND_URL,
  builtAt: new Date().toISOString(),
}, null, 2);

writeFileSync(distDir + '/ivx-config.json', configJson, 'utf-8');
console.log('   ✅ ivx-config.json built → ivxholding-landing/dist/ivx-config.json');

const { dealsPayload, healthPayload } = await fetchStaticLandingApiPayloads({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  directApiBaseUrl: BACKEND_URL || API_BASE_URL,
});
const dealsJson = JSON.stringify(dealsPayload, null, 2);
const healthJson = JSON.stringify(healthPayload, null, 2);
writeFileSync(distApiDir + '/landing-deals', dealsJson, 'utf-8');
writeFileSync(distApiDir + '/published-jv-deals', dealsJson, 'utf-8');
writeFileSync(distDir + '/health', healthJson, 'utf-8');
console.log('   ✅ static API JSON built → ivxholding-landing/dist/api/landing-deals');
console.log('   ✅ static API JSON built → ivxholding-landing/dist/api/published-jv-deals');
console.log('   ✅ static health JSON built → ivxholding-landing/dist/health');

console.log('\n🎉 BUILD COMPLETE!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Files ready in: ivxholding-landing/dist/');
console.log('');
console.log('To deploy to S3, either:');
console.log('');
console.log('  Option A — Use deploy script (handles bucket setup + upload):');
console.log('    AWS_ACCESS_KEY_ID="your-key" \\');
console.log('    AWS_SECRET_ACCESS_KEY="your-secret" \\');
console.log('    AWS_REGION="us-east-1" \\');
console.log(`    EXPO_PUBLIC_SUPABASE_URL="${SUPABASE_URL}" \\`);
console.log(`    EXPO_PUBLIC_SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}" \\`);
console.log('    node deploy-landing.mjs');
console.log('');
console.log('  Option B — Manual S3 upload:');
console.log('    aws s3 cp ivxholding-landing/dist/index.html s3://ivxholding.com/index.html \\');
console.log(`      --content-type "text/html" --cache-control "${LANDING_HTML_CACHE_CONTROL}"`);
console.log('    aws s3 cp ivxholding-landing/dist/ivx-config.json s3://ivxholding.com/ivx-config.json \\');
console.log(`      --content-type "application/json" --cache-control "${LANDING_CONFIG_CACHE_CONTROL}"`);
console.log('    aws s3 cp ivxholding-landing/dist/api/landing-deals s3://ivxholding.com/api/landing-deals \\');
console.log(`      --content-type "application/json" --cache-control "${LANDING_API_CACHE_CONTROL}"`);
console.log('    aws s3 cp ivxholding-landing/dist/api/published-jv-deals s3://ivxholding.com/api/published-jv-deals \\');
console.log(`      --content-type "application/json" --cache-control "${LANDING_API_CACHE_CONTROL}"`);
console.log('    aws s3 cp ivxholding-landing/dist/health s3://ivxholding.com/health \\');
console.log(`      --content-type "application/json" --cache-control "${LANDING_HEALTH_CACHE_CONTROL}"`);
console.log('');
console.log('  Option C — AWS Console:');
console.log('    1. Go to S3 → ivxholding.com bucket');
console.log('    2. Upload dist/index.html (replace existing)');
console.log('    3. Upload dist/ivx-config.json');
console.log('    4. Upload dist/api/landing-deals and dist/api/published-jv-deals');
console.log('    5. Upload dist/health');
console.log('    6. Set JSON Content-Type and enable CDN caching for API files and health payloads');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
