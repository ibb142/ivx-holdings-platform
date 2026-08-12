/**
 * Expo Config Plugin: Fix fmt 11.0.2 consteval compilation error with Xcode 26+.
 *
 * React Native bundles fmt 11.0.2 via RCT-Folly. Xcode 26 (Apple Clang 21)
 * enforces stricter consteval rules, causing FMT_STRING macro expansions
 * to fail. fmt 12.1.0 fixes this but RN hasn't upgraded yet.
 *
 * This plugin patches the Podfile post_install to:
 *   1. Set CLANG_CXX_LANGUAGE_STANDARD=c++17 for the fmt target (disables
 *      consteval by staying below the C++20 threshold).
 *   2. Patch Pods/fmt/include/fmt/base.h to force FMT_USE_CONSTEVAL=0
 *      as a belt-and-suspenders fix.
 *
 * References:
 *   - https://github.com/facebook/react-native/issues/55601
 *   - https://github.com/fmtlib/fmt/issues/4740
 *   - https://github.com/expo/expo/issues/44229
 */

let withDangerousMod;
try {
  withDangerousMod = require('expo/config-plugins').withDangerousMod;
} catch (_e) {
  withDangerousMod = (_fn) => (config) => config;
}
const fs = require('fs');
const path = require('path');

const fmtPatchCode = `
  # === FMT Xcode 26 consteval fix ===
  # Fix fmt 11.0.2 consteval errors with Xcode 26 / Apple Clang 21+.
  # The FMT_STRING macro calls consteval functions that fail under C++20.
  # Strategy: (1) force C++17 for fmt target, (2) aggressively patch base.h
  # to force FMT_USE_CONSTEVAL=0 by prepending an override, (3) patch all
  # fmt headers that reference FMT_USE_CONSTEVAL.
  installer.pods_project.targets.each do |target|
    if target.name == 'fmt'
      target.build_configurations.each do |config|
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
        # Also add a preprocessor define as belt-and-suspenders
        defs = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        defs << 'FMT_USE_CONSTEVAL=0'
        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs
      end
    end
  end

  # Aggressively patch base.h — prepend #define FMT_USE_CONSTEVAL 0 at the
  # very top, before any detection logic runs. This is simpler and more
  # reliable than regex-replacing specific lines.
  fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
  if File.exist?(fmt_base)
    content = File.read(fmt_base)
    unless content.include?('FMT_USE_CONSTEVAL_override_Xcode26')
      override = "// FMT_USE_CONSTEVAL_override_Xcode26\\n// Force-disable consteval for fmt 11.0.2 + Xcode 26 compatibility\\n#ifndef FMT_USE_CONSTEVAL\\n#define FMT_USE_CONSTEVAL 0\\n#endif\\n\n"
      File.chmod(0644, fmt_base)
      File.write(fmt_base, override + content)
      puts "Patch: fmt/base.h FMT_USE_CONSTEVAL=0 prepended for Xcode 26"
    end
  end

  # Also patch format-inl.h and other fmt headers that may use FMT_STRING
  fmt_include = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt')
  if File.directory?(fmt_include)
    Dir.glob(File.join(fmt_include, '*.h')).each do |header|
      content = File.read(header)
      unless content.include?('FMT_USE_CONSTEVAL_override_Xcode26')
        # Only patch headers that reference FMT_STRING or FMT_USE_CONSTEVAL
        if content.include?('FMT_STRING') || content.include?('FMT_USE_CONSTEVAL')
          override = "// FMT_USE_CONSTEVAL_override_Xcode26\\n#ifndef FMT_USE_CONSTEVAL\\n#define FMT_USE_CONSTEVAL 0\\n#endif\\n\n"
          File.chmod(0644, header)
          File.write(header, override + content)
          puts "Patch: #{File.basename(header)} FMT_USE_CONSTEVAL=0 for Xcode 26"
        end
      end
    end
  end
`;

const withFmtXcode26Fix = (config) => {
  return withDangerousMod(config, ['ios', (modConfig) => {
    const podfilePath = path.join(
      modConfig.modRequest.platformProjectRoot,
      'Podfile'
    );

    if (!fs.existsSync(podfilePath)) {
      console.log('[withFmtXcode26Fix] No Podfile found, skipping');
      return modConfig;
    }

    let content = fs.readFileSync(podfilePath, 'utf-8');

    // Check if we already patched
    if (content.includes('FMT_USE_CONSTEVAL_override_Xcode26')) {
      console.log('[withFmtXcode26Fix] Podfile already patched, skipping');
      return modConfig;
    }

    // Find the post_install block and inject our patch before the final 'end'
    const postInstallMatch = content.match(
      /post_install\s+do\s+\|installer\|[\s\S]*?react_native_post_install\([\s\S]*?\)[\s\S]*?\n(\s*end\s*\n)/
    );

    if (postInstallMatch) {
      const insertPoint = postInstallMatch.index + postInstallMatch[0].length;
      content =
        content.slice(0, insertPoint - postInstallMatch[1].length) +
        fmtPatchCode +
        content.slice(insertPoint - postInstallMatch[1].length);
      console.log('[withFmtXcode26Fix] Injected fmt patch into post_install block');
    } else {
      // Fallback: try to find any post_install block
      const simpleMatch = content.match(
        /post_install\s+do\s+\|installer\|[\s\S]*?\n(\s*end\s*\n)/
      );
      if (simpleMatch) {
        const insertPoint = simpleMatch.index + simpleMatch[0].length;
        content =
          content.slice(0, insertPoint - simpleMatch[1].length) +
          fmtPatchCode +
          content.slice(insertPoint - simpleMatch[1].length);
        console.log('[withFmtXcode26Fix] Injected fmt patch into simple post_install block');
      } else {
        // Last resort: append a new post_install block
        content += '\npost_install do |installer|\n' + fmtPatchCode + '\nend\n';
        console.log('[withFmtXcode26Fix] Appended new post_install block with fmt patch');
      }
    }

    fs.writeFileSync(podfilePath, content, 'utf-8');
    return modConfig;
  }]);
};

module.exports = withFmtXcode26Fix;
