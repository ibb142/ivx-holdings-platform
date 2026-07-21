/**
 * IVXBrandLogo — the single reusable brand component for all IVX surfaces.
 *
 * Supported variants:
 *   - full       (master black-bg logo)
 *   - symbol     (compact gold symbol)
 *   - wordmark   (IVX text only)
 *   - horizontal (symbol left, wordmark right)
 *   - stacked    (symbol above wordmark)
 *
 * Supported sizes: xs, sm, md, lg, xl, hero
 * Supported themes: dark, light
 *
 * Rules:
 *   - Always use this component instead of ad-hoc Image components for IVX branding.
 *   - Never stretch or distort the logo.
 *   - Always provide an accessible label.
 */
import React from 'react';
import { Image, StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native';
import { getIVXLogoSpec, type IVXLogoVariant, type IVXLogoSize, type IVXLogoTheme } from '@/constants/brand';

interface IVXBrandLogoProps {
  variant?: IVXLogoVariant;
  size?: IVXLogoSize;
  theme?: IVXLogoTheme;
  style?: ImageStyle;
  containerStyle?: ViewStyle;
  accessibilityLabel?: string;
  testID?: string;
}

export default function IVXBrandLogo({
  variant = 'full',
  size = 'md',
  theme = 'dark',
  style,
  containerStyle,
  accessibilityLabel,
  testID = 'ivx-brand-logo',
}: IVXBrandLogoProps) {
  const spec = getIVXLogoSpec(variant, size, theme);

  return (
    <View style={[styles.container, containerStyle]} testID={`${testID}-container`}>
      <Image
        source={spec.source}
        style={[
          {
            width: spec.width,
            height: spec.height,
          },
          style,
        ]}
        resizeMode="contain"
        accessibilityLabel={accessibilityLabel || spec.accessibilityLabel}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
