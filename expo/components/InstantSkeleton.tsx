/**
 * InstantSkeleton — Instagram-style shimmer skeleton system.
 *
 * Replaces ActivityIndicator spinners with content-shaped skeleton placeholders
 * that shimmer like Instagram/Facebook/Twitter feeds. The key principle:
 * NEVER show a blank screen with a spinner. Always show skeleton shapes that
 * match the upcoming content layout so the user perceives instant loading.
 *
 * Techniques:
 * - Shimmer animation (gradient sweep, not opacity pulse)
 * - Content-matched shapes (cards, lists, profiles, feeds)
 * - Zero blank screens — skeletons render immediately on mount
 * - No ActivityIndicator anywhere in the skeleton tree
 */
import React, { useEffect, useRef, memo } from 'react';
import {
  View,
  Animated,
  StyleSheet,
  ViewStyle,
  LayoutAnimation,
  Platform,
  Dimensions} from 'react-native';
import Colors from '@/constants/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;

/** Single shimmer bone — animated gradient sweep */
function ShimmerBone({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style}: {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}) {
  const translateX = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
  const anim = Animated.loop(
    Animated.timing(translateX, {
      toValue: 1,
      duration: 1200,
      useNativeDriver: true})
  );
  anim.start();
  return () => anim.stop();
  }, [translateX]);

  const boneWidth = typeof width === 'number' ? width : SCREEN_WIDTH;
  const shimmerWidth = boneWidth * 0.5;

  return (
  <View
    style={[
    {
      width: width as number,
      height,
      borderRadius,
      backgroundColor: Colors.surfaceLight,
      overflow: 'hidden'},
    style,
    ]}
  >
    <Animated.View
    style={[
      StyleSheet.absoluteFill,
      {
      transform: [
        {
        translateX: translateX.interpolate({
          inputRange: [-1, 1],
          outputRange: [-shimmerWidth, boneWidth + shimmerWidth]})},
      ]},
    ]}
    >
    <View
      style={{
      width: shimmerWidth,
      height: '100%',
      backgroundColor: Platform.OS === 'web' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)'}}
    />
    </Animated.View>
  </View>
  );
  }

export const Skeleton = memo(ShimmerBone);

/** Feed card skeleton — matches Instagram post card shape */
export function FeedCardSkeleton() {
  return (
  <View style={styles.card}>
    <View style={styles.cardHeader}>
    <ShimmerBone width={36} height={36} borderRadius={18} />
    <View style={styles.cardHeaderText}>
      <ShimmerBone width={120} height={14} />
      <ShimmerBone width={80} height={11} style={{ marginTop: 5 }} />
    </View>
    </View>
    <ShimmerBone width="100%" height={SCREEN_WIDTH} borderRadius={0} style={{ marginTop: 8 }} />
    <View style={styles.cardFooter}>
    <ShimmerBone width="90%" height={14} />
    <ShimmerBone width="60%" height={12} style={{ marginTop: 6 }} />
    </View>
  </View>
  );
}

/** List item skeleton — matches row-based list items */
export function ListItemSkeleton() {
  return (
  <View style={styles.listItem}>
    <ShimmerBone width={44} height={44} borderRadius={12} />
    <View style={styles.listItemContent}>
    <ShimmerBone width="60%" height={15} />
    <ShimmerBone width="40%" height={12} style={{ marginTop: 6 }} />
    </View>
    <ShimmerBone width={60} height={28} borderRadius={8} />
  </View>
  );
}

/** Profile skeleton — matches profile header */
export function ProfileSkeleton() {
  return (
  <View style={styles.profile}>
    <ShimmerBone width={80} height={80} borderRadius={40} />
    <ShimmerBone width={160} height={20} style={{ marginTop: 14 }} />
    <ShimmerBone width={120} height={14} style={{ marginTop: 8 }} />
    <View style={styles.profileStats}>
    <ShimmerBone width={80} height={50} borderRadius={12} />
    <ShimmerBone width={80} height={50} borderRadius={12} />
    <ShimmerBone width={80} height={50} borderRadius={12} />
    </View>
  </View>
  );
}

/** Grid skeleton — matches 2-column grid cards */
export function GridCardSkeleton() {
  return (
  <View style={styles.gridCard}>
    <ShimmerBone width="100%" height={120} borderRadius={14} />
    <View style={styles.gridCardContent}>
    <ShimmerBone width="70%" height={16} />
    <ShimmerBone width="50%" height={13} style={{ marginTop: 6 }} />
    <View style={styles.gridCardRow}>
      <ShimmerBone width="35%" height={22} />
      <ShimmerBone width="25%" height={14} />
    </View>
    </View>
  </View>
  );
}

/** Home feed skeleton — matches the home screen layout */
export function HomeSkeleton() {
  return (
  <View style={styles.home}>
    <View style={styles.homeHeader}>
    <View>
      <ShimmerBone width={120} height={14} />
      <ShimmerBone width={180} height={24} style={{ marginTop: 8 }} />
    </View>
    <ShimmerBone width={40} height={40} borderRadius={20} />
    </View>
    <ShimmerBone width="100%" height={140} borderRadius={20} style={{ marginTop: 20 }} />
    <View style={styles.homeRow}>
    <ShimmerBone width="48%" height={90} borderRadius={16} />
    <ShimmerBone width="48%" height={90} borderRadius={16} />
    </View>
    <ShimmerBone width={140} height={18} style={{ marginTop: 24 }} />
    <FeedCardSkeleton />
    <FeedCardSkeleton />
  </View>
  );
}

