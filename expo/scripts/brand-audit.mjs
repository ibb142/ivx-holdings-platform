#!/usr/bin/env node
// Brand audit script — scans the repo for IVX brand violations.
// Usage: node expo/scripts/brand-audit.mjs

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';

const ROOT = resolve(process.cwd(), 'expo');

const OLD_LOGO_HOSTS = [
  'pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev',
];
const PROHIBITED_MARKS = [
  'Crown',
];
const OFFICIAL_LOGO_FILES = new Set([
  'ivx-logo.png',
  'ivx-logo-master.png',
  'ivx-logo-transparent.png',
  'ivx-symbol.png',
  'ivx-wordmark.png',
  'ivx-splash-logo.png',
]);
const PROPERTY_IMAGE_HOSTS = new Set([
  'images.unsplash.com',
  'images.pexels.com',
  'pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev', // old R2 is used for property photos too
]);

const EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js', '.html', '.css', '.md']);
const IGNORED_DIRS = new Set(['node_modules', '.git', '.rork', 'deploy', 'logs', 'tmp-qr', 'ios-ivx-anchor', 'ios-ivx-command-center', 'ios-ivx-deal-tracker', 'ios-ivx-ia']);

const issues = [];

function isPropertyUrl(url) {
  try {
    const host = new URL(url).hostname;
    return PROPERTY_IMAGE_HOSTS.has(host);
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(fullPath);
      }
      continue;
    }
    if (!EXTENSIONS.has(extname(entry.name))) continue;
    const content = await readFile(fullPath, 'utf-8');
    const rel = fullPath.replace(process.cwd() + '/', '');
    for (const host of OLD_LOGO_HOSTS) {
      if (content.includes(host)) {
        // Only flag if the URL is NOT a known property image URL
        const matches = [...content.matchAll(new RegExp(`https?://[^\\s"'\`]+${host}[^\\s"'\`]*`, 'g'))];
        for (const m of matches) {
          if (!isPropertyUrl(m[0])) {
            issues.push({ file: rel, type: 'old-logo-url', detail: m[0] });
          }
        }
      }
    }
    for (const mark of PROHIBITED_MARKS) {
      const re = new RegExp(`\\b${mark}\\b`, 'g');
      if (re.test(content)) {
        // Governance docs are allowed to mention prohibited marks as rules.
        if (entry.name === 'BRAND_GOVERNANCE.md') continue;
        issues.push({ file: rel, type: 'prohibited-mark', detail: mark });
      }
    }
    if (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
      const imageMatches = content.match(/source=\{[^}]*\}/g) || [];
      for (const m of imageMatches) {
        if (m.includes('http') && !m.includes('ivx-logo') && !m.includes('ivx-symbol') && !m.includes('ivx-wordmark')) {
          // Skip known property/background image hosts (not logos).
          const urlMatch = m.match(/https?:\/\/[^\s"'\`]+/);
          if (urlMatch && isPropertyUrl(urlMatch[0])) continue;
          issues.push({ file: rel, type: 'remote-logo-candidate', detail: m.slice(0, 80) });
        }
      }
    }
  }
}

async function checkAssets() {
  const assetDir = join(ROOT, 'assets/images');
  for (const name of OFFICIAL_LOGO_FILES) {
    try {
      await stat(join(assetDir, name));
    } catch {
      issues.push({ file: `expo/assets/images/${name}`, type: 'missing-official-asset', detail: name });
    }
  }
}

async function main() {
  await walk(ROOT);
  await checkAssets();

  const grouped = issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {});

  console.log('IVX Brand Audit Results');
  console.log('=========================');
  console.log(`Total issues: ${issues.length}`);
  for (const [type, count] of Object.entries(grouped)) {
    console.log(`  ${type}: ${count}`);
  }
  if (issues.length > 0) {
    console.log('\nDetails:');
    for (const issue of issues) {
      console.log(`  ${issue.file} — ${issue.type} (${issue.detail})`);
    }
  }
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Audit failed:', e);
  process.exit(1);
});
