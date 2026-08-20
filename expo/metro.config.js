/**
 * IVX Metro configuration — self-contained.
 *
 * This config depends only on Expo's own tooling. It must never require a
 * third-party toolkit package at module scope: doing so makes that package a
 * hard build dependency, so no APK, AAB or web bundle can be produced on a
 * machine that lacks it.
 *
 * `expo/__tests__/vendor-independence.test.ts` enforces this. If you are here
 * because that gate failed, restore independence — do not relax the assertion.
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Expo's babel transformer, wrapped so the Metro-incompatible dynamic
// `import(id)` helper inside @ai-sdk/provider-utils is neutralized at bundle
// time. See scripts/ivx-metro-transformer.js for the full rationale.
config.transformer = {
  ...config.transformer,
  babelTransformerPath: path.resolve(__dirname, "scripts/ivx-metro-transformer.js"),
};

module.exports = config;
