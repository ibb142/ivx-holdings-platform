/**
 * IVX CI Checks (items 188-190)
 *
 * 188: Check for empty/placeholder advertising identifiers
 * 189: Detect routes that return index.html instead of proper content
 * 190: Verify APK existence and generate SHA-256 checksum
 *
 * Usage: node ivx-ci-checks.mjs
 * Exit code 0 = pass, 1 = errors found
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const LANDING_DIR = '/home/user/rork-app/expo/ivxholding-landing';
const APK_PATH = '/tmp/ivx-holdings-1.10.14.apk';

let errors = 0;
let warnings = 0;
let passes = 0;

function pass(msg) { passes++; console.log('  \u2705', msg); }
function warn(msg) { warnings++; console.log('  \u26A0\uFE0F ', msg); }
function fail(msg) { errors++; console.error('  \u274C', msg); }

// ── Item 188: Check for empty advertising identifiers ────────────────
function checkAdIdentifiers() {
  console.log('\n\u2500\u2500 Item 188: Advertising Identifier Check \u2500\u2500');
  const htmlPath = join(LANDING_DIR, 'index.html');
  if (!existsSync(htmlPath)) { fail('index.html not found'); return; }
  const html = readFileSync(htmlPath, 'utf-8');

  const checks = [
    { name: 'Google Ads Key', pattern: /ivx-gads-key[^>]*content="([^"]*)"/ },
    { name: 'Meta Pixel ID', pattern: /ivx-meta-pixel-id[^>]*content="([^"]*)"/ },
    { name: 'TikTok Pixel ID', pattern: /ivx-tiktok-pixel-id[^>]*content="([^"]*)"/ },
    { name: 'LinkedIn Partner ID', pattern: /ivx-linkedin-partner-id[^>]*content="([^"]*)"/ },
  ];

  for (const c of checks) {
    const match = html.match(c.pattern);
    if (!match || !match[1] || match[1].startsWith('__')) {
      warn(`${c.name}: empty or placeholder (acceptable for dev, must be set for production ads)`);
    } else {
      pass(`${c.name}: configured (${match[1].slice(0, 4)}****)`);
    }
  }
}

// ── Item 189: Detect routes that return index.html (SPA fallback) ────
function checkSPARoutes() {
  console.log('\n\u2500\u2500 Item 189: SPA Route Check \u2500\u2500');
  const htmlPath = join(LANDING_DIR, 'index.html');
  if (!existsSync(htmlPath)) { fail('index.html not found'); return; }
  const html = readFileSync(htmlPath, 'utf-8');

  // Check that index.html doesn't contain references to non-existent routes
  const routeRefs = html.match(/href="\/(enterprise-register|reset-password|capture)"/g) || [];
  for (const ref of routeRefs) {
    const route = ref.match(/href="\/([^"]+)"/)[1];
    const path = join(LANDING_DIR, route + '.html');
    if (existsSync(path)) {
      pass(`Route file exists: ${route}.html`);
    } else {
      warn(`Route referenced but file not found: ${route}.html (may be deployed separately)`);
    }
  }

  // Check for dead /capture links
  const captureLinks = html.match(/href="\/capture/g) || [];
  if (captureLinks.length > 0) {
    fail(`Found ${captureLinks.length} dead /capture links — should be /#join`);
  } else {
    pass('No dead /capture links found');
  }

  // Check for hardcoded bank details (items 153-154)
  const accountNumber = html.match(/id="wire-account-number">([^<]+)/);
  if (accountNumber && /\d{6,}/.test(accountNumber[1])) {
    fail(`Hardcoded bank account number in HTML: ${accountNumber[1]}`);
  } else {
    pass('No hardcoded bank account numbers in HTML');
  }

  // Check for hardcoded AWS credentials (item 159)
  const awsKeyPattern = /AKIA[A-Z0-9]{16}/;
  if (awsKeyPattern.test(html)) {
    fail('Hardcoded AWS access key found in HTML');
  } else {
    pass('No hardcoded AWS credentials in HTML');
  }
}

// ── Item 190: APK verification and checksum ─────────────────────────
function checkAPK() {
  console.log('\n\u2500\u2500 Item 190: APK Verification \u2500\u2500');
  if (!existsSync(APK_PATH)) {
    warn('APK not found at ' + APK_PATH + ' (build APK first with ./gradlew assembleDebug)');
    return;
  }

  const apkData = readFileSync(APK_PATH);
  const hash = createHash('sha256').update(apkData).digest('hex');
  const size = apkData.length;

  pass(`APK exists: ${APK_PATH}`);
  pass(`APK size: ${(size / 1024 / 1024).toFixed(1)} MB`);
  pass(`SHA-256: ${hash.slice(0, 16)}...${hash.slice(-8)}`);

  // Write checksum file
  const checksumPath = APK_PATH + '.sha256';
  writeFileSync(checksumPath, `${hash}  ivx-holdings-v1.10.14.apk\n`);
  pass(`Checksum written: ${checksumPath}`);

  // Verify size is reasonable (debug APK should be 80-200MB)
  if (size < 10 * 1024 * 1024) {
    fail(`APK too small (${(size / 1024 / 1024).toFixed(1)} MB) — may be corrupt`);
  } else if (size > 300 * 1024 * 1024) {
    warn(`APK very large (${(size / 1024 / 1024).toFixed(1)} MB) — consider optimizing`);
  } else {
    pass(`APK size within expected range`);
  }
}

// ── Content honesty checks (items 172-174) ──────────────────────────
function checkContentHonesty() {
  console.log('\n\u2500\u2500 Items 172-174: Content Honesty Check \u2500\u2500');
  const htmlPath = join(LANDING_DIR, 'index.html');
  if (!existsSync(htmlPath)) { fail('index.html not found'); return; }
  const html = readFileSync(htmlPath, 'utf-8');

  // Check for unverifiable financial claims
  const financialClaims = [
    { pattern: /\$\d+(?:\.\d+)?[MK]/g, name: 'Dollar amounts' },
    { pattern: /\d+%\s*(?:ROI|return|IRR|IRR|projected)/gi, name: 'Percentage returns' },
  ];

  for (const c of financialClaims) {
    const matches = html.match(c.pattern) || [];
    if (matches.length > 0) {
      // Check if they're in mockup/display context or actual claims
      const inDisclaimer = html.includes('past performance does not guarantee');
      if (inDisclaimer) {
        pass(`${c.name}: found (${matches.length}) but risk disclaimer present`);
      } else {
        warn(`${c.name}: found (${matches.length}) — verify accuracy or add disclaimer`);
      }
    } else {
      pass(`${c.name}: none found`);
    }
  }

  // Check for fake badges/ratings
  const fakeRatings = html.match(/\d+(\.\d+)?\s*(?:star|rating|review)/gi) || [];
  if (fakeRatings.length > 0) {
    fail(`Found ${fakeRatings.length} potential fake ratings: ${fakeRatings.slice(0, 3).join(', ')}`);
  } else {
    pass('No fake ratings or reviews found');
  }

  // Check for risk disclaimers
  const hasRiskDisclaimer = html.includes('investments involve risk') || html.includes('risk of principal');
  if (hasRiskDisclaimer) {
    pass('Risk disclaimer present');
  } else {
    fail('No risk disclaimer found — required for financial content');
  }

  // Check for verifiable contact info
  const hasEmail = html.includes('investors@ivxholding.com');
  const hasAddress = html.includes('1001 Brickell Bay');
  const hasEntity = html.includes('IVX Holdings LLC');
  if (hasEmail && hasAddress && hasEntity) {
    pass('Verifiable legal and contact information present');
  } else {
    fail('Missing verifiable legal/contact info');
  }
}

// ── SEO checks (items 176-184) ──────────────────────────────────────
function checkSEO() {
  console.log('\n\u2500\u2500 Items 176-184: SEO Check \u2500\u2500');
  const htmlPath = join(LANDING_DIR, 'index.html');
  if (!existsSync(htmlPath)) { fail('index.html not found'); return; }
  const html = readFileSync(htmlPath, 'utf-8');

  // 176: Canonical URL
  const canonical = html.match(/rel="canonical" href="([^"]+)"/);
  if (canonical && canonical[1] === 'https://ivxholding.com') {
    pass('Canonical URL correct: https://ivxholding.com');
  } else {
    fail(`Canonical URL missing or wrong: ${canonical?.[1] || 'not found'}`);
  }

  // 177: HTTPS redirect (www → non-www)
  const hasRedirect = html.includes("host.toLowerCase().indexOf('www.') === 0");
  if (hasRedirect) {
    pass('www to non-www HTTPS redirect present');
  } else {
    warn('www to non-www redirect not found in inline script');
  }

  // 182-183: Structured data
  const jsonLdCount = (html.match(/type="application\/ld\+json"/g) || []).length;
  if (jsonLdCount >= 3) {
    pass(`Structured data blocks present (${jsonLdCount} JSON-LD blocks)`);
  } else {
    warn(`Only ${jsonLdCount} JSON-LD blocks — should have at least 3`);
  }

  // 184: Open Graph
  const hasOG = html.includes('og:title') && html.includes('og:description') && html.includes('og:image');
  const hasTwitter = html.includes('twitter:card') && html.includes('twitter:title');
  if (hasOG && hasTwitter) {
    pass('Open Graph and Twitter Card tags present');
  } else {
    fail('Missing Open Graph or Twitter Card tags');
  }

  // Check sitemap
  const sitemapPath = join(LANDING_DIR, 'sitemap.xml');
  if (existsSync(sitemapPath)) {
    const sitemap = readFileSync(sitemapPath, 'utf-8');
    // 179: No private pages in sitemap
    const hasResetPassword = sitemap.includes('/reset-password');
    if (hasResetPassword) {
      fail('/reset-password still in sitemap (item 179)');
    } else {
      pass('No private pages in sitemap');
    }
    // 180: Sitemap URLs
    const urlCount = (sitemap.match(/<loc>/g) || []).length;
    pass(`Sitemap has ${urlCount} URLs`);
  } else {
    fail('sitemap.xml not found');
  }

  // Check robots.txt
  const robotsPath = join(LANDING_DIR, 'robots.txt');
  if (existsSync(robotsPath)) {
    const robots = readFileSync(robotsPath, 'utf-8');
    const hasSitemap = robots.includes('Sitemap: https://ivxholding.com/sitemap.xml');
    if (hasSitemap) {
      pass('robots.txt points to correct sitemap');
    } else {
      fail('robots.txt does not point to sitemap');
    }
  } else {
    fail('robots.txt not found');
  }
}

// ── Run all checks ─────────────────────────────────────────────────
console.log('\u2550'.repeat(55));
console.log('  IVX Holdings \u2014 CI Checks (items 188-190, 172-184)');
console.log('\u2550'.repeat(55));

checkAdIdentifiers();
checkSPARoutes();
checkAPK();
checkContentHonesty();
checkSEO();

console.log('\n' + '\u2550'.repeat(55));
console.log(`  \u2705 Passed: ${passes}  |  \u26A0\uFE0F  Warnings: ${warnings}  |  \u274C Errors: ${errors}`);
console.log('\u2550'.repeat(55));

if (errors > 0) process.exit(1);
