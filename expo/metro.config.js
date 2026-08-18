const { getDefaultConfig } = require("expo/metro-config");

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
