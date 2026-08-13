const { getDefaultConfig } = require("expo/metro-config");

// IVX-owned Metro configuration. Keep the mobile production bundle independent
// from Rork-specific transforms so native QA and release builds use standard
// Expo/React Native semantics.
const config = getDefaultConfig(__dirname);

module.exports = config;
