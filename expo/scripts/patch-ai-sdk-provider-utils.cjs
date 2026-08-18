const { existsSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const UNSAFE_PATTERN = /function importNodeModule\(id\) \{\s*return import\(id\);\s*\}/g;
const SAFE_SOURCE = `function importNodeModule(id) {
  // Metro/Hermes cannot compile a non-static dynamic import. This helper only
  // loads Node built-ins, which are unavailable in React Native and web builds.
  return Promise.reject(
    new Error('Node module "' + id + '" loading is not supported in this build'),
  );
}`;

/**
 * Finds every installed copy of @ai-sdk/provider-utils and removes its
 * Metro-incompatible non-static dynamic import. Safe and idempotent.
 *
 * @param {string} projectRoot Expo project root containing node_modules.
 * @returns {{ copies: number, patched: number, verifiedFiles: number }}
 */
function patchAiSdkProviderUtils(projectRoot) {
  const copies = new Set();
  const rootNodeModules = join(projectRoot, "node_modules");

  function walkNodeModules(nodeModulesDir, depth) {
    if (depth > 8 || !existsSync(nodeModulesDir)) return;

    let entries;
    try {
      entries = readdirSync(nodeModulesDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const entryPath = join(nodeModulesDir, entry.name);

      if (entry.name.startsWith("@")) {
        let scopedEntries;
        try {
          scopedEntries = readdirSync(entryPath, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory() || scopedEntry.name.startsWith(".")) continue;
          const packagePath = join(entryPath, scopedEntry.name);
          if (entry.name === "@ai-sdk" && scopedEntry.name === "provider-utils") {
            copies.add(packagePath);
          }
          walkNodeModules(join(packagePath, "node_modules"), depth + 1);
        }
      } else {
        walkNodeModules(join(entryPath, "node_modules"), depth + 1);
      }
    }
  }

  walkNodeModules(rootNodeModules, 0);

  let patched = 0;
  let verifiedFiles = 0;
  const unknownFiles = [];

  for (const packagePath of copies) {
    for (const relativePath of ["dist/index.mjs", "dist/index.js"]) {
      const filePath = join(packagePath, relativePath);
      if (!existsSync(filePath)) continue;

      const source = readFileSync(filePath, "utf8");
      const fixed = source.replace(UNSAFE_PATTERN, SAFE_SOURCE);
      if (fixed !== source) {
        writeFileSync(filePath, fixed, "utf8");
        patched += 1;
      }

      const verified = readFileSync(filePath, "utf8");
      if (/function importNodeModule\(id\) \{\s*return import\(id\);/m.test(verified)) {
        unknownFiles.push(filePath);
      } else {
        verifiedFiles += 1;
      }
    }
  }

  if (unknownFiles.length > 0) {
    throw new Error(
      `AI SDK Metro compatibility patch failed for: ${unknownFiles.join(", ")}`,
    );
  }

  return { copies: copies.size, patched, verifiedFiles };
}

module.exports = { patchAiSdkProviderUtils };

if (require.main === module) {
  const result = patchAiSdkProviderUtils(join(__dirname, ".."));
  console.log(
    `[IVX AI SDK guard] ${result.copies} copy(ies), ${result.patched} patched, ${result.verifiedFiles} verified.`,
  );
}
