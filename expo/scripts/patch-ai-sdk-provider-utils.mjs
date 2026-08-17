import { readFile, writeFile } from "node:fs/promises";

const candidates = [
  new URL("../node_modules/@ai-sdk/react/node_modules/@ai-sdk/provider-utils/dist/index.mjs", import.meta.url),
  new URL("../node_modules/@ai-sdk/provider-utils/dist/index.mjs", import.meta.url),
];

const unsafeSource = `function importNodeModule(id) {
  return import(id);
}`;

const safeSource = `function importNodeModule(id) {
  // React Native/Hermes cannot compile a non-static dynamic import. This
  // helper only loads Node built-ins, which are unavailable on native.
  return Promise.reject(
    new Error('Node module "' + id + '" loading is not supported in native builds'),
  );
}`;

let target = null;
let source = null;

for (const candidate of candidates) {
  try {
    source = await readFile(candidate, "utf8");
    target = candidate;
    break;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

if (!target || source === null) {
  console.log("[IVX postinstall] AI SDK provider-utils is not installed; no Hermes patch needed.");
} else if (source.includes(safeSource)) {
  console.log("[IVX postinstall] AI SDK provider-utils is already Hermes-safe.");
} else if (source.includes(unsafeSource)) {
  await writeFile(target, source.replace(unsafeSource, safeSource), "utf8");
  console.log("[IVX postinstall] Applied Hermes-safe AI SDK provider-utils patch.");
} else {
  console.log("[IVX postinstall] Installed AI SDK provider-utils does not require the legacy Hermes patch.");
}
