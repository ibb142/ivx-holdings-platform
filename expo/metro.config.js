const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// IVX-owned plain Expo Metro config.
// Rork toolkit wrapper removed — IVX is fully independent.
config.watcher.watchman = false;

module.exports = config;
