import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import Colors from '@/constants/colors';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as number,
          height,
          borderRadius,
          backgroundColor: Colors.surfaceLight,
          opacity},
        style,
      ]}
    />
  );
}

export function CardSkeleton() {
  return (
    <View style={skeletonStyles.card}>
      <Skeleton width="100%" height={160} borderRadius={16} />
      <View style={skeletonStyles.cardContent}>
        <Skeleton width="70%" height={18} />
        <Skeleton width="50%" height={14} style={{ marginTop: 8 }} />
        <View style={skeletonStyles.cardRow}>
          <Skeleton width="30%" height={24} />
          <Skeleton width="25%" height={14} />
        </View>
      </View>
    </View>
  );
}

export function ListItemSkeleton() {
  return (
    <View style={skeletonStyles.listItem}>
      <Skeleton width={44} height={44} borderRadius={12} />
      <View style={skeletonStyles.listItemContent}>
        <Skeleton width="60%" height={16} />
        <Skeleton width="40%" height={12} style={{ marginTop: 6 }} />
      </View>
      <Skeleton width={60} height={16} />
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View style={skeletonStyles.profile}>
      <Skeleton width={80} height={80} borderRadius={40} />
      <Skeleton width={160} height={20} style={{ marginTop: 12 }} />
      <Skeleton width={120} height={14} style={{ marginTop: 8 }} />
    </View>
  );
}

export function HomeSkeleton() {
  return (
    <View style={skeletonStyles.home}>
      <View style={skeletonStyles.homeHeader}>
        <View>
          <Skeleton width={120} height={14} />
          <Skeleton width={180} height={24} style={{ marginTop: 8 }} />
        </View>
        <Skeleton width={40} height={40} borderRadius={20} />
      </View>
      <Skeleton width="100%" height={140} borderRadius={20} style={{ marginTop: 20 }} />
      <View style={skeletonStyles.homeRow}>
        <Skeleton width="48%" height={90} borderRadius={16} />
        <Skeleton width="48%" height={90} borderRadius={16} />
      </View>
      <Skeleton width={140} height={18} style={{ marginTop: 24 }} />
      <CardSkeleton />
      <CardSkeleton />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    overflow: 'hidden' as const,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  cardContent: {
    padding: 16,
    gap: 4},
  cardRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginTop: 12},
  listItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 16,
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  listItemContent: {
    flex: 1},
  profile: {
    alignItems: 'center' as const,
    paddingVertical: 24},
  home: {
    padding: 20},
  homeHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const},
  homeRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginTop: 16}});
