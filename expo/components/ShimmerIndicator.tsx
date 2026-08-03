/**
 * ShimmerIndicator — Drop-in replacement for ActivityIndicator.
 *
 * Instead of a spinning circle (which signals "waiting"), this renders
 * a subtle pulsing dot that matches Instagram's content-loading aesthetic.
 * The user perceives content is arriving, not that the app is stuck.
 *
 * Use this anywhere you would use ActivityIndicator. Same props API.
 */
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Platform } from 'react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type ShimmerIndicatorProps = {
  size?: 'small' | 'large';
  color?: string;
  style?: any;
  animating?: boolean;
};

const SIZE_MAP = {
  small: 20,
  large: 36};

export function ShimmerIndicator({
  size = 'small',
  color,
  style,
  animating = true}: ShimmerIndicatorProps) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0.4)).current;
  const dotSize = SIZE_MAP[size];

  useEffect(() => {
    if (!animating) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.1,
            duration: 600,
            useNativeDriver: true}),
          Animated.timing(opacity, {
            toValue: 0.9,
            duration: 600,
            useNativeDriver: true}),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 0.85,
            duration: 600,
            useNativeDriver: true}),
          Animated.timing(opacity, {
            toValue: 0.4,
            duration: 600,
            useNativeDriver: true}),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [animating, scale, opacity]);

  const dotColor = color ?? Colors.primary;

  return (
    <View style={[styles.container, { width: dotSize, height: dotSize }, style]}>
      <Animated.View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: dotColor,
            transform: [{ scale }],
            opacity},
        ]}
      />
    </View>
  );
}

export default ShimmerIndicator;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center'},
  dot: {
    alignItems: 'center',
    justifyContent: 'center'}});
