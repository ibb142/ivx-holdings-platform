const { getDefaultConfig } = require("expo/metro-config");
const {
  patchAiSdkProviderUtils,
} = require("./scripts/patch-ai-sdk-provider-utils.cjs");

// Dependency trees can be refreshed without package-manager lifecycle hooks.
// Repair and verify every nested provider-utils copy before Metro transforms it.
const aiSdkPatch = patchAiSdkProviderUtils(__dirname);
if (aiSdkPatch.patched > 0) {
  console.log(
    `[IVX AI SDK guard] Repaired ${aiSdkPatch.patched} Metro-incompatible file(s).`,
  );
}

const config = getDefaultConfig(__dirname);
let finalConfig = config;

// Developer preview tooling is optional and absent from production builds.
if (process.env.IVX_ZERO_RORK !== "1") {
  try {
    const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");
    finalConfig = withRorkMetro(config);
  } catch {
    // Plain Expo configuration is the production fallback.
  }
}

module.exports = finalConfig;
