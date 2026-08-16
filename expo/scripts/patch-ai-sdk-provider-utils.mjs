import { readFile, writeFile } from "node:fs/promises";

const target = new URL(
  "../node_modules/@ai-sdk/react/node_modules/@ai-sdk/provider-utils/dist/index.mjs",
  import.meta.url,
);

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

const source = await readFile(target, "utf8");

if (source.includes(safeSource)) {
  console.log("[IVX postinstall] AI SDK provider-utils is already Hermes-safe.");
} else if (source.includes(unsafeSource)) {
  await writeFile(target, source.replace(unsafeSource, safeSource), "utf8");
  console.log("[IVX postinstall] Applied Hermes-safe AI SDK provider-utils patch.");
} else {
  throw new Error(
    "Unable to apply Hermes-safe AI SDK patch: expected provider-utils source was not found.",
  );
}
