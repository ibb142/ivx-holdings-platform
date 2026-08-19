/**
 * IVX Metro configuration — owner-controlled, fully independent.
 *
 * INDEPENDENCE RULE:
 *   This bundler config contains NO third-party build wrapper of any kind.
 *   It previously required a vendor toolkit package at module scope and
 *   exported that vendor's wrapper as the Metro config, which meant every
 *   APK, AAB and web bundle could only be produced on a machine that had the
 *   vendor package installed. That is vendor lock-in at the build layer.
 *
 *   IVX now builds with stock Expo Metro only. No vendor package is required,
 *   imported, or referenced to produce a shippable artifact.
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

module.exports = config;
