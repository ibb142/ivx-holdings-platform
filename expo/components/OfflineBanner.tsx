import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { WifiOff, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface OfflineBannerProps {
  isOffline: boolean;
  onRetry?: () => void;
}

export default function OfflineBanner({ isOffline, onRetry }: OfflineBannerProps) {
  const slideAnim = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: isOffline ? 0 : -60,
      friction: 10,
      tension: 80,
      useNativeDriver: true}).start();
  }, [isOffline, slideAnim]);

  if (!isOffline) return null;

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.inner}>
        <WifiOff size={16} color={Colors.white} />
        <Text style={styles.text}>No internet connection</Text>
        {onRetry && (
          <TouchableOpacity onPress={onRetry} style={styles.retryBtn} testID="offline-retry">
            <RefreshCw size={14} color={Colors.white} />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999},
  inner: {
    backgroundColor: '#E53935',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8},
  text: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '600' as const},
  retryBtn: {
    padding: 4,
    marginLeft: 4}});
