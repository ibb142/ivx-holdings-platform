const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");
const path = require("path");

const config = withRorkMetro(getDefaultConfig(__dirname));

// Bundle-time guard: strips the Metro-incompatible dynamic `import(id)` from
// @ai-sdk/provider-utils even when node_modules was installed without scripts.
// Delegates to the Rork transformer, so provider wrapping is preserved.
config.transformer = {
  ...config.transformer,
  babelTransformerPath: path.resolve(
    __dirname,
    "scripts/ivx-metro-transformer.js",
  ),
};

module.exports = config;
