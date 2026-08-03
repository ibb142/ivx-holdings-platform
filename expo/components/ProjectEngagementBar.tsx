/**
 * ProjectEngagementBar — Instagram-Style Engagement Row
 *
 * Like | Comment | Share | Save buttons with animated counts.
 * Works on both landing page and app project cards.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Heart, MessageCircle, Share2, Bookmark } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

const GOLD = '#FFD700';
const HEART_RED = '#FF4D4D';
const ICON_ACTIVE_SCALE = 1.25;

interface EngagementBarProps {
  projectId: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  isLiked: boolean;
  isSaved: boolean;
  onLikePress: (projectId: string) => void;
  onCommentPress: (projectId: string) => void;
  onSharePress: (projectId: string) => void;
  onSavePress: (projectId: string) => void;
  compact?: boolean;
  light?: boolean;
}

function AnimatedIconButton({
  onPress,
  icon: Icon,
  count,
  color,
  activeColor,
  isActive = false,
  compact = false,
  light = false,
  testID}: {
  onPress: () => void;
  icon: React.ElementType;
  count: number;
  color: string;
  activeColor?: string;
  isActive?: boolean;
  compact?: boolean;
  light?: boolean;
  testID?: string;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [isPressed, setIsPressed] = useState(false);

  const handlePress = useCallback(() => {
    setIsPressed(true);
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: ICON_ACTIVE_SCALE, tension: 200, friction: 8, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 140, friction: 6, useNativeDriver: true }),
    ]).start(() => setIsPressed(false));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress, scaleAnim]);

  const iconColor = isActive && activeColor ? activeColor : light ? 'rgba(255,255,255,0.7)' : color;
  const countColor = light ? 'rgba(255,255,255,0.6)' : color;
  const iconSize = compact ? 16 : 20;

  return (
    <TouchableOpacity
      style={styles.actionBtn}
      onPress={handlePress}
      activeOpacity={0.7}
      testID={testID}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Icon
          size={iconSize}
          color={iconColor}
          fill={isActive ? iconColor : 'none'}
          strokeWidth={isActive ? 0 : 1.8}
        />
      </Animated.View>
      {count > 0 && (
        <Text style={[styles.actionCount, { color: countColor, fontSize: compact ? 11 : 12 }]}>
          {count > 999 ? `${(count / 1000).toFixed(1)}k` : count}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const ProjectEngagementBar = memo(function ProjectEngagementBar({
  projectId,
  likeCount,
  commentCount,
  shareCount,
  saveCount,
  isLiked,
  isSaved,
  onLikePress,
  onCommentPress,
  onSharePress,
  onSavePress,
  compact = false,
  light = false}: EngagementBarProps) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View style={styles.leftActions}>
        <AnimatedIconButton
          onPress={() => onLikePress(projectId)}
          icon={Heart}
          count={likeCount}
          color={Colors.textSecondary}
          activeColor={HEART_RED}
          isActive={isLiked}
          compact={compact}
          light={light}
          testID={`project-like-${projectId}`}
        />
        <AnimatedIconButton
          onPress={() => onCommentPress(projectId)}
          icon={MessageCircle}
          count={commentCount}
          color={Colors.textSecondary}
          compact={compact}
          light={light}
          testID={`project-comment-${projectId}`}
        />
        <AnimatedIconButton
          onPress={() => onSharePress(projectId)}
          icon={Share2}
          count={shareCount}
          color={Colors.textSecondary}
          compact={compact}
          light={light}
          testID={`project-share-${projectId}`}
        />
      </View>
      <AnimatedIconButton
        onPress={() => onSavePress(projectId)}
        icon={Bookmark}
        count={saveCount}
        color={Colors.textSecondary}
        activeColor={GOLD}
        isActive={isSaved}
        compact={compact}
        light={light}
        testID={`project-save-${projectId}`}
      />
    </View>
  );
});

export default ProjectEngagementBar;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10},
  containerCompact: {
    paddingHorizontal: 4,
    paddingVertical: 6},
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minWidth: 44,
    minHeight: 36,
    justifyContent: 'center'},
  actionCount: {
    fontWeight: '600' as const,
    minWidth: 20}});
