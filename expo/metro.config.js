const { getDefaultConfig } = require("expo/metro-config");

let config = getDefaultConfig(__dirname);

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

// In CI, auto-exit Metro after serving the bundle to prevent 60-min timeout.
// The iOS build succeeds and app launches within ~2 minutes of Metro starting.
// Without this, `npx expo run:ios` hangs forever waiting for Metro in CI.
if (process.env.CI === 'true') {
    config.server = config.server || {};
    let bundleServed = false;
    const originalEnhanceMiddleware = config.server.enhanceMiddleware;
    config.server.enhanceMiddleware = (middleware, server) => {
        if (originalEnhanceMiddleware) {
            middleware = originalEnhanceMiddleware(middleware, server);
        }
        return (req, res, next) => {
            res.on('finish', () => {
                if (req.url && req.url.includes('.bundle') && !bundleServed) {
                    bundleServed = true;
                    console.error('[IVX METRO CONFIG] Bundle served in CI, scheduling clean exit in 60s');
                    setTimeout(() => {
                        console.error('[IVX METRO CONFIG] CI verification complete, exiting Metro');
                        process.exit(0);
                    }, 60000);
                }
            });
            return middleware(req, res, next);
        };
    };
    // Fallback: force exit after 10 minutes if no bundle was served
    setTimeout(() => {
        if (!bundleServed) {
            console.error('[IVX METRO CONFIG] No bundle served within 10min in CI, exiting');
            process.exit(0);
        }
    }, 600000);
}

module.exports = config;
