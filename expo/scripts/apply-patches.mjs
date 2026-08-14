import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const patches = [
  {
    file: 'patches/fb-watchman+2.0.2.patch',
    target: 'node_modules/fb-watchman',
  },
  {
    file: 'patches/@ai-sdk+provider-utils+3.0.32.patch',
    target: 'node_modules/@ai-sdk/react/node_modules/@ai-sdk/provider-utils',
  },
];

for (const { file, target } of patches) {
  const patchPath = path.join(root, file);
  const targetPath = path.join(root, target);
  if (!existsSync(patchPath)) {
    console.warn(`[apply-patches] missing patch file: ${patchPath}`);
    continue;
  }
  if (!existsSync(targetPath)) {
    console.warn(`[apply-patches] target directory missing: ${targetPath}`);
    continue;
  }
  try {
    execSync(`patch -p1 -d "${targetPath}" < "${patchPath}"`, { stdio: 'inherit' });
    console.log(`[apply-patches] applied ${file}`);
  } catch (err) {
    console.warn(`[apply-patches] failed to apply ${file}: ${err.message}`);
  }
}
