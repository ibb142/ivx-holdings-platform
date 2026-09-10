import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { completeLandingInvalidation } from '../expo/scripts/landing-cloudfront-invalidation.mjs';

const bucket = 'ivxholding.com';
const distributionId = 'E1C0DEI0VKCUYN';
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const brandFiles = ['ivx-logo.png', 'ivx-logo-master.png', 'ivx-symbol.png', 'ivx-og-image.png',
  'favicon.png', 'favicon-16.png', 'favicon-32.png', 'favicon-180.png', 'favicon-192.png'];

// Build only from reviewed files and explicitly public settings. AWS credentials
// are consumed by the AWS SDK in this process, never placed in an HTTP body or asset.
export function buildLandingRelease(root, env, checkoutSha) {
  const sha = env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || '') || sha !== checkoutSha) throw new Error('Landing checkout SHA mismatch');
  const supabaseUrl = (env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const supabaseKey = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) throw new Error('Public Supabase URL missing or invalid');
  let publicKey = supabaseKey.startsWith('sb_publishable_');
  if (!publicKey) {
    try { publicKey = JSON.parse(Buffer.from(supabaseKey.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* invalid */ }
  }
  if (!publicKey) throw new Error('Only a public Supabase key may enter landing assets');
  const replacements = {
    __IVX_API_BASE_URL__: 'https://api.ivxholding.com', __IVX_BACKEND_URL__: 'https://api.ivxholding.com',
    __IVX_APP_URL__: '', __IVX_SUPABASE_URL__: supabaseUrl, __IVX_SUPABASE_ANON_KEY__: supabaseKey,
    __IVX_GOOGLE_ADS_KEY__: env.EXPO_PUBLIC_GOOGLE_ADS_KEY || '',
    __IVX_META_PIXEL_ID__: env.EXPO_PUBLIC_META_PIXEL_ID || '',
    __IVX_TIKTOK_PIXEL_ID__: env.EXPO_PUBLIC_TIKTOK_PIXEL_ID || '',
    __IVX_LINKEDIN_PARTNER_ID__: env.EXPO_PUBLIC_LINKEDIN_PARTNER_ID || '',
  };
  const landing = join(root, 'expo/ivxholding-landing');
  const files = readdirSync(landing, { withFileTypes: true }).filter(f => f.isFile() && types[extname(f.name)]);
  for (const required of ['index.html', 'ivx-app.js', 'ivx-reels.js', 'robots.txt', 'sitemap.xml']) {
    if (!files.some(f => f.name === required)) throw new Error(`Required landing asset missing: ${required}`);
  }
  const uploads = new Map();
  function add(key, body) {
    uploads.set(key, { Bucket: bucket, Key: key, Body: body, ContentType: types[extname(key)],
      CacheControl: /\.(html|json)$/.test(key) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=300',
      Metadata: { 'ivx-source-sha': sha } });
  }
  for (const file of files) {
    let body = readFileSync(join(landing, file.name));
    if (/\.(html|json)$/.test(file.name)) {
      let text = body.toString('utf8').replace(/__IVX_[A-Z_]+__/g, token => replacements[token] ?? token);
      if (/__IVX_[A-Z_]+__/.test(text)) throw new Error(`Unresolved public configuration in ${file.name}`);
      if (file.name === 'index.html') {
        const marker = `<meta name="ivx-deployment-sha" content="${sha}" />`;
        text = text.replace(/<meta\s+name="ivx-deployment-sha"[^>]*>/g, '');
        if (!text.includes('</head>')) throw new Error('Landing head is missing');
        text = text.replace('</head>', `${marker}\n</head>`);
      }
      body = Buffer.from(text);
    }
    add(file.name, body);
  }
  for (const file of brandFiles) add(file, readFileSync(join(root, 'expo/assets/images', file)));
  add('ivx-config.json', Buffer.from(JSON.stringify({ gitSha: sha, supabaseUrl, supabaseAnonKey: supabaseKey,
    apiBaseUrl: 'https://api.ivxholding.com', backendUrl: 'https://api.ivxholding.com', appUrl: '' })));
  // Publish the entry page after its dependencies; a failed upload stops the release.
  return { sha, uploads: [...uploads.values()].sort((a, b) => Number(a.Key === 'index.html') - Number(b.Key === 'index.html')) };
}

export async function publishLandingRelease(release, { put, invalidate }) {
  for (const item of release.uploads) await put(item);
  const result = await invalidate();
  if (!result?.id || result.status !== 'Completed') throw new Error('CloudFront invalidation is not complete');
  return { sourceCommitSha: release.sha, uploads: release.uploads.length, invalidationId: result.id, invalidationStatus: result.status };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'expo/ivxholding-landing', 'expo/assets/images'], { cwd: root, stdio: 'pipe' });
  const release = buildLandingRelease(root, process.env, sha);
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error('AWS deployment credentials missing');
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { CloudFrontClient, CreateInvalidationCommand, GetInvalidationCommand } = await import('@aws-sdk/client-cloudfront');
  // Default SDK credentials remain inside the existing GitHub-to-AWS trust path.
  const s3 = new S3Client({ region: 'us-east-1' });
  const cf = new CloudFrontClient({ region: 'us-east-1' });
  const proof = await publishLandingRelease(release, {
    put: item => s3.send(new PutObjectCommand(item), { abortSignal: AbortSignal.timeout(30_000) }),
    invalidate: () => completeLandingInvalidation({
      create: async () => (await cf.send(new CreateInvalidationCommand({ DistributionId: distributionId,
        InvalidationBatch: { CallerReference: `ivx-runtime-${sha}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
          Paths: { Quantity: 1, Items: ['/*'] } },
      }), { abortSignal: AbortSignal.timeout(30_000) })).Invalidation,
      read: async id => (await cf.send(new GetInvalidationCommand({ DistributionId: distributionId, Id: id }),
        { abortSignal: AbortSignal.timeout(30_000) })).Invalidation,
    }),
  });
  console.log(JSON.stringify(proof));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Landing publication failed: ${error.name || 'Error'}`); process.exitCode = 1; });
}
