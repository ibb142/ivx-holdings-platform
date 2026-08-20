// Self-contained Expo Metro configuration.
//
// This file must not reference any external build vendor. A previous revision
// imported a third-party metro wrapper at module scope, which made that package a
// HARD BUILD DEPENDENCY: with it absent the bundler crashed before the first line
// of app code ran. The independence gate in __tests__/vendor-independence.test.ts
// asserts this file loads cleanly with that package uninstalled, and that the
// babel transformer never delegates to it.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Use the in-repo transformer so bundling is reproducible on any machine,
// regardless of which optional packages happen to be installed.
config.transformer = {
  ...config.transformer,
  babelTransformerPath: path.resolve(__dirname, 'scripts/ivx-metro-transformer.js'),
};

module.exports = config;
