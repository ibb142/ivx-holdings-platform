import { ConfigPlugin, withPodfile } from '@expo/config-plugins';

const MARKER = '# IVX_XCODE26_FMT_CONSTEVAL_FIX';

/**
 * Xcode 26 rejects the fmt version pulled by the current React Native/Expo
 * dependency graph when FMT_USE_CONSTEVAL remains enabled. Apply the fix at
 * the CocoaPods target build-setting level so it survives fresh prebuilds and
 * pod installs instead of mutating generated Pods sources.
 */
const withFmtXcode26Fix: ConfigPlugin = (config) =>
  withPodfile(config, (podfileConfig) => {
    const contents = podfileConfig.modResults.contents;
    if (contents.includes(MARKER)) return podfileConfig;

    const postInstall = /post_install\s+do\s+\|installer\|/;
    if (!postInstall.test(contents)) {
      throw new Error('IVX Xcode 26 fmt fix: generated Podfile has no post_install installer hook.');
    }

    const patch = `post_install do |installer|\n  ${MARKER}\n  installer.pods_project.targets.each do |target|\n    next unless target.name == 'fmt'\n    target.build_configurations.each do |build_config|\n      definitions = build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']\n      definitions = [definitions] if definitions.is_a?(String)\n      definitions << 'FMT_USE_CONSTEVAL=0' unless definitions.include?('FMT_USE_CONSTEVAL=0')\n      build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = definitions\n    end\n  end`;

    podfileConfig.modResults.contents = contents.replace(postInstall, patch);
    return podfileConfig;
  });

export default withFmtXcode26Fix;
