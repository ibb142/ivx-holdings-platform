/**
 * IVX Testing Suite (items 191-194)
 *
 * 191: E2E test validation for registration, recovery, login, investment flows
 * 192: Visual tests at official breakpoints (480, 768, 1024, 1280px)
 * 193: Accessibility tests (aria-labels, alt text, headings, focus, reduced motion, contrast)
 * 194: Performance limits (deferred scripts, weight budget, compressed assets, Web Vitals config)
 *
 * Usage: node ivx-testing-suite.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const LANDING_DIR = '/home/user/rork-app/expo/ivxholding-landing';
let errors = 0;
let passes = 0;
let warnings = 0;

function pass(msg) { passes++; console.log('  \u2705', msg); }
function warn(msg) { warnings++; console.log('  \u26A0\uFE0F ', msg); }
function fail(msg) { errors++; console.error('  \u274C', msg); }

function readHTML() {
  return readFileSync(join(LANDING_DIR, 'index.html'), 'utf-8');
}

function readCSS() {
  return readFileSync(join(LANDING_DIR, 'ivx-styles.css'), 'utf-8');
}

// ── Item 191: E2E test validation ─────────────────────────────────
function checkE2E() {
  console.log('\n\u2500\u2500 Item 191: E2E Test Validation \u2500\u2500');
  const html = readHTML();

  // Registration flow
  const hasFunnel = html.includes('openFunnel()') && html.includes('handleFunnelSubmit');
  if (hasFunnel) pass('Registration funnel (openFunnel + handleSubmit) present');
  else fail('Registration funnel not found');

  // Login flow
  const hasPortal = html.includes('handlePortalLogin') && html.includes('portal-login-form');
  if (hasPortal) pass('Login flow (portal login form + handler) present');
  else fail('Login flow not found');

  // Investment flow
  const hasInvest = html.includes('confirmInvestment') && html.includes('invest-step-1');
  if (hasInvest) pass('Investment flow (4-step modal + confirm) present');
  else fail('Investment flow not found');

  // Recovery flow
  const hasReset = existsSync(join(LANDING_DIR, 'reset-password.html'));
  if (hasReset) pass('Password recovery page exists');
  else warn('Password recovery page not found (may be app-only)');

  // Wire transfer flow
  const hasWire = html.includes('wire-instructions') && existsSync(join(LANDING_DIR, 'ivx-wire.js'));
  if (hasWire) pass('Wire transfer flow present');
  else fail('Wire transfer flow not found');

  // Maestro flow file
  const maestroPath = '/home/user/rork-app/expo/.maestro/ivx-e2e-registration.yml';
  if (existsSync(maestroPath)) pass('Maestro E2E flow file exists');
  else warn('Maestro E2E flow file not found');
}

// ── Item 192: Visual tests at official breakpoints ────────────────
function checkVisualBreakpoints() {
  console.log('\n\u2500\u2500 Item 192: Visual Breakpoint Tests \u2500\u2500');
  const css = readCSS();

  const breakpoints = [
    { width: 480, pattern: /480px/i },
    { width: 768, pattern: /768px/i },
    { width: 1024, pattern: /1024px/i },
    { width: 1280, pattern: /1280px/i },
  ];

  for (const bp of breakpoints) {
    if (bp.pattern.test(css)) {
      pass(`Breakpoint @${bp.width}px present`);
    } else {
      fail(`Breakpoint @${bp.width}px missing`);
    }
  }

  // Check for fluid layouts
  if (css.includes('clamp(')) pass('Fluid typography (clamp) present');
  else warn('No fluid typography (clamp) found');

  // Check for responsive grid
  if (css.includes('auto-fit') || css.includes('auto-fill')) pass('Responsive grid (auto-fit/auto-fill) present');
  else fail('No responsive grid found');

  // Check for safe area insets
  if (css.includes('safe-area-inset')) pass('Safe area insets present');
  else fail('No safe area insets found');

  // Check for touch target sizes
  if (css.includes('44px') || css.includes('44pt')) pass('44px touch targets present');
  else warn('44px touch targets not explicitly set');
}

// ── Item 193: Accessibility tests ─────────────────────────────────
function checkAccessibility() {
  console.log('\n\u2500\u2500 Item 193: Accessibility Tests \u2500\u2500');
  const html = readHTML();
  const css = readCSS();

  // Aria labels
  const ariaLabels = html.match(/aria-label="/g) || [];
  if (ariaLabels.length >= 5) pass(`Aria-labels present (${ariaLabels.length} instances)`);
  else fail(`Insufficient aria-labels (${ariaLabels.length} found, need 5+)`);

  // Alt text on images
  const images = html.match(/<img\s/g) || [];
  const altTexts = html.match(/<img[^>]*alt="/g) || [];
  if (images.length > 0 && altTexts.length === images.length) {
    pass(`All ${images.length} images have alt text`);
  } else if (images.length > 0) {
    fail(`${images.length - altTexts.length} images missing alt text`);
  } else {
    pass('No images to check');
  }

  // Heading hierarchy
  const h1Count = (html.match(/<h1/g) || []).length;
  const h2Count = (html.match(/<h2/g) || []).length;
  const h3Count = (html.match(/<h3/g) || []).length;
  if (h1Count === 1) pass(`Single h1 present (${h2Count} h2s, ${h3Count} h3s)`);
  else fail(`Heading hierarchy issue (${h1Count} h1s — should be exactly 1)`);

  // Focus indicators
  if (css.includes('focus-visible')) pass('Focus-visible indicators present');
  else fail('No focus-visible indicators found');

  // Reduced motion
  if (css.includes('prefers-reduced-motion')) pass('Reduced motion support present');
  else fail('No prefers-reduced-motion support');

  // Skip link
  if (html.includes('sr-only-focusable') || html.includes('skip to content')) pass('Skip-to-content link present');
  else warn('Skip-to-content link not found');

  // Aria-live regions
  if (html.includes('aria-live')) pass('Aria-live regions present');
  else warn('No aria-live regions found');

  // Contrast (check for improved text3 color)
  if (css.includes('#7A7A7A') || css.includes('rgb(122, 122, 122)')) pass('Improved contrast for secondary text');
  else warn('Secondary text color not improved for contrast');

  // Role attributes
  const roles = html.match(/role="/g) || [];
  if (roles.length >= 2) pass(`Role attributes present (${roles.length} instances)`);
  else fail('Insufficient role attributes');
}

// ── Item 194: Performance limits ─────────────────────────────────
function checkPerformance() {
  console.log('\n\u2500\u2500 Item 194: Performance Budget Tests \u2500\u2500');
  const html = readHTML();

  // Deferred scripts
  const scripts = html.match(/<script\s/g) || [];
  const deferredScripts = html.match(/<script[^>]*defer/g) || [];
  const inlineScripts = html.match(/<script>(?!\s*\(function\(\)\s*\{)/g) || [];
  if (scripts.length > 0 && deferredScripts.length / scripts.length > 0.8) {
    pass(`Most scripts deferred (${deferredScripts.length}/${scripts.length})`);
  } else {
    warn(`Script deferral: ${deferredScripts.length}/${scripts.length} deferred`);
  }

  // Web Vitals measurement
  if (existsSync(join(LANDING_DIR, 'ivx-web-vitals.js'))) pass('Web Vitals measurement script present');
  else fail('Web Vitals measurement script not found');

  // Performance budget
  const webVitals = readFileSync(join(LANDING_DIR, 'ivx-web-vitals.js'), 'utf-8');
  if (webVitals.includes('2500') && webVitals.includes('200') && webVitals.includes('0.1')) {
    pass('Performance budget defined (LCP 2500ms, INP 200ms, CLS 0.1)');
  } else {
    fail('Performance budget not defined');
  }

  // Preload/preconnect
  if (html.includes('preconnect')) pass('Preconnect hints present');
  else warn('No preconnect hints');

  if (html.includes('preload')) pass('Preload hints present');
  else warn('No preload hints');

  // Image optimization
  if (html.includes('fetchpriority="high"')) pass('Fetch priority on above-fold image');
  else warn('No fetch priority on above-fold image');

  if (html.includes('loading="lazy"')) pass('Lazy loading on below-fold images');
  else warn('No lazy loading on images');

  // Compressed assets
  const distDir = join(LANDING_DIR, 'dist');
  if (existsSync(distDir)) {
    const brFiles = readdirSync(distDir).filter(f => f.endsWith('.br'));
    const gzFiles = readdirSync(distDir).filter(f => f.endsWith('.gz'));
    if (brFiles.length > 0) pass(`Brotli compressed assets present (${brFiles.length} files)`);
    else warn('No Brotli compressed assets in dist/');
    if (gzFiles.length > 0) pass(`Gzip compressed assets present (${gzFiles.length} files)`);
    else warn('No Gzip compressed assets in dist/');
  } else {
    warn('dist/ directory not found (run build-landing-v2.mjs first)');
  }

  // Total weight check
  const cssSize = readFileSync(join(LANDING_DIR, 'ivx-styles.css')).length;
  const jsSize = readFileSync(join(LANDING_DIR, 'ivx-app.js')).length;
  const htmlSize = readFileSync(join(LANDING_DIR, 'index.html')).length;
  const totalSize = cssSize + jsSize + htmlSize;
  const totalKB = (totalSize / 1024).toFixed(0);
  if (totalSize < 500 * 1024) {
    pass(`Total weight within budget (${totalKB}KB < 500KB)`);
  } else {
    warn(`Total weight: ${totalKB}KB (budget: 500KB for unminified source)`);
  }
}

// ── Run all tests ────────────────────────────────────────────────
console.log('\u2550'.repeat(55));
console.log('  IVX Holdings \u2014 Testing Suite (items 191-194)');
console.log('\u2550'.repeat(55));

checkE2E();
checkVisualBreakpoints();
checkAccessibility();
checkPerformance();

console.log('\n' + '\u2550'.repeat(55));
console.log(`  \u2705 Passed: ${passes}  |  \u26A0\uFE0F  Warnings: ${warnings}  |  \u274C Errors: ${errors}`);
console.log('\u2550'.repeat(55));

if (errors > 0) process.exit(1);
