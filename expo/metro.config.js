const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = getDefaultConfig(__dirname);

// Disable Watchman — it refuses to start in low-priority sandboxes
config.watcher = config.watcher || {};
config.watcher.useWatchman = false;
config.resolver = config.resolver || {};

module.exports = withRorkMetro(config);
