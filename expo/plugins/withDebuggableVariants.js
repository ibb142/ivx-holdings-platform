/**
 * Expo Config Plugin: Force JS bundle + assets in ALL build variants.
 *
 * By default, React Native's Gradle plugin sets debuggableVariants = ["debug"],
 * which means debug builds skip JS bundling and asset packaging (expecting a
 * Metro dev server). In CI/CD there's no Metro server, so the debug APK ships
 * without JavaScript code — producing a ~48MB APK that crashes on launch.
 *
 * This plugin injects `debuggableVariants = []` into the `react { }` block
 * in android/app/build.gradle AFTER `expo prebuild --clean` regenerates it,
 * so the setting survives prebuild. With debuggableVariants = [], ALL variants
 * (including debug) get the JS bundle + assets baked in.
 *
 * The resulting debug APK is ~84MB (matching the release build size) and
 * launches correctly without a Metro server.
 */

const { withProjectBuildGradle } = require('expo/config-plugins');

const DEBUGGABLE_VARIANTS_LINE = '    debuggableVariants = []';
const MARKER = '// === withDebuggableVariants plugin: force JS bundle in all variants ===';

function withDebuggableVariants(config) {
  return withProjectBuildGradle(config, (modConfig) => {
    // withProjectBuildGradle gives us the project-level build.gradle,
    // but we need the app-level one. Use the mod's projectRoot to find it.
    return modConfig;
  });
}

// We actually need to modify android/app/build.gradle, not the project-level one.
// Use a file-based approach instead.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withDebuggableVariantsFile(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const appBuildGradlePath = path.join(
        modConfig.platformProjectRoot,
        'app',
        'build.gradle'
      );

      if (!fs.existsSync(appBuildGradlePath)) {
        console.warn('[withDebuggableVariants] app/build.gradle not found at', appBuildGradlePath);
        return modConfig;
      }

      let contents = fs.readFileSync(appBuildGradlePath, 'utf-8');

      // Skip if already patched
      if (contents.includes(MARKER)) {
        console.log('[withDebuggableVariants] Already patched, skipping.');
        return modConfig;
      }

      // Find the react { } block and inject debuggableVariants = [] after the opening
      // The react block starts with "react {" and we want to add our line inside it.
      // We look for the "/* Variants */" comment block which is the standard Expo/RN
      // template location for debuggableVariants.

      // Strategy: replace the commented-out debuggableVariants line with the active one
      const commentedPattern = /\/\/\s*debuggableVariants\s*=\s*\["liteDebug",\s*"prodDebug"\]/;
      if (commentedPattern.test(contents)) {
        contents = contents.replace(
          commentedPattern,
          `${MARKER}\n${DEBUGGABLE_VARIANTS_LINE}`
        );
        console.log('[withDebuggableVariants] Patched: replaced commented debuggableVariants with active one.');
      } else {
        // Fallback: inject right after the "react {" opening line
        const reactBlockPattern = /^(react\s*\{)/m;
        if (reactBlockPattern.test(contents)) {
          contents = contents.replace(
            reactBlockPattern,
            `$1\n${MARKER}\n${DEBUGGABLE_VARIANTS_LINE}`
          );
          console.log('[withDebuggableVariants] Patched: injected after react { opening.');
        } else {
          console.warn('[withDebuggableVariants] Could not find react { block to patch.');
        }
      }

      fs.writeFileSync(appBuildGradlePath, contents, 'utf-8');
      console.log('[withDebuggableVariants] Wrote patched build.gradle');
      return modConfig;
    },
  ]);
}

module.exports = withDebuggableVariantsFile;
