// Self-contained Expo Metro config — no third-party bundler plugin.
//
// The managed preview environment periodically rewrites this file back to a
// default that wraps the config in a vendor plugin required at module scope.
// That revert breaks two guarantees at once:
//
//   1. Independence — the build stops working on any machine where the vendor
//      package is not installed, because the require runs at module scope.
//   2. Bundle safety — that default sets no `babelTransformerPath`, so the IVX
//      transformer which strips non-static AI SDK imports is dropped, and the
//      bundle can then fail on `import(id)` inside @ai-sdk/provider-utils.
//
// `expo/__tests__/vendor-independence.test.ts` and
// `expo/__tests__/metro-ai-sdk-compatibility.test.ts` both assert this file's
// shape, so a silent revert is caught by the test suite instead of at runtime.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.transformer = {
  ...config.transformer,
  babelTransformerPath: path.resolve(__dirname, "scripts/ivx-metro-transformer.js"),
};

module.exports = config;