/** Aura/dashboard skeleton — matches the Aura pulse grid */
export function AuraSkeleton() {
  return (
  <View style={styles.aura}>
    <View style={styles.auraHero}>
    <ShimmerBone width={64} height={64} borderRadius={32} />
    <ShimmerBone width={140} height={24} style={{ marginTop: 12 }} />
    <ShimmerBone width={180} height={14} style={{ marginTop: 6 }} />
    </View>
    <View style={styles.auraGrid}>
    <ShimmerBone width="48%" height={130} borderRadius={16} />
    <ShimmerBone width="48%" height={130} borderRadius={16} />
    <ShimmerBone width="48%" height={130} borderRadius={16} />
    <ShimmerBone width="48%" height={130} borderRadius={16} />
    </View>
    <ShimmerBone width="100%" height={120} borderRadius={16} style={{ marginTop: 16 }} />
  </View>
  );
}

/** Market skeleton — matches market list + chart layout */
export function MarketSkeleton() {
  return (
  <View style={styles.market}>
    <ShimmerBone width="100%" height={120} borderRadius={16} />
    <View style={styles.marketRow}>
    <ShimmerBone width="30%" height={36} borderRadius={10} />
    <ShimmerBone width="30%" height={36} borderRadius={10} />
    <ShimmerBone width="30%" height={36} borderRadius={10} />
    </View>
    {Array.from({ length: 5 }).map((_, i) => (
    <ListItemSkeleton key={i} />
    ))}
  </View>
  );
}

/** Chat skeleton — matches chat message list */
export function ChatSkeleton() {
  return (
  <View style={styles.chat}>
    {Array.from({ length: 4 }).map((_, i) => (
    <View key={i} style={[styles.chatRow, i % 2 === 0 ? styles.chatRowLeft : styles.chatRowRight]}>
      {i % 2 === 0 && <ShimmerBone width={32} height={32} borderRadius={16} />}
      <View style={[styles.chatBubble, i % 2 === 0 ? styles.chatBubbleLeft : styles.chatBubbleRight]}>
      <ShimmerBone width={i % 2 === 0 ? 200 : 150} height={14} />
      <ShimmerBone width={i % 2 === 0 ? 160 : 100} height={14} style={{ marginTop: 5 }} />
      </View>
      {i % 2 !== 0 && <ShimmerBone width={32} height={32} borderRadius={16} />}
    </View>
    ))}
  </View>
  );
}

/** CRM skeleton — matches CRM contact grid */
export function CRMSkeleton() {
  return (
  <View style={styles.crm}>
    <View style={styles.crmStats}>
    <ShimmerBone width="31%" height={70} borderRadius={12} />
    <ShimmerBone width="31%" height={70} borderRadius={12} />
    <ShimmerBone width="31%" height={70} borderRadius={12} />
    </View>
    {Array.from({ length: 6 }).map((_, i) => (
    <ListItemSkeleton key={i} />
    ))}
  </View>
  );
}

/** Generic full-screen skeleton — for any screen */
export function FullScreenSkeleton({ type = 'list' }: { type?: 'list' | 'cards' | 'profile' | 'grid' }) {
  const content = (() => {
    switch (type) {
    case 'cards':
      return Array.from({ length: 3 }).map((_, i) => <FeedCardSkeleton key={i} />);
    case 'profile':
      return <ProfileSkeleton />;
    case 'grid':
      return (
      <View style={styles.gridWrap}>
        {Array.from({ length: 4 }).map((_, i) => (
        <GridCardSkeleton key={i} />
        ))}
      </View>
      );
    default:
      return Array.from({ length: 6 }).map((_, i) => <ListItemSkeleton key={i} />);
    }
  })();

  return <View style={styles.fullScreen}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
  backgroundColor: Colors.surface,
  borderRadius: 20,
  overflow: 'hidden' as const,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: Colors.surfaceBorder},
  cardHeader: {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  padding: 14,
  gap: 10},
  cardHeaderText: {
  flex: 1,
  gap: 5},
  cardFooter: {
  padding: 14},
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
  profileStats: {
  flexDirection: 'row' as const,
  gap: 10,
  marginTop: 20},
  gridCard: {
  backgroundColor: Colors.surface,
  borderRadius: 20,
  overflow: 'hidden' as const,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: Colors.surfaceBorder,
  width: '48%'},
  gridCardContent: {
  padding: 14,
  gap: 4},
  gridCardRow: {
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
  alignItems: 'center' as const,
  marginTop: 10},
  gridWrap: {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  justifyContent: 'space-between' as const},
  home: {
  padding: 20},
  homeHeader: {
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
  alignItems: 'center' as const},
  homeRow: {
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
  marginTop: 16},
  aura: {
  padding: 20},
  auraHero: {
  alignItems: 'center' as const,
  marginTop: 12,
  marginBottom: 24},
  auraGrid: {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  justifyContent: 'space-between' as const,
  gap: 12},
  market: {
  padding: 20},
  marketRow: {
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
  marginVertical: 16},
  chat: {
  padding: 16,
  gap: 14},
  chatRow: {
  flexDirection: 'row' as const,
  alignItems: 'flex-start' as const,
  gap: 8},
  chatRowLeft: {
  justifyContent: 'flex-start' as const},
  chatRowRight: {
  justifyContent: 'flex-end' as const},
  chatBubble: {
  borderRadius: 16,
  padding: 12,
  gap: 5,
  maxWidth: '75%'},
  chatBubbleLeft: {
  backgroundColor: Colors.surface},
  chatBubbleRight: {
  backgroundColor: 'rgba(230,194,0,0.12)'},
  crm: {
  padding: 20},
  crmStats: {
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
  marginBottom: 16},
  fullScreen: {
  flex: 1,
  padding: 20}});
