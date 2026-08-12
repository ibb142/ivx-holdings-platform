/**
 * IVX Holdings — Landing Page Optimizer
 *
 * Extracts inline CSS/JS to external cached files, replaces base64 logos,
 * adds analytics event layer, and consolidates responsive breakpoints.
 *
 * Usage: bun run build-optimized.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const LAND_DIR = '/home/user/rork-app/expo/ivxholding-landing';
const INDEX = LAND_DIR + '/index.html';

// Version string for cache-busting (timestamp-based, not a UUID)
const BUILD_VER = 'v' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

// Git commit SHA (short) — real, not fabricated
let gitSha = 'unknown';
try {
  gitSha = execSync('git rev-parse --short HEAD', { cwd: '/home/user/rork-app', encoding: 'utf-8' }).trim();
} catch (e) {
  // Git not available — use timestamp fallback
  gitSha = 'no-git-' + Date.now().toString(36);
}

console.log('=== IVX Landing Page Optimizer ===');
console.log('Build version:', BUILD_VER);
console.log('Git SHA:', gitSha);
console.log('');

// Read the source HTML
let html = readFileSync(INDEX, 'utf-8');
const originalSize = Buffer.byteLength(html, 'utf-8');
console.log('Original index.html:', (originalSize / 1024).toFixed(1) + ' KB,', html.split('\n').length, 'lines');

// ═════════════════════════════════════════════════════
// STEP 1: Extract all CSS from <style> blocks
// ═════════════════════════════════════════════════════
const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
let cssContent = '';
let styleBlockCount = 0;
let styleBlockMarkers = []; // Track positions for replacement

html = html.replace(styleRegex, (match, css, offset) => {
  styleBlockCount++;
  cssContent += '\n/* === Style Block ' + styleBlockCount + ' === */\n' + css;
  styleBlockMarkers.push(offset);
  return '__IVX_STYLE_BLOCK_' + styleBlockCount + '__';
});

console.log('Extracted CSS:', (cssContent.length / 1024).toFixed(1) + ' KB from', styleBlockCount, 'style blocks');

