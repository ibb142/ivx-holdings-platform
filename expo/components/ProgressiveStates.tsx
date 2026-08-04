/**
 * Reusable state components for progressive loading screens.
 * Provides Empty, Loading, Offline, and Error states with retry.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Inbox, WifiOff, AlertCircle, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Skeleton } from '@/components/InstantSkeleton';

type EmptyStateProps = {
  title: string;
  message?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, message, icon, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ?? <Inbox size={48} color={Colors.textTertiary} />}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.actionBtn} onPress={onAction} activeOpacity={0.8}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

type LoadingStateProps = {
  message?: string;
};

export function LoadingState({ message = 'Loading…' }: LoadingStateProps) {
  // Instagram-style: skeleton bones instead of spinner
  return (
    <View style={styles.container}>
      <Skeleton width="80%" height={16} style={{ marginBottom: 8 }} />
      <Skeleton width="60%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="70%" height={14} />
    </View>
  );
}

type OfflineStateProps = {
  onRetry?: () => void;
};

export function OfflineState({ onRetry }: OfflineStateProps) {
  return (
    <View style={styles.container}>
      <WifiOff size={48} color={Colors.textTertiary} />
      <Text style={styles.title}>You're offline</Text>
      <Text style={styles.message}>Check your connection and try again.</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.actionBtn} onPress={onRetry} activeOpacity={0.8}>
          <RefreshCw size={16} color="#fff" />
          <Text style={styles.actionText}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

type ErrorStateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
  traceId?: string;
};

export function ErrorState({ title = 'Something went wrong', message, onRetry, traceId }: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <AlertCircle size={48} color={Colors.error} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {traceId ? <Text style={styles.traceId}>Trace: {traceId}</Text> : null}
      {onRetry ? (
        <TouchableOpacity style={styles.actionBtn} onPress={onRetry} activeOpacity={0.8}>
          <RefreshCw size={16} color="#fff" />
          <Text style={styles.actionText}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

type ListFooterProps = {
  isFetchingMore: boolean;
  hasMore: boolean;
};

export function ListFooter({ isFetchingMore, hasMore }: ListFooterProps) {
  if (!isFetchingMore && !hasMore) return null;
  return (
    <View style={styles.footer}>
      {isFetchingMore ? (
        <View style={styles.footerSkeleton}>
          <Skeleton width={40} height={40} borderRadius={12} />
          <View style={{ flex: 1, gap: 4 }}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="40%" height={11} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 8},
  title: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center',
    marginTop: 8},
  message: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4},
  traceId: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontFamily: 'monospace',
    marginTop: 4},
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12},
  actionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const},
  footerSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8},
  footerText: {
    fontSize: 13,
    color: Colors.textSecondary}});
