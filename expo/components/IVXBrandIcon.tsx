import React from 'react';
import { View, StyleSheet } from 'react-native';
import IVXBrandLogo from '@/components/IVXBrandLogo';

interface IVXBrandIconProps {
  size?: number;
  style?: any;
  testID?: string;
  accessibilityLabel?: string;
}

export default function IVXBrandIcon({
  size = 24,
  style,
  testID = 'ivx-brand-icon',
  accessibilityLabel = 'IVX',
}: IVXBrandIconProps) {
  return (
    <View style={[styles.container, { width: size, height: size }, style]} testID={testID}>
      <IVXBrandLogo
        variant="symbol"
        size="xs"
        theme="dark"
        containerStyle={styles.logo}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
});
