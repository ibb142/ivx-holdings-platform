/**
 * IVX Metro configuration — self-contained.
 *
 * This file must never `require` an external toolkit at module scope. Doing so
 * makes that package a HARD BUILD dependency: no APK, AAB or web bundle can be
 * produced on a machine where it is absent, and the failure only appears at
 * build time on another machine. `__tests__/vendor-independence.test.ts` locks
 * this down — if it fails, independence has regressed. Do not relax it.
 *
 * The babel transformer is IVX's own (`scripts/ivx-metro-transformer.js`),
 * which delegates to Expo's transformer and patches the Metro-incompatible
 * dynamic `import(id)` helper inside `@ai-sdk/provider-utils` at bundle time.
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.transformer = {
  ...config.transformer,
  babelTransformerPath: path.resolve(__dirname, "scripts/ivx-metro-transformer.js"),
};

module.exports = config;
