// IVX Metro configuration — standard Expo config (owner-controlled).
// This is now the live config, identical to metro.config.js.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// IVX-owned plain Expo Metro config.
// Rork toolkit wrapper removed — IVX is fully independent.
// Watchman is disabled because the Linux sandbox runs at a low nice value
// that watchman refuses to start under, causing the bundle step to hang.
config.watcher.watchman = false;
config.resolver = config.resolver || {};
config.resolver.useWatchman = false;
config.server = config.server || {};
config.server.watchman = false;

module.exports = config;
