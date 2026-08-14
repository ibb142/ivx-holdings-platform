import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function findExisting(paths) {
  for (const p of paths) {
    if (existsSync(path.join(root, p))) return p;
  }
  return null;
}

const patches = [
  {
    file: 'patches/fb-watchman+2.0.2.patch',
    targets: ['node_modules/fb-watchman'],
  },
  {
    file: 'patches/@ai-sdk+provider-utils+3.0.32.patch',
    targets: [
      'node_modules/@ai-sdk/react/node_modules/@ai-sdk/provider-utils',
      'node_modules/@ai-sdk/provider-utils',
    ],
  },
];

let failed = false;

for (const { file, targets } of patches) {
  const patchPath = path.join(root, file);
  const target = findExisting(targets.map((t) => path.join(t)));
  if (!existsSync(patchPath)) {
    console.error(`[apply-patches] missing patch file: ${patchPath}`);
    failed = true;
    continue;
  }
  if (!target) {
    console.error(`[apply-patches] none of the target directories exist for ${file}: ${targets.join(', ')}`);
    failed = true;
    continue;
  }
  const targetPath = path.join(root, target);
  try {
    execSync(`patch -p1 -d "${targetPath}" < "${patchPath}"`, { stdio: 'inherit' });
    console.log(`[apply-patches] applied ${file} to ${target}`);
  } catch (err) {
    console.error(`[apply-patches] failed to apply ${file}: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('[apply-patches] one or more patches failed to apply');
  process.exit(1);
}
