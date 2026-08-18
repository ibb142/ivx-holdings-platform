"use strict";

const { readdirSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Hermes/Metro cannot compile a non-static dynamic import like `import(id)`.
 * @ai-sdk/provider-utils ships an `importNodeModule` helper that does exactly
 * that (it only loads Node built-ins, which are unavailable on native anyway).
 * This script finds EVERY installed copy of @ai-sdk/provider-utils — top-level
 * and nested (e.g. under @ai-sdk/react/node_modules) — and replaces the unsafe
 * helper in both dist/index.mjs and dist/index.js.
 */

const SAFE_SOURCE = `function importNodeModule(id) {
  // React Native/Hermes cannot compile a non-static dynamic import. This
  // helper only loads Node built-ins, which are unavailable on native.
  return Promise.reject(
    new Error('Node module "' + id + '" loading is not supported in native builds'),
  );
}`;

const ALREADY_PATCHED_MARKER =
  'loading is not supported in native builds';

const UNSAFE_IMPORT_NODE_MODULE =
  /function importNodeModule\(id\)\s*\{\s*return import\(id\);\s*\}/g;

/** @returns {{ source: string, status: string }} */
function patchSource(source) {
  if (source.includes(ALREADY_PATCHED_MARKER)) {
    return { source, status: "already-patched" };
  }

  if (UNSAFE_IMPORT_NODE_MODULE.test(source)) {
    UNSAFE_IMPORT_NODE_MODULE.lastIndex = 0;
    return {
      source: source.replace(UNSAFE_IMPORT_NODE_MODULE, SAFE_SOURCE),
      status: "patched",
    };
  }

  if (
    source.includes("importNodeModule") &&
    /return import\(id\)/.test(source)
  ) {
    const replaced = source.replace(
      /function importNodeModule\(id\)\s*\{[\s\S]*?return import\(id\);[\s\S]*?\}/,
      SAFE_SOURCE,
    );
    if (replaced !== source) {
      return { source: replaced, status: "patched" };
    }
  }

  if (source.includes("importNodeModule")) {
    return { source, status: "unknown-shape" };
  }

  return { source, status: "no-dynamic-import" };
}

/** Recursively collect every @ai-sdk/provider-utils package dir. */
function findProviderUtilsCopies(nodeModulesDir, found, depth) {
  if (depth > 6 || !existsSync(nodeModulesDir)) return;

  let entries;
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true });
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
        scoped = readdirSync(entryPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of scoped) {
        if (sub.name.startsWith(".")) continue;
        const pkgPath = join(entryPath, sub.name);
        if (name === "@ai-sdk" && sub.name === "provider-utils") {
          found.add(pkgPath);
        }
        findProviderUtilsCopies(join(pkgPath, "node_modules"), found, depth + 1);
      }
    } else {
      findProviderUtilsCopies(join(entryPath, "node_modules"), found, depth + 1);
    }
  }
}

/** Patch one dist file; returns a status string for logging. */
function patchFile(filePath) {
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return "missing";
  }

  const { source: nextSource, status } = patchSource(source);
  if (status === "patched") {
    writeFileSync(filePath, nextSource, "utf8");
  }
  return status;
}

/**
 * Apply the Hermes-safe patch to every installed @ai-sdk/provider-utils copy.
 * Safe to call repeatedly (idempotent). Used from postinstall, start scripts,
 * and Metro config load.
 *
 * @param {{ projectRoot?: string, logPrefix?: string, quiet?: boolean }} [options]
 */
function patchAiSdkProviderUtils(options = {}) {
  const projectRoot = options.projectRoot ?? join(__dirname, "..");
  const logPrefix = options.logPrefix ?? "[IVX ai-sdk patch]";
  const quiet = options.quiet ?? false;

  const copies = new Set();
  findProviderUtilsCopies(join(projectRoot, "node_modules"), copies, 0);

  if (copies.size === 0) {
    if (!quiet) {
      console.log(`${logPrefix} No @ai-sdk/provider-utils copies found; nothing to patch.`);
    }
    return { patchedCount: 0, copiesScanned: 0, unknownShapes: [] };
  }

  let patchedCount = 0;
  const unknownShapes = [];

  for (const pkgDir of copies) {
    for (const distFile of ["dist/index.mjs", "dist/index.js"]) {
      const filePath = join(pkgDir, distFile);
      const result = patchFile(filePath);
      if (!quiet) {
        console.log(`${logPrefix} ${filePath}: ${result}`);
      }
      if (result === "patched") patchedCount += 1;
      if (result === "unknown-shape") unknownShapes.push(filePath);
    }
  }

  if (unknownShapes.length > 0) {
    throw new Error(
      `Hermes-safe AI SDK patch: unexpected importNodeModule shape in: ${unknownShapes.join(", ")}`,
    );
  }

  if (!quiet && patchedCount > 0) {
    console.log(
      `${logPrefix} complete (${patchedCount} file(s) patched, ${copies.size} copy(ies) scanned).`,
    );
  }

  return { patchedCount, copiesScanned: copies.size, unknownShapes };
}

module.exports = { patchAiSdkProviderUtils, patchSource };

if (require.main === module) {
  patchAiSdkProviderUtils();
}
