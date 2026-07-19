const { getDefaultConfig } = require("expo/metro-config");

// IVX VENDOR-INDEPENDENCE 2026-07-19: @rork-ai/toolkit-sdk and withRorkMetro
// removed. Metro now uses the plain Expo default config. The IVX app builds,
// bundles, and runs with zero Rork SDK in the Metro pipeline.
const config = getDefaultConfig(__dirname);

// Watchman refuses to start in low-priority sandboxes (nice_value=19).
// Force Metro to use the Node.js fs.watch (non-watchman) watcher.
// Setting `useWatchman` was an invalid Metro option that produced a
// validation warning but did NOT actually disable Watchman. The correct
// approach is to remove the Watchman binary from PATH (done in build script)
// and set `watchFolders` to an empty array plus `resolver.blockList` to
// prevent recursive node_modules watches.
config.watcher = config.watcher || {};
// Prevent Watchman from being spawned at all by pointing watchFolders
// only at the project root (Metro will fall back to fs.watch).
config.watchFolders = [__dirname];
config.resolver = config.resolver || {};

module.exports = config;
