import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import Colors from '@/constants/colors';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

function SkeletonBlock({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
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
    <View style={sk.card}>
      <SkeletonBlock height={140} borderRadius={0} />
      <View style={sk.cardBody}>
        <SkeletonBlock width="70%" height={18} />
        <SkeletonBlock width="50%" height={14} style={{ marginTop: 8 }} />
        <View style={sk.cardRow}>
          <SkeletonBlock width="30%" height={28} borderRadius={10} />
          <SkeletonBlock width="30%" height={28} borderRadius={10} />
          <SkeletonBlock width="30%" height={28} borderRadius={10} />
        </View>
      </View>
    </View>
  );
}

export function PortfolioSkeleton() {
  return (
    <View style={sk.portfolioWrap}>
      <View style={sk.portfolioCard}>
        <SkeletonBlock width="40%" height={14} />
        <SkeletonBlock width="60%" height={36} style={{ marginTop: 8 }} />
        <SkeletonBlock width="35%" height={14} style={{ marginTop: 8 }} />
        <SkeletonBlock width="100%" height={120} borderRadius={12} style={{ marginTop: 16 }} />
      </View>
      <View style={sk.walletRow}>
        <SkeletonBlock width={40} height={40} borderRadius={12} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonBlock width="50%" height={12} />
          <SkeletonBlock width="30%" height={16} />
        </View>
      </View>
      {[1, 2].map(i => (
        <View key={i} style={sk.holdingRow}>
          <SkeletonBlock width={44} height={44} borderRadius={10} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock width="60%" height={14} />
            <SkeletonBlock width="40%" height={12} />
          </View>
          <SkeletonBlock width={60} height={24} borderRadius={8} />
        </View>
      ))}
    </View>
  );
}

export function MarketRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={sk.marketRow}>
          <SkeletonBlock width={36} height={36} borderRadius={8} />
          <View style={{ flex: 1, gap: 4, marginLeft: 10 }}>
            <SkeletonBlock width="55%" height={14} />
            <SkeletonBlock width="35%" height={10} />
          </View>
          <SkeletonBlock width={55} height={16} />
          <SkeletonBlock width={50} height={24} borderRadius={8} style={{ marginLeft: 8 }} />
        </View>
      ))}
    </View>
  );
}

export function HomeSkeleton() {
  return (
    <View style={sk.homeWrap}>
      <View style={{ paddingHorizontal: 20, gap: 6 }}>
        <SkeletonBlock width="70%" height={28} />
        <SkeletonBlock width="55%" height={28} />
        <SkeletonBlock width="85%" height={12} style={{ marginTop: 8 }} />
      </View>
      <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
        <View style={sk.portfolioCard}>
          <SkeletonBlock width="40%" height={14} />
          <SkeletonBlock width="50%" height={28} style={{ marginTop: 6 }} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
        <SkeletonBlock width="40%" height={18} style={{ marginBottom: 12 }} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <CardSkeleton />
          <CardSkeleton />
        </View>
      </View>
    </View>
  );
}

export { SkeletonBlock };

const sk = StyleSheet.create({
  card: {
    width: 220,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  cardBody: {
    padding: 14,
    gap: 4},
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 8},
  portfolioWrap: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8},
  portfolioCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  walletRow: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  holdingRow: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  marketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  homeWrap: {
    paddingTop: 8}});