// ═════════════════════════════════════════════════════
// STEP 2: Consolidate responsive breakpoints to 4 standard ones
// ═════════════════════════════════════════════════════
// Map existing breakpoints to standard set: 480, 768, 1024, 1280
const breakpointMap = [
  { from: /@media\s*\(\s*max-width\s*:\s*360px\s*\)/g, to: '@media (max-width: 480px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*400px\s*\)/g, to: '@media (max-width: 480px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*420px\s*\)/g, to: '@media (max-width: 480px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*440px\s*\)/g, to: '@media (max-width: 480px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*480px\s*\)/g, to: '@media (max-width: 480px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*520px\s*\)/g, to: '@media (max-width: 480px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*560px\s*\)/g, to: '@media (max-width: 480px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*600px\s*\)/g, to: '@media (max-width: 768px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*640px\s*\)/g, to: '@media (max-width: 768px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*720px\s*\)/g, to: '@media (max-width: 768px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*760px\s*\)/g, to: '@media (max-width: 768px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*800px\s*\)/g, to: '@media (max-width: 768px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*900px\s*\)/g, to: '@media (max-width: 1024px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*900px\s*\)/g, to: '@media (max-width: 1024px)' },
  { from: /@media\s*\(\s*max-width\s*:\s*980px\s*\)/g, to: '@media (max-width: 1024px)' },
  { from: /@media\s*\(\s*min-width\s*:\s*600px\s*\)/g, to: '@media (min-width: 768px)' },
  { from: /@media\s*\(\s*min-width\s*:\s*640px\s*\)/g, to: '@media (min-width: 768px)' },
  { from: /@media\s*\(\s*min-width\s*:\s*560px\s*\)/g, to: '@media (min-width: 480px)' },
];

let breakpointCount = 0;
for (const bp of breakpointMap) {
  const matches = cssContent.match(bp.from);
  if (matches) {
    breakpointCount += matches.length;
    cssContent = cssContent.replace(bp.from, bp.to);
  }
}

// Deduplicate consecutive identical media queries
// This is a simple pass — merge identical @media blocks
const mediaBlockRegex = /@media\s*\((?:min|max)-width\s*:\s*\d+px\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
const mediaBlocks = {};
let deduped = 0;
cssContent = cssContent.replace(mediaBlockRegex, (match, body, offset) => {
  // Extract the media query selector
  const selMatch = match.match(/@media\s*\(([^)]+)\)/);
  if (!selMatch) return match;
  const selector = selMatch[1];
  if (mediaBlocks[selector]) {
    // Merge into existing block — skip this duplicate wrapper
    deduped++;
    return body; // Just the body, no wrapper
  }
  mediaBlocks[selector] = true;
  return match;
});

console.log('Consolidated breakpoints:', breakpointCount, 'replacements,', deduped, 'deduplicated');

// Count final unique breakpoints
const finalBreakpoints = cssContent.match(/@media\s*\((?:min|max)-width\s*:\s*\d+px\)/g) || [];
const uniqueBreakpoints = [...new Set(finalBreakpoints.map(b => b.match(/\d+px/)[0]))];
console.log('Final unique breakpoints:', uniqueBreakpoints.join(', '));

// Write CSS file
writeFileSync(LAND_DIR + '/ivx-styles.css', cssContent, 'utf-8');
console.log('Wrote ivx-styles.css:', (cssContent.length / 1024).toFixed(1) + ' KB');

// ═════════════════════════════════════════════════════
// STEP 3: Replace style block markers with external link
// ═════════════════════════════════════════════════════
// Replace first marker with link, remove the rest
let styleLinkAdded = false;
html = html.replace(/__IVX_STYLE_BLOCK_\d+__/g, () => {
  if (!styleLinkAdded) {
    styleLinkAdded = true;
    return '<link rel="preload" href="/ivx-styles.css?' + BUILD_VER + '" as="style"><link rel="stylesheet" href="/ivx-styles.css?' + BUILD_VER + '">';
  }
  return '';
});

// ═════════════════════════════════════════════════════
// STEP 4: Extract large inline JS blocks to external file
// ═════════════════════════════════════════════════════
// Keep these inline: JSON-LD, www redirect, ad tracking (small scripts)
// Extract: scripts > 100 lines that are application logic

const scriptRegex = /<script>([\s\S]*?)<\/script>/gi;
let jsContent = '';
let extractedScriptCount = 0;
const extractedScripts = [];

html = html.replace(scriptRegex, (match, js, offset) => {
  const lineCount = js.split('\n').length;
  
  // Keep small scripts inline (< 50 lines)
  if (lineCount < 50) {
    return match; // Keep inline
  }
  
  // Skip if it contains JSON-LD
  if (match.includes('application/ld+json')) {
    return match;
  }
  
  extractedScriptCount++;
  const marker = '__IVX_EXTRACTED_SCRIPT_' + extractedScriptCount + '__';
  extractedScripts.push({ marker, js, lineCount });
  jsContent += '\n// === Extracted Script Block ' + extractedScriptCount + ' (' + lineCount + ' lines) ===\n' + js;
  return marker;
});

console.log('Extracted JS:', (jsContent.length / 1024).toFixed(1) + ' KB from', extractedScriptCount, 'script blocks');

// Write JS file
if (jsContent.length > 0) {
  writeFileSync(LAND_DIR + '/ivx-app.js', jsContent, 'utf-8');
  console.log('Wrote ivx-app.js:', (jsContent.length / 1024).toFixed(1) + ' KB');
}

// Replace extracted script markers with external script tag
let scriptSrcAdded = false;
html = html.replace(/__IVX_EXTRACTED_SCRIPT_\d+__/g, () => {
  if (!scriptSrcAdded) {
    scriptSrcAdded = true;
    return '<script src="/ivx-app.js?' + BUILD_VER + '" defer></script>';
  }
  return '';
});

// ═════════════════════════════════════════════════════
// STEP 5: Replace base64 data URI images with external references
// ═════════════════════════════════════════════════════
const base64Regex = /src="data:image\/(png|jpeg|jpg|gif|webp);base64,([^"]+)"/gi;
let base64Count = 0;
const base64Map = {};

