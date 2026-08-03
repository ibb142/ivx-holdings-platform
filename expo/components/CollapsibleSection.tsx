import React, { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  color?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  badge?: string | number;
  testID?: string;
}

function CollapsibleSectionInner({
  title,
  icon,
  color = Colors.primary,
  defaultExpanded = false,
  children,
  badge,
  testID}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const animValue = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  const toggle = useCallback(() => {
    const toValue = expanded ? 0 : 1;
    Animated.timing(animValue, {
      toValue,
      duration: 200,
      useNativeDriver: false}).start();
    setExpanded(!expanded);
  }, [expanded, animValue]);

  const contentHeight = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 2000]});

  return (
    <View style={styles.container} testID={testID}>
      <TouchableOpacity
        style={styles.header}
        onPress={toggle}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          {icon && (
            <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
              {renderSafeViewChildren(icon)}
            </View>
          )}
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {badge !== undefined && (
            <View style={[styles.badge, { backgroundColor: color + '22' }]}>
              <Text style={[styles.badgeText, { color }]}>{badge}</Text>
            </View>
          )}
        </View>
        {expanded ? (
          <ChevronUp size={18} color={Colors.textSecondary} />
        ) : (
          <ChevronDown size={18} color={Colors.textSecondary} />
        )}
      </TouchableOpacity>
      <Animated.View style={{ maxHeight: contentHeight, overflow: 'hidden' }}>
        {expanded ? <View style={styles.content}>{renderSafeViewChildren(children)}</View> : null}
      </Animated.View>
    </View>
  );
}

export const CollapsibleSection = React.memo(CollapsibleSectionInner);

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14},
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1},
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10},
  title: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600' as const,
    flex: 1},
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8},
  badgeText: {
    fontSize: 12,
    fontWeight: '600' as const},
  content: {
    paddingHorizontal: 14,
    paddingBottom: 14}});
