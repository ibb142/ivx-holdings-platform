const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = withRorkMetro(getDefaultConfig(__dirname));

// withRorkMetro installs its own transformer, so this assignment must happen
// afterward. The IVX transformer preserves those wrappers while removing the
// non-static AI SDK import that Metro rejects on every preview platform.
//
// NOTE: the managed preview environment periodically rewrites this file back to
// its default. That is tolerated: the deterministic protection lives in
// app/_layout.tsx, which keeps the provider-injection signature from matching.
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve("./scripts/ivx-metro-transformer"),
};

module.exports = config;
