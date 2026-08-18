import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Hermes/Metro cannot compile a non-static dynamic import like `import(id)`.
 * @ai-sdk/provider-utils ships an `importNodeModule` helper that does exactly
 * that (it only loads Node built-ins, which are unavailable on native anyway).
 * This script finds EVERY installed copy of @ai-sdk/provider-utils — top-level
 * and nested (e.g. under @ai-sdk/react/node_modules) — and replaces the unsafe
 * helper in both dist/index.mjs and dist/index.js.
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const UNSAFE_SOURCE = `function importNodeModule(id) {
  return import(id);
}`;

const SAFE_SOURCE = `function importNodeModule(id) {
  // React Native/Hermes cannot compile a non-static dynamic import. This
  // helper only loads Node built-ins, which are unavailable on native.
  return Promise.reject(
    new Error('Node module "' + id + '" loading is not supported in native builds'),
  );
}`;

/** Recursively collect every @ai-sdk/provider-utils package dir. */
async function findProviderUtilsCopies(nodeModulesDir, found, depth) {
  if (depth > 6) return;
  let entries;
  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".")) continue;
    const entryPath = join(nodeModulesDir, name);
    if (name.startsWith("@")) {
      let scoped;
      try {
        scoped = await readdir(entryPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of scoped) {
        if (sub.name.startsWith(".")) continue;
        const pkgPath = join(entryPath, sub.name);
        if (name === "@ai-sdk" && sub.name === "provider-utils") {
          found.add(pkgPath);
        }
        await findProviderUtilsCopies(join(pkgPath, "node_modules"), found, depth + 1);
      }
    } else {
      await findProviderUtilsCopies(join(entryPath, "node_modules"), found, depth + 1);
    }
  }
}

/** Patch one dist file; returns a status string for logging. */
async function patchFile(filePath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch {
    return "missing";
  }
  if (source.includes(SAFE_SOURCE)) return "already-patched";
  if (source.includes(UNSAFE_SOURCE)) {
    await writeFile(filePath, source.replace(UNSAFE_SOURCE, SAFE_SOURCE), "utf8");
    return "patched";
  }
  if (source.includes("importNodeModule")) return "unknown-shape";
  return "no-dynamic-import";
}

const copies = new Set();
await findProviderUtilsCopies(join(projectRoot, "node_modules"), copies, 0);

if (copies.size === 0) {
  console.log(
    "[IVX postinstall] No @ai-sdk/provider-utils copies found; nothing to patch.",
  );
  process.exit(0);
}

let patchedCount = 0;
const unknownShapes = [];
for (const pkgDir of copies) {
  for (const distFile of ["dist/index.mjs", "dist/index.js"]) {
    const filePath = join(pkgDir, distFile);
    const result = await patchFile(filePath);
    console.log(`[IVX postinstall] ${filePath}: ${result}`);
    if (result === "patched") patchedCount += 1;
    if (result === "unknown-shape") unknownShapes.push(filePath);
  }
}

if (unknownShapes.length > 0) {
  throw new Error(
    `Hermes-safe AI SDK patch: unexpected importNodeModule shape in: ${unknownShapes.join(", ")}`,
  );
}

console.log(
  `[IVX postinstall] Hermes-safe AI SDK patch complete (${patchedCount} file(s) patched, ${copies.size} copy(ies) scanned).`,
);
