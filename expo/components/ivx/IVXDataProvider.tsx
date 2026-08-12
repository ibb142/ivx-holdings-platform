/**
 * IVXDataProvider — Canonical data fetching wrapper around React Query.
 *
 * Unifies loading, error, empty, offline, retry, timeout, and skeleton states
 * into a single render-prop component. Every screen that fetches data should
 * use this instead of manually checking isLoading/isError.
 *
 * Features:
 * - Skeleton placeholder during initial load (no blank screen)
 * - Stale-while-revalidate: shows cached data while refetching
 * - Error state with retry button
 * - Empty state with optional action
 * - Offline state when network is down
 * - Timeout detection for hung requests
 * - Accessibility announcements for state changes
 * - Works with any useQuery result
 *
 * Usage:
 * ```tsx
 * const result = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
 * <IVXDataProvider result={result} skeleton={<MySkeleton />}>
 *   {(data) => <MyContent data={data} />}
 * </IVXDataProvider>
 * ```
 */
import React, { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { View, AccessibilityInfo, type ViewStyle } from 'react-native';
import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorState, EmptyState, OfflineState, TimeoutState } from './IVXStates';
import { useNetwork } from '@/lib/network-context';

export interface IVXDataProviderProps<T> {
  /** The useQuery result. */
  result: UseQueryResult<T>;
  /** Skeleton to show during initial load. */
  skeleton?: React.ReactNode;
  /** Render prop called with the data. */
  children: (data: T) => React.ReactNode;
  /** Empty state title. */
  emptyTitle?: string;
  /** Empty state message. */
  emptyMessage?: string;
  /** Empty state action label. */
  emptyActionLabel?: string;
  /** Empty state action handler. */
  onEmptyAction?: () => void;
  /** Error state title. */
  errorTitle?: string;
  /** Custom error message extractor. */
  errorMessage?: (error: Error) => string;
  /** Whether the data is considered empty. */
  isEmpty?: (data: T) => boolean;
  /** Test ID for the container. */
  testID?: string;
  /** Container style. */
  style?: ViewStyle;
  /** Whether to announce state changes to screen readers. Default: true. */
  announceStates?: boolean;
  /** Timeout in ms — if loading exceeds this, show timeout state. Default: 30000. */
  timeoutMs?: number;
  /** Whether to show offline state. Default: true. */
  showOfflineState?: boolean;
}

// Default empty checker: arrays with length 0, null, undefined
function defaultIsEmpty<T>(data: T): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object' && 'items' in data) {
    return Array.isArray((data as any).items) && (data as any).items.length === 0;
  }
  return false;
}

export function IVXDataProvider<T>({
  result,
  skeleton,
  children,
  emptyTitle = 'Nothing here yet',
  emptyMessage = 'Content will appear here once it becomes available.',
  emptyActionLabel,
  onEmptyAction,
  errorTitle = 'Something went wrong',
  errorMessage,
  isEmpty = defaultIsEmpty,
  testID = 'ivx-data-provider',
  style,
  announceStates = true,
  timeoutMs = 30_000,
  showOfflineState = true,
}: IVXDataProviderProps<T>) {
  const { isOffline, refresh: refreshNetwork } = useNetwork();
  const { isLoading, isError, error, data, refetch, isFetching, isLoadingError } = result;
  const loadStartTime = useRef<number>(Date.now());
  const [isTimeout, setIsTimeout] = useState(false);
  const lastAnnounced = useRef<string>('');

  // Track load start time
  useEffect(() => {
    if (isLoading) {
      loadStartTime.current = Date.now();
      setIsTimeout(false);
    }
  }, [isLoading]);

  // Timeout detection
  useEffect(() => {
    if (!isLoading || timeoutMs <= 0) return;
    const timer = setTimeout(() => {
      if (isLoading && !data) {
        setIsTimeout(true);
      }
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [isLoading, data, timeoutMs]);

  // Accessibility announcements
  useEffect(() => {
    if (!announceStates) return;
    let announcement = '';
    if (isLoading && !data) announcement = 'Loading';
    else if (isError) announcement = 'Error loading content';
    else if (data && isEmpty(data)) announcement = 'No content available';
    else if (data) announcement = 'Content loaded';

    if (announcement && announcement !== lastAnnounced.current) {
      lastAnnounced.current = announcement;
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [isLoading, isError, data, isEmpty, announceStates]);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleOfflineRetry = useCallback(() => {
    void refreshNetwork().then(() => refetch());
  }, [refreshNetwork, refetch]);

  // ─── Timeout state ────────────────────────────────────────────────
  if (isTimeout && isLoading && !data) {
    return (
      <View style={{ flex: 1, ...(style || {}) }} testID={`${testID}-timeout`}>
        <TimeoutState onRetry={handleRetry} testID={`${testID}-timeout-state`} />
      </View>
    );
  }

  // ─── Offline state (only on initial load, not refetch) ────────────
  if (showOfflineState && isOffline && isLoading && !data) {
    return (
      <View style={{ flex: 1, ...(style || {}) }} testID={`${testID}-offline`}>
        <OfflineState onRetry={handleOfflineRetry} testID={`${testID}-offline-state`} />
      </View>
    );
  }

  // ─── Error state (only on initial load, not background refetch) ───
  if (isError && !data) {
    const msg = errorMessage
      ? errorMessage(error as Error)
      : (error as Error)?.message || 'We encountered an error while loading this content.';
    return (
      <View style={{ flex: 1, ...(style || {}) }} testID={`${testID}-error`}>
        <ErrorState
          title={errorTitle}
          message={msg}
          onRetry={handleRetry}
          testID={`${testID}-error-state`}
        />
      </View>
    );
  }

  // ─── Loading state (initial load, no cached data) ─────────────────
  if (isLoading && !data) {
    return (
      <View style={{ flex: 1, ...(style || {}) }} testID={`${testID}-loading`}>
        {skeleton ?? <DefaultSkeleton />}
      </View>
    );
  }

  // ─── Empty state ──────────────────────────────────────────────────
  if (data && isEmpty(data)) {
    return (
      <View style={{ flex: 1, ...(style || {}) }} testID={`${testID}-empty`}>
        <EmptyState
          title={emptyTitle}
          message={emptyMessage}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
          testID={`${testID}-empty-state`}
        />
      </View>
    );
  }

  // ─── Data available ───────────────────────────────────────────────
  if (data != null) {
    return (
      <View style={{ flex: 1, ...(style || {}) }} testID={testID}>
        {children(data)}
      </View>
    );
  }

  // Fallback (should not reach here, but safety net)
  return (
    <View style={{ flex: 1, ...(style || {}) }} testID={`${testID}-fallback`}>
      {skeleton ?? <DefaultSkeleton />}
    </View>
  );
}

// ─── Default skeleton (generic list) ─────────────────────────────────

function DefaultSkeleton() {
  // Lazy import to avoid circular dependency
  const { FullScreenSkeleton } = require('@/components/InstantSkeleton');
  return <FullScreenSkeleton type="list" />;
}

export default IVXDataProvider;
