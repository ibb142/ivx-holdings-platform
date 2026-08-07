/**
 * Media lifecycle types for the IVX Global Media Lifecycle system.
 *
 * Defines the state machine and telemetry surface used by the centralized
 * controller to manage image, video, and generated media across feeds, reels,
 * chat, and any other media-capable module.
 */

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'unknown';

export type MediaLifecycleState =
  | 'idle'
  | 'prefetching'
  | 'ready'
  | 'visible'
  | 'active'
  | 'paused'
  | 'error'
  | 'released';

export type MediaScope = 'reels' | 'home' | 'profile' | 'search' | 'chat' | 'inbox' | 'other';

export type MediaDownloadState = 'none' | 'queued' | 'loading' | 'loaded' | 'error' | 'cancelled';

export type MediaCacheState = 'none' | 'memory' | 'disk' | 'network';

export type MediaPlayerState = 'none' | 'mounted' | 'prepared' | 'playing' | 'paused' | 'buffering' | 'error' | 'released';

export type MediaBufferState = 'none' | 'idle' | 'loading' | 'buffering' | 'ready' | 'error';

export interface MediaLifecycleItem {
  mediaId: string;
  postId?: string | null;
  messageId?: string | null;
  scope: MediaScope;
  module: string;
  mediaType: MediaType;
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  fullResolutionUrl: string | null;
  visibilityPercent: number;
  lifecycleState: MediaLifecycleState;
  downloadState: MediaDownloadState;
  cacheState: MediaCacheState;
  playerState: MediaPlayerState;
  bufferState: MediaBufferState;
  isActive: boolean;
  isPrefetched: boolean;
  lastVisibleAt: number;
  lastActivatedAt: number;
  loadStartedAt: number;
  firstFrameAt: number;
  error: string | null;
  retryCount: number;
  mountGeneration: number;
  aborted: boolean;
}

export interface MediaLifecycleTelemetryEvent {
  mediaId: string;
  scope: MediaScope;
  mediaType: MediaType;
  event: string;
  timestamp: number;
  visibilityPercent?: number;
  lifecycleState?: MediaLifecycleState;
  playerState?: MediaPlayerState;
  downloadState?: MediaDownloadState;
  cacheState?: MediaCacheState;
  error?: string;
  latencyMs?: number;
}

export interface MediaLifecycleConfig {
  /** Max actively playing videos globally. */
  maxActiveVideos: number;
  /** Max prepared video players globally. */
  maxPreparedVideos: number;
  /** Visible full-resolution image window around the primary item. */
  imageWindowRadius: number;
  /** Video prefetch distance (upcoming items). */
  videoPrefetchDistance: number;
  /** Primary video activation threshold (0-1). */
  videoActivationThreshold: number;
  /** Video pause threshold (0-1). */
  videoPauseThreshold: number;
  /** Fast scroll velocity threshold (pixels/ms). */
  fastScrollVelocity: number;
  /** Video release window radius around primary item. */
  videoReleaseWindowRadius: number;
  /** Image release window radius around visible items. */
  imageReleaseWindowRadius: number;
  /** Max retry attempts per media item. */
  maxRetries: number;
}

export const DEFAULT_MEDIA_LIFECYCLE_CONFIG: MediaLifecycleConfig = {
  maxActiveVideos: 1,
  maxPreparedVideos: 2,
  imageWindowRadius: 2,
  videoPrefetchDistance: 2,
  videoActivationThreshold: 0.7,
  videoPauseThreshold: 0.45,
  fastScrollVelocity: 2.5,
  videoReleaseWindowRadius: 3,
  imageReleaseWindowRadius: 5,
  maxRetries: 2,
};

export interface ViewportItem {
  index: number;
  item: unknown;
  isViewable: boolean;
  percentVisible: number;
}

export interface MediaDiagnosticsSnapshot {
  totalItems: number;
  activeItems: number;
  visibleItems: number;
  prefetchingItems: number;
  errorItems: number;
  releasedItems: number;
  activeVideoId: string | null;
  events: MediaLifecycleTelemetryEvent[];
  byScope: Record<MediaScope, number>;
}
