const { getDefaultConfig } = require("expo/metro-config");
const { patchAiSdkProviderUtils } = require("./scripts/patch-ai-sdk-provider-utils.cjs");

// Hermes/Metro rejects dynamic `import(id)` in @ai-sdk/provider-utils. Patch
// every installed copy before Metro resolves modules (Rork sandboxes may skip
// postinstall, so this must run at Metro startup too).
try {
  patchAiSdkProviderUtils({ quiet: true });
} catch (error) {
  console.warn("[IVX metro] Hermes-safe AI SDK patch failed:", error.message);
}

const config = getDefaultConfig(__dirname);

/**
 * IVX ZERO-RORK RUNTIME POLICY
 * ----------------------------
 * The IVX app has ZERO hard dependency on Rork.
 *
 * The optional block below activates ONLY inside the Rork development
 * sandbox, where the toolkit is installed as a devDependency (developer
 * tooling — Rork acts as IVX's senior developer, nothing more).
 *
 * On every production checkout (GitHub clone, Render, CI, release APK
 * builds) the toolkit is absent, the require fails silently, and the
 * plain Expo config is exported unchanged.
 *
 * Force-disable even in dev with: IVX_ZERO_RORK=1
 * Verify anytime with: node scripts/verify-zero-rork-runtime.mjs
 */
let finalConfig = config;

if (process.env.IVX_ZERO_RORK !== "1") {
  try {
    const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");
    finalConfig = withRorkMetro(config);
  } catch {
    // Rork toolkit not installed — production mode, pure Expo config.
  }
}

module.exports = finalConfig;
