/**
 * IVX Metro babel transformer.
 *
 * Delegates to Expo's own babel transformer and, at bundle time, neutralizes
 * the Metro-incompatible non-static dynamic `import(id)` helper shipped inside
 * `@ai-sdk/provider-utils` dist bundles.
 *
 * This used to try a vendor toolkit transformer first and fall back to Expo's.
 * The fallback made the vendor look optional while it silently stayed on the
 * bundling hot path whenever it happened to be installed — two different
 * transformers could process the same source depending on the machine. It is
 * Expo's transformer only now, so every machine bundles identically.
 *
 * Why this file exists: the postinstall patch (`scripts/patch-ai-sdk-provider-utils.mjs`)
 * fixes node_modules on install, but installs that skip lifecycle scripts can
 * restore pristine copies and break the build. This transformer runs on every
 * bundle, so the build stays green regardless of how node_modules was produced.
 * It is version-agnostic and a no-op for all other files.
 */
const upstream = require("@expo/metro-config/babel-transformer");

const UNSAFE_IMPORT_PATTERN =
  /function\s+importNodeModule\s*\(\s*id\s*\)\s*\{\s*return\s+import\s*\(\s*id\s*\)\s*;?\s*\}/g;

const SAFE_IMPORT_SOURCE = [
  "function importNodeModule(id) {",
  "  // Patched at bundle time (IVX): Metro cannot compile a non-static dynamic import.",
  "  // This helper only loads Node built-ins, which do not exist in app builds.",
  "  return Promise.reject(new Error('Node module \"' + id + '\" loading is not supported in this build'));",
  "}",
].join("\n");

function patchMetroUnsafeImports(filename, source) {
  if (
    typeof filename !== "string" ||
    typeof source !== "string" ||
    !filename.includes("@ai-sdk") ||
    !source.includes("import")
  ) {
    return source;
  }

  UNSAFE_IMPORT_PATTERN.lastIndex = 0;
  return source.replace(UNSAFE_IMPORT_PATTERN, SAFE_IMPORT_SOURCE);
}

function transform(args) {
  const source = patchMetroUnsafeImports(args?.filename, args?.src);
  // /app is the AWS web mount, never a native navigation prefix. Expo's
  // prefix stripping otherwise turns /app-report into /-report on Android.
  const options = args?.options;
  const native = options?.platform === 'android' || options?.platform === 'ios';
  const transformedArgs = {
    ...args,
    src: source,
    ...(native ? { options: { ...options, customTransformOptions: {
      ...options.customTransformOptions, baseUrl: '',
    } } } : {}),
  };
  return upstream.transform(transformedArgs);
}

module.exports = {
  ...upstream,
  patchMetroUnsafeImports,
  transform,
};
