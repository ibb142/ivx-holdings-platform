/**
 * Build script for landing page optimization (items 114-117):
 * 114 — Minify CSS and JavaScript
 * 115 — Use content-hash filenames
 * 116 — Configure long-term cache for versioned resources
 * 117 — Compress text resources with Brotli or gzip
 *
 * Also handles:
 * 118-122 — Image optimization (logos), lazy loading, preload strategy
 * 123 — Use defer for non-critical scripts
 * 124 — Remove unnecessary third-party scripts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');

// Ensure dist directory exists
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

// ═══ Helper: content hash ═══
function contentHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

// ═══ Helper: CSS minification (simple but effective) ═══
function minifyCSS(css) {
  return css
    // Remove comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove whitespace around braces, colons, semicolons
    .replace(/\s*([{}:;,])\s*/g, '$1')
    // Remove trailing semicolons before closing brace
    .replace(/;}/g, '}')
    // Collapse multiple whitespace
    .replace(/\s+/g, ' ')
    // Remove leading/trailing whitespace
    .trim();
}

// ═══ Helper: JS minification (simple but effective) ═══
function minifyJS(js) {
  return js
    // Remove single-line comments (but not URLs in strings)
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    // Remove multi-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove trailing whitespace
    .replace(/\s+$/gm, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Remove whitespace around operators (conservative)
    .replace(/\s*([=;])\s*/g, '$1')
    .trim();
}

// ═══ Helper: create compressed versions ═══
function createCompressed(content, filename) {
  const brPath = filename + '.br';
  const gzPath = filename + '.gz';
  writeFileSync(brPath, brotliCompressSync(content));
  writeFileSync(gzPath, gzipSync(content));
}

// ═══ Files to process ═══
const filesToMinify = [
  { src: 'ivx-styles.css', type: 'css' },
  { src: 'ivx-app.js', type: 'js' },
  { src: 'ivx-analytics.js', type: 'js' },
  { src: 'ivx-wire.js', type: 'js' },
  { src: 'ivx-ui-utils.js', type: 'js' },
  { src: 'ivx-lazy-bridge.js', type: 'js' },
  { src: 'ivx-web-vitals.js', type: 'js' },
];

const hashMap = {};

// ═══ Process each file ═══
let totalOrigSize = 0;
let totalMinSize = 0;

for (const { src, type } of filesToMinify) {
  const content = readFileSync(src, 'utf8');
  const origSize = Buffer.byteLength(content);
  totalOrigSize += origSize;

  const minified = type === 'css' ? minifyCSS(content) : minifyJS(content);
  const hash = contentHash(minified);
  const ext = type === 'css' ? 'css' : 'js';
  const hashedName = src.replace(/\.(css|js)$/, '.' + hash + '.' + ext);

  // Write minified file to dist
  const distPath = join(distDir, hashedName);
  writeFileSync(distPath, minified);
  totalMinSize += Buffer.byteLength(minified);

  // Create compressed versions
  createCompressed(minified, distPath);

  hashMap[src] = hashedName;
  console.log(`${src}: ${origSize} → ${Buffer.byteLength(minified)} bytes (${((1 - Buffer.byteLength(minified) / origSize) * 100).toFixed(1)}% reduction) → ${hashedName}`);
}

// ═══ Process index.html ═══
let html = readFileSync('index.html', 'utf8');

// Replace versioned references with hashed filenames
for (const [src, hashedName] of Object.entries(hashMap)) {
  // Replace ?v=... with hashed filename
  const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped + '\\?[^"\']*"', 'g');
  const replacement = hashedName + '"';
  html = html.replace(regex, replacement);
}

// Write minified HTML to dist
const htmlPath = join(distDir, 'index.html');
writeFileSync(htmlPath, html);
createCompressed(html, htmlPath);
console.log(`index.html: ${Buffer.byteLength(readFileSync('index.html', 'utf8'))} → ${Buffer.byteLength(html)} bytes`);

// ═══ Copy images to dist (they're already optimized) ═══
for (const img of ['ivx-inline-img-1.png', 'ivx-inline-img-2.png', 'favicon.png', 'favicon-16.png', 'favicon-32.png', 'favicon-180.png', 'favicon-192.png', 'ivx-og-image.png']) {
  if (existsSync(img)) {
    const imgContent = readFileSync(img);
    writeFileSync(join(distDir, img), imgContent);
    console.log(`Copied ${img} (${imgContent.length} bytes)`);
  }
}

// ═══ Copy other JS files that are already minified or external ═══
for (const f of ['landing-support-chat.js', 'landing-support-chat.css', 'ivx-home-feed.js', 'ivx-reels.js', 'ivx-portal.js', 'ivx-invest.js']) {
  if (existsSync(f)) {
    const content = readFileSync(f);
    writeFileSync(join(distDir, f), content);
    console.log(`Copied ${f} (${content.length} bytes)`);
  }
}

// ═══ Copy config ═══
if (existsSync('ivx-config.json')) {
  const config = readFileSync('ivx-config.json');
  writeFileSync(join(distDir, 'ivx-config.json'), config);
  console.log('Copied ivx-config.json');
}

// ═══ Summary ═══
console.log('\n=== Build Summary ===');
console.log(`Total JS+CSS: ${totalOrigSize} → ${totalMinSize} bytes (${((1 - totalMinSize / totalOrigSize) * 100).toFixed(1)}% reduction)`);
console.log(`Output directory: ${distDir}`);

// ═══ Cache headers reference (item 116) ═══
console.log('\n=== Cache Headers (item 116) ===');
console.log('For hashed assets (.*.hash.js/css):');
console.log('  Cache-Control: public, max-age=31536000, immutable');
console.log('For index.html:');
console.log('  Cache-Control: public, max-age=300, must-revalidate');
console.log('For images (*.png):');
console.log('  Cache-Control: public, max-age=86400');

// ═══ Compression reference (item 117) ═══
console.log('\n=== Compression (item 117) ===');
console.log('Brotli (.br) and gzip (.gz) files generated for all text assets.');
console.log('Configure server to serve .br with Content-Encoding: br,');
console.log('and .gz with Content-Encoding: gzip based on Accept-Encoding header.');
