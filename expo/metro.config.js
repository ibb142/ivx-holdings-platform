// IVX Metro configuration — plain Expo config, owner-controlled.
//
// This file previously required a vendor toolkit wrapper and exported the
// wrapped config. That made the vendor package a HARD build dependency: no
// APK, AAB or web bundle could be produced on any machine without it. It is
// stock Expo now, so the build runs anywhere.
//
// Do not reintroduce a vendor wrapper here. The zero-vendor runtime audit in
// `scripts/` fails the build if this file stops being a self-contained Expo config.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Bundle-time patch for the Metro-incompatible dynamic `import(id)` helper
// inside @ai-sdk/provider-utils. The postinstall patch fixes node_modules on
// install, but installs that skip lifecycle scripts restore pristine copies;
// this runs on every bundle, so the build stays green either way.
config.transformer = config.transformer || {};
config.transformer.babelTransformerPath = path.resolve(
  __dirname,
  "scripts/ivx-metro-transformer.js",
);

// Watchman is disabled: the Linux build sandbox runs at a low nice value that
// watchman refuses to start under, which hangs the bundle step.
config.watcher = config.watcher || {};
config.watcher.watchman = false;
config.resolver = config.resolver || {};
config.resolver.useWatchman = false;
config.server = config.server || {};
config.server.watchman = false;

module.exports = config;
