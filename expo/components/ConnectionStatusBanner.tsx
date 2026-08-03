import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform} from 'react-native';
import { Wifi, WifiOff, Database, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useNetwork } from '@/lib/network-context';
import type { BackendStatus } from '@/lib/api-resilience';

const STATUS_COLORS: Record<BackendStatus, string> = {
  online: '#00C48C',
  degraded: '#F59E0B',
  offline: '#FF4D4D',
  unknown: '#909090'};

const STATUS_LABELS: Record<BackendStatus, string> = {
  online: 'Connected',
  degraded: 'Slow',
  offline: 'Down',
  unknown: 'Checking...'};

export default function ConnectionStatusBanner() {
  const {
    isOffline,
    supabaseStatus,
    isFullyOperational,
    refresh} = useNetwork();

  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const refreshSpin = useRef(new Animated.Value(0)).current;

  const shouldShow = isOffline || supabaseStatus === 'offline' || supabaseStatus === 'degraded';

  useEffect(() => {
    if (shouldShow && !visible) {
      setVisible(true);
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 80,
        friction: 12,
        useNativeDriver: true}).start();
    } else if (!shouldShow && visible) {
      Animated.timing(slideAnim, {
        toValue: -80,
        duration: 300,
        useNativeDriver: true}).start(() => {
        setVisible(false);
        setExpanded(false);
      });
    }
  }, [shouldShow, visible, slideAnim]);

  const handleRefresh = () => {
    Animated.loop(
      Animated.timing(refreshSpin, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true}),
      { iterations: 1 }
    ).start(() => refreshSpin.setValue(0));

    void refresh();
  };

  if (!visible) return null;

  const bannerBg = isOffline ? '#1C1917' : supabaseStatus === 'offline' ? '#1E1B2E' : '#2D2305';
  const accentColor = isOffline ? '#FF4D4D' : supabaseStatus === 'offline' ? '#A78BFA' : '#FBBF24';

  const spin = refreshSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']});

  const getMessage = (): string => {
    if (isOffline) return 'No internet connection';
    if (supabaseStatus === 'offline') return 'Database unreachable';
    if (supabaseStatus === 'degraded') return 'Database responding slowly';
    return 'Connection issues detected';
  };

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: bannerBg, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <TouchableOpacity
        style={styles.mainRow}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
        testID="connection-status-banner"
      >
        <View style={styles.leftSection}>
          <View style={[styles.dot, { backgroundColor: accentColor }]} />
          {isOffline ? (
            <WifiOff size={16} color={accentColor} />
          ) : (
            <Wifi size={16} color={accentColor} />
          )}
          <Text style={[styles.message, { color: '#F8FAFC' }]} numberOfLines={1}>
            {getMessage()}
          </Text>
        </View>

        <View style={styles.rightSection}>
          <TouchableOpacity onPress={handleRefresh} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <RefreshCw size={16} color="#909090" />
            </Animated.View>
          </TouchableOpacity>
          {expanded ? (
            <ChevronUp size={16} color="#909090" />
          ) : (
            <ChevronDown size={16} color="#909090" />
          )}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.detailsContainer}>
          <View style={styles.detailRow}>
            <Database size={14} color="#909090" />
            <Text style={styles.detailLabel}>Supabase DB</Text>
            <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[supabaseStatus] + '22' }]}>
              <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[supabaseStatus] }]} />
              <Text style={[styles.statusText, { color: STATUS_COLORS[supabaseStatus] }]}>
                {STATUS_LABELS[supabaseStatus]}
              </Text>
            </View>
          </View>

          {isFullyOperational && (
            <View style={[styles.fallbackNotice, { backgroundColor: '#00C48C15' }]}>
              <Text style={[styles.fallbackText, { color: '#00C48C' }]}>
                All systems operational.
              </Text>
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 4,
    borderRadius: 12,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8},
      android: { elevation: 4 },
      web: {
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)'} as any})},
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10},
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8},
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  message: {
    fontSize: 13,
    fontWeight: '600' as const,
    flex: 1},
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  detailsContainer: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8},
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  detailLabel: {
    fontSize: 12,
    color: '#909090',
    flex: 1},
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 5},
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5},
  statusText: {
    fontSize: 11,
    fontWeight: '600' as const},
  fallbackNotice: {
    marginTop: 4,
    backgroundColor: '#A78BFA15',
    borderRadius: 8,
    padding: 10},
  fallbackText: {
    fontSize: 11,
    color: '#A78BFA',
    lineHeight: 16}});