html = html.replace(base64Regex, (match, ext, data) => {
  base64Count++;
  // Generate a filename based on context
  const filename = 'ivx-inline-img-' + base64Count + '.' + ext;
  const filepath = LAND_DIR + '/' + filename;
  
  // Only write if file doesn't exist (avoid overwriting)
  if (!existsSync(filepath)) {
    try {
      const buf = Buffer.from(data, 'base64');
      writeFileSync(filepath, buf);
      console.log('Extracted base64 image:', filename, '(' + (buf.length / 1024).toFixed(1) + ' KB)');
    } catch (e) {
      console.log('Failed to extract base64 image:', filename, e.message);
      return match; // Keep inline if extraction fails
    }
  }
  
  return 'src="/' + filename + '"';
});

// Also replace base64 in CSS background-image
const cssBase64Regex = /url\(data:image\/(png|jpeg|jpg|gif|webp);base64,([^)]+)\)/gi;
let cssBase64Count = 0;
cssContent = cssContent.replace(cssBase64Regex, (match, ext, data) => {
  cssBase64Count++;
  const filename = 'ivx-css-img-' + cssBase64Count + '.' + ext;
  const filepath = LAND_DIR + '/' + filename;
  
  if (!existsSync(filepath)) {
    try {
      const buf = Buffer.from(data, 'base64');
      writeFileSync(filepath, buf);
    } catch (e) {
      return match;
    }
  }
  
  return 'url(/' + filename + ')';
});

if (cssBase64Count > 0) {
  // Re-write CSS with extracted images
  writeFileSync(LAND_DIR + '/ivx-styles.css', cssContent, 'utf-8');
  console.log('Extracted', cssBase64Count, 'base64 images from CSS');
}

console.log('Extracted', base64Count, 'base64 images from HTML');

// ═════════════════════════════════════════════════════
// STEP 6: Add IVX Analytics Event Layer
// ═════════════════════════════════════════════════════
const analyticsScript = `<script>
// IVX Analytics Event Layer — centralized, safe, no secrets
window.IVX = window.IVX || {};
IVX.track = function(eventName, data) {
  data = data || {};
  data.timestamp = new Date().toISOString();
  data.page_url = window.location.href;
  data.page_path = window.location.pathname;
  
  // Google Ads / GA4
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, data);
  }
  
  // Meta Pixel
  if (typeof window.fbq === 'function') {
    window.fbq('trackCustom', eventName, data);
  }
  
  // TikTok Pixel
  if (typeof window.ttq && typeof window.ttq.track === 'function') {
    window.ttq.track(eventName, data);
  }
  
  // LinkedIn Insight
  if (window.lintrk) {
    window.lintrk('track', { conversion_id: eventName });
  }
  
  // Internal queue for debugging
  IVX._events = IVX._events || [];
  IVX._events.push({ event: eventName, data: data });
  console.log('[IVX Analytics]', eventName, data);
};

// Auto-track key events
IVX.trackPageView = function() {
  IVX.track('landing_page_view', { referrer: document.referrer });
};

IVX.trackCTA = function(ctaName, ctaLocation) {
  IVX.track('primary_cta_click', { cta_name: ctaName, cta_location: ctaLocation });
};

IVX.trackRegStart = function() {
  IVX.track('registration_started', { form: 'smart_funnel' });
};

IVX.trackRegComplete = function(userId) {
  IVX.track('registration_completed', { user_id: userId || 'anonymous' });
};

IVX.trackAPKDownload = function(action) {
  IVX.track('apk_download_' + (action || 'started'), { platform: 'android' });
};

IVX.trackFormError = function(field, message) {
  IVX.track('form_validation_error', { field: field, message: message });
};

IVX.trackBackendError = function(endpoint, status) {
  IVX.track('backend_submission_error', { endpoint: endpoint, status: status });
};

// Fire page view on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', IVX.trackPageView);
} else {
  IVX.trackPageView();
}
</script>`;

