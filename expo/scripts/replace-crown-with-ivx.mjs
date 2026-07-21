#!/usr/bin/env node
// Replace Crown icon usage with IVXBrandIcon across the Expo app.
// Usage: node expo/scripts/replace-crown-with-ivx.mjs

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = 'expo';
const IGNORED_DIRS = new Set(['node_modules', '.git', '.rork', 'assets', 'deploy', 'logs', 'ios-ivx-anchor', 'ios-ivx-command-center', 'ios-ivx-deal-tracker', 'ios-ivx-ia']);
const EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js']);

const filesWithCrown = [];

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
    if (/\bCrown\b/.test(content)) {
      filesWithCrown.push(fullPath);
    }
  }
}

function replaceCrown(content) {
  // Remove Crown from lucide-react-native import block
  let modified = content;
  modified = modified.replace(/(\s+)Crown,\n/g, '$1');
  // Handle Crown at end of list before \n}
  modified = modified.replace(/,\n\s*Crown\n\s*}/g, '\n}');
  modified = modified.replace(/,\n\s*Crown\n(\s*)}/g, '\n$1}');

  // Add IVXBrandIcon import if not present
  if (!modified.includes('IVXBrandIcon')) {
    const lucideImportMatch = modified.match(/import\s+\{[^}]*\}\s+from\s+'lucide-react-native';\n/);
    if (lucideImportMatch) {
      const end = lucideImportMatch.index + lucideImportMatch[0].length;
      modified = modified.slice(0, end) + "import IVXBrandIcon from '@/components/IVXBrandIcon';\n" + modified.slice(end);
    } else {
      const anyImportMatch = modified.match(/import\s+.*\s+from\s+['"][^'"]+['"];\n/);
      if (anyImportMatch) {
        const end = anyImportMatch.index + anyImportMatch[0].length;
        modified = modified.slice(0, end) + "import IVXBrandIcon from '@/components/IVXBrandIcon';\n" + modified.slice(end);
      }
    }
  }

  // Replace icon: Crown with icon: IVXBrandIcon
  modified = modified.replace(/icon:\s*Crown\b/g, 'icon: IVXBrandIcon');

  // Replace <Crown size={X} color={Y} /> with <IVXBrandIcon size={X} />
  modified = modified.replace(/<Crown\s+size=\{([^}]+)\}\s+color=\{([^}]+)\}\s*\/>/g, '<IVXBrandIcon size={$1} />');
  // With style
  modified = modified.replace(/<Crown\s+size=\{([^}]+)\}\s+color=\{([^}]+)\}\s+style=\{([^}]+)\}\s*\/>/g, '<IVXBrandIcon size={$1} style={$3} />');

  return modified;
}

async function main() {
  await walk(ROOT);
  console.log(`Found ${filesWithCrown.length} files with Crown:`);
  for (const f of filesWithCrown) {
    console.log(`  ${f}`);
  }

  for (const file of filesWithCrown) {
    const original = await readFile(file, 'utf-8');
    const modified = replaceCrown(original);
    if (modified !== original) {
      await writeFile(file, modified, 'utf-8');
      console.log(`Updated ${file}`);
    } else {
      console.log(`No changes needed for ${file}`);
    }
  }
}

main().catch((e) => {
  console.error('Replacement failed:', e);
  process.exit(1);
});
