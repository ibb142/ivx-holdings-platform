import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getEnvironmentBadge } from '@/lib/environment';

export default function EnvironmentBadge() {
  const badge = getEnvironmentBadge();
  if (!badge) return null;

  return (
    <View style={[styles.container, { backgroundColor: badge.color }]} testID="environment-badge">
      <Text style={styles.text}>{badge.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 9999,
    opacity: 0.85},
  text: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.5}});
