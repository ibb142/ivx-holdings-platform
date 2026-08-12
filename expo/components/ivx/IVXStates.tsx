/**
 * IVXStates — Canonical empty, error, offline, and retry state components.
 *
 * Every screen in the IVX app should use these instead of ad-hoc Text/View
 * patterns. This ensures consistent UX across all 255+ routes.
 *
 * Design principles:
 * - Never show a blank screen — always show a meaningful state
 * - Error states include a retry button and a human-readable message
 * - Empty states include an icon, title, subtitle, and optional action
 * - Offline state includes a reconnect button
 * - All states are accessible with screen reader labels
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  AccessibilityInfo,
  type ViewStyle,
} from 'react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

// ─── Types ───────────────────────────────────────────────────────────

interface StateContainerProps {
  children: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  testID?: string;
}

interface EmptyStateProps {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
  testID?: string;
}

interface OfflineStateProps {
  onRetry?: () => void;
  testID?: string;
}

interface TimeoutStateProps {
  onRetry?: () => void;
  testID?: string;
}

// ─── Shared container ────────────────────────────────────────────────

function StateContainer({ children, style, testID }: StateContainerProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// ─── Error State ─────────────────────────────────────────────────────

export const ErrorState = React.memo(function ErrorState({
  title = 'Something went wrong',
  message = 'We encountered an error while loading this content. Please try again.',
  onRetry,
  retryLabel = 'Retry',
  testID = 'ivx-error-state',
}: ErrorStateProps) {
  const handleRetry = useCallback(() => {
    AccessibilityInfo.announceForAccessibility('Retrying...');
    onRetry?.();
  }, [onRetry]);

  return (
    <StateContainer testID={testID}>
      <View style={styles.stateBody}>
        <View style={styles.errorIcon}>
          <View style={styles.errorIconLine} />
          <View style={[styles.errorIconLine, styles.errorIconLineRotated]} />
        </View>
        <Text style={styles.errorTitle}>{title}</Text>
        <Text style={styles.stateMessage}>{message}</Text>
        {onRetry && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
            testID={`${testID}-retry`}
          >
            <Text style={styles.retryButtonText}>{retryLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </StateContainer>
  );
});

// ─── Empty State ─────────────────────────────────────────────────────

export const EmptyState = React.memo(function EmptyState({
  title = 'Nothing here yet',
  message = 'Content will appear here once it becomes available.',
  actionLabel,
  onAction,
  icon,
  testID = 'ivx-empty-state',
}: EmptyStateProps) {
  const handleAction = useCallback(() => {
    onAction?.();
  }, [onAction]);

  return (
    <StateContainer testID={testID}>
      <View style={styles.stateBody}>
        {icon ?? (
          <View style={styles.emptyIcon}>
            <View style={styles.emptyIconDot} />
          </View>
        )}
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.stateMessage}>{message}</Text>
        {actionLabel && onAction && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            testID={`${testID}-action`}
          >
            <Text style={styles.actionButtonText}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </StateContainer>
  );
});

// ─── Offline State ───────────────────────────────────────────────────

export const OfflineState = React.memo(function OfflineState({
  onRetry,
  testID = 'ivx-offline-state',
}: OfflineStateProps) {
  const handleRetry = useCallback(() => {
    AccessibilityInfo.announceForAccessibility('Checking connection...');
    onRetry?.();
  }, [onRetry]);

  return (
    <StateContainer testID={testID}>
      <View style={styles.stateBody}>
        <View style={styles.offlineIcon}>
          <View style={styles.offlineIconBar} />
          <View style={styles.offlineIconBar2} />
        </View>
        <Text style={styles.offlineTitle}>You're offline</Text>
        <Text style={styles.stateMessage}>
          Check your internet connection and try again.
        </Text>
        {onRetry && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry connection"
            testID={`${testID}-retry`}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        )}
      </View>
    </StateContainer>
  );
});

// ─── Timeout State ───────────────────────────────────────────────────

export const TimeoutState = React.memo(function TimeoutState({
  onRetry,
  testID = 'ivx-timeout-state',
}: TimeoutStateProps) {
  const handleRetry = useCallback(() => {
    AccessibilityInfo.announceForAccessibility('Retrying...');
    onRetry?.();
  }, [onRetry]);

  return (
    <StateContainer testID={testID}>
      <View style={styles.stateBody}>
        <View style={styles.timeoutIcon}>
          <View style={styles.timeoutIconCircle} />
          <View style={styles.timeoutIconHand} />
        </View>
        <Text style={styles.timeoutTitle}>Request timed out</Text>
        <Text style={styles.stateMessage}>
          The server took too long to respond. Please try again.
        </Text>
        {onRetry && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry request"
            testID={`${testID}-retry`}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    </StateContainer>
  );
});

// ─── Inline Loading (small spinner for inline use) ──────────────────

export const InlineLoading = React.memo(function InlineLoading({
  label = 'Loading...',
  testID = 'ivx-inline-loading',
}: {
  label?: string;
  testID?: string;
}) {
  return (
    <View style={styles.inlineLoading} testID={testID}>
      <ShimmerIndicator size="small" color={Colors.gold} />
      <Text style={styles.inlineLoadingText}>{label}</Text>
    </View>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  stateBody: {
    alignItems: 'center',
    maxWidth: 320,
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,77,77,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  errorIconLine: {
    position: 'absolute' as const,
    width: 24,
    height: 2,
    backgroundColor: Colors.error,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  errorIconLineRotated: {
    transform: [{ rotate: '-45deg' }],
  },
  errorTitle: {
    color: Colors.error,
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyIconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textTertiary,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  offlineIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,158,11,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  offlineIconBar: {
    width: 28,
    height: 3,
    backgroundColor: Colors.warning,
    borderRadius: 1.5,
  },
  offlineIconBar2: {
    width: 20,
    height: 3,
    backgroundColor: Colors.warning,
    borderRadius: 1.5,
    marginTop: 4,
    opacity: 0.6,
  },
  offlineTitle: {
    color: Colors.warning,
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  timeoutIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  timeoutIconCircle: {
    position: 'absolute' as const,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.textSecondary,
  },
  timeoutIconHand: {
    width: 2,
    height: 12,
    backgroundColor: Colors.textSecondary,
    borderRadius: 1,
  },
  timeoutTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  stateMessage: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    minWidth: 120,
    alignItems: 'center' as const,
  },
  retryButtonText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  actionButton: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    minWidth: 120,
    alignItems: 'center' as const,
  },
  actionButtonText: {
    color: Colors.gold,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  inlineLoading: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 16,
    gap: 10,
  },
  inlineLoadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
});

export default ErrorState;
