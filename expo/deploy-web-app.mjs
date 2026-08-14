/**
 * IVX Holdings — Expo Web App S3 Deploy
 *
 * Deploys the contents of expo/dist to S3 under the /app/ prefix.
 * Sets correct MIME types and cache headers for a single-page web app.
 * Uses environment variables for AWS credentials (no hardcoded secrets).
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx bun run deploy-web-app.mjs
 */
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import path from 'path';

const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || process.env.IVX_AWS_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || process.env.IVX_AWS_SECRET_ACCESS_KEY || '';
const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET_NAME || 'ivxholding.com';
const DIST_DIR = '/home/user/rork-app/expo/dist';
const PREFIX = 'app';

if (!ACCESS_KEY || !SECRET_KEY) {
  console.error('❌ AWS credentials not set. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars.');
  process.exit(1);
}

const s3 = new S3Client({ region: REGION, credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
}

function getCacheControl(key) {
  if (key.endsWith('index.html')) {
    return 'no-cache, no-store, must-revalidate';
  }
  // Hashed assets get immutable long-term cache
  if (/\.[a-f0-9]{20,}\./.test(key) || key.startsWith(`${PREFIX}/_expo/static/`)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

async function deploy() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  IVX Holdings — Expo Web App S3 Deploy');
  console.log('═══════════════════════════════════════════════════');
  console.log('Bucket:', BUCKET, '| Region:', REGION);
  console.log('Source:', DIST_DIR);
  console.log('Prefix:', PREFIX);
  console.log('');

  if (!existsSync(DIST_DIR)) {
    console.error('❌ dist directory does not exist. Run `bunx expo export --platform web` first.');
    process.exit(1);
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log('✅ Bucket accessible: YES');
  } catch (e) {
    console.warn('⚠️  HeadBucket check failed:', e?.name || 'Unknown', e?.message || 'Unknown error');
    console.warn('   Continuing anyway — will try direct PutObject...');
  }

  let ok = 0, fail = 0;
  const results = [];

  for (const filePath of walk(DIST_DIR)) {
    const relative = path.relative(DIST_DIR, filePath);
    const key = `${PREFIX}/${relative.replace(/\\/g, '/')}`;
    const body = readFileSync(filePath);
    const contentType = getMimeType(filePath);
    const cacheControl = getCacheControl(key);

    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }));
      console.log('✅ UPLOADED', key, `(${body.length} bytes, ${contentType})`);
      results.push({ key, status: 'ok', size: body.length });
      ok++;
    } catch (e) {
      console.error('❌ FAILED', key + ':', e?.name || 'Unknown', e?.message || 'Unknown error');
      if (e?.$metadata) console.error('   HTTP:', e.$metadata.httpStatusCode, '| Request ID:', e.$metadata.requestId || 'N/A');
      results.push({ key, status: 'fail', error: e?.message || 'Unknown' });
      fail++;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Upload complete: ${ok} OK, ${fail} FAILED`);
  console.log('═══════════════════════════════════════════════════');

  if (fail > 0) process.exit(1);
}

deploy();
