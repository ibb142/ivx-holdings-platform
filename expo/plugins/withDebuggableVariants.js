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
 */

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DEBUGGABLE_VARIANTS_LINE = '    debuggableVariants = []';
const MARKER = '// === withDebuggableVariants plugin: force JS bundle in all variants ===';

function withDebuggableVariants(config) {
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

      // Replace the commented-out debuggableVariants line with the active one
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

module.exports = withDebuggableVariants;
