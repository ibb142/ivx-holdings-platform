/**
 * Extract inline scripts from index.html and replace with external references.
 * Items 104-106: extract CSS/JS, items 123: use defer for non-critical scripts.
 */
import { readFileSync, writeFileSync } from 'node:fs';

let html = readFileSync('index.html', 'utf8');
const origSize = Buffer.byteLength(html);

// 1. Remove 4 ad pixel IIFEs — replaced by ivx-analytics.js (consent-gated loadAdPixels)
html = html.replace(
  /<!-- ═══ AD TRACKING.*?LinkedIn Insight Tag.*?<\/script>\s*\n\s*/s,
  '<!-- Ad pixels loaded via ivx-analytics.js (deferred, consent-gated) -->\n  '
);

// 2. Add defer to Supabase CDN + add ivx-analytics.js reference
html = html.replace(
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>',
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js" defer></script>\n  <script src="/ivx-analytics.js?v20260813" defer></script>'
);

// 3. Remove analytics event layer (the big <script> block after <body>)
html = html.replace(
  /<script>\n\/\/ IVX Analytics Event Layer[\s\S]*?<\/script>\s*\n/,
  ''
);

// 4. Replace wire instructions script with external reference
html = html.replace(
  /<script>\n\(function\(\) \{\n  \/\/ Fetch wire instructions[\s\S]*?<\/script>/,
  '<script src="/ivx-wire.js?v20260813" defer></script>'
);

// 5. Add defer to chat script
html = html.replace(
  '<script src="./landing-support-chat.js"></script>',
  '<script src="./landing-support-chat.js" defer></script>'
);

// 6. Replace scroll restoration + focus trap + lazy bridge + FAB + duplicate submission
//    All at end of body — replaced by ivx-lazy-bridge.js, ivx-ui-utils.js, ivx-web-vitals.js
html = html.replace(
  /<!-- ═══ SCROLL RESTORATION ═══ -->[\s\S]*?<\/body>/,
  '<script src="/ivx-lazy-bridge.js?v20260813" defer></script>\n<script src="/ivx-ui-utils.js?v20260813" defer></script>\n<script src="/ivx-web-vitals.js?v20260813" defer></script>\n</body>'
);

// 7. Update version strings
html = html.replace(/\?v20260812/g, '?v20260813');
html = html.replace(/\?v=20260722r/g, '?v20260813');

// 8. Remove 'unsafe-inline' from CSP script-src (no more inline scripts except JSON-LD)
//    Keep unsafe-inline for style-src since we have inline styles
html = html.replace(
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "script-src 'self' https://cdn.jsdelivr.net"
);

writeFileSync('index.html', html);
const newSize = Buffer.byteLength(html);
const reduction = ((1 - newSize / origSize) * 100).toFixed(1);
console.log(`index.html: ${origSize} → ${newSize} bytes (${reduction}% reduction)`);
console.log('Inline <script> blocks remaining:', (html.match(/<script>/g) || []).length);
console.log('External script references:', (html.match(/<script src=/g) || []).length);
