/**
 * IVX Landing SEO Auto-Deployer
 *
 * Runs on backend boot (Render), where the AWS credentials actually exist, and
 * pushes the static landing/SEO files to the S3 bucket with the CORRECT
 * content-types, then invalidates CloudFront. This fixes the long-standing
 * problem where `/robots.txt` and `/sitemap.xml` returned `text/html` (the S3
 * `ErrorDocument: index.html` fallback) because the real files were never
 * deployed — the sandbox has no AWS keys, but the Render container does.
 *
 * Files handled (correct content-types per file):
 *   - robots.txt   → text/plain
 *   - sitemap.xml  → application/xml
 *   - index.html   → text/html (env placeholders substituted)
 *   - capture.html → text/html (also served at /capture)
 *   - ivx-config.json → application/json
 *
 * Honest by construction: never throws into the boot path, reports exactly
 * which env vars are missing, and only claims success when S3 confirms the
 * upload. robots.txt / sitemap.xml are embedded as constants so the crawl
 * directives deploy even if the static files are not in the container image.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCloudFrontInvalidation } from './ivx-cloudfront-invalidation';

export const LANDING_SEO_AUTODEPLOY_MARKER = 'ivx-landing-seo-autodeploy-2026-06-07-v1';

const BUCKET_DEFAULT = 'ivxholding.com';
const PUBLIC_BASE_URL = 'https://ivxholding.com';

/** Embedded crawl directives — guaranteed to deploy even if files are absent from the image. */
const EMBEDDED_ROBOTS_TXT = [
  'User-agent: *',
  'Allow: /',
  '',
  '# Block nothing that should rank; the capture page is intentionally indexable.',
  `Sitemap: ${PUBLIC_BASE_URL}/sitemap.xml`,
  '',
].join('\n');

const EMBEDDED_SITEMAP_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  `  <url><loc>${PUBLIC_BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
  `  <url><loc>${PUBLIC_BASE_URL}/capture</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
  `  <url><loc>${PUBLIC_BASE_URL}/#properties</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`,
  `  <url><loc>${PUBLIC_BASE_URL}/#how-it-works</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`,
  `  <url><loc>${PUBLIC_BASE_URL}/#trust</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`,
  `  <url><loc>${PUBLIC_BASE_URL}/#partners</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`,
  '</urlset>',
  '',
].join('\n');

export interface LandingSeoUploadResult {
  key: string;
  contentType: string;
  bytes: number;
  ok: boolean;
  error?: string;
}

