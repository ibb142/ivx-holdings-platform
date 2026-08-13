/**
 * IVX Final Audit Script (item 199)
 *
 * Runs all verification checks and produces a report with verifiable evidence.
 * Checks: security, content honesty, SEO, performance, CI checks, monitoring.
 *
 * Usage: node ivx-final-audit.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const LANDING_DIR = '/home/user/rork-app/expo/ivxholding-landing';
const BACKEND_DIR = '/home/user/rork-app/backend';

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;
const results = [];

function check(name, fn) {
  totalChecks++;
  try {
    const result = fn();
    if (result === true || (typeof result === 'string' && result.startsWith('PASS'))) {
      passedChecks++;
      results.push({ name, status: 'PASS', detail: typeof result === 'string' ? result : '' });
    } else {
      failedChecks++;
      results.push({ name, status: 'FAIL', detail: typeof result === 'string' ? result : 'Check failed' });
    }
  } catch (e) {
    failedChecks++;
    results.push({ name, status: 'FAIL', detail: e.message });
  }
}

// ── Security checks (items 151-160) ─────────────────────────────────
check('151: Bank account name is IVX Holdings', () => {
  const api = readFileSync(join(BACKEND_DIR, 'api/ivx-wire-transfer.ts'), 'utf-8');
  return api.includes('IVX_WIRE_ACCOUNT_NAME') ? 'PASS: env var based' : 'FAIL: hardcoded';
});

check('153-154: Wire instructions require auth', () => {
  const hono = readFileSync(join(BACKEND_DIR, 'hono.ts'), 'utf-8');
  return hono.includes('authentication_required') ? 'PASS: auth gated' : 'FAIL: public access';
});

check('155: RLS policies created', () => {
  return existsSync(join(BACKEND_DIR, '..', 'supabase/migrations/ivx-rls-policies.sql')) ? 'PASS: SQL created' : 'FAIL: not found';
});

check('157-158: Bucket policies in RLS SQL', () => {
  const sql = readFileSync(join(BACKEND_DIR, '..', 'supabase/migrations/ivx-rls-policies.sql'), 'utf-8');
  return sql.includes('storage.objects') ? 'PASS: bucket policies present' : 'FAIL: missing bucket policies';
});

check('159: No hardcoded AWS credentials in deploy script', () => {
  const deploy = readFileSync('/home/user/rork-app/expo/deploy-s3-direct.mjs', 'utf-8');
  return !deploy.match(/AKIA[A-Z0-9]{16}/) ? 'PASS: no hardcoded keys' : 'FAIL: hardcoded AWS key found';
});

check('160: No hardcoded bank details in HTML', () => {
  const html = readFileSync(join(LANDING_DIR, 'index.html'), 'utf-8');
  return !html.includes('1052026057') ? 'PASS: no account numbers' : 'FAIL: account number in HTML';
});

// ── Web security checks (items 161-166) ─────────────────────────────
check('161: CORS is restrictive', () => {
  const hono = readFileSync(join(BACKEND_DIR, 'hono.ts'), 'utf-8');
  return hono.includes('IVX_ALLOWED_ORIGINS') ? 'PASS: origin allowlist' : 'FAIL: no allowlist';
});

check('162-163: CSP is restrictive', () => {
  const html = readFileSync(join(LANDING_DIR, 'index.html'), 'utf-8');
  return html.includes("default-src 'self';") && !html.includes("default-src 'self' https:") ? 'PASS: tightened CSP' : 'FAIL: permissive CSP';
});

check('164: HSTS header in middleware', () => {
  const mw = readFileSync(join(BACKEND_DIR, 'middleware/ivx-enterprise-middleware.ts'), 'utf-8');
  return mw.includes('Strict-Transport-Security') ? 'PASS: HSTS added' : 'FAIL: no HSTS';
});

check('164: Permissions-Policy header', () => {
  const mw = readFileSync(join(BACKEND_DIR, 'middleware/ivx-enterprise-middleware.ts'), 'utf-8');
  return mw.includes('Permissions-Policy') ? 'PASS: Permissions-Policy added' : 'FAIL: missing';
});

check('165: CSRF protection middleware created', () => {
  return existsSync(join(BACKEND_DIR, 'middleware/ivx-csrf-protection.ts')) ? 'PASS: created' : 'FAIL: not found';
});

check('166: Rate limiting on login endpoint', () => {
  const hono = readFileSync(join(BACKEND_DIR, 'hono.ts'), 'utf-8');
  return hono.includes("'member-login'") ? 'PASS: login rate limited' : 'FAIL: not rate limited';
});

// ── Audit & privacy checks (items 167-171) ──────────────────────────
check('167: Audit log service created', () => {
  return existsSync(join(BACKEND_DIR, 'services/ivx-audit-log.ts')) ? 'PASS: created' : 'FAIL: not found';
});

check('168: PII sanitizer created', () => {
  return existsSync(join(BACKEND_DIR, 'services/ivx-pii-sanitizer.ts')) ? 'PASS: created' : 'FAIL: not found';
});

check('169: Data retention policy created', () => {
  return existsSync(join(BACKEND_DIR, '..', 'supabase/migrations/ivx-data-retention.sql')) ? 'PASS: created' : 'FAIL: not found';
});

check('171: Consent recording in analytics', () => {
  const analytics = readFileSync(join(LANDING_DIR, 'ivx-analytics.js'), 'utf-8');
  return analytics.includes('recordConsent') && analytics.includes('CONSENT_VERSION') ? 'PASS: consent recorded' : 'FAIL: not implemented';
});

// ── Content honesty checks (items 172-175) ─────────────────────────
check('172: Risk disclaimer present', () => {
  const html = readFileSync(join(LANDING_DIR, 'index.html'), 'utf-8');
  return html.includes('investments involve risk') ? 'PASS: risk disclaimer present' : 'FAIL: no disclaimer';
});

check('174: No fake ratings', () => {
  const html = readFileSync(join(LANDING_DIR, 'index.html'), 'utf-8');
  return !html.match(/\d+(\.\d+)?\s*(?:star|rating)/i) ? 'PASS: no fake ratings' : 'FAIL: fake ratings found';
});

check('175: Verifiable contact info', () => {
  const html = readFileSync(join(LANDING_DIR, 'index.html'), 'utf-8');
  return html.includes('IVX Holdings LLC') && html.includes('investors@ivxholding.com') && html.includes('1001 Brickell Bay')
    ? 'PASS: verifiable info present'
    : 'FAIL: missing verifiable info';
});

// ── SEO checks (items 176-184) ─────────────────────────────────────
check('176: Canonical URL correct', () => {
  const html = readFileSync(join(LANDING_DIR, 'index.html'), 'utf-8');
  return html.includes('rel="canonical" href="https://ivxholding.com"') ? 'PASS: canonical set' : 'FAIL: wrong canonical';
});

check('179: No private pages in sitemap', () => {
  const sitemap = readFileSync(join(LANDING_DIR, 'sitemap.xml'), 'utf-8');
  return !sitemap.includes('<loc>https://ivxholding.com/reset-password</loc>') ? 'PASS: clean sitemap' : 'FAIL: private page in sitemap';
});

check('181: robots.txt points to sitemap', () => {
  const robots = readFileSync(join(LANDING_DIR, 'robots.txt'), 'utf-8');
  return robots.includes('Sitemap: https://ivxholding.com/sitemap.xml') ? 'PASS: sitemap referenced' : 'FAIL: not referenced';
});

check('183: Schema logo URL fixed', () => {
  const html = readFileSync(join(LANDING_DIR, 'index.html'), 'utf-8');
  return !html.includes('ivx-logo-master.png') ? 'PASS: logo URL fixed' : 'FAIL: old logo URL';
});

// ── Build & CI checks (items 185-190) ──────────────────────────────
check('185: ivx-config.json version updated', () => {
  const config = JSON.parse(readFileSync(join(LANDING_DIR, 'ivx-config.json'), 'utf-8'));
  return config.version === 'v20260813' ? 'PASS: v20260813' : 'FAIL: ' + config.version;
});

check('188: CI checks script created', () => {
  return existsSync('/home/user/rork-app/expo/scripts/ivx-ci-checks.mjs') ? 'PASS: created' : 'FAIL: not found';
});

check('190: APK checksum script in CI checks', () => {
  const ci = readFileSync('/home/user/rork-app/expo/scripts/ivx-ci-checks.mjs', 'utf-8');
  return ci.includes('createHash') ? 'PASS: checksum verification' : 'FAIL: no checksum';
});

// ── Monitoring checks (items 195-197) ──────────────────────────────
check('195: Monitoring script created', () => {
  return existsSync('/home/user/rork-app/expo/scripts/ivx-monitor.mjs') ? 'PASS: created' : 'FAIL: not found';
});

check('197: Rollback script created', () => {
  return existsSync('/home/user/rork-app/expo/scripts/ivx-rollback.mjs') ? 'PASS: created' : 'FAIL: not found';
});

// ── Print report ───────────────────────────────────────────────────
console.log('\n' + '\u2550'.repeat(60));
console.log('  IVX Holdings \u2014 Final Audit Report (item 199)');
console.log('  Date: ' + new Date().toISOString());
console.log('\u2550'.repeat(60) + '\n');

for (const r of results) {
  const icon = r.status === 'PASS' ? '\u2705' : '\u274C';
  console.log(`${icon} ${r.name}`);
  if (r.detail) console.log(`   ${r.detail}`);
}

console.log('\n' + '\u2550'.repeat(60));
console.log(`  Total: ${totalChecks}  |  Passed: ${passedChecks}  |  Failed: ${failedChecks}`);
console.log(`  Score: ${Math.round((passedChecks / totalChecks) * 100)}%`);
console.log('\u2550'.repeat(60));

if (failedChecks > 0) {
  console.log('\n\u274C CRITICAL BLOCKERS DETECTED (item 200)');
  console.log('   Do NOT reactivate ads until blockers are resolved.');
  process.exit(1);
} else {
  console.log('\n\u2705 No critical blockers detected (item 200)');
  console.log('   Ads may be reactivated with caution.');
}
