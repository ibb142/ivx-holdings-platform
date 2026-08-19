/**
 * IVX Metro configuration — owner-controlled, Rork-independent.
 *
 * INDEPENDENCE RULE:
 *   The production bundle is built by plain Expo Metro. The Rork toolkit is
 *   NEVER a hard dependency: it was previously required unguarded at module
 *   scope (`require("@rork-ai/toolkit-sdk/metro")` + `module.exports =
 *   withRorkMetro(config)`), which meant every APK, AAB and web bundle could
 *   only be produced on a machine that had Rork's package installed. That is
 *   the definition of a vendor lock-in: the app could not be built without it.
 *
 *   Now the toolkit is loaded through a guarded optional block. If it is
 *   present (Rork dev preview) it is applied as a convenience. If it is absent,
 *   missing, or fails to load, the build continues on the standard Expo config
 *   with no behavioural difference to the shipped app.
 *
 *   Set IVX_ZERO_RORK=1 to force the pure-Expo path even when the package is
 *   installed. CI release builds use this to prove independence.
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Watchman is disabled because the Linux build sandbox runs at a low nice value
// that watchman refuses to start under, which hangs the bundle step.
config.watcher = config.watcher || {};
config.watcher.watchman = false;
config.resolver = config.resolver || {};
config.resolver.useWatchman = false;
config.server = config.server || {};
config.server.watchman = false;

let finalConfig = config;

// ── Guarded optional Rork dev-preview integration (never required to build) ──
const IVX_ZERO_RORK = process.env.IVX_ZERO_RORK === "1";

if (!IVX_ZERO_RORK) {
  try {
    // Indented + inside try/catch on purpose: this must never be a hard,
    // module-scope dependency of the IVX build.
    const rorkMetro = require("@rork-ai/toolkit-sdk/metro");
    const wrap = rorkMetro && rorkMetro.withRorkMetro;
    if (typeof wrap === "function") {
      finalConfig = wrap(config);
    }
  } catch {
    // Package absent or failed to load — expected in independent builds.
    finalConfig = config;
  }
}

module.exports = finalConfig;
