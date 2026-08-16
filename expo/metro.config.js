const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

let config = getDefaultConfig(__dirname);
config = withRorkMetro(config);

// Disable Watchman in sandbox/CI — it triggers "priority fatal error"
// and the bundler falls back to Node fs watching, which is stable here.
// metro-file-map reads `useWatchman`; the watcher key is also kept for safety.
config.useWatchman = false;
config.watchman = false;
config.watcher = config.watcher || {};
config.watcher.watchman = false;
config.watcher.useWatchman = false;

// Some server-capable AI SDK packages contain generic dynamic module loaders.
// They are not used by the native startup path, but Metro rejects them while
// building the iOS bundle unless package-level dynamic dependencies are
// deferred to runtime.
config.transformer = config.transformer || {};
config.transformer.dynamicDepsInPackages = "throwAtRuntime";

// DEBUG: ensure this config is being loaded by Expo CLI
console.error(
  "[IVX METRO CONFIG] useWatchman=" +
    config.useWatchman +
    " watchman=" +
    config.watchman +
    " dynamicDepsInPackages=" +
    config.transformer.dynamicDepsInPackages,
);

module.exports = config;
