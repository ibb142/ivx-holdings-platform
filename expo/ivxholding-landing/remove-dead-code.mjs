/**
 * Remove dead code (items 112-113):
 * - Member registration modal HTML from index.html (not called — funnel is sole route)
 * - Member registration functions from ivx-app.js
 * - Waitlist CSS from ivx-styles.css (waitlist removed in items 58-60)
 */
import { readFileSync, writeFileSync } from 'node:fs';

// ═══ 1. Remove member registration modal from index.html ═══
let html = readFileSync('index.html', 'utf8');
const htmlBefore = Buffer.byteLength(html);

// Remove the mreg-overlay div (lines 287-341 in current file)
html = html.replace(
  /<div class="mreg-overlay" id="mreg-overlay"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
  '<!-- Member registration modal removed (item 112) — funnel is sole conversion route -->'
);

writeFileSync('index.html', html);
console.log(`index.html: ${htmlBefore} → ${Buffer.byteLength(html)} bytes (${((1 - Buffer.byteLength(html) / htmlBefore) * 100).toFixed(1)}% reduction)`);

// ═══ 2. Remove member registration functions from ivx-app.js ═══
let js = readFileSync('ivx-app.js', 'utf8');
const jsBefore = Buffer.byteLength(js);

// Remove the member registration block (from comment to the closing of submitMemberVerify)
js = js.replace(
  /\/\/ ── Member registration ──[\s\S]*?window\.submitMemberVerify = function \(\) \{[\s\S]*?  \};\n/,
  '// Member registration functions removed (item 112) — funnel is sole conversion route.\n'
);

writeFileSync('ivx-app.js', js);
console.log(`ivx-app.js: ${jsBefore} → ${Buffer.byteLength(js)} bytes (${((1 - Buffer.byteLength(js) / jsBefore) * 100).toFixed(1)}% reduction)`);

// ═══ 3. Remove waitlist CSS from ivx-styles.css ═══
let css = readFileSync('ivx-styles.css', 'utf8');
const cssBefore = Buffer.byteLength(css);

// Remove waitlist CSS section (from .waitlist-section to the end of waitlist-related rules)
css = css.replace(
  /\/\* ─── WAITLIST SECTION ─── \*\/[\s\S]*?(?=\/\*|$)/,
  '/* Waitlist CSS removed (item 113) — waitlist functionality removed in items 58-60 */\n\n'
);

// Also remove any remaining waitlist-related rules
css = css.replace(/\s*\.waitlist[^{]*\{[^}]*\}/g, '');
css = css.replace(/\s*\.wl-[^{]*\{[^}]*\}/g, '');

writeFileSync('ivx-styles.css', css);
console.log(`ivx-styles.css: ${cssBefore} → ${Buffer.byteLength(css)} bytes (${((1 - Buffer.byteLength(css) / cssBefore) * 100).toFixed(1)}% reduction)`);

console.log('\n=== Dead code removal complete ===');