export interface LandingSeoAutodeployResult {
  ran: boolean;
  ok: boolean;
  marker: string;
  bucket: string;
  region: string;
  uploads: LandingSeoUploadResult[];
  cloudFront: {
    attempted: boolean;
    ok: boolean;
    status?: string;
    invalidationId?: string;
    error?: string;
  };
  missingEnv: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

function readEnv(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

/** Read a landing file from the container; return null if it's not shipped in the image. */
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

/** Substitute the landing env placeholders the same way deploy-landing.mjs does. */
function substituteLandingPlaceholders(html: string): string {
  const apiBaseUrl = (
    readEnv('EXPO_PUBLIC_API_BASE_URL') ||
    readEnv('EXPO_PUBLIC_IVX_API_BASE_URL') ||
    PUBLIC_BASE_URL
  ).replace(/\/$/, '');
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  const supabaseAnonKey = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') || readEnv('SUPABASE_ANON_KEY');
  const appUrl = (readEnv('EXPO_PUBLIC_APP_URL') || readEnv('EXPO_PUBLIC_IVX_API_BASE_URL')).replace(/\/$/, '');
  const backendUrl = (readEnv('EXPO_PUBLIC_IVX_API_BASE_URL') || readEnv('RENDER_EXTERNAL_URL')).replace(/\/$/, '');
  const googleAdsKey = readEnv('EXPO_PUBLIC_GOOGLE_ADS_API_KEY');
  const metaPixelId = readEnv('META_PIXEL_ID');
  const tiktokPixelId = readEnv('TIKTOK_PIXEL_ID');
  const linkedinPartnerId = readEnv('LINKEDIN_PARTNER_ID');

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

interface PlannedUpload {
  key: string;
  body: string;
  contentType: string;
  cacheControl: string;
}

function buildUploadPlan(): PlannedUpload[] {
  const plan: PlannedUpload[] = [];
  const htmlCache = 'no-cache, no-store, must-revalidate';
  const seoCache = 'public, max-age=3600';
  const assetCache = 'public, max-age=31536000, immutable';

  // robots.txt — prefer the shipped file, fall back to the embedded constant.
  const robots = tryReadLandingFile('robots.txt') ?? EMBEDDED_ROBOTS_TXT;
  plan.push({ key: 'robots.txt', body: robots, contentType: 'text/plain; charset=utf-8', cacheControl: seoCache });

  // sitemap.xml — prefer the shipped file, fall back to the embedded constant.
  const sitemap = tryReadLandingFile('sitemap.xml') ?? EMBEDDED_SITEMAP_XML;
  plan.push({ key: 'sitemap.xml', body: sitemap, contentType: 'application/xml; charset=utf-8', cacheControl: seoCache });

  // index.html — deploy with env placeholder substitution (phone number, legal links, etc.)
  const indexHtml = tryReadLandingFile('index.html');
  if (indexHtml) {
    plan.push({
      key: 'index.html',
      body: substituteLandingPlaceholders(indexHtml),
      contentType: 'text/html; charset=utf-8',
      cacheControl: htmlCache,
    });
  }

  // capture.html — served at both /capture.html and /capture.
  const captureHtml = tryReadLandingFile('capture.html');
  if (captureHtml) {
    const captureBody = substituteLandingPlaceholders(captureHtml);
    for (const key of ['capture.html', 'capture']) {
      plan.push({ key, body: captureBody, contentType: 'text/html; charset=utf-8', cacheControl: htmlCache });
    }
  }

  // Standalone legal pages — deploy with env substitution
  const legalPages = ['privacy.html', 'terms.html', 'disclosures.html', 'cookie.html', 'legal.html'];
  for (const page of legalPages) {
    const content = tryReadLandingFile(page);
    if (content) {
      plan.push({
        key: page,
        body: substituteLandingPlaceholders(content),
        contentType: 'text/html; charset=utf-8',
        cacheControl: htmlCache,
      });
    }
  }

  // enterprise-register.html and reset-password.html
  for (const page of ['enterprise-register.html', 'reset-password.html']) {
    const content = tryReadLandingFile(page);
    if (content) {
      plan.push({
        key: page,
        body: substituteLandingPlaceholders(content),
        contentType: 'text/html; charset=utf-8',
        cacheControl: htmlCache,
      });
    }
  }

  // JS assets — deploy with correct content-type (previously served as HTML by S3 fallback)
  const jsAssets = [
    'ivx-app.js', 'ivx-analytics.js', 'ivx-home-feed.js', 'ivx-invest.js',
    'ivx-portal.js', 'ivx-reels.js', 'ivx-lazy-bridge.js', 'ivx-ui-utils.js',
    'ivx-web-vitals.js', 'ivx-wire.js', 'landing-support-chat.js',
  ];
  for (const jsFile of jsAssets) {
    const content = tryReadLandingFile(jsFile);
    if (content) {
      plan.push({
        key: jsFile,
        body: content,
        contentType: 'application/javascript; charset=utf-8',
        cacheControl: assetCache,
      });
    }
  }

  // CSS assets
  const cssAssets = ['ivx-styles.css', 'landing-support-chat.css'];
  for (const cssFile of cssAssets) {
    const content = tryReadLandingFile(cssFile);
    if (content) {
      plan.push({
        key: cssFile,
        body: content,
        contentType: 'text/css; charset=utf-8',
        cacheControl: assetCache,
      });
    }
  }

  // ivx-config.json — Supabase fallback config the landing reads client-side.
  const configJson = tryReadLandingFile('ivx-config.json');
  if (configJson) {
    plan.push({
      key: 'ivx-config.json',
      body: substituteLandingPlaceholders(configJson),
      contentType: 'application/json; charset=utf-8',
      cacheControl: htmlCache,
    });
  }

  return plan;
}

/**
 * Push the landing SEO files to S3 + invalidate CloudFront. Safe to call on
 * every boot (idempotent overwrite). Never throws.
 */
export async function deployLandingSeoToS3(): Promise<LandingSeoAutodeployResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const region = readEnv('AWS_REGION') || 'us-east-1';
  const bucket = readEnv('S3_BUCKET_NAME') || BUCKET_DEFAULT;
  const accessKey = readEnv('AWS_ACCESS_KEY_ID');
  const secretKey = readEnv('AWS_SECRET_ACCESS_KEY');

  const missingEnv: string[] = [];
  if (!accessKey) missingEnv.push('AWS_ACCESS_KEY_ID');
  if (!secretKey) missingEnv.push('AWS_SECRET_ACCESS_KEY');

  const baseResult: LandingSeoAutodeployResult = {
    ran: false,
    ok: false,
    marker: LANDING_SEO_AUTODEPLOY_MARKER,
    bucket,
    region,
    uploads: [],
    cloudFront: { attempted: false, ok: false },
    missingEnv,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
  };

  if (missingEnv.length > 0) {
    console.log('[LandingSeoAutodeploy] Skipped — missing AWS credentials:', missingEnv.join(', '));
    return { ...baseResult, finishedAt: new Date().toISOString(), durationMs: Date.now() - startMs };
  }

  const s3 = new S3Client({
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const plan = buildUploadPlan();
  const uploads: LandingSeoUploadResult[] = [];

  for (const item of plan) {
    const bytes = Buffer.byteLength(item.body, 'utf-8');
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: item.key,
          Body: item.body,
          ContentType: item.contentType,
          CacheControl: item.cacheControl,
        }),
      );
      uploads.push({ key: item.key, contentType: item.contentType, bytes, ok: true });
      console.log(`[LandingSeoAutodeploy] Uploaded ${item.key} (${item.contentType}, ${bytes} bytes)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upload failed';
      uploads.push({ key: item.key, contentType: item.contentType, bytes, ok: false, error: message });
      console.log(`[LandingSeoAutodeploy] FAILED ${item.key}: ${message}`);
    }
  }

  const allUploadsOk = uploads.length > 0 && uploads.every((u) => u.ok);

  // Invalidate CloudFront so the new files are served immediately.
  let cloudFront: LandingSeoAutodeployResult['cloudFront'] = { attempted: false, ok: false };
  if (allUploadsOk && readEnv('CLOUDFRONT_DISTRIBUTION_ID')) {
    const invalidation = await createCloudFrontInvalidation({
      paths: ['/robots.txt', '/sitemap.xml', '/index.html', '/capture', '/capture.html', '/'],
      callerReference: `landing-seo-autodeploy-${Date.now()}`,
    });
    cloudFront = {
      attempted: true,
      ok: invalidation.ok,
      status: invalidation.status,
      invalidationId: invalidation.invalidationId,
      error: invalidation.error,
    };
    console.log(
      `[LandingSeoAutodeploy] CloudFront invalidation: ${invalidation.status}` +
        (invalidation.invalidationId ? ` (${invalidation.invalidationId})` : ''),
    );
  }

  const finishedAt = new Date().toISOString();
  return {
    ran: true,
    ok: allUploadsOk,
    marker: LANDING_SEO_AUTODEPLOY_MARKER,
    bucket,
    region,
    uploads,
    cloudFront,
    missingEnv,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
  };
}

let lastAutodeployResult: LandingSeoAutodeployResult | null = null;
let autodeployStarted = false;

/** Returns the last autodeploy result (for the /health or status surface). */
export function getLastLandingSeoAutodeployResult(): LandingSeoAutodeployResult | null {
  return lastAutodeployResult;
}

/**
 * Fire-and-forget boot hook. Runs the S3 push once on startup without blocking
 * the server from coming online. Never throws.
 */
export function startLandingSeoAutodeploy(): void {
  if (autodeployStarted) return;
  autodeployStarted = true;

  // Defer slightly so the HTTP server binds first; the deploy runs in the background.
  setTimeout(() => {
    void (async () => {
      try {
        lastAutodeployResult = await deployLandingSeoToS3();
        if (lastAutodeployResult.ran) {
          console.log(
            `[LandingSeoAutodeploy] Boot deploy ${lastAutodeployResult.ok ? 'OK' : 'PARTIAL'} — ` +
              `${lastAutodeployResult.uploads.filter((u) => u.ok).length}/${lastAutodeployResult.uploads.length} files`,
          );
        }
      } catch (error) {
        console.log(
          '[LandingSeoAutodeploy] Boot deploy error:',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    })();
  }, 2500);
}
