import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  const patchInput = readFileSync(patchPath);
  const patchArgs = ['-p1', '--batch', '-d', targetPath];

  try {
    execFileSync('patch', [...patchArgs, '--forward', '--dry-run'], {
      input: patchInput,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    execFileSync('patch', [...patchArgs, '--forward'], {
      input: patchInput,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log(`[apply-patches] applied ${file} to ${target}`);
  } catch (applyError) {
    try {
      execFileSync('patch', [...patchArgs, '--reverse', '--dry-run'], {
        input: patchInput,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      console.log(`[apply-patches] already applied ${file} to ${target}`);
    } catch {
      console.error(`[apply-patches] failed to apply ${file}: ${applyError.message}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('[apply-patches] one or more patches failed to apply');
  process.exit(1);
}
