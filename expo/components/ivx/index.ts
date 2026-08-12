/**
 * IVX shared infrastructure barrel export.
 *
 * All screens should import from here for consistent loading,
 * image, feed, realtime, and state management patterns.
 */
export { IVXDataProvider } from './IVXDataProvider';
export type { IVXDataProviderProps } from './IVXDataProvider';

export { IVXImage } from './IVXImage';
export type { IVXImageProps } from './IVXImage';

export { IVXFeed } from './IVXFeed';
export type { IVXFeedProps } from './IVXFeed';

export {
  ErrorState,
  EmptyState,
  OfflineState,
  TimeoutState,
  InlineLoading,
} from './IVXStates';

export { AccessibilityAnnouncer } from './AccessibilityAnnouncer';
export type { AccessibilityAnnouncerProps } from './AccessibilityAnnouncer';

export { useRealtimeChannel, useRealtimeTable } from '@/hooks/useRealtimeChannel';
export type {
  RealtimeChannelConfig,
  RealtimeChannelState,
  RealtimeStatus,
  RealtimeEvent,
} from '@/hooks/useRealtimeChannel';

export { useInfiniteFeed } from '@/hooks/useInfiniteFeed';
export type {
  UseInfiniteFeedOptions,
  UseInfiniteFeedResult,
  FeedPage,
} from '@/hooks/useInfiniteFeed';