// Insert analytics right after the opening <body> tag
html = html.replace(/<body([^>]*)>/, '<body$1>\n' + analyticsScript);

// ═════════════════════════════════════════════════════
// STEP 7: Fix mobile Reels/FAB positioning
// ═════════════════════════════════════════════════════
// Add CSS to fix FAB covering CTAs on mobile
const fabFixCSS = `
/* === FAB Safe Area Fix === */
.nav-reels-btn, .reels-fab, .floating-reels-btn {
  z-index: 100 !important;
  bottom: max(80px, env(safe-area-inset-bottom, 0px) + 80px) !important;
}
@media (max-width: 480px) {
  .nav-reels-btn, .reels-fab, .floating-reels-btn {
    bottom: max(90px, env(safe-area-inset-bottom, 0px) + 90px) !important;
    right: 16px !important;
  }
}
/* Hide FAB when form is active */
.form-active .nav-reels-btn,
.form-active .reels-fab,
.form-active .floating-reels-btn {
  display: none !important;
}
`;
// Append FAB fix to CSS file
cssContent += fabFixCSS;
writeFileSync(LAND_DIR + '/ivx-styles.css', cssContent, 'utf-8');

// Also add a script to toggle form-active class on the body
const fabFixJS = `
<script>
// Hide FAB during form interaction
(function() {
  document.addEventListener('focusin', function(e) {
    if (e.target.matches('input, textarea, select, [contenteditable]')) {
      document.body.classList.add('form-active');
    }
  });
  document.addEventListener('focusout', function(e) {
    if (!e.target.matches('input, textarea, select, [contenteditable]')) {
      document.body.classList.remove('form-active');
    }
  });
})();
</script>`;
// Insert before closing </body>
html = html.replace('</body>', fabFixJS + '\n</body>');

// ═════════════════════════════════════════════════════
// STEP 8: Update ivx-config.json with real build info
// ═════════════════════════════════════════════════════
const config = {
  version: BUILD_VER,
  gitSha: gitSha,
  builtAt: new Date().toISOString(),
  supabaseUrl: '__IVX_SUPABASE_URL__',
  supabaseAnonKey: '__IVX_SUPABASE_ANON_KEY__',
  apiBaseUrl: 'https://api.ivxholding.com',
  backendUrl: 'https://api.ivxholding.com',
  analytics: {
    googleAdsKey: '__IVX_GOOGLE_ADS_KEY__',
    metaPixelId: '__IVX_META_PIXEL_ID__',
    tiktokPixelId: '__IVX_TIKTOK_PIXEL_ID__',
    linkedinPartnerId: '__IVX_LINKEDIN_PARTNER_ID__',
  },
};
writeFileSync(LAND_DIR + '/ivx-config.json', JSON.stringify(config, null, 2), 'utf-8');
console.log('Updated ivx-config.json with version:', BUILD_VER, 'gitSha:', gitSha);

// ═════════════════════════════════════════════════════
// Write optimized HTML
// ═════════════════════════════════════════════════════
writeFileSync(INDEX, html, 'utf-8');
const newSize = Buffer.byteLength(html, 'utf-8');
console.log('');
console.log('=== OPTIMIZATION COMPLETE ===');
console.log('Original HTML:', (originalSize / 1024).toFixed(1), 'KB');
console.log('Optimized HTML:', (newSize / 1024).toFixed(1), 'KB');
console.log('CSS extracted:', (cssContent.length / 1024).toFixed(1), 'KB → ivx-styles.css');
console.log('JS extracted:', (jsContent.length / 1024).toFixed(1), 'KB → ivx-app.js');
console.log('Base64 images extracted:', base64Count + cssBase64Count);
console.log('Total savings:', ((originalSize - newSize) / 1024).toFixed(1), 'KB (' + (((originalSize - newSize) / originalSize) * 100).toFixed(1) + '%)');
console.log('Breakpoints consolidated to:', uniqueBreakpoints.join(', '));
console.log('Analytics layer: ADDED');
console.log('FAB fix: ADDED');
console.log('Config updated: version=' + BUILD_VER + ', gitSha=' + gitSha);
